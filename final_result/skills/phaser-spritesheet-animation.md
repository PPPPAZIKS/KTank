# Skill：Phaser 3 序列帧动画接入

## 适用场景

在 Phaser 3 游戏项目中，将命名规范为 `name_NxM.png` 的等分 Spritesheet 图集接入为序列帧动画，并在指定游戏事件（如角色死亡、技能释放）时触发一次性播放。

适用于：
- 爆炸、死亡、技能特效等"一次性"序列帧动画
- 循环播放的行走、待机动画
- 无需 TexturePacker JSON，仅有图集 PNG 的场景

---

## 输入

| 参数 | 说明 | 示例 |
|---|---|---|
| 图集文件 | 等分 Spritesheet PNG，命名含行列数 | `boom_4x4.png`（1024×1024，4行4列）|
| 帧率 | 每秒播放帧数 | `14`（fps）|
| 播放比例 | 渲染缩放 | `0.5`（原图 50%）|
| 触发事件 | 何时播放 | 玩家 `alive: true → false` |

---

## 输出

- Phaser `AnimatedSprite`，在指定位置自动播放，播放完毕自动销毁
- 无内存泄漏（`ANIMATION_COMPLETE` 事件触发 `destroy()`）

---

## 操作步骤

### Step 1：图集命名规范

将图集文件命名为：

```
{动画名}_{行数}x{列数}.png
```

| 命名示例 | 行数 | 列数 | 总帧数 |
|---|---|---|---|
| `boom_4x4.png` | 4 | 4 | 16 |
| `walk_2x8.png` | 2 | 8 | 16 |
| `idle_1x6.png` | 1 | 6 | 6 |

分隔符支持 `*`、`x`、`×`，如 `boom_4*4.png` 也有效。

### Step 2：工程中 import 图片

在 `BattleScene.ts`（或其他 Phaser Scene）顶部：

```typescript
import boomUrl from '../assets/effects/boom_4x4.png';
```

### Step 3：preload 中加载为普通图片

```typescript
preload(): void {
  // 先以普通 image 加载，后续在 create() 中手动切帧
  this.load.image('boom', boomUrl);
}
```

> **为什么不用 `this.load.spritesheet`？**  
> `load.spritesheet` 需要在加载时就指定帧尺寸，而我们的尺寸从文件名动态解析，在 `create()` 阶段才确定，因此先 `load.image` 再手动添加帧更灵活。

### Step 4：create 中注册动画（通用工具函数）

将以下函数粘贴到 Phaser Scene 类中：

```typescript
/**
 * 解析文件名中的行列数。
 * 支持格式：boom_4x4.png / boom_4*4.png / boom_4×4.png
 * @param url  图片 URL（含文件名）
 * @returns    { rows, cols }
 */
private parseGridFromFilename(url: string): { rows: number; cols: number } {
  const filename = url.split('/').pop()!.replace(/\.[^.]+$/, '');
  const segment = filename.split('_').pop() ?? '1x1';
  const parts = segment.split(/[*x×]/i);
  const rows = parseInt(parts[0] ?? '1', 10);
  const cols = parseInt(parts[1] ?? parts[0] ?? '1', 10);
  return { rows, cols };
}

/**
 * 将已加载的普通纹理按命名约定切割为序列帧，并注册 Phaser 动画。
 * @param key      纹理 key（需已在 preload 中 load.image）
 * @param url      原始 URL（用于从文件名解析行列数）
 * @param options  帧率（frameRate）和渲染缩放（scale）
 */
private setupFrameAnimation(
  key: string,
  url: string,
  options: { frameRate?: number; scale?: number; repeat?: number } = {}
): void {
  const { cols, rows } = this.parseGridFromFilename(url);
  const tex = this.textures.get(key);
  const totalW = tex.source[0]!.width;
  const totalH = tex.source[0]!.height;
  const frameW = Math.floor(totalW / cols);
  const frameH = Math.floor(totalH / rows);

  // 向纹理添加数字索引帧（0, 1, 2 ... rows*cols-1）
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tex.add(idx++, 0, c * frameW, r * frameH, frameW, frameH);
    }
  }

  this.anims.create({
    key,
    frames: Array.from({ length: rows * cols }, (_, i) => ({ key, frame: i })),
    frameRate: options.frameRate ?? 12,
    repeat: options.repeat ?? 0,   // 0 = 播放一次，-1 = 循环
  });

  // 缓存缩放比，供 playAnimAt 使用
  if (options.scale !== undefined) {
    this.registry.set(`${key}_scale`, options.scale);
  }
}
```

在 `create()` 末尾调用：

```typescript
create(): void {
  // ... 其他初始化 ...
  this.setupFrameAnimation('boom', boomUrl, { frameRate: 14, scale: 0.5 });
}
```

### Step 5：触发一次性播放

```typescript
/**
 * 在指定位置播放一次序列帧动画，播放完毕后自动销毁。
 * @param key  动画 key（同 setupFrameAnimation 注册时的 key）
 * @param x    世界坐标 X
 * @param y    世界坐标 Y
 */
private playAnimAt(key: string, x: number, y: number): void {
  const scale = (this.registry.get(`${key}_scale`) as number | undefined) ?? 1;
  const sprite = this.add.sprite(x, y, key, 0);
  sprite.setScale(scale);
  sprite.play(key);
  sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy());
}
```

### Step 6：在事件中调用

以坦克死亡为例，在 `syncSnapshot` 中检测 `alive: true → false`：

```typescript
// 在 Scene 中维护上一帧的存活状态
private previousAlive = new Map<string, boolean>();

// 在 syncSnapshot 的玩家循环中
for (const player of snapshot.players) {
  // ... 更新位置、血条 ...

  const wasAlive = this.previousAlive.get(player.id);
  if (wasAlive === true && !player.alive) {
    this.playAnimAt('boom', player.x, player.y);
  }
  this.previousAlive.set(player.id, player.alive);
}
```

---

## 使用约束

1. **等分图集**：每帧必须等宽等高，否则切帧位置错误
2. **帧序**：切帧顺序为从左到右、从上到下（行优先）
3. **preload 顺序**：必须在 `preload()` 中先 `load.image`，在 `create()` 中再 `setupFrameAnimation`
4. **key 唯一性**：同一 Phaser Scene 中不同动画 key 不能重复
5. **scale 缓存**：`registry.set` 使用字符串 `${key}_scale`，多动画时不冲突
6. **一次性播放**：`repeat: 0` + `ANIMATION_COMPLETE` 销毁，不会产生孤立 Sprite
7. **透明背景**：图集必须是 RGBA PNG，否则帧间会有白色或黑色边框

---

## 验证方法

1. **帧数验证**：打印 `rows * cols`，应等于实际动画帧数
2. **视觉验证**：在目标位置触发事件，确认动画完整播放且无残影
3. **内存验证**：触发多次后，用浏览器 DevTools → Memory → Heap Snapshot 确认无泄漏

```typescript
// 快速验证：在 create() 末尾手动触发一次
this.time.delayedCall(500, () => this.playAnimAt('boom', 400, 300));
```

4. **帧切割验证**：

```typescript
// 在 create() 中打印帧信息
const tex = this.textures.get('boom');
console.log('帧总数:', Object.keys(tex.frames).length - 1); // -1 排除 __BASE
```

---

## 使用示例

**目标**：为 KTank 接入 `boom_4x4.png` 爆炸动画

```typescript
// 1. 导入图片
import boomUrl from '../assets/effects/boom_4*4.png';

// 2. preload 中加载
this.load.image('boom', boomUrl);

// 3. create 中注册（图集 1024×1024，16帧，14fps，渲染为 50%）
this.setupFrameAnimation('boom', boomUrl, { frameRate: 14, scale: 0.5 });

// 4. 死亡时触发
if (wasAlive && !player.alive) {
  this.playAnimAt('boom', player.x, player.y);
}
```

**效果**：坦克死亡时，在其位置播放 16 帧爆炸动画（约 1.1 秒），播放完毕自动销毁，不影响游戏性能。

---

## 扩展：注册多个动画

```typescript
// create() 中注册多个不同动画
this.setupFrameAnimation('boom',    boomUrl,    { frameRate: 14, scale: 0.5 });
this.setupFrameAnimation('hit',     hitUrl,     { frameRate: 20, scale: 0.3 });
this.setupFrameAnimation('shield',  shieldUrl,  { frameRate: 10, scale: 0.8, repeat: -1 });
//                                                                             ^^^^^^^^^^
//                                                                             repeat: -1 = 循环

// 调用
this.playAnimAt('boom', x, y);
this.playAnimAt('hit', x, y);
```
