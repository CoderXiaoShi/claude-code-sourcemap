#!/usr/bin/env node
import { createBuddyLanServer } from './server/server.js'
import { DEFAULT_SERVER_PORT } from './server/protocol.js'

function showHelp(): void {
  console.log(`
Buddy LAN Server

Usage:
  buddy-server [options]
  node ./dist/lan-server.js [options]

Options:
  --host <host>     Listen host (default: 0.0.0.0)
  --port <port>     Listen port (default: ${DEFAULT_SERVER_PORT})
  --name <name>     Server name shown to clients
  -h, --help        Show help

Env:
  HOST / PORT / NAME can also be used.
`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  let host = process.env.HOST ?? '0.0.0.0'
  let port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT)
  let name = process.env.NAME ?? 'Code Buddy LAN'

  for (let index = 0; index < args.length; index++) {
    switch (args[index]) {
      case '--host':
        host = args[++index] ?? host
        break
      case '--port':
        port = Number(args[++index] ?? port)
        break
      case '--name':
        name = args[++index] ?? name
        break
      case '-h':
      case '--help':
        showHelp()
        return
    }
  }

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid port: ${port}`)
  }

  const server = createBuddyLanServer({ host, port, name })
  await server.start()

  const info = server.info()
  console.log(`[buddy-server] started: ${info.name}`)
  console.log(`[buddy-server] listening on ${host}:${info.port}`)

  const shutdown = async () => {
    console.log('[buddy-server] stopping...')
    await server.stop()
    console.log('[buddy-server] stopped')
  }

  process.once('SIGINT', () => shutdown().catch(() => {}).finally(() => process.exit(0)))
  process.once('SIGTERM', () => shutdown().catch(() => {}).finally(() => process.exit(0)))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

