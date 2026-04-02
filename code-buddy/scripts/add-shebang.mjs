import fs from 'node:fs/promises'

const SHEBANG = '#!/usr/bin/env node\n'
const TARGETS = [
  new URL('../dist/cli.js', import.meta.url),
  new URL('../dist/lan-server.js', import.meta.url),
]

for (const target of TARGETS) {
  let contents
  try {
    contents = await fs.readFile(target, 'utf8')
  } catch (err) {
    // dist entry may not exist in some builds; skip.
    continue
  }

  if (!contents.startsWith('#!')) {
    await fs.writeFile(target, SHEBANG + contents, 'utf8')
  }
}
