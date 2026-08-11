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

打开 `http://localhost:5173`，在 2～4 个浏览器窗口输入相同房间号。首位加入者是房主，至少 2 人加入后由房主点击“开始游戏”。服务端默认监听 `http://localhost:3001`。

## 局域网多人联机

选择一台电脑作为主机，主机负责运行服务端和客户端，其他电脑只需使用浏览器访问主机。

### 1. 获取主机局域网 IP

macOS Wi-Fi 通常使用 `en0`：

```bash
ipconfig getifaddr en0
```

例如返回 `172.24.66.162`。如果没有输出，可运行 `ifconfig` 查看当前联网网卡的 `inet` 地址。不要使用 `127.0.0.1`。

### 2. 在主机启动服务端

```bash
corepack pnpm --filter @ktank/server dev
```

服务端监听 `0.0.0.0:3001`，同一局域网内的设备可以连接。

### 3. 在主机启动局域网客户端

另开一个终端，将示例 IP 替换为主机实际 IP：

```bash
VITE_SERVER_URL=http://172.24.66.162:3001 corepack pnpm --filter @ktank/client dev --host 0.0.0.0
```

Vite 会输出类似地址：

```text
Network: http://172.24.66.162:5173/
```

### 4. 其他电脑加入游戏

1. 确保所有电脑连接同一个 Wi-Fi 或局域网。
2. 在其他电脑浏览器打开 `http://主机IP:5173`，例如 `http://172.24.66.162:5173`。
3. 所有玩家输入相同房间号、不同昵称。
4. 房间支持 2～4 名玩家，首位加入者是房主；至少 2 人加入后由房主点击“开始游戏”。
5. 开局后房间锁定，新玩家需要等待下一局或加入其他房间。

### 5. 无法访问时排查

- 确认其他电脑可以 `ping 主机IP`。
- 确认客户端命令包含 `--host 0.0.0.0`。
- 确认 `VITE_SERVER_URL` 使用主机局域网 IP，而不是 `localhost`。
- 确认 macOS 防火墙允许 Node.js 接收入站连接，并放行 TCP 端口 `5173` 和 `3001`。
- 某些公司 Wi-Fi 开启了客户端隔离，设备之间无法直连；可改用允许设备互访的 Wi-Fi 或手机热点。
- 主机 IP 变化后，需要使用新 IP 重启客户端，并让其他玩家访问新地址。

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
