# KTank 项目规则

## 重启开发服务

当用户说“重启一下”“帮我重启”或语义等价的指令时，直接执行以下流程，不再询问确认：

1. 停止当前 KTank 客户端和服务端进程，仅终止命令行路径属于当前仓库的进程。
2. 运行 `ipconfig getifaddr en0` 获取当前局域网 IP；若 `en0` 无地址，再检查当前有效网卡地址。
3. 后台启动服务端：

```bash
corepack pnpm --filter @ktank/server dev
```

4. 后台启动客户端，将 `<主机IP>` 替换为上一步获取的地址：

```bash
VITE_SERVER_URL=http://<主机IP>:3001 corepack pnpm --filter @ktank/client dev --host 0.0.0.0
```

5. 确认服务端监听 `3001`、客户端监听 `5173`，并向用户返回本机地址和局域网访问地址。

## 工程检查

代码修改完成后运行：

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## 游戏规则文档

- 当前游戏规则记录在 `docs/GAME_RULES.md`。
- 任何影响房间、玩家、操作、移动、射击、碰撞、生命值、胜负、重开、离开或断线重连的代码变更，都必须在同一次修改中同步更新 `docs/GAME_RULES.md`。
- 若 README 中存在对应简述，也必须保持一致。

## 项目约束

- 使用服务端权威模型，客户端只发送操作意图。
- 房间支持 2～4 人，房主负责开始和重新开始游戏。
- 主动退出或意外断线均保留玩家状态 30 秒，期间重新加入同一房间恢复原状态，超时后移除。
- 不提交 `nativeID`、`testID` 等调试定位字段。
- UI 位图素材必须提供 2x 资源。
