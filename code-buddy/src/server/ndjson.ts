import type net from 'node:net'

export class NdjsonParser {
  #buffer = ''

  push(chunk: Buffer): unknown[] {
    this.#buffer += chunk.toString('utf8')

    const lines = this.#buffer.split('\n')
    this.#buffer = lines.pop() ?? ''

    const messages: unknown[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        messages.push(JSON.parse(trimmed) as unknown)
      } catch {
        // ignore malformed json line
      }
    }

    return messages
  }
}

export function writeNdjson(socket: net.Socket, message: unknown): void {
  socket.write(`${JSON.stringify(message)}\n`, 'utf8')
}

