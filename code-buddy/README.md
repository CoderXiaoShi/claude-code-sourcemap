# `sxl-code-buddy`

一个轻松有趣的终端宠物生成器。

它可以在命令行里随机生成一只像素风 ASCII Buddy，带有：

- 不同物种
- 不同稀有度
- 不同眼睛 / 帽子
- 属性值与表情
- 本地存档
- 简单动画预览

非常适合拿来做：

- 终端小玩具
- npm CLI Demo
- ASCII / Sprite 生成示例
- 随机宠物生成器

---

## Features

- 支持命令行交互模式
- 支持按 `userId` 稳定生成同一只宠物
- 支持按 `seed` 复现结果
- 支持随机单抽
- 支持保存 / 读取 / 删除本地宠物存档
- 支持程序化调用，既能当 CLI 用，也能当库用

---

## Install

全局安装：

```bash
npm install -g sxl-code-buddy
```

项目内使用：

```bash
npm install sxl-code-buddy
```

直接运行：

```bash
npx sxl-code-buddy
```

---

## Quick Start

进入交互模式：

```bash
buddy
```

随机抽一只：

```bash
buddy --once
```

按种子生成：

```bash
buddy --seed myseed
```

按用户 ID 稳定生成：

```bash
buddy --user alice
```

播放动画预览：

```bash
buddy --seed myseed --animate
```

指定本地存档文件：

```bash
buddy --save-file ./data/my-buddy.json
```

---

## CLI Options

| 参数 | 说明 |
| --- | --- |
| `--user <id>` | 基于用户 ID 稳定生成宠物 |
| `--seed <seed>` | 基于 seed 复现同一只宠物 |
| `--once` | 随机生成一只 |
| `--save-file <path>` | 指定本地存档文件路径 |
| `--list-species` | 查看支持的物种 |
| `--list-eyes` | 查看支持的眼睛样式 |
| `--list-hats` | 查看支持的帽子样式 |
| `--animate` | 显示动画预览 |
| `-h`, `--help` | 查看帮助 |

---

## Example

```text
========================================
🐾 你的宠物
========================================

物种: cat
稀有度: 🟡 金色
稀有值: 50
眼睛: o
帽子: crown
闪光: 否
灵感种子: 123456789

属性:
  DEBUGGING    82 ████████
  PATIENCE     61 ██████
  CHAOS        27 ███
  WISDOM       74 ███████
  SNARK        49 █████

表情: =o蠅o=
```

---

## Programmatic Usage

```ts
import {
  roll,
  rollRandom,
  rollWithSeed,
  renderFace,
  renderSprite,
  saveRollToFile,
  loadSavedRoll,
} from 'sxl-code-buddy'

const fixed = roll('alice')
const seeded = rollWithSeed('demo-seed')
const random = rollRandom()

console.log(fixed.bones.species)
console.log(renderFace(seeded.bones))
console.log(renderSprite(random.bones).join('\n'))

await saveRollToFile(random, './buddy-pet.json')
const saved = await loadSavedRoll('./buddy-pet.json')
console.log(saved?.roll.bones.rarity)
```

---

## Exports

这个包同时导出了生成、渲染和存档能力：

- `roll`
- `rollRandom`
- `rollWithSeed`
- `renderFace`
- `renderSprite`
- `spriteFrameCount`
- `saveRollToFile`
- `loadSavedRoll`
- `deleteSavedRollFile`
- `SPECIES`
- `EYES`
- `HATS`

---

## Save File

默认存档文件为：

```text
./buddy-pet.json
```

保存内容是可读 JSON，适合调试和二次处理。

---

## Use Cases

- 给每个用户分配一只固定 Buddy
- 给 CLI 工具加一个有趣的欢迎角色
- 在终端里做小游戏 / 彩蛋
- 做随机角色、宠物或像素素材原型

---

## Development

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

---

## License

MIT

