# KTank · AI 坦克竞技场 最终报告

## 项目概述

**项目名称**：KTank —— 浏览器多人实时坦克对战  
**团队成员**：panzexu03  
**技术栈**：TypeScript · Phaser 3 · Vite · Node.js · Socket.IO · pnpm workspace  
**仓库地址**：https://github.com/PPPPAZIKS/KTank

---

## 一、核心玩法与完成度

### 已实现功能（必做全部完成）

#### 必做 1：房间与玩家
- 支持创建或加入房间（输入房间号 + 昵称）
- 相同房间号的 2～4 名玩家进入同一局
- 颜色区分不同玩家（蓝 / 红 / 绿 / 黄）
- 玩家断线后自动从其他客户端移除坦克
- 房间满员或局中有明确错误提示

#### 必做 2：基础战斗
- WASD / 方向键移动，鼠标瞄准，点击或空格射击
- 地图四边界 + 中央障碍物阻挡
- 子弹与坦克碰撞判定（服务端权威计算）
- 每名玩家 3 点生命值，归零后淘汰
- 最后存活玩家获胜，支持平局

#### 必做 3：状态同步
- 服务端以 30 Tick/s 更新全局状态，20Hz 广播完整 `GameSnapshot`
- 客户端只发送操作意图（`playerInput` / `fire`），不做本地裁决
- 新加入客户端立即获得当前完整快照
- 两端最终展示一致的血量、淘汰、胜负结果

#### 必做 4：美术与反馈
| 资产类型 | 实现方式 |
|---|---|
| 坦克 | AIGC 生成 4 种颜色坦克图（PNG，透明背景） |
| 地图 / 障碍物 | Phaser Graphics 绘制网格背景 + 填色矩形障碍 |
| 子弹 | 短激光束（对应坦克颜色 + 白色芯线，Graphics 绘制） |
| 命中反馈 | 圆形闪光扩散动画（`showHit`，Tween） |
| 死亡爆炸 | `boom_4*4.png` 序列帧动画（16 帧，14fps，死亡时自动播放） |
| 胜利特效 | Lottie 矢量动画（`win/data.json`，仅胜利玩家可见，一次性播放） |

#### 必做 5：工程运行
```bash
# 安装
corepack pnpm install

# 本地启动（服务端 + 客户端同时）
corepack pnpm dev

# 构建 / 测试 / 检查
corepack pnpm build
corepack pnpm test
corepack pnpm check   # lint + typecheck + test
```

#### 必做 6：Skill 沉淀
交付 2 个可复用 Skill，详见 `final_result/skills/` 目录：

| Skill | 方向 | 文件 |
|---|---|---|
| AIGC 游戏素材生产 | 美术资产生产 | `skills/aigc-game-asset.md` |
| Phaser 序列帧动画接入 | 代码工程 | `skills/phaser-spritesheet-animation.md` |

---

## 二、多人状态与工程设计

### 服务端权威模型

```
客户端               服务端
  │  playerInput ──▶  │  GameManager.tick() × 30Hz
  │  fire        ──▶  │    物理更新、碰撞检测、生命值
  │  ◀── snapshot ──  │  广播 GameSnapshot × 20Hz
```

- 客户端只渲染快照，不做任何物理计算
- `BulletState.ownerId` 关联发射者，客户端根据颜色渲染激光束
- 同一快照内所有客户端看到的数据完全一致

### 工程结构

```
KTank/
├── apps/
│   ├── client/          # Phaser 3 前端（Vite）
│   └── server/          # Node.js 服务端（Socket.IO）
└── packages/
    └── shared/          # 类型 + 常量（两端共享）
```

共享包 `@ktank/shared` 统一定义了 `GameSnapshot`、`PlayerInput`、`BulletState` 等协议类型，避免两端类型漂移。

---

## 三、AI-Native 研发过程

| 环节 | AI 实际参与内容 | 人工判断 |
|---|---|---|
| 需求拆解 | 分析题目要求，产出 Milestone 和技术选型建议 | 确认 Phaser 3 + Socket.IO 技术栈 |
| 工程脚手架 | 生成 pnpm workspace 多包结构、tsconfig、ESLint 配置 | 审查依赖版本兼容性 |
| 协议设计 | 生成 `protocol.ts` 事件类型定义 | 确认 `ownerId` 字段和 `snapshot` 结构 |
| 服务端逻辑 | 生成 `GameManager`（Tick 循环、碰撞检测、房间管理） | 验证多客户端下状态一致性 |
| 客户端渲染 | 生成 `BattleScene`（坦克、子弹、健康条渲染） | 审查 z-order 和 Phaser API 调用 |
| 子弹视觉 | 迭代：圆形 → 粒子拖尾（失败）→ 锥形拖尾 → 激光束 | 判断粒子方案不可靠，改用 Graphics 方案 |
| 爆炸动画 | 生成 `setupFrameAnimation` / `playBoomAt` 通用工具函数 | 验证序列帧切割逻辑和 Phaser Spritesheet API |
| 图片处理 | Python Pillow flood-fill 去除 PNG 背景（灰色棋盘格 → 透明） | 调整容差参数，验证爆炸区域未被误删 |
| Lottie 集成 | 生成 `playWinAnim` / `stopWinAnim`，解决图片路径 Vite hash 问题 | 排查 `winPlayed` 标志位解决重复播放 |
| 调试排障 | 分析 `ERR_MODULE_NOT_FOUND`（`@ktank/shared` 未构建）报错 | 执行 `pnpm build` 生成 `dist/` |

### AI Harness 关键决策记录

1. **粒子方案失效**：Phaser `ParticleEmitter` 的 `speed:0` 和 `tint[]` 在快照驱动（非实时）场景下不可靠，AI 建议改用 `Graphics.fillTriangle`，经验证有效后再次迭代为激光束方案。

2. **Lottie 图片路径**：`data.json` 中的 `"u":"images/"` 在 Vite hash 后失效，AI 建议 import 图片 URL 后动态替换 `animationData.assets`，并设置 `e:1` 告知 lottie 以完整 URL 加载。

3. **背景去除**：原图为 RGB（无 Alpha），AI 通过像素采样确认背景色范围后，用 flood-fill 从边缘向内蔓延，仅对灰色像素透明化，保留橙红色火焰像素。

---

## 四、公司工程平台实践

- 项目使用 pnpm workspace 管理多包，符合公司前端工程规范
- 构建命令 `pnpm build` 对 client 和 server 均执行 `tsc --noEmit` 类型检查后再打包
- 环境变量通过 `.env.example` 说明，不含任何密钥
- README 提供本地启动、局域网联机、常见问题排查说明

---

## 五、视觉与交互体验

| 元素 | 设计决策 |
|---|---|
| 坦克贴图 | 4 种颜色对应 4 个玩家槽位，AIGC 生成统一风格 |
| 激光子弹 | 颜色对应坦克颜色，外光晕 + 白芯，方向由发射角度实时计算 |
| 血条 | 浮于坦克上方，绿（>35%）/ 红（≤35%）渐变 |
| 爆炸动画 | 死亡时自动播放 16 帧序列帧，播放完毕销毁，不影响性能 |
| 胜利特效 | Lottie 矢量动画叠加在结果面板上，每局仅播放一次 |
| 结果面板 | 绝对定位居中，平局 / 你赢了 / 他人获胜 三种文案 |

---

## 六、测试与鲁棒性

| 场景 | 处理方式 |
|---|---|
| 满员房间加入 | 服务端返回 `{ok: false, message}`，客户端显示错误文案 |
| 玩家断线 | Socket 断开时从房间移除，其他客户端下次快照不含该玩家 |
| 局中新客户端加入 | 立即推送完整 `GameSnapshot`，`applyInitialSnapshot` 同步渲染 |
| 共享包未构建 | 文档说明需先执行 `pnpm --filter @ktank/shared build` |
| Lottie 重复触发 | `winPlayed` 标志位保证每局仅播放一次 |

---

## 七、最小验证集

1. 两个客户端以相同房间号加入，双方均能看到彼此
2. 移动受地图边界和中央障碍限制
3. 射击命中后双方看到相同血量，3 次命中后显示相同胜负结果
4. 新客户端加入时立即获得房间完整状态
5. 客户端断开后，其坦克从其他客户端消失
6. 无效房间号和满员房间会返回明确提示

---

## 附：目录结构

```
final_result/
├── report.md                          # 本文档
└── skills/
    ├── aigc-game-asset.md             # Skill 1：AIGC 游戏素材生产
    └── phaser-spritesheet-animation.md # Skill 2：Phaser 序列帧动画接入
```
