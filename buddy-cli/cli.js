#!/usr/bin/env node
import { roll, rollWithSeed } from './companion.js'
import { renderSprite, spriteFrameCount, renderFace } from './sprites.js'
import { RARITY_STARS, SPECIES, EYES, HATS } from './types.js'
import readline from 'readline'

/**
 * 显示帮助信息
 */
function showHelp() {
  console.log(`
Buddy CLI - 宠物生成器

用法:
  node cli.js [选项]

选项:
  --user <id>     指定用户ID生成宠物
  --seed <seed>   指定种子生成宠物
  --list-species  列出所有物种
  --list-eyes     列出所有眼睛样式
  --list-hats     列出所有帽子
  --animate       显示动画效果
  -h, --help      显示帮助信息

示例:
  node cli.js
  node cli.js --user alice
  node cli.js --seed myseed
  node cli.js --list-species
`)
}

/**
 * 列出所有物种
 */
function listSpecies() {
  console.log('\n可用的物种:')
  console.log(SPECIES.join(', '))
}

/**
 * 列出所有眼睛样式
 */
function listEyes() {
  console.log('\n可用的眼睛样式:')
  EYES.forEach(eye => console.log(`  ${eye}`))
}

/**
 * 列出所有帽子
 */
function listHats() {
  console.log('\n可用的帽子:')
  console.log(HATS.join(', '))
}

/**
 * 显示宠物信息
 * @param {Object} result - 宠物生成结果
 */
function displayBuddy(result) {
  const { bones, inspirationSeed } = result
  
  console.log('\n' + '='.repeat(40))
  console.log(`🐾 你的宠物`)
  console.log('='.repeat(40))
  
  console.log(`\n物种: ${bones.species}`)
  console.log(`稀有度: ${bones.rarity} ${RARITY_STARS[bones.rarity]}`)
  console.log(`眼睛: ${bones.eye}`)
  console.log(`帽子: ${bones.hat}`)
  console.log(`闪光: ${bones.shiny ? '✨ 是' : '否'}`)
  console.log(`灵感种子: ${inspirationSeed}`)
  
  console.log('\n属性:')
  Object.entries(bones.stats).forEach(([stat, value]) => {
    const bar = '█'.repeat(Math.round(value / 10))
    console.log(`  ${stat.padEnd(10)} ${value.toString().padStart(3)} ${bar}`)
  })
  
  console.log('\n表情:', renderFace(bones))
  
  console.log('\n精灵:')
  const sprite = renderSprite(bones, 0)
  sprite.forEach(line => console.log('  ' + line))
  console.log()
}

/**
 * 播放动画
 * @param {Object} bones - 宠物骨骼配置
 */
async function playAnimation(bones) {
  const frameCount = spriteFrameCount(bones.species)
  let frame = 0
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  
  console.log('\n按 Ctrl+C 退出动画...\n')
  
  const interval = setInterval(() => {
    const sprite = renderSprite(bones, frame)
    
    for (let i = 0; i < sprite.length + 2; i++) {
      process.stdout.write('\x1B[1A\x1B[2K')
    }
    
    sprite.forEach(line => console.log('  ' + line))
    console.log(`\n  帧: ${frame + 1}/${frameCount}`)
    
    frame = (frame + 1) % frameCount
  }, 500)
  
  rl.on('SIGINT', () => {
    clearInterval(interval)
    rl.close()
    process.exit()
  })
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2)
  let user = null
  let seed = null
  let animate = false
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--user':
        user = args[++i]
        break
      case '--seed':
        seed = args[++i]
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
  
  let result
  if (seed) {
    result = rollWithSeed(seed)
    console.log(`使用种子: ${seed}`)
  } else if (user) {
    result = roll(user)
    console.log(`用户ID: ${user}`)
  } else {
    result = rollWithSeed(Date.now().toString())
    console.log('随机生成宠物...')
  }
  
  displayBuddy(result)
  
  if (animate) {
    await playAnimation(result.bones)
  }
}

main().catch(console.error)
