import fs from 'node:fs/promises'

const CLI_PATH = new URL('../dist/cli.js', import.meta.url)
const SHEBANG = '#!/usr/bin/env node\n'

let contents
try {
  contents = await fs.readFile(CLI_PATH, 'utf8')
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  throw new Error(`Failed to read ${CLI_PATH.pathname}: ${msg}`)
}

if (!contents.startsWith('#!')) {
  await fs.writeFile(CLI_PATH, SHEBANG + contents, 'utf8')
}

