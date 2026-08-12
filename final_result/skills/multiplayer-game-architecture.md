# Skill：小型联机游戏 服务端权威架构设计

## 适用场景

需要在浏览器中实现 2～8 人实时对战小游戏，要求：
- 不同客户端看到一致的关键游戏结果（血量、胜负、位置）
- 服务端负责物理判定，客户端不可作弊
- 单台 Node.js 服务器支撑多个独立房间
- 技术栈：Node.js + Socket.IO + TypeScript（前端任意游戏引擎）

本 Skill 以 KTank 坦克对战项目为参考实现，所有代码片段均来自真实项目。

---

## 输入

| 参数 | 说明 | KTank 示例值 |
|---|---|---|
| 最大玩家数 | 单房间上限 | 4 |
| 游戏 Tick 率 | 服务端物理更新频率 | 30 Hz |
| 快照推送率 | 向客户端广播频率 | 20 Hz |
| 客户端帧率 | 前端渲染帧率 | 60 fps（浏览器默认）|

---

## 输出

- 可运行的多人联机游戏后端
- 多端状态一致（关键结果由服务端裁决）
- 明确的协议类型定义（TypeScript 共享包）

---

## 核心架构

### 分层设计

```
┌─────────────────────────────────────────────┐
│              shared/                         │  ← 两端共用类型 + 常量
│  GameSnapshot / PlayerInput / BulletState   │
│  SERVER_TICK_RATE=30 / SNAPSHOT_RATE=20     │
└─────────────────────────────────────────────┘
         ↑ import              ↑ import
┌──────────────────┐  ┌──────────────────────┐
│   server/        │  │   client/            │
│  GameManager     │  │  BattleScene         │
│  GameRoom        │  │  (Phaser 3)          │
│  Socket handlers │  │  Socket.IO client    │
└──────────────────┘  └──────────────────────┘
```

**关键原则：客户端只发送"操作意图"，不做任何物理计算。**

---

## 操作步骤

### Step 1：定义共享协议类型

在 `packages/shared/src/protocol.ts` 中统一定义两端通信协议：

```typescript
// 服务端 → 客户端：完整世界快照
export interface GameSnapshot {
  roomId: string;
  status: 'waiting' | 'playing' | 'finished';
  hostId: string | null;
  players: TankState[];      // 所有玩家当前状态
  bullets: BulletState[];    // 所有子弹位置
  obstacles: ObstacleState[];
  winnerId: string | null;
  serverTime: number;        // 用于延迟估算
}

// 客户端 → 服务端：玩家操作意图（不含位置！）
export interface PlayerInput {
  sequence: number;  // 单调递增，服务端丢弃过期输入
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  angle: number;     // 炮管朝向（弧度），由鼠标位置计算
}

// Socket.IO 事件类型定义（TypeScript 类型安全）
export interface ClientToServerEvents {
  joinRoom: (req: JoinRequest, cb: (res: JoinResponse) => void) => void;
  playerInput: (input: PlayerInput) => void;
  fire: () => void;
  startGame: () => void;
  restart: () => void;
}

export interface ServerToClientEvents {
  snapshot: (snapshot: GameSnapshot) => void;
  notice: (message: string) => void;
}
```

**设计要点**：
- 快照包含完整状态，客户端每帧全量覆盖渲染（无需差分合并）
- 客户端只发送意图（按键布尔 + 鼠标角度），不发送位置
- `sequence` 字段防止乱序输入被使用

---

### Step 2：实现服务端房间（GameRoom）

房间封装单局游戏的全部可变状态和物理逻辑：

```typescript
export class GameRoom {
  readonly id: string;
  private readonly players = new Map<string, PlayerRecord>();
  private readonly bullets = new Map<string, BulletRecord>();
  private status: GameStatus = 'waiting';
  private hostId: string | null = null;
  private winnerId: string | null = null;

  // ─── 玩家管理 ───────────────────────────────────────────
  addPlayer(id: string, name: string): boolean {
    // 仅 waiting 状态、未满员才允许加入
    if (this.status !== 'waiting' || this.players.size >= MAX_PLAYERS) return false;
    // 按槽位分配固定出生点和颜色
    const slot = this.nextFreeSlot();
    this.players.set(id, { ...SPAWNS[slot], color: COLORS[slot], health: 3, alive: true, ... });
    this.hostId ??= id; // 第一个加入的是房主
    return true;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    // 清除该玩家的子弹
    for (const [bid, b] of this.bullets) {
      if (b.ownerId === id) this.bullets.delete(bid);
    }
    // 转移房主
    if (this.hostId === id) this.hostId = this.players.keys().next().value ?? null;
    // 玩家离开可能触发胜负判定
    if (this.status === 'playing') this.resolveWinner();
  }

  // ─── 输入接收 ────────────────────────────────────────────
  setInput(id: string, input: PlayerInput): void {
    const player = this.players.get(id);
    // 丢弃过期序号（防乱序）
    if (!player || input.sequence < player.input.sequence) return;
    player.input = input;
  }

  // ─── 物理 Tick（每帧由 GameManager 调用）────────────────
  update(deltaSeconds: number): void {
    if (this.status !== 'playing') return;
    for (const player of this.players.values()) {
      this.updatePlayer(player, deltaSeconds); // 移动 + 碰撞
    }
    this.updateBullets(deltaSeconds); // 弹道 + 碰撞
    this.resolveWinner();             // 胜负判定
  }

  // ─── 快照生成 ─────────────────────────────────────────────
  snapshot(): GameSnapshot {
    return {
      // 只序列化客户端需要的字段，不暴露 velocityX/Y 等内部状态
      players: [...this.players.values()].map(p => ({
        id: p.id, x: p.x, y: p.y, angle: p.angle,
        health: p.health, alive: p.alive, color: p.color, name: p.name
      })),
      bullets: [...this.bullets.values()].map(b => ({
        id: b.id, ownerId: b.ownerId, x: b.x, y: b.y
      })),
      // ...其余字段
    };
  }
}
```

**设计要点**：
- `PlayerRecord` 在 `TankState`（共享类型）基础上扩展了服务端私有字段（`velocityX`、`lastFireAt` 等），快照时只序列化公共字段
- 出生点固定（4 个角），按槽位分配，避免碰撞
- 射击频率限制（`lastFireAt` + `FIRE_COOLDOWN_MS`）在服务端执行，客户端发多少次 `fire` 事件都不能突破

---

### Step 3：实现 Tick 循环和快照广播（GameManager）

物理更新和快照广播使用**两个独立 `setInterval`**，频率解耦：

```typescript
export class GameManager {
  private readonly rooms = new Map<string, GameRoom>();

  start(): void {
    // 物理 Tick：30 Hz，保证运动精度
    this.loopTimer = setInterval(() => {
      const now = Date.now();
      const deltaSeconds = Math.min((now - this.lastUpdateAt) / 1000, 0.1); // 最大 100ms 防跳帧
      this.lastUpdateAt = now;
      for (const room of this.rooms.values()) {
        room.update(deltaSeconds);
      }
    }, 1000 / SERVER_TICK_RATE); // 33ms

    // 快照广播：20 Hz，减少带宽
    this.snapshotTimer = setInterval(() => {
      for (const room of this.rooms.values()) {
        this.io.to(room.id).emit('snapshot', room.snapshot());
      }
    }, 1000 / SNAPSHOT_RATE); // 50ms
  }
}
```

**设计要点**：
- `deltaSeconds` 用实际时间差，而非固定值——应对服务器卡顿（Tick 抖动）
- `Math.min(delta, 0.1)` 防止长时间卡顿后子弹/坦克位移过大穿墙
- 快照推送率（20Hz）低于 Tick 率（30Hz）：节省带宽，客户端渲染插值即可

---

### Step 4：实现 Socket 事件处理

```typescript
io.on('connection', (socket) => {
  // 加入房间（带 callback 确认）
  socket.on('joinRoom', (req, callback) => {
    const room = manager.getOrCreateRoom(req.roomId);
    if (!room.addPlayer(socket.id, req.name)) {
      callback({ ok: false, message: '房间已满或对局已开始' });
      return;
    }
    socket.data.roomId = req.roomId;   // 绑定到 socket，断线时用
    void socket.join(req.roomId);      // 加入 Socket.IO 房间（用于广播）
    callback({ ok: true, playerId: socket.id, snapshot: room.snapshot() });
    io.to(req.roomId).emit('snapshot', room.snapshot()); // 通知其他人
  });

  // 输入（高频，无 callback，无需确认）
  socket.on('playerInput', (input) => {
    manager.getRoom(socket.data.roomId)?.setInput(socket.data.playerId, input);
  });

  // 断线清理
  socket.on('disconnect', () => {
    const { roomId, playerId } = socket.data;
    if (roomId && playerId) manager.removePlayer(roomId, playerId);
  });
});
```

**设计要点**：
- `joinRoom` 使用 Socket.IO callback（请求-响应模式），其余事件使用 fire-and-forget
- `socket.data` 存储玩家房间信息，断线时无需玩家主动发送离开消息
- `socket.join(roomId)` 后可直接用 `io.to(roomId).emit()` 向房间广播

---

### Step 5：客户端只渲染快照，不做物理计算

```typescript
// BattleScene（Phaser 3）
create(): void {
  this.client.onSnapshot((snapshot) => {
    this.latestSnapshot = snapshot;
    this.syncSnapshot(snapshot); // 全量覆盖渲染
  });
}

// 每帧采集输入，发送给服务端
update(): void {
  const input: PlayerInput = {
    sequence: ++this.sequence,
    up: this.cursors.up.isDown || this.wasd.up.isDown,
    // ...
    angle: Phaser.Math.Angle.Between(player.x, player.y, pointer.worldX, pointer.worldY)
  };
  this.client.sendInput(input);
}

// 渲染：直接设置快照中的位置，不做任何预测
private syncSnapshot(snapshot: GameSnapshot): void {
  for (const player of snapshot.players) {
    view.body.setPosition(player.x, player.y).setRotation(player.angle);
    // ...
  }
}
```

---

## 关键参数

| 参数 | KTank 值 | 建议范围 | 影响 |
|---|---|---|---|
| `SERVER_TICK_RATE` | 30 Hz | 20～60 Hz | 碰撞精度、弹道准确性 |
| `SNAPSHOT_RATE` | 20 Hz | 15～30 Hz | 带宽、视觉流畅度 |
| `BULLET_SPEED` | 420 px/s | 200～600 | 游戏节奏 |
| `FIRE_COOLDOWN_MS` | 450 ms | 200～1000 | 射击手感 |
| `MAX_PLAYERS` | 4 | 2～8 | 房间规模 |
| delta 上限 | 100 ms | 50～200 ms | 防止卡顿后穿墙 |

---

## 使用约束

1. **不要在客户端做物理裁决**：位置插值（本地预测）可以做，但最终以服务端快照为准
2. **快照全量推送**：简单可靠，对 2～8 人小游戏带宽完全够用；人数更多再考虑差分推送
3. **`socket.id` 作为玩家 ID**：断线重连会生成新 ID，如需断线续玩需额外设计 token 机制
4. **共享包必须先构建**：服务端 `import '@ktank/shared'` 依赖 `dist/`，修改 shared 后必须执行 `pnpm --filter @ktank/shared build`
5. **delta 时间上限**：`Math.min(delta, 0.1)` 防止服务器卡顿后游戏对象突然大幅位移
6. **不要把密钥写入 `shared`**：共享包内容会被打包进客户端 bundle

---

## 验证方法

### 基础验证
```bash
# 启动
corepack pnpm install && corepack pnpm dev

# 打开两个浏览器窗口，输入相同房间号
# 验证：
# 1. 双方都能看到对方坦克
# 2. 一方移动，另一方画面同步更新
# 3. 射击命中后两端血量一致
# 4. 一方关闭标签页，另一方的坦克消失
```

### 状态一致性验证
在浏览器 Console 中输出服务端快照的 `serverTime`：

```javascript
// 客户端注入日志（临时调试用）
socket.on('snapshot', (snap) => {
  console.log('serverTime:', snap.serverTime, 'players:', snap.players.map(p => `${p.name}:${p.health}`));
});
```

两个客户端的控制台应输出相同的 `serverTime` 和 `health` 值。

### Tick 率验证

```typescript
// GameManager 中临时添加
let tickCount = 0;
setInterval(() => {
  console.log(`Tick/s: ${tickCount}`);
  tickCount = 0;
}, 1000);
// 在 loopTimer 中 tickCount++
```

稳定在 28～32 次/秒为正常。

---

## 使用示例

**目标**：在 KTank 基础上增加一种新的游戏模式（护旗模式）

```typescript
// 1. 在 shared/protocol.ts 中扩展快照
export interface GameSnapshot {
  // ...原有字段
  flagPosition?: { x: number; y: number };  // 新增旗帜位置
  flagHolder?: string | null;               // 持旗玩家 ID
}

// 2. 在 GameRoom.ts 中添加旗帜状态
private flag = { x: 480, y: 320 };
private flagHolder: string | null = null;

// 在 update() 中检测玩家是否捡到旗帜
private updateFlag(): void {
  for (const player of this.players.values()) {
    if (circlesOverlap(player, TANK_RADIUS, this.flag, 20)) {
      this.flagHolder = player.id;
    }
  }
}

// 3. snapshot() 中带上新字段
snapshot(): GameSnapshot {
  return { ...existing, flagPosition: this.flag, flagHolder: this.flagHolder };
}

// 4. 客户端 syncSnapshot 中渲染旗帜（无需修改任何物理逻辑）
if (snapshot.flagPosition) {
  this.flagSprite.setPosition(snapshot.flagPosition.x, snapshot.flagPosition.y);
}
```

**结论**：新增游戏元素只需：①扩展共享协议 → ②服务端 GameRoom 增加状态和更新逻辑 → ③客户端 syncSnapshot 增加渲染，三层完全解耦。
