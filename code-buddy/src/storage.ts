import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Roll } from './companion.js'
import { RARITY_SCORES, type Rarity } from './types.js'

export type SavedRoll = {
  savedAt: string
  roll: Roll
}

type LegacySavedRoll = {
  savedAt: string
  roll: {
    bones: {
      rarity: Rarity
      level?: number
      rarityScore?: number
    } & Record<string, unknown>
    inspirationSeed: number
  }
}

function normalizeSavedRoll(saved: LegacySavedRoll): SavedRoll {
  const rarity = saved.roll.bones.rarity
  const rarityScore =
    saved.roll.bones.rarityScore ??
    saved.roll.bones.level ??
    RARITY_SCORES[rarity]

  return {
    savedAt: saved.savedAt,
    roll: {
      inspirationSeed: saved.roll.inspirationSeed,
      bones: {
        ...saved.roll.bones,
        rarityScore,
      },
    } as Roll,
  }
}

export async function saveRollToFile(
  roll: Roll,
  targetFile: string,
): Promise<string> {
  const resolvedPath = resolve(targetFile)
  await mkdir(dirname(resolvedPath), { recursive: true })

  const payload: SavedRoll = {
    savedAt: new Date().toISOString(),
    roll,
  }

  await writeFile(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return resolvedPath
}

export async function loadSavedRoll(
  targetFile: string,
): Promise<SavedRoll | null> {
  const resolvedPath = resolve(targetFile)

  try {
    const content = await readFile(resolvedPath, 'utf8')
    return normalizeSavedRoll(JSON.parse(content) as LegacySavedRoll)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return null
    }

    throw error
  }
}

export async function deleteSavedRollFile(targetFile: string): Promise<string> {
  const resolvedPath = resolve(targetFile)

  try {
    await rm(resolvedPath, { force: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      throw error
    }
  }

  return resolvedPath
}
