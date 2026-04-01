import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Roll } from './companion.js'

export type SavedRoll = {
  savedAt: string
  roll: Roll
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
