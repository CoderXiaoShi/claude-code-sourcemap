# `sxl-code-buddy`

一个轻松有趣的终端 Buddy（宠物/伙伴）生成器：离线可玩、可本地存档，并支持局域网联机（LAN）。

## 主要特性

- **确定性生成**：同 `userId` / `seed` 生成结果稳定一致
- **ASCII 展示**：属性、表情与多帧精灵（可选动画预览）
- **交互式菜单**：默认启动进入菜单，更适合日常使用
- **局域网联机（可选）**
  - UDP 广播发现服务器（必要时回退 TCP 探测）
  - 房间功能 + 用户列表
  - 本机可用 `pm2` 常驻托管独立服务端进程
- **服务端权威游戏架构**
  - 房间、准备、选游戏、开局都由服务端管理
  - 游戏命令由服务端计算并广播状态
- **当前已启用迷宫玩法**
  - 双人房间准备后开局
  - 客户端只负责输入与渲染

## 安装

全局安装：

```bash
npm install -g sxl-code-buddy
```

或直接运行：

```bash
npx sxl-code-buddy
```

## 快速开始（CLI）

进入交互模式（默认）：

```bash
buddy
```

随机抽一只：

```bash
buddy --once
```

按种子生成（可复现）：

```bash
buddy --seed myseed
```

按用户 ID 稳定生成（可复现）：

```bash
buddy --user alice
```

播放动画预览：

```bash
buddy --seed myseed --animate
```

## 交互式菜单说明

运行 `buddy` 后，菜单一般包含：

- 查看当前宠物 / 单次抽取 / 连续抽取
- 播放宠物动画
- **局域网联机**：加入局域网 / 建房 / 选迷宫 / 准备 / 开始 / 进入游戏

## 局域网联机（LAN）

### 作为服务器（推荐：pm2 常驻）

先构建：

```bash
npm run build
```

使用 pm2 启动（常驻）：

```bash
pm2 start ecosystem.config.cjs
```

查看日志：

```bash
pm2 logs code-buddy-lan
```

停止服务：

```bash
pm2 stop code-buddy-lan
```

说明：

- 默认端口：`4432`（TCP 会话 + UDP 发现）
- 你也可以用 `buddy-server` 直接启动一次性服务进程（适合调试）

### 作为客户端加入

运行 `buddy` → 选择 `局域网联机` → `加入局域网（自动发现）`，选中目标服务器即可。

房间号是 **4 位数字**（例如 `0427`），创建房间后会自动加入。

### 常见问题

- **发现不到服务器**：可能是防火墙拦截 UDP/TCP `4432` 或网络不在同一网段；客户端会自动回退 TCP 探测，但仍需端口可达

## CLI 参数

| 参数 | 说明 |
| --- | --- |
| `--user <id>` | 基于用户 ID 稳定生成 |
| `--seed <seed>` | 基于 seed 复现同一只 |
| `--once` | 随机生成一只 |
| `--list-species` | 查看支持的物种 |
| `--list-eyes` | 查看支持的眼睛样式 |
| `--list-hats` | 查看支持的帽子样式 |
| `--animate` | 显示动画预览 |
| `-h`, `--help` | 查看帮助 |

## 作为库使用（Programmatic）

```ts
import {
  roll,
  rollRandom,
  rollWithSeed,
  renderFace,
  renderSprite,
  // LAN (optional)
  BuddyLanClient,
  scanLanForBuddyServers,
} from 'sxl-code-buddy'

const fixed = roll('alice')
const seeded = rollWithSeed('demo-seed')
const random = rollRandom()

console.log(fixed.bones.species)
console.log(renderFace(seeded.bones))
console.log(renderSprite(random.bones).join('\n'))

const servers = await scanLanForBuddyServers()
if (servers[0]) {
  const client = await BuddyLanClient.connect({
    host: servers[0].ip,
    port: servers[0].server.port,
    name: 'alice',
  })
  console.log(client.state.rooms)
  console.log(client.state.games)
  client.close()
}
```

## 开发

安装依赖：

```bash
npm install
```

构建：

```bash
npm run build
```

开发监听：

```bash
npm run watch
```

本地运行：

```bash
npm start
```

## License

MIT
