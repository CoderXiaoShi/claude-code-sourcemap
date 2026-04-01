import {
  EYES,
  HATS,
  RARITIES,
  RARITY_WEIGHTS,
  SPECIES,
  STAT_NAMES,
} from './types.js'

/**
 * Mulberry32 — 小型种子化 PRNG，适合选择宠物
 * @param {number} seed - 种子值
 * @returns {Function} 随机数生成函数
 */
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 字符串哈希函数
 * @param {string} s - 输入字符串
 * @returns {number} 哈希值
 */
function hashString(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * 从数组中随机选择一个元素
 * @param {Function} rng - 随机数生成函数
 * @param {Array} arr - 输入数组
 * @returns {*} 选中的元素
 */
function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

/**
 * 随机生成稀有度
 * @param {Function} rng - 随机数生成函数
 * @returns {string} 稀有度
 */
function rollRarity(rng) {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0)
  let roll = rng() * total
  for (const rarity of RARITIES) {
    roll -= RARITY_WEIGHTS[rarity]
    if (roll < 0) return rarity
  }
  return 'common'
}

const RARITY_FLOOR = {
  common: 5,
  uncommon: 15,
  rare: 25,
  epic: 35,
  legendary: 50,
}

/**
 * 生成属性值
 * @param {Function} rng - 随机数生成函数
 * @param {string} rarity - 稀有度
 * @returns {Object} 属性对象
 */
function rollStats(rng, rarity) {
  const floor = RARITY_FLOOR[rarity]
  const peak = pick(rng, STAT_NAMES)
  let dump = pick(rng, STAT_NAMES)
  while (dump === peak) dump = pick(rng, STAT_NAMES)

  const stats = {}
  for (const name of STAT_NAMES) {
    if (name === peak) {
      stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30))
    } else if (name === dump) {
      stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15))
    } else {
      stats[name] = floor + Math.floor(rng() * 40)
    }
  }
  return stats
}

const SALT = 'friend-2026-401'

/**
 * 从随机数生成器生成宠物
 * @param {Function} rng - 随机数生成函数
 * @returns {Object} 宠物骨骼配置和灵感种子
 */
function rollFrom(rng) {
  const rarity = rollRarity(rng)
  const bones = {
    rarity,
    species: pick(rng, SPECIES),
    eye: pick(rng, EYES),
    hat: rarity === 'common' ? 'none' : pick(rng, HATS),
    shiny: rng() < 0.01,
    stats: rollStats(rng, rarity),
  }
  return { bones, inspirationSeed: Math.floor(rng() * 1e9) }
}

let rollCache = undefined

/**
 * 根据用户ID生成宠物（带缓存）
 * @param {string} userId - 用户ID
 * @returns {Object} 宠物骨骼配置和灵感种子
 */
export function roll(userId) {
  const key = userId + SALT
  if (rollCache?.key === key) return rollCache.value
  const value = rollFrom(mulberry32(hashString(key)))
  rollCache = { key, value }
  return value
}

/**
 * 根据种子生成宠物
 * @param {string} seed - 种子字符串
 * @returns {Object} 宠物骨骼配置和灵感种子
 */
export function rollWithSeed(seed) {
  return rollFrom(mulberry32(hashString(seed)))
}
