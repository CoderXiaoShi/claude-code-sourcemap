#!/usr/bin/env node
import readline from 'node:readline'
import { roll, rollRandom, rollWithSeed, type Roll } from './companion.js'
import {
  type NetworkConnection,
  joinServerFlow,
  runRoomMenu,
  startServerFlow,
} from './online.js'
import { renderFace, renderSprite, spriteFrameCount } from './sprites.js'
import {
  EYES,
  HATS,
  RARITY_BADGES,
  RARITY_ANSI_COLORS,
  RARITY_LABELS,
  SPECIES,
  type CompanionBones,
  type Rarity,
} from './types.js'

const ANSI_RESET = '\x1b[0m'
const RAINBOW_SEQUENCE = [
  '\x1b[31m',
  '\x1b[33m',
  '\x1b[32m',
  '\x1b[36m',
  '\x1b[34m',
  '\x1b[35m',
]

type AppSession = {
  rl: readline.Interface
  current: Roll | null
  animate: boolean
  connection: NetworkConnection
}

type SessionAction = {
  key: string
  label: string
  description: string
  when?: (session: AppSession) => boolean
  run: (session: AppSession) => Promise<boolean>
}

function clearScreen(): void {
  if (!process.stdout.isTTY) return
  readline.cursorTo(process.stdout, 0, 0)
  readline.clearScreenDown(process.stdout)
}

function showHelp(): void {
  console.log(`
Buddy CLI - 宠物生成器

用法:
  buddy [选项]
  node ./dist/cli.js [选项]

选项:
  --user <id>    根据用户 ID 确定性生成宠物
  --seed <seed>  根据种子确定性生成宠物
  --once         只随机抽取一次
  --list-species 列出所有物种
  --list-eyes    列出所有眼睛样式
  --list-hats    列出所有帽子
  --animate      显示动画预览
  -h, --help     显示帮助信息

默认行为:
  进入交互式菜单。

示例:
  buddy
  buddy --once
  buddy --seed myseed --animate
  buddy --user alice
`)
}

function listSpecies(): void {
  console.log('\n可用的物种:')
  console.log(SPECIES.join(', '))
}

function listEyes(): void {
  console.log('\n可用的眼睛样式:')
  EYES.forEach(eye => console.log(`  ${eye}`))
}

function listHats(): void {
  console.log('\n可用的帽子:')
  console.log(HATS.join(', '))
}

function colorizeText(value: string, rarity: Rarity): string {
  if (rarity !== 'rainbow') {
    return `${RARITY_ANSI_COLORS[rarity]}${value}${ANSI_RESET}`
  }

  let colorIndex = 0
  let output = ''
  for (const char of value) {
    if (char === ' ') {
      output += char
      continue
    }
    output += `${RAINBOW_SEQUENCE[colorIndex % RAINBOW_SEQUENCE.length]}${char}`
    colorIndex += 1
  }

  return `${output}${ANSI_RESET}`
}

function getStatusLine(connection: NetworkConnection): string {
  const users = connection.client.state.users.length
  return `[在线] IP: ${connection.serverIp} | ${users} 人在线`
}

function displayBuddy(
  result: Roll,
  options?: {
    title?: string
    subtitle?: string
    statusLine?: string
  },
): void {
  const { bones, inspirationSeed } = result

  console.log('\n' + '='.repeat(40))
  console.log(options?.title ?? '🐾 当前宠物')
  if (options?.statusLine) {
    console.log(options.statusLine)
  }
  console.log('='.repeat(40))

  if (options?.subtitle) {
    console.log(options.subtitle)
  }

  console.log(`\n物种: ${bones.species}`)
  console.log(
    `稀有程度: ${colorizeText(
      `${RARITY_BADGES[bones.rarity]} ${RARITY_LABELS[bones.rarity]}`,
      bones.rarity,
    )}`,
  )
  console.log(`稀有值: ${bones.rarityScore}`)
  console.log(`眼睛: ${bones.eye}`)
  console.log(`帽子: ${bones.hat}`)
  console.log(`闪光: ${bones.shiny ? '是' : '否'}`)
  console.log(`灵感种子: ${inspirationSeed}`)

  console.log('\n属性:')
  Object.entries(bones.stats).forEach(([stat, value]) => {
    const bar = '█'.repeat(Math.max(1, Math.round(value / 10)))
    console.log(`  ${stat.padEnd(10)} ${value.toString().padStart(3)} ${bar}`)
  })

  console.log('\n表情:', colorizeText(renderFace(bones), bones.rarity))
  console.log('\n精灵:')
  renderSprite(bones, 0).forEach(line => {
    console.log('  ' + colorizeText(line, bones.rarity))
  })
  console.log()
}

function printAnimationFrame(
  bones: CompanionBones,
  frame: number,
  frameCount: number,
): number {
  const sprite = renderSprite(bones, frame)
  sprite.forEach(line => console.log('  ' + colorizeText(line, bones.rarity)))
  console.log(`\n  帧 ${frame + 1}/${frameCount}`)
  return sprite.length + 2
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function playAnimation(
  bones: CompanionBones,
  loops = 3,
): Promise<void> {
  const frameCount = spriteFrameCount(bones.species)
  const totalFrames = Math.max(1, frameCount * loops)
  let renderedLines = 0

  for (let index = 0; index < totalFrames; index += 1) {
    if (renderedLines > 0) {
      for (let lineIndex = 0; lineIndex < renderedLines; lineIndex += 1) {
        process.stdout.write('\x1B[1A\x1B[2K')
      }
    }
    renderedLines = printAnimationFrame(bones, index % frameCount, frameCount)
    await sleep(400)
  }

  console.log('\n动画预览结束。')
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
  prompt = '\n按回车返回菜单: ',
): Promise<void> {
  await askQuestion(rl, prompt)
}

async function runStartupConnectionFlow(
  rl: readline.Interface,
): Promise<NetworkConnection> {
  console.log('\n' + '='.repeat(40))
  console.log('欢迎来到 Buddy 终端宠物中心')
  console.log('='.repeat(40))

  while (true) {
    console.log('\n请选择联机模式:')
    console.log('  1) 开启服务器（成为主机，其他人可加入）')
    console.log('  2) 加入服务器（扫描局域网并连接）')

    const ans = normalizeAnswer(await askQuestion(rl, '\n请选择 [1/2]: '))
    if (ans === '1') {
      const conn = await startServerFlow(rl)
      if (conn) return conn
      console.log('启动失败，请重试。')
      continue
    }
    if (ans === '2') {
      const conn = await joinServerFlow(rl)
      if (conn) return conn
      console.log('连接失败，请重试。')
      continue
    }
    console.log('请输入 1 或 2。')
  }
}

function createSessionActions(): SessionAction[] {
  return [
    {
      key: 'v',
      label: '查看当前宠物',
      description: '展示本次会话中的当前宠物',
      when: session => session.current !== null,
      run: async session => {
        clearScreen()
        if (!session.current) {
          console.log('当前还没有宠物。')
          await waitForContinue(session.rl)
          return true
        }
        displayBuddy(session.current, {
          title: '🐾 当前宠物',
          statusLine: getStatusLine(session.connection),
        })
        if (session.animate) {
          await playAnimation(session.current.bones)
        }
        await waitForContinue(session.rl)
        return true
      },
    },
    {
      key: 'h',
      label: '开始抽宠物',
      description: '连续抽取，直到你满意',
      run: async session => {
        let drawCount = 0
        while (true) {
          drawCount += 1
          clearScreen()
          const result = rollRandom()
          displayBuddy(result, {
            title: `🐾 第 ${drawCount} 抽`,
            statusLine: getStatusLine(session.connection),
          })
          const ans = normalizeAnswer(
            await askQuestion(session.rl, '留下这只宠物？[y/n/q]: '),
          )
          if (['y', 'yes', '是', '好'].includes(ans)) {
            session.current = result
            break
          }
          if (['q', 'quit', '退出'].includes(ans)) {
            console.log('已退出抽取。')
            await waitForContinue(session.rl)
            return true
          }
        }
        if (session.animate && session.current) {
          await playAnimation(session.current.bones)
        }
        return true
      },
    },
    {
      key: 'o',
      label: '随机抽一次',
      description: '随机生成一只并设为当前宠物',
      run: async session => {
        clearScreen()
        session.current = rollRandom()
        displayBuddy(session.current, {
          title: '🐾 单次抽取结果',
          statusLine: getStatusLine(session.connection),
        })
        if (session.animate) {
          await playAnimation(session.current.bones)
        }
        await waitForContinue(session.rl)
        return true
      },
    },
    {
      key: 'a',
      label: '播放宠物动画',
      description: '对当前宠物播放动画预览',
      when: session => session.current !== null,
      run: async session => {
        clearScreen()
        if (!session.current) {
          console.log('当前没有可播放动画的宠物。')
          await waitForContinue(session.rl)
          return true
        }
        await playAnimation(session.current.bones)
        await waitForContinue(session.rl)
        return true
      },
    },
    {
      key: 'n',
      label: '联机管理',
      description: '房间管理 / 迷宫游戏',
      run: async session => {
        clearScreen()
        await runRoomMenu(session.rl, session.connection.client)
        return true
      },
    },
    {
      key: 'i',
      label: '查看帮助',
      description: '展示命令说明和模式说明',
      run: async session => {
        clearScreen()
        showHelp()
        await waitForContinue(session.rl)
        return true
      },
    },
    {
      key: 'q',
      label: '退出',
      description: '结束当前会话',
      run: async () => false,
    },
  ]
}

function showSessionMenu(session: AppSession, actions: SessionAction[]): void {
  console.log('\n' + '='.repeat(40))
  console.log('Buddy 终端宠物中心')
  console.log(getStatusLine(session.connection))
  console.log('='.repeat(40))

  if (session.current) {
    const { bones } = session.current
    console.log(
      `当前宠物: ${bones.species} / ${RARITY_LABELS[bones.rarity]} / 稀有值 ${bones.rarityScore}`,
    )
  } else {
    console.log('当前宠物: 暂无')
  }

  console.log('\n可执行操作:')
  actions.forEach(action => {
    console.log(`  [${action.key}] ${action.label} - ${action.description}`)
  })
}

async function selectAction(
  session: AppSession,
  actions: SessionAction[],
): Promise<SessionAction> {
  while (true) {
    const answer = normalizeAnswer(
      await askQuestion(session.rl, '\n请选择操作（编号或快捷键）: '),
    )

    const byIndex = Number(answer)
    if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= actions.length) {
      return actions[byIndex - 1]!
    }

    const byKey = actions.find(action => action.key === answer)
    if (byKey) {
      return byKey
    }

    console.log('无效操作，请重新输入。')
  }
}

async function runInteractiveSession(animate: boolean): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    clearScreen()
    const connection = await runStartupConnectionFlow(rl)
    const session: AppSession = {
      rl,
      current: null,
      animate,
      connection,
    }

    const actionRegistry = createSessionActions()
    let running = true
    let shouldClearMenu = false

    while (running) {
      const actions = actionRegistry.filter(action => action.when?.(session) ?? true)
      if (shouldClearMenu) clearScreen()
      showSessionMenu(session, actions)
      const action = await selectAction(session, actions)
      running = await action.run(session)
      shouldClearMenu = true
    }

    console.log('\n已退出 Buddy，会话结束。')
    connection.client.close()
  } finally {
    rl.close()
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  let user: string | null = null
  let seed: string | null = null
  let animate = false
  let once = false

  for (let index = 0; index < args.length; index += 1) {
    switch (args[index]) {
      case '--user':
        user = args[++index] ?? null
        break
      case '--seed':
        seed = args[++index] ?? null
        break
      case '--once':
        once = true
        break
      case '--list-species':
        listSpecies()
        return
      case '--list-eyes':
        listEyes()
        return
      case '--list-hats':
        listHats()
        return
      case '--animate':
        animate = true
        break
      case '-h':
      case '--help':
        showHelp()
        return
    }
  }

  if (!user && !seed && !once) {
    await runInteractiveSession(animate)
    return
  }

  let result: Roll
  if (seed) {
    result = rollWithSeed(seed)
    console.log(`使用种子: ${seed}`)
  } else if (user) {
    result = roll(user)
    console.log(`用户 ID: ${user}`)
  } else {
    result = rollRandom()
    console.log('随机生成一只宠物...')
  }

  displayBuddy(result)
  if (animate) {
    await playAnimation(result.bones)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
