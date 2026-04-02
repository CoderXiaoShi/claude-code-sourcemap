# Code Buddy 架构与交互设计

本文档基于仓库当前代码（`src/`）描述：整体架构、模块边界、关键数据流，以及“离线 + 局域网联机（LAN）”的用户体验与部署方式。

## 1. 项目概览

`code-buddy` 是一个 TypeScript/Node.js 项目，同时提供：

- **CLI 终端应用**：生成、展示 Buddy（ASCII 精灵/表情）、本地存档、简单动画、局域网联机入口
- **可复用库**：导出生成/渲染/存档以及 LAN 客户端/服务端相关 API
- **独立 LAN 服务端进程**：默认端口 `4432`，可由 `pm2` 常驻托管

## 2. 用户体验（UX）

### 2.1 CLI 两种使用方式

1) **参数模式（一次性输出）**

- `buddy --user <id>`：对同一 `userId` 确定性生成同一只 Buddy
- `buddy --seed <seed>`：对同一 `seed` 确定性复现同一只 Buddy
- `buddy --once`：随机抽取一只，并可选择是否写入本地存档
- `buddy --animate`：在输出后播放一次精灵逐帧动画预览

2) **交互模式（默认）**

当未传入 `--user` / `--seed` / `--once` 时进入交互菜单，支持：

- 查看当前已保存宠物（若存在存档）
- 连续抽取 / 单次抽取，并选择是否保存
- 播放动画预览
- 删除本地存档
- 进入“局域网联机”菜单（加入局域网 / 本机开服与状态管理）

### 2.2 本地存档

- 默认存档文件：`./buddy-pet.json`（可通过 `--save-file` 指定）
- 存档内容是可读 JSON，并做了对历史字段的兼容归一化（例如 `rarityScore`/`level`）

### 2.3 局域网联机（LAN）

联机仅面向局域网（无互联网服务端、无数据库），主要体验点：

- **加入局域网**：优先使用 **UDP 广播发现**局域网服务器；若广播受限则自动回退到 TCP 扫描探测
- **开启服务（pm2 常驻）**：在 CLI 中直接调用 `pm2` 启动/重载独立服务端进程，并通过健康检查确认启动结果
- **查看状态 / 停止服务**：在 CLI 中查看 pm2 状态 + TCP 健康检查，并可停止服务
- **房间号**：创建房间后返回一个 **4 位数字房间号**（例如 `0427`），便于口头输入与分享
- **用户列表/房间列表**：服务端维护在线用户列表与房间列表，并向所有客户端广播更新

## 3. 模块边界与目录结构

### 3.1 入口文件

- `src/cli.ts`：CLI 主入口（参数解析、交互菜单、离线玩法编排、联机入口）
- `src/lan-server.ts`：独立 LAN 服务端进程入口（用于 `buddy-server`/pm2 托管）
- `src/index.ts`：库入口（统一 re-export）

### 3.2 离线核心能力

- `src/companion.ts`：领域生成（确定性 RNG、稀有度、属性、骨架生成、随机抽取）
- `src/sprites.ts`：渲染（表情 + ASCII Sprite 帧）
- `src/storage.ts`：本地存档（JSON 保存/读取/删除、兼容归一化）
- `src/types.ts`：类型与常量单一事实来源（物种/眼睛/帽子/稀有度/ANSI 等）

### 3.3 联机入口与进程管理

- `src/online.ts`：联机菜单（加入局域网、pm2 常驻开服、状态/停止）
- `src/pm2.ts`：`pm2` 命令封装（启动/停止/状态查询；CLI 只依赖它而不直接散落 shell 调用）

### 3.4 LAN 网络模块（可复用）

目录：`src/server/`

- `protocol.ts`：协议与数据结构（服务信息/用户/房间/消息类型）
- `ndjson.ts`：NDJSON 编解码（按行 JSON，适合 TCP 流式读写）
- `rooms.ts`：房间注册表（创建/加入/离开、空房间回收、4 位房间号）
- `server.ts`：LAN 服务端（TCP 会话、UDP 探测响应、广播 users/rooms 更新）
- `client.ts`：LAN 客户端（连接、请求/响应、状态更新事件）
- `discovery.ts`：发现（UDP 广播优先；必要时回退 TCP 扫描）
- `probe.ts`：健康检查（TCP `probe`）

## 4. 核心数据模型

### 4.1 Buddy 领域模型

`CompanionBones` 是 Buddy 的核心骨架：

```ts
type CompanionBones = {
  rarity: Rarity
  rarityScore: number
  species: Species
  eye: Eye
  hat: Hat
  shiny: boolean
  stats: Record<StatName, number>
}
```

- `Roll`：在 `CompanionBones` 外补充 `inspirationSeed`，用于展示与传播
- `SavedRoll`：存档结构（`savedAt` + `roll`）

### 4.2 LAN 模型

- `ServerInfo`：服务器标识/名称/端口
- `UserInfo`：在线用户（含 `roomId`）
- `RoomInfo`：房间（4 位房间号、名称、owner、成员列表）

## 5. LAN 协议与运行方式

### 5.1 传输层

- **会话与业务消息**：TCP + NDJSON（每条消息一行 JSON）
- **发现**：UDP 广播 `probe` → 服务端 UDP 回 `probe_result`
- **健康检查**：TCP `probe` → `probe_result`

### 5.2 关键消息（示例）

- `probe` / `probe_result`：发现与健康检查
- `hello` / `welcome`：握手与初始状态同步
- `users_update` / `rooms_update`：服务端广播状态变更
- `create_room` / `join_room` / `leave_room`：房间操作
- `list_users` / `list_rooms`：按需拉取列表（带 `requestId`）

### 5.3 服务端状态

- 服务端为**内存态**（无数据库、无持久化）
- 在线用户断开时会自动从用户列表移除，并离开房间
- 当房间成员为空时，房间自动回收

## 6. 构建、发布与部署

### 6.1 构建

- `tsc` 编译：`src/**/*.ts` → `dist/`
- `scripts/add-shebang.mjs`：为 `dist/cli.js` 与 `dist/lan-server.js` 补充 shebang

### 6.2 发布

- npm 包只发布 `dist/`
- `bin`：
  - `buddy` → `dist/cli.js`
  - `buddy-server` → `dist/lan-server.js`

### 6.3 pm2 托管

- `ecosystem.config.cjs` 定义常驻服务进程（默认端口 `4432`）
- CLI 联机菜单会调用 pm2 启动/重载，并做 `127.0.0.1:4432` 的健康检查

## 7. 可扩展性与演进建议

- **协议可版本化**：`PROTOCOL_VERSION` 已存在；新增消息建议保持向后兼容或提升版本
- **更强的游戏化扩展**：建议以“事件/命令”风格扩展消息类型（例如 `player_update`、`room_event`、`chat`）
- **测试**：优先补充确定性生成与渲染快照测试；LAN 层可用协议回放做集成测试

