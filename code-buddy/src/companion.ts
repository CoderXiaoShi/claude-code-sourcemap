import { randomUUID } from 'node:crypto'
import {
  type CompanionBones,
  EYES,
  HATS,
  RARITIES,
  RARITY_SCORES,
  RARITY_WEIGHTS,
  type Rarity,
  SPECIES,
  STAT_NAMES,
  type StatName,
} from './types.js'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]!
}

function rollRarity(rng: () => number): Rarity {
  const total = Object.values(RARITY_WEIGHTS).reduce(
    (sum, weight) => sum + weight,
    0,
  )
  let ticket = rng() * total

  for (const rarity of RARITIES) {
    ticket -= RARITY_WEIGHTS[rarity]
    if (ticket < 0) return rarity
  }

  return 'white'
}

const RARITY_FLOOR: Record<Rarity, number> = {
  white: 5,
  blue: 18,
  gold: 40,
  rainbow: 85,
}

function rollStats(
  rng: () => number,
  rarity: Rarity,
): Record<StatName, number> {
  const floor = RARITY_FLOOR[rarity]
  const peak = pick(rng, STAT_NAMES)
  let dump = pick(rng, STAT_NAMES)

  while (dump === peak) {
    dump = pick(rng, STAT_NAMES)
  }

  const stats = {} as Record<StatName, number>
  for (const name of STAT_NAMES) {
    if (name === peak) {
      stats[name] = Math.min(100, floor + 35 + Math.floor(rng() * 25))
      continue
    }

    if (name === dump) {
      stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 12))
      continue
    }

    stats[name] = Math.min(100, floor + Math.floor(rng() * 35))
  }

  return stats
}

const SALT = 'friend-2026-401'

export type Roll = {
  bones: CompanionBones
  inspirationSeed: number
}

function rollFrom(rng: () => number): Roll {
  const rarity = rollRarity(rng)
  const bones: CompanionBones = {
    rarity,
    rarityScore: RARITY_SCORES[rarity],
    species: pick(rng, SPECIES),
    eye: pick(rng, EYES),
    hat: rarity === 'white' ? 'none' : pick(rng, HATS),
    shiny: rng() < 0.01,
    stats: rollStats(rng, rarity),
  }

  return {
    bones,
    inspirationSeed: Math.floor(rng() * 1e9),
  }
}

let rollCache: { key: string; value: Roll } | undefined

export function roll(userId: string): Roll {
  const key = userId + SALT
  if (rollCache?.key === key) {
    return rollCache.value
  }

  const value = rollFrom(mulberry32(hashString(key)))
  rollCache = { key, value }
  return value
}

export function rollWithSeed(seed: string): Roll {
  return rollFrom(mulberry32(hashString(seed)))
}

export function rollRandom(): Roll {
  return rollWithSeed(`${Date.now()}-${randomUUID()}`)
}
