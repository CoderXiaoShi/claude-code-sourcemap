#!/usr/bin/env node
import readline from 'node:readline'
import { roll, rollRandom, rollWithSeed, type Roll } from './companion.js'
import { renderFace, renderSprite, spriteFrameCount } from './sprites.js'
import { saveRollToFile } from './storage.js'
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
  --animate          展示动画效果
  -h, --help         显示帮助信息

默认行为:
  不传 --user / --seed / --once 时，会一直随机抽宠物，
  直到你回答“这是你想要的宠物么？”并选择保存。

示例:
  buddy
  buddy --once
  buddy --seed myseed
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

function displayBuddy(result: Roll, drawCount?: number): void {
  const { bones, inspirationSeed } = result

  console.log('\n' + '='.repeat(40))
  console.log(drawCount ? `🐾 第 ${drawCount} 抽` : '🐾 你的宠物')
  console.log('='.repeat(40))

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
  sprite.forEach(line =>
    console.log('  ' + colorizeText(line, bones.rarity)),
  )
  console.log()
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

function printAnimationFrame(
  bones: CompanionBones,
  frame: number,
  frameCount: number,
): number {
  const sprite = renderSprite(bones, frame)
  sprite.forEach(line =>
    console.log('  ' + colorizeText(line, bones.rarity)),
  )
  console.log(`\n  帧 ${frame + 1}/${frameCount}`)
  return sprite.length + 2
}

async function playAnimation(bones: CompanionBones): Promise<void> {
  const frameCount = spriteFrameCount(bones.species)
  let frame = 0
  let renderedLines = 0

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  console.log('\n按 Ctrl+C 退出动画。\n')
  renderedLines = printAnimationFrame(bones, frame, frameCount)
  frame = (frame + 1) % frameCount

  const interval = setInterval(() => {
    for (let index = 0; index < renderedLines; index++) {
      process.stdout.write('\x1B[1A\x1B[2K')
    }

    renderedLines = printAnimationFrame(bones, frame, frameCount)
    frame = (frame + 1) % frameCount
  }, 500)

  rl.on('SIGINT', () => {
    clearInterval(interval)
    rl.close()
    process.exit()
  })
}

function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase()
}

function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, resolve)
  })
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

async function saveSelectedRoll(result: Roll, saveFile: string): Promise<void> {
  const savedPath = await saveRollToFile(result, saveFile)
  console.log(`已保存到本地: ${savedPath}`)
}

async function huntFavoritePet(saveFile: string): Promise<Roll | null> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    let drawCount = 0

    while (true) {
      drawCount += 1
      const result = rollRandom()
      displayBuddy(result, drawCount)

      const decision = await askForDecision(
        rl,
        '这是你想要的宠物么？[y/n/q]: ',
      )

      if (decision === 'yes') {
        await saveSelectedRoll(result, saveFile)
        return result
      }

      if (decision === 'quit') {
        console.log('已退出，本次没有保存宠物。')
        return null
      }

      console.log('\n那就继续抽下一只吧...')
    }
  } finally {
    rl.close()
  }
}

async function promptToSaveRandomResult(
  result: Roll,
  saveFile: string,
): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    const decision = await askForDecision(
      rl,
      '这是你想要的宠物么？[y/n]: ',
    )

    if (decision === 'yes') {
      await saveSelectedRoll(result, saveFile)
      return true
    }

    if (decision === 'quit') {
      console.log('已退出，本次没有保存宠物。')
      return false
    }

    console.log('这次先不保存。')
    return false
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
    const selected = await huntFavoritePet(saveFile)
    if (animate && selected) {
      await playAnimation(selected.bones)
    }
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
    await promptToSaveRandomResult(result, saveFile)
  }

  if (animate) {
    await playAnimation(result.bones)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
