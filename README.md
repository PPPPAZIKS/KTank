# KTank

浏览器多人坦克对战 Demo，采用服务端权威状态同步。

## 技术栈

- 客户端：TypeScript、Phaser 3、Vite、Socket.IO Client
- 服务端：Node.js、TypeScript、Express、Socket.IO
- 工程：pnpm workspace、Vitest、ESLint

## 快速开始

环境要求：Node.js 20+、pnpm 8+。

```bash
corepack pnpm install
corepack pnpm dev
```

打开 `http://localhost:5173`，在两个浏览器窗口输入相同房间号即可开始。服务端默认监听 `http://localhost:3001`。

## 操作

- `WASD` 或方向键：移动
- 鼠标：瞄准
- 鼠标点击或空格：射击
- 每名玩家 3 点生命；存活到最后的玩家获胜

## 最小验证集

1. 两个客户端以相同房间号加入，双方均能看到彼此。
2. 移动受地图边界和中央障碍限制。
3. 射击命中后双方看到相同血量，3 次命中后显示相同胜负结果。
4. 新客户端加入时立即获得房间完整状态。
5. 客户端断开后，其坦克从其他客户端消失。
6. 无效房间号和满员房间会返回明确提示。

## 工程命令

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm check
```

## 消息协议

客户端只发送 `joinRoom`、`playerInput`、`fire`、`restart` 操作意图。服务端以 30 Tick 更新位置、子弹、碰撞、生命值和胜负，以 20Hz 向房间广播完整 `snapshot`。
