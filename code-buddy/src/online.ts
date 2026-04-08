import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import readline from 'node:readline'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { scanLanForBuddyServers } from './server/discovery.js'
import { BuddyLanClient } from './server/client.js'
import {
  DEFAULT_SERVER_PORT,
  type GameInfo,
  type GameStateSnapshot,
  type RoomInfo,
  type UserInfo,
} from './server/protocol.js'
import { probeBuddyServerTcp } from './server/probe.js'
import {
  isPm2Available,
  pm2JList,
  pm2StartOrReloadEcosystem,
  pm2Stop,
} from './pm2.js'

type MazeRaceState = {
  kind: 'maze-race'
  width: number
  height: number
  walls: string[]
  finish: { x: number; y: number }
  players: Record<string, { x: number; y: number; steps: number }>
  status: 'playing' | 'finished'
  winnerId: string | null
}

export type NetworkConnection = {
  client: BuddyLanClient
  serverIp: string
}

function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase()
}

function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, resolve)
  })
}

async function waitForContinue(
  rl: readline.Interface,
  prompt = '\n按回车继续... ',
): Promise<void> {
  await askQuestion(rl, prompt)
}

function formatServerLine(
  index: number,
  item: Awaited<ReturnType<typeof scanLanForBuddyServers>>[number],
): string {
  return `${index + 1}. ${item.ip} - ${item.server.name}（在线: ${item.stats.users}，房间: ${item.stats.rooms}）`
}

function defaultClientName(): string {
  try {
    const user = os.userInfo().username
    if (user) return user
  } catch {
    // ignore
  }
  return `buddy-${randomUUID().slice(0, 8)}`
}

function getLocalIp(): string {
  const interfaces = os.networkInterfaces()
  for (const ifaces of Object.values(interfaces)) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return '127.0.0.1'
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function currentRoom(client: BuddyLanClient): RoomInfo | null {
  const roomId = client.state.you.roomId
  if (!roomId) return null
  return client.state.rooms.find(room => room.id === roomId) ?? null
}

function findGameInfo(client: BuddyLanClient, type: GameInfo['type'] | null): GameInfo | null {
  if (!type) return null
  return client.state.games.find(game => game.type === type) ?? null
}

function formatRoomStatus(room: RoomInfo, client: BuddyLanClient): string {
  const game = findGameInfo(client, room.gameType)
  return `${room.status === 'playing' ? '进行中' : '待机'} / ${game?.name ?? '未选游戏'}`
}

function printRoomList(client: BuddyLanClient, rooms: RoomInfo[]): void {
  console.log('\n房间列表:')
  if (rooms.length === 0) {
    console.log('  （暂无）')
    return
  }

  for (const room of rooms) {
    console.log(
      `  - ${room.id} :: ${room.name}（${formatRoomStatus(room, client)} / 人数: ${room.memberIds.length}）`,
    )
  }
}

function printUserList(users: UserInfo[]): void {
  console.log('\n用户列表:')
  if (users.length === 0) {
    console.log('  （暂无）')
    return
  }
  for (const user of users) {
    console.log(`  - ${user.id} :: ${user.name}（房间: ${user.roomId ?? '大厅'}）`)
  }
}

function printSupportedGames(client: BuddyLanClient): void {
  console.log('\n支持的游戏:')
  client.state.games.forEach((game, index) => {
    const maxPlayers = game.maxPlayers ?? '∞'
    const kind = game.kind === 'match' ? '对局型' : '世界型'
    console.log(
      `  ${index + 1}) ${game.name} [${game.type}]（${kind} / ${game.minPlayers}-${maxPlayers} 人）`,
    )
    console.log(`    ${game.description}`)
  })
}

function printCurrentRoomDetail(client: BuddyLanClient, room: RoomInfo): void {
  const usersById = new Map(client.state.users.map(user => [user.id, user]))
  const game = findGameInfo(client, room.gameType)

  console.log('\n当前房间:')
  console.log(`  房间号: ${room.id}`)
  console.log(`  名称: ${room.name}`)
  console.log(`  房主: ${usersById.get(room.ownerId)?.name ?? room.ownerId}`)
  console.log(`  状态: ${room.status === 'playing' ? '进行中' : '待机中'}`)
  console.log(`  游戏: ${game?.name ?? '未选择'}`)
  console.log(`  进行中实例: ${room.currentGameId ?? '无'}`)
  console.log('  成员:')
  for (const memberId of room.memberIds) {
    const user = usersById.get(memberId)
    const readyTag = room.readyMemberIds.includes(memberId) ? '已准备' : '未准备'
    const ownerTag = memberId === room.ownerId ? '房主' : '成员'
    console.log(`    - ${user?.name ?? memberId}（${ownerTag} / ${readyTag}）`)
  }
}

function isMazeSnapshot(snapshot: GameStateSnapshot): snapshot is GameStateSnapshot & {
  gameType: 'maze-race'
  state: MazeRaceState
} {
  return snapshot.gameType === 'maze-race'
}

function renderMazeState(snapshot: GameStateSnapshot, room: RoomInfo, users: UserInfo[]): void {
  if (!isMazeSnapshot(snapshot)) {
    console.log('当前游戏快照类型不匹配。')
    return
  }

  const state = snapshot.state
  const markerByPlayer = new Map(room.memberIds.map((id, index) => [id, String(index + 1)]))
  const nameById = new Map(users.map(user => [user.id, user.name]))

  console.log('\n迷宫状态:')
  for (let y = 0; y < state.height; y += 1) {
    let line = ''
    for (let x = 0; x < state.width; x += 1) {
      const wall = state.walls.includes(`${x},${y}`)
      const playerEntry = Object.entries(state.players).find(
        ([, pos]) => pos.x === x && pos.y === y,
      )
      if (playerEntry) {
        line += markerByPlayer.get(playerEntry[0]) ?? 'P'
        continue
      }
      if (wall) {
        line += '#'
        continue
      }
      if (x === state.finish.x && y === state.finish.y) {
        line += 'F'
        continue
      }
      line += '.'
    }
    console.log(`  ${line}`)
  }

  console.log('\n玩家:')
  for (const playerId of room.memberIds) {
    const pos = state.players[playerId]
    if (!pos) continue
    console.log(
      `  ${markerByPlayer.get(playerId)} = ${nameById.get(playerId) ?? playerId}（${pos.x},${pos.y} / 步数 ${pos.steps}）`,
    )
  }

  if (state.status === 'finished') {
    console.log(
      `\n胜者: ${nameById.get(state.winnerId ?? '') ?? state.winnerId ?? '未知'}`,
    )
  } else {
    console.log('\n终点: F    墙体: #')
  }
}

async function waitForClientEvent(
  client: BuddyLanClient,
  eventNames: string | string[],
  timeoutMs = 1_200,
): Promise<{ event: string; payload: unknown } | null> {
  const names = Array.isArray(eventNames) ? eventNames : [eventNames]

  return new Promise(resolve => {
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      for (const [name, handler] of handlers) {
        client.off(name, handler)
      }
    }
    const settle = (value: { event: string; payload: unknown } | null) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    const handlers = new Map<string, (payload: unknown) => void>()
    for (const name of names) {
      const handler = (payload: unknown) => settle({ event: name, payload })
      handlers.set(name, handler)
      client.on(name, handler)
    }
    const timer = setTimeout(() => settle(null), timeoutMs)
  })
}

async function chooseGameFlow(
  rl: readline.Interface,
  client: BuddyLanClient,
  room: RoomInfo,
): Promise<void> {
  if (room.ownerId !== client.state.you.id) {
    console.log('只有房主可以选择游戏。')
    await waitForContinue(rl)
    return
  }

  printSupportedGames(client)
  const ans = normalizeAnswer(await askQuestion(rl, '\n选择游戏编号（或 q 取消）: '))
  if (ans === 'q') return

  const index = Number(ans)
  if (!Number.isInteger(index) || index < 1 || index > client.state.games.length) {
    console.log('选择无效。')
    await waitForContinue(rl)
    return
  }

  const game = client.state.games[index - 1]!
  client.selectGame(game.type)
  await waitForClientEvent(client, ['rooms_update', 'error'])
  console.log(`已选择游戏：${game.name}`)
  await waitForContinue(rl)
}

async function toggleReadyFlow(
  rl: readline.Interface,
  client: BuddyLanClient,
  room: RoomInfo,
): Promise<void> {
  const ready = !room.readyMemberIds.includes(client.state.you.id)
  client.setReady(ready)
  await waitForClientEvent(client, ['rooms_update', 'error'])
  console.log(ready ? '你已准备。' : '你已取消准备。')
  await waitForContinue(rl)
}

async function startGameFlow(
  rl: readline.Interface,
  client: BuddyLanClient,
  room: RoomInfo,
): Promise<void> {
  if (room.ownerId !== client.state.you.id) {
    console.log('只有房主可以开始游戏。')
    await waitForContinue(rl)
    return
  }

  client.startGame()
  const result = await waitForClientEvent(client, ['game_started', 'game_state', 'error'], 1_500)
  if (result?.event === 'error') {
    console.log('开局失败。')
    await waitForContinue(rl)
    return
  }
  console.log('游戏已开始。')
  await waitForContinue(rl)
}

async function runMazeGameMenu(
  rl: readline.Interface,
  client: BuddyLanClient,
  room: RoomInfo,
): Promise<void> {
  while (true) {
    const snapshot = client.state.activeGames[room.id]
    if (!snapshot) {
      console.log('尚未收到迷宫状态。')
      await waitForContinue(rl)
      return
    }

    renderMazeState(snapshot, room, client.state.users)
    console.log('\n操作: w/a/s/d 移动, r 刷新, q 返回')
    const ans = normalizeAnswer(await askQuestion(rl, '\n输入操作: '))
    if (ans === 'q') return
    if (ans === 'r') continue

    const directionMap: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      w: 'up',
      a: 'left',
      s: 'down',
      d: 'right',
      up: 'up',
      left: 'left',
      down: 'down',
      right: 'right',
    }
    const direction = directionMap[ans]
    if (!direction) {
      console.log('请输入 w/a/s/d。')
      await waitForContinue(rl)
      continue
    }

    client.sendGameCommand(room.id, {
      type: 'move',
      payload: { direction },
    })
    await waitForClientEvent(client, ['game_state', 'game_event', 'error'], 1_000)
    await sleep(50)
  }
}

async function enterGameFlow(
  rl: readline.Interface,
  client: BuddyLanClient,
  room: RoomInfo,
): Promise<void> {
  if (!room.currentGameId) {
    console.log('当前房间没有进行中的游戏。')
    await waitForContinue(rl)
    return
  }

  let snapshot = client.state.activeGames[room.id]
  if (!snapshot) {
    await waitForClientEvent(client, 'game_state', 1_200)
    snapshot = client.state.activeGames[room.id]
  }
  if (!snapshot) {
    console.log('未能同步到游戏状态。')
    await waitForContinue(rl)
    return
  }

  if (snapshot.gameType === 'maze-race') {
    await runMazeGameMenu(rl, client, room)
    return
  }

  console.log(`暂不支持该游戏的 CLI 交互：${snapshot.gameType}`)
  await waitForContinue(rl)
}

async function createRoomFlow(
  rl: readline.Interface,
  client: BuddyLanClient,
): Promise<void> {
  const name = (await askQuestion(rl, '房间名: ')).trim()
  if (!name) {
    console.log('房间名不能为空。')
    await waitForContinue(rl)
    return
  }

  client.createRoom(name)
  await waitForClientEvent(client, ['joined_room', 'rooms_update', 'error'])
  console.log('已创建房间并加入。')
  await waitForContinue(rl)
}

async function joinRoomFlow(
  rl: readline.Interface,
  client: BuddyLanClient,
): Promise<void> {
  const rooms = await client.listRooms()
  if (rooms.length === 0) {
    console.log('当前没有可加入的房间。')
    await waitForContinue(rl)
    return
  }

  printRoomList(client, rooms)
  const pick = normalizeAnswer(await askQuestion(rl, '输入编号或 4 位房间号: '))
  const byIndex = Number(pick)
  const roomId =
    Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= rooms.length
      ? rooms[byIndex - 1]!.id
      : pick
  if (!roomId) {
    console.log('房间号不能为空。')
    await waitForContinue(rl)
    return
  }

  client.joinRoom(roomId)
  await waitForClientEvent(client, ['joined_room', 'rooms_update', 'game_state', 'error'])
  console.log('已加入房间。')
  await waitForContinue(rl)
}

async function leaveRoomFlow(
  rl: readline.Interface,
  client: BuddyLanClient,
): Promise<void> {
  client.leaveRoom()
  await waitForClientEvent(client, ['joined_room', 'rooms_update', 'error'])
  console.log('已退出房间。')
  await waitForContinue(rl)
}

export async function runRoomMenu(
  rl: readline.Interface,
  client: BuddyLanClient,
): Promise<void> {
  while (true) {
    const { server, you } = client.state
    const room = currentRoom(client)

    console.log('\n' + '-'.repeat(40))
    console.log(`已连接: ${server.name} @ ${server.port}`)
    console.log(`你: ${you.name}（${you.id}）房间=${you.roomId ?? '大厅'}`)
    console.log('-'.repeat(40))

    if (!room) {
      console.log('1) 查看房间列表')
      console.log('2) 查看用户列表')
      console.log('3) 创建房间')
      console.log('4) 加入房间')
      console.log('5) 查看支持的游戏')
      console.log('q) 返回主菜单')

      const ans = normalizeAnswer(await askQuestion(rl, '\n请选择: '))
      if (ans === 'q') return
      if (ans === '1') {
        printRoomList(client, await client.listRooms())
        await waitForContinue(rl)
        continue
      }
      if (ans === '2') {
        printUserList(await client.listUsers())
        await waitForContinue(rl)
        continue
      }
      if (ans === '3') {
        await createRoomFlow(rl, client)
        continue
      }
      if (ans === '4') {
        await joinRoomFlow(rl, client)
        continue
      }
      if (ans === '5') {
        printSupportedGames(client)
        await waitForContinue(rl)
        continue
      }
      console.log('未知选项。')
      continue
    }

    printCurrentRoomDetail(client, room)
    console.log('\n1) 查看全体用户')
    console.log('2) 查看支持的游戏')
    console.log('3) 选择游戏')
    console.log('4) 准备 / 取消准备')
    console.log('5) 开始游戏')
    console.log('6) 进入当前游戏')
    console.log('7) 退出房间')
    console.log('q) 返回主菜单')

    const ans = normalizeAnswer(await askQuestion(rl, '\n请选择: '))
    if (ans === 'q') return
    if (ans === '1') {
      printUserList(await client.listUsers())
      await waitForContinue(rl)
      continue
    }
    if (ans === '2') {
      printSupportedGames(client)
      await waitForContinue(rl)
      continue
    }
    if (ans === '3') {
      await chooseGameFlow(rl, client, room)
      continue
    }
    if (ans === '4') {
      await toggleReadyFlow(rl, client, room)
      continue
    }
    if (ans === '5') {
      await startGameFlow(rl, client, room)
      continue
    }
    if (ans === '6') {
      await enterGameFlow(rl, client, room)
      continue
    }
    if (ans === '7') {
      await leaveRoomFlow(rl, client)
      continue
    }
    console.log('未知选项。')
  }
}

const PM2_APP_NAME = 'code-buddy-lan'
const PM2_ECOSYSTEM_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'ecosystem.config.cjs',
)

async function ensurePm2(rl: readline.Interface): Promise<boolean> {
  const ok = await isPm2Available()
  if (ok) return true
  console.log('\n未检测到 pm2。请先安装并确保在 PATH 中：')
  console.log('  npm i -g pm2')
  await waitForContinue(rl)
  return false
}

export async function startServerFlow(
  rl: readline.Interface,
): Promise<NetworkConnection | null> {
  if (!(await ensurePm2(rl))) return null

  console.log('\n正在用 pm2 启动（常驻）服务端...')
  const result = await pm2StartOrReloadEcosystem(PM2_ECOSYSTEM_FILE, PM2_APP_NAME)
  if (result.code !== 0) {
    console.log('启动失败：')
    if (result.stdout.trim()) console.log(result.stdout.trim())
    if (result.stderr.trim()) console.log(result.stderr.trim())
    await waitForContinue(rl)
    return null
  }

  let probe = null
  for (let i = 0; i < 6; i += 1) {
    await sleep(500)
    probe = await probeBuddyServerTcp('127.0.0.1', DEFAULT_SERVER_PORT, 1000)
    if (probe) break
  }

  if (!probe) {
    console.log('pm2 已执行，但健康检查未通过。')
    console.log(`查看日志: pm2 logs ${PM2_APP_NAME}`)
    await waitForContinue(rl)
    return null
  }

  const serverIp = getLocalIp()
  console.log(`服务已启动 → ${serverIp}:${probe.server.port}`)

  try {
    const client = await BuddyLanClient.connect({
      host: '127.0.0.1',
      port: DEFAULT_SERVER_PORT,
      name: defaultClientName(),
    })
    return { client, serverIp }
  } catch (err) {
    console.log(`连接本地服务失败: ${String(err)}`)
    await waitForContinue(rl)
    return null
  }
}

export async function joinServerFlow(
  rl: readline.Interface,
): Promise<NetworkConnection | null> {
  console.log('\n正在通过 UDP 广播发现局域网服务器...')
  const discovered = await scanLanForBuddyServers({
    port: DEFAULT_SERVER_PORT,
    timeoutMs: 800,
    method: 'auto',
  })

  if (discovered.length === 0) {
    console.log('未发现局域网服务器（可能 UDP 广播被拦截）。')
    await waitForContinue(rl)
    return null
  }

  console.log('\n发现以下服务器:')
  discovered.forEach((item, index) => console.log(formatServerLine(index, item)))

  const ans = normalizeAnswer(
    await askQuestion(rl, '\n请选择服务器编号（或 q 取消）: '),
  )
  if (ans === 'q') return null

  const idx = Number(ans)
  if (!Number.isInteger(idx) || idx < 1 || idx > discovered.length) {
    console.log('选择无效。')
    await waitForContinue(rl)
    return null
  }

  const target = discovered[idx - 1]!
  try {
    const client = await BuddyLanClient.connect({
      host: target.ip,
      port: target.server.port,
      name: defaultClientName(),
    })
    return { client, serverIp: target.ip }
  } catch (err) {
    console.log(`连接失败: ${String(err)}`)
    await waitForContinue(rl)
    return null
  }
}

export async function showLocalServerStatus(rl: readline.Interface): Promise<void> {
  const list = await pm2JList()
  const item = list?.find(app => app.name === PM2_APP_NAME)
  const status = item?.pm2_env?.status ?? 'unknown'

  console.log('\n本机服务状态（pm2）:')
  console.log(`  名称: ${PM2_APP_NAME}`)
  console.log(`  状态: ${status}`)

  const probe = await probeBuddyServerTcp('127.0.0.1', DEFAULT_SERVER_PORT, 800)
  if (probe) {
    console.log('  健康检查: OK')
    console.log(`  服务名: ${probe.server.name}`)
    console.log(`  在线: ${probe.stats.users}  房间: ${probe.stats.rooms}`)
  } else {
    console.log('  健康检查: 失败（端口未监听或被防火墙拦截）')
  }

  await waitForContinue(rl)
}

export async function stopLocalServer(rl: readline.Interface): Promise<void> {
  if (!(await ensurePm2(rl))) return

  console.log('\n正在停止服务端...')
  const result = await pm2Stop(PM2_APP_NAME)
  if (result.code !== 0) {
    console.log('停止失败：')
    if (result.stdout.trim()) console.log(result.stdout.trim())
    if (result.stderr.trim()) console.log(result.stderr.trim())
  } else {
    console.log('已停止。')
  }

  await waitForContinue(rl)
}
