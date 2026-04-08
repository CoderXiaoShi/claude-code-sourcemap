# Code Buddy 架构与服务端设计

本文档描述当前实现中的整体结构，以及后续承载多种游戏时采用的**服务端权威（server-authoritative）**方案。

## 1. 项目目标

`code-buddy` 现在同时提供：

- **CLI 客户端**：负责用户输入、终端渲染、局域网发现、房间操作
- **LAN 服务端**：负责在线状态、房间、游戏逻辑、状态广播

核心原则：

- **客户端只提交行为**
- **所有游戏计算都在服务端完成**
- **客户端只消费状态与事件并负责渲染**

这使后续扩展到不同联机玩法时，不会把判定逻辑散落到客户端。

## 2. 服务端权威模型

### 2.1 数据流

1. 客户端发送输入行为，例如：
   - `join_room`
   - `select_game`
   - `set_ready`
   - `start_game`
   - `game_command`
2. 服务端完成：
   - 参数校验
   - 房间权限校验
   - 游戏规则计算
   - 状态更新
   - 事件广播
3. 服务端向房间广播：
   - `rooms_update`
   - `game_started`
   - `game_event`
   - `game_state`
4. 客户端只渲染房间和游戏状态

### 2.2 为什么采用这一模型

- 防作弊：客户端不能自行决定胜负、位置、成熟时间
- 一致性：所有玩家看到同一份服务端状态
- 可扩展：新增游戏只需要新增一个服务端 `GameDefinition`
- 易持久化：状态快照和事件天然适合落 SQLite

## 3. 当前服务端分层

### 3.1 Transport 层

目录：

- `src/server/server.ts`
- `src/server/ndjson.ts`
- `src/server/discovery.ts`
- `src/server/probe.ts`

职责：

- TCP 连接与握手
- UDP 广播发现
- NDJSON 编解码
- 房间广播与单连接回包

这一层不承载具体游戏规则。

### 3.2 Lobby 层

目录：

- `src/server/lobby.ts`
- `src/server/protocol.ts`

职责：

- 在线玩家与房间关系
- 创建/加入/退出房间
- 房主权限
- 游戏类型选择
- 准备状态
- 房间状态（`open` / `playing`）

### 3.3 Game Runtime 层

目录：

- `src/server/game/registry.ts`
- `src/server/game/runtime.ts`
- `src/server/game/types.ts`
- `src/server/games/maze-race.ts`

职责：

- 注册当前启用的可玩游戏
- 为每个房间创建独立游戏实例
- 对同一房间的命令做**串行执行**
- 生成事件与状态快照
- 调度延时任务

## 4. 目录结构

当前与服务端相关的关键目录如下：

```text
src/
  cli.ts
  online.ts
  lan-server.ts
  server/
    client.ts
    protocol.ts
    server.ts
    lobby.ts
    ndjson.ts
    discovery.ts
    probe.ts
    game/
      types.ts
      registry.ts
      runtime.ts
    games/
      maze-race.ts
```

## 5. 核心模型

### 5.1 房间模型

`RoomInfo` 现在不仅描述房间成员，还描述运行中的游戏：

- `memberIds`
- `readyMemberIds`
- `gameType`
- `currentGameId`
- `status`

这让“房间”成为统一入口，而不是把每种游戏的状态混进网络层。

### 5.2 游戏模型

每种游戏都实现统一接口：

- `createInitialState`
- `applyCommand`
- `applyScheduledTask`
- `listScheduledTasks`

也就是说：

- **迷宫** 用移动命令推进
- 后续新增玩法时，也继续复用同一套运行时框架。

### 5.3 运行时模型

每个房间最多绑定一个活跃 `GameInstance`：

- `roomId`
- `gameInstanceId`
- `gameType`
- `state`
- `version`

同一房间的所有命令进入同一条串行队列，避免并发踩状态。

## 6. 当前已实现的游戏

### 7.1 `maze-race`

- 类型：`match`
- 人数：2 人
- 逻辑：服务端负责移动判定、墙体碰撞、胜负判定
- 命令：`move`

## 7. 协议演进

当前协议保留原有 LAN 房间能力，并新增：

- `select_game`
- `set_ready`
- `start_game`
- `game_command`
- `game_started`
- `game_event`
- `game_state`

原则：

- 房间消息用于会话组织
- 游戏消息用于具体玩法
- 新增游戏尽量不改 Transport 层

## 8. 可扩展性策略

后续新增游戏时，推荐遵守下面的边界：

1. 在 `src/server/games/` 新增一个游戏模块
2. 实现统一 `GameDefinition`
3. 在 `GameRegistry` 中注册
这样：

- 不需要重写 `server.ts`
- 不需要侵入 Lobby 逻辑
- 不需要改 UDP/TCP 发现流程

## 9. 后续建议

下一步可以继续做：

- 继续打磨迷宫 CLI 体验与状态展示
- 为 `maze-race` 补地图生成与观战信息
- 为迷宫补倒计时、局内结算、排行榜
- 增加游戏事件回放与断线重连恢复
- 增加协议级测试和运行时集成测试
