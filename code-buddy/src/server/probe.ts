import net from 'node:net'
import { NdjsonParser, writeNdjson } from './ndjson.js'
import { PROTOCOL_VERSION, getMessageType, type ProbeResult } from './protocol.js'

export async function probeBuddyServerTcp(
  host: string,
  port: number,
  timeoutMs = 1_000,
): Promise<ProbeResult | null> {
  const socket = new net.Socket()
  socket.setNoDelay(true)
  const parser = new NdjsonParser()

  return new Promise(resolve => {
    let settled = false
    const settle = (value: ProbeResult | null) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    const timer = setTimeout(() => {
      try {
        socket.destroy()
      } catch {
        // ignore
      }
      settle(null)
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timer)
      socket.removeAllListeners()
    }

    socket.on('error', () => settle(null))
    socket.on('close', () => settle(null))
    socket.on('data', chunk => {
      for (const raw of parser.push(chunk)) {
        if (getMessageType(raw) !== 'probe_result') continue
        settle(raw as ProbeResult)
        socket.end()
        return
      }
    })

    socket.connect(port, host, () => {
      writeNdjson(socket, { type: 'probe', version: PROTOCOL_VERSION })
    })
  })
}

