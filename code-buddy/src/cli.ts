#!/usr/bin/env node
import readline from 'node:readline'
import { roll, rollRandom, rollWithSeed, type Roll } from './companion.js'
import { runOnlineMenu } from './online.js'
import { renderFace, renderSprite, spriteFrameCount } from './sprites.js'
import {
  deleteSavedRollFile,
  loadSavedRoll,
  saveRollToFile,
  type SavedRoll,
} from './storage.js'
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

const DEFAULT_SAVE_FILE = './buddy-pet.json'
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
  saveFile: string
  saved: SavedRoll | null
  animate: boolean
}

type SessionAction = {
  key: string
  label: string
  description: string
  when?: (session: AppSession) => boolean
  run: (session: AppSession) => Promise<boolean>
}

function clearScreen(): void {
  if (!process.stdout.isTTY) {
    return
  }

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
  --user <id>        根据用户 ID 确定性生成宠物
  --seed <seed>      根据种子确定性生成宠物
  --once             只随机抽取一次
  --save-file <path> 指定本地保存文件，默认 ./buddy-pet.json
  --list-species     列出所有物种
  --list-eyes        列出所有眼睛样式
  --list-hats        列出所有帽子
  --animate          显示动画预览
  -h, --help         显示帮助信息

默认行为:
  进入交互式菜单。
  如果本地存在已保存的宠物文件，会在启动时自动加载。

示例:
  buddy
  buddy --once
  buddy --seed myseed --animate
  buddy --user alice --save-file ./data/my-buddy.json
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

function displayBuddy(
  result: Roll,
  options?: {
    title?: string
    subtitle?: string
  },
): void {
  const { bones, inspirationSeed } = result

  console.log('\n' + '='.repeat(40))
  console.log(options?.title ?? '🐾 你的宠物')
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
  const sprite = renderSprite(bones, 0)
  sprite.forEach(line => console.log('  ' + colorizeText(line, bones.rarity)))
  console.log()
}

function showSavedSummary(saved: SavedRoll): void {
  const savedAt = new Date(saved.savedAt).toLocaleString('zh-CN', {
    hour12: false,
  })
  const { bones } = saved.roll
  console.log('\n已加载本地宠物:')
  console.log(
    `  ${bones.species} / ${RARITY_LABELS[bones.rarity]} / 稀有值 ${bones.rarityScore}`,
  )
  console.log(`  保存时间: ${savedAt}`)
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
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

async function playAnimation(
  bones: CompanionBones,
  loops = 3,
): Promise<void> {
  const frameCount = spriteFrameCount(bones.species)
  const totalFrames = Math.max(1, frameCount * loops)
  let renderedLines = 0

  for (let index = 0; index < totalFrames; index++) {
    if (renderedLines > 0) {
      for (let lineIndex = 0; lineIndex < renderedLines; lineIndex++) {
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

function toDecision(answer: string): 'yes' | 'no' | 'quit' | null {
  if (['y', 'yes', '是', '好'].includes(answer)) {
    return 'yes'
  }

  if (['n', 'no', '否', '不是'].includes(answer)) {
    return 'no'
  }

  if (['q', 'quit', 'exit', '退出'].includes(answer)) {
    return 'quit'
  }

  return null
}

async function askForDecision(
  rl: readline.Interface,
  question: string,
): Promise<'yes' | 'no' | 'quit'> {
  while (true) {
    const decision = toDecision(normalizeAnswer(await askQuestion(rl, question)))
    if (decision) {
      return decision
    }

    console.log('请输入 y / n / q。')
  }
}

async function saveSelectedRoll(result: Roll, saveFile: string): Promise<SavedRoll> {
  const savedPath = await saveRollToFile(result, saveFile)
  const saved = await loadSavedRoll(saveFile)

  if (!saved) {
    throw new Error(`保存后未能重新加载文件: ${savedPath}`)
  }

  console.log(`已保存到本地: ${savedPath}`)
  return saved
}

async function huntFavoritePet(
  rl: readline.Interface,
  saveFile: string,
): Promise<SavedRoll | null> {
  let drawCount = 0

  while (true) {
    drawCount += 1
    clearScreen()
    const result = rollRandom()
    displayBuddy(result, { title: `🐾 第 ${drawCount} 抽` })

    const decision = await askForDecision(
      rl,
      '这是你想要的宠物么？[y/n/q]: ',
    )

    if (decision === 'yes') {
      return saveSelectedRoll(result, saveFile)
    }

    if (decision === 'quit') {
      console.log('已退出抽取，本次没有保存新宠物。')
      return null
    }

    console.log('\n那就继续抽下一只吧...')
  }
}

async function promptToSaveRandomResult(
  rl: readline.Interface,
  result: Roll,
  saveFile: string,
): Promise<SavedRoll | null> {
  const decision = await askForDecision(
    rl,
    '这是你想要的宠物么？[y/n/q]: ',
  )

  if (decision === 'yes') {
    return saveSelectedRoll(result, saveFile)
  }

  if (decision === 'quit') {
    console.log('已退出，本次没有保存宠物。')
    return null
  }

  console.log('这次先不保存。')
  return null
}

function createSessionActions(): SessionAction[] {
  return [
    {
      key: 'v',
      label: '查看已保存宠物',
      description: '展示本地存档里的宠物详情',
      when: session => session.saved !== null,
      run: async session => {
        clearScreen()
        if (!session.saved) {
          console.log('当前没有已保存宠物。')
          await waitForContinue(session.rl)
          return true
        }

        displayBuddy(session.saved.roll, {
          title: '🐾 当前已保存宠物',
          subtitle: `保存文件: ${session.saveFile}`,
        })
        if (session.animate) {
          await playAnimation(session.saved.roll.bones)
        }
        await waitForContinue(session.rl)
        return true
      },
    },
    {
      key: 'h',
      label: '开始抽宠物',
      description: '连续抽取，直到你满意并保存',
      run: async session => {
        clearScreen()
        const saved = await huntFavoritePet(session.rl, session.saveFile)
        if (saved) {
          session.saved = saved
          if (session.animate) {
            await playAnimation(saved.roll.bones)
          }
        }
        return true
      },
    },
    {
      key: 'o',
      label: '随机抽一次',
      description: '只看一只，决定是否覆盖保存',
      run: async session => {
        clearScreen()
        const result = rollRandom()
        displayBuddy(result, { title: '🐾 单次抽取结果' })
        const saved = await promptToSaveRandomResult(
          session.rl,
          result,
          session.saveFile,
        )
        if (saved) {
          session.saved = saved
          if (session.animate) {
            await playAnimation(saved.roll.bones)
          }
        }
        return true
      },
    },
    {
      key: 'a',
      label: '播放宠物动画',
      description: '对已保存宠物播放动画预览',
      when: session => session.saved !== null,
      run: async session => {
        clearScreen()
        if (!session.saved) {
          console.log('当前没有可播放动画的宠物。')
          await waitForContinue(session.rl)
          return true
        }

        await playAnimation(session.saved.roll.bones)
        await waitForContinue(session.rl)
        return true
      },
    },
    {
      key: 'n',
      label: '局域网联机',
      description: '加入局域网 / 开启服务',
      run: async session => {
        clearScreen()
        await runOnlineMenu(session.rl)
        return true
      },
    },
    {
      key: 'd',
      label: '删除本地宠物',
      description: '清空当前本地存档',
      when: session => session.saved !== null,
      run: async session => {
        clearScreen()
        const decision = await askForDecision(
          session.rl,
          '确认删除本地宠物存档？[y/n]: ',
        )

        if (decision !== 'yes') {
          console.log('已取消删除。')
          await waitForContinue(session.rl)
          return true
        }

        const deletedPath = await deleteSavedRollFile(session.saveFile)
        session.saved = null
        console.log(`已删除本地宠物存档: ${deletedPath}`)
        await waitForContinue(session.rl)
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
  console.log('\n' + '-'.repeat(40))
  console.log('Buddy 终端菜单')
  console.log('-'.repeat(40))
  // console.log(`存档文件: ${session.saveFile}`)

  if (session.saved) {
    const { bones } = session.saved.roll
    console.log(
      `当前存档: ${bones.species} / ${RARITY_LABELS[bones.rarity]} / 稀有值 ${bones.rarityScore}`,
    )
  } else {
    console.log('当前存档: 暂无')
  }

  console.log('\n可执行操作:')
  actions.forEach((action, index) => {
    console.log(
      `  [${action.key}] ${action.label} - ${action.description}`,
    )
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

async function runInteractiveSession(
  saveFile: string,
  animate: boolean,
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const session: AppSession = {
    rl,
    saveFile,
    saved: await loadSavedRoll(saveFile),
    animate,
  }

  try {
    clearScreen()
    console.log('\n欢迎来到 Buddy 命令行宠物中心。')
    if (session.saved) {
      showSavedSummary(session.saved)
    } else {
      console.log('\n当前没有已保存宠物，你可以开始抽取。')
    }

    const actionRegistry = createSessionActions()
    let running = true
    let shouldClearMenu = false

    while (running) {
      const actions = actionRegistry.filter(action => action.when?.(session) ?? true)
      if (shouldClearMenu) {
        clearScreen()
      }
      showSessionMenu(session, actions)
      const action = await selectAction(session, actions)
      running = await action.run(session)
      shouldClearMenu = true
    }

    console.log('\n已退出 Buddy，会话结束。')
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
  let saveFile = DEFAULT_SAVE_FILE

  for (let index = 0; index < args.length; index++) {
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
      case '--save-file':
        saveFile = args[++index] ?? DEFAULT_SAVE_FILE
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
    await runInteractiveSession(saveFile, animate)
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

  if (!user && !seed) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    try {
      await promptToSaveRandomResult(rl, result, saveFile)
    } finally {
      rl.close()
    }
  }

  if (animate) {
    await playAnimation(result.bones)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
