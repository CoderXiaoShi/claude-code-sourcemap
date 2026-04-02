import readline from 'node:readline'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { scanLanForBuddyServers } from './server/discovery.js'
import { BuddyLanClient } from './server/client.js'
import { DEFAULT_SERVER_PORT } from './server/protocol.js'
import { probeBuddyServerTcp } from './server/probe.js'
import {
  isPm2Available,
  pm2JList,
  pm2StartOrReloadEcosystem,
  pm2Stop,
} from './pm2.js'

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

const PM2_APP_NAME = 'code-buddy-lan'
const PM2_ECOSYSTEM_FILE = 'ecosystem.config.cjs'

async function runConnectedMenu(
  rl: readline.Interface,
  client: BuddyLanClient,
): Promise<void> {
  while (true) {
    const { server, you } = client.state
    console.log('\n' + '-'.repeat(40))
    console.log(`已连接: ${server.name} @ ${server.port}`)
    console.log(`你: ${you.name} (${you.id}) 房间=${you.roomId ?? '大厅'}`)
    console.log('-'.repeat(40))
    console.log('1) 查看房间列表')
    console.log('2) 查看用户列表')
    console.log('3) 创建房间')
    console.log('4) 加入房间')
    console.log('5) 退出房间')
    console.log('q) 断开连接')

    const ans = normalizeAnswer(await askQuestion(rl, '\n请选择: '))

    if (ans === 'q') {
      client.close()
      return
    }

    if (ans === '1') {
      const rooms = await client.listRooms()
      console.log('\n房间列表:')
      if (rooms.length === 0) console.log('  （暂无）')
      for (const room of rooms) {
        console.log(
          `  - ${room.id} :: ${room.name}（人数: ${room.memberIds.length}）`,
        )
      }
      await waitForContinue(rl)
      continue
    }

    if (ans === '2') {
      const users = await client.listUsers()
      console.log('\n用户列表:')
      for (const user of users) {
        console.log(
          `  - ${user.id} :: ${user.name}（房间: ${user.roomId ?? '大厅'}）`,
        )
      }
      await waitForContinue(rl)
      continue
    }

    if (ans === '3') {
      const name = (await askQuestion(rl, '房间名: ')).trim()
      if (!name) {
        console.log('房间名不能为空。')
        await waitForContinue(rl)
        continue
      }
      client.createRoom(name)
      console.log('已创建房间并加入。')
      await waitForContinue(rl)
      continue
    }

    if (ans === '4') {
      const rooms = await client.listRooms()
      if (rooms.length === 0) {
        console.log('当前没有可加入的房间。')
        await waitForContinue(rl)
        continue
      }
      console.log('\n房间列表:')
      rooms.forEach((r, i) => console.log(`  ${i + 1}) ${r.name}（房间号: ${r.id}）`))
      const pick = normalizeAnswer(await askQuestion(rl, '输入编号或 4 位房间号: '))
      const byIndex = Number(pick)
      const roomId =
        Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= rooms.length
          ? rooms[byIndex - 1]!.id
          : pick
      if (!roomId) {
        console.log('房间号不能为空。')
        await waitForContinue(rl)
        continue
      }
      client.joinRoom(roomId)
      console.log('已发送加入请求。')
      await waitForContinue(rl)
      continue
    }

    if (ans === '5') {
      client.leaveRoom()
      console.log('已退出房间。')
      await waitForContinue(rl)
      continue
    }

    console.log('未知选项。')
  }
}

async function joinLanFlow(rl: readline.Interface): Promise<void> {
  console.log('\n正在通过 UDP 广播发现局域网服务器...')
  const discovered = await scanLanForBuddyServers({
    port: DEFAULT_SERVER_PORT,
    timeoutMs: 800,
    method: 'auto',
  })

  if (discovered.length === 0) {
    console.log('未发现局域网服务器（可能 UDP 广播被拦截）。')
    await waitForContinue(rl)
    return
  }

  console.log('\n发现以下服务器:')
  discovered.forEach((item, index) => console.log(formatServerLine(index, item)))

  const ans = normalizeAnswer(
    await askQuestion(rl, '\n请选择服务器编号（或 q 取消）: '),
  )
  if (ans === 'q') return

  const idx = Number(ans)
  if (!Number.isInteger(idx) || idx < 1 || idx > discovered.length) {
    console.log('选择无效。')
    await waitForContinue(rl)
    return
  }

  const target = discovered[idx - 1]!
  const client = await BuddyLanClient.connect({
    host: target.ip,
    port: target.server.port,
    name: defaultClientName(),
  })

  try {
    await runConnectedMenu(rl, client)
  } finally {
    client.close()
  }
}

async function ensurePm2(rl: readline.Interface): Promise<boolean> {
  const ok = await isPm2Available()
  if (ok) return true
  console.log('\n未检测到 pm2。请先安装并确保在 PATH 中：')
  console.log('  npm i -g pm2')
  await waitForContinue(rl)
  return false
}

async function showLocalServerStatus(rl: readline.Interface): Promise<void> {
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

async function startServerWithPm2Flow(rl: readline.Interface): Promise<void> {
  if (!(await ensurePm2(rl))) return

  console.log('\n正在用 pm2 启动（常驻）服务端...')
  const result = await pm2StartOrReloadEcosystem(PM2_ECOSYSTEM_FILE, PM2_APP_NAME)
  if (result.code !== 0) {
    console.log('启动失败：')
    if (result.stdout.trim()) console.log(result.stdout.trim())
    if (result.stderr.trim()) console.log(result.stderr.trim())
    await waitForContinue(rl)
    return
  }

  const probe = await probeBuddyServerTcp('127.0.0.1', DEFAULT_SERVER_PORT, 1200)
  if (probe) {
    console.log('启动成功。')
    console.log(`监听: 0.0.0.0:${probe.server.port}`)
    console.log(`服务名: ${probe.server.name}`)
  } else {
    console.log('pm2 已执行，但健康检查未通过。')
    console.log('你可以在 pm2 里查看日志：')
    console.log(`  pm2 logs ${PM2_APP_NAME}`)
  }

  await waitForContinue(rl)
}

async function stopServerWithPm2Flow(rl: readline.Interface): Promise<void> {
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

export async function runOnlineMenu(rl: readline.Interface): Promise<void> {
  while (true) {
    console.log('\n' + '-'.repeat(40))
    console.log('联机服务菜单')
    console.log('-'.repeat(40))
    console.log('1) 加入局域网（自动发现）')
    console.log('2) 开启服务（pm2 常驻）')
    console.log('3) 查看本机服务状态')
    console.log('4) 停止本机服务')
    console.log('q) 返回')

    const ans = normalizeAnswer(await askQuestion(rl, '\n请选择: '))
    if (ans === 'q') return
    if (ans === '1') {
      await joinLanFlow(rl)
      continue
    }
    if (ans === '2') {
      await startServerWithPm2Flow(rl)
      continue
    }
    if (ans === '3') {
      await showLocalServerStatus(rl)
      continue
    }
    if (ans === '4') {
      await stopServerWithPm2Flow(rl)
      continue
    }
    console.log('未知选项。')
  }
}
