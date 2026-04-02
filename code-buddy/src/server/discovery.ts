import dgram from 'node:dgram'
import net from 'node:net'
import os from 'node:os'
import { NdjsonParser, writeNdjson } from './ndjson.js'
import {
  DEFAULT_SERVER_PORT,
  PROTOCOL_VERSION,
  getMessageType,
  type ProbeResult,
  type ServerInfo,
} from './protocol.js'

export type DiscoveredServer = {
  ip: string
  server: ServerInfo
  stats: ProbeResult['stats']
}

export type ScanOptions = {
  port?: number
  timeoutMs?: number
  concurrency?: number
  method?: 'auto' | 'udp' | 'tcp'
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

type LocalIpv4 = {
  address: string
  netmask?: string
}

function getLocalIpv4(): LocalIpv4[] {
  const nets = os.networkInterfaces()
  const items: LocalIpv4[] = []

  for (const name of Object.keys(nets)) {
    for (const netInfo of nets[name] ?? []) {
      if (netInfo.family !== 'IPv4') continue
      if (netInfo.internal) continue
      items.push({ address: netInfo.address, netmask: netInfo.netmask })
    }
  }

  const seen = new Set<string>()
  const out: LocalIpv4[] = []
  for (const item of items) {
    if (seen.has(item.address)) continue
    seen.add(item.address)
    out.push(item)
  }
  return out
}

function getIpv4Prefix24Candidates(ip: string): string[] {
  const parts = ip.split('.').map(n => Number(n))
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n))) return []

  const [a, b, c] = parts
  const candidates: string[] = []
  for (let d = 1; d <= 254; d++) {
    const candidate = `${a}.${b}.${c}.${d}`
    if (candidate === ip) continue
    candidates.push(candidate)
  }
  return candidates
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map(n => Number(n))
  if (parts.length !== 4) return null
  if (parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null
  // eslint-disable-next-line no-bitwise
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
}

function intToIpv4(value: number): string {
  // eslint-disable-next-line no-bitwise
  const a = (value >>> 24) & 0xff
  // eslint-disable-next-line no-bitwise
  const b = (value >>> 16) & 0xff
  // eslint-disable-next-line no-bitwise
  const c = (value >>> 8) & 0xff
  // eslint-disable-next-line no-bitwise
  const d = value & 0xff
  return `${a}.${b}.${c}.${d}`
}

function broadcastAddress(ip: string, netmask?: string): string | null {
  const ipInt = ipv4ToInt(ip)
  if (ipInt === null) return null

  const maskInt = netmask ? ipv4ToInt(netmask) : null
  if (maskInt === null) {
    // fallback to /24
    const parts = ip.split('.')
    if (parts.length !== 4) return null
    return `${parts[0]}.${parts[1]}.${parts[2]}.255`
  }

  // broadcast = ip | (~mask)
  // eslint-disable-next-line no-bitwise
  const bcast = (ipInt | (~maskInt >>> 0)) >>> 0
  return intToIpv4(bcast)
}

async function probeServer(
  ip: string,
  port: number,
  timeoutMs: number,
): Promise<DiscoveredServer | null> {
  const socket = new net.Socket()
  socket.setNoDelay(true)

  const parser = new NdjsonParser()

  return new Promise(resolve => {
    let settled = false
    const settle = (value: DiscoveredServer | null) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    const timer = setTimeout(() => {
      socket.destroy()
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
        const type = getMessageType(raw)
        if (type !== 'probe_result') continue
        const result = raw as ProbeResult
        settle({ ip, server: result.server, stats: result.stats })
        socket.end()
        return
      }
    })

    socket.connect(port, ip, () => {
      writeNdjson(socket, { type: 'probe', version: PROTOCOL_VERSION })
    })
  })
}

async function discoverLanBuddyServersUdp(
  options: ScanOptions,
): Promise<DiscoveredServer[]> {
  const port = options.port ?? DEFAULT_SERVER_PORT
  const timeoutMs = options.timeoutMs ?? 800

  const locals = getLocalIpv4()
  const broadcasts = unique(
    [
      ...locals
        .map(item => broadcastAddress(item.address, item.netmask))
        .filter((value): value is string => Boolean(value)),
      '255.255.255.255',
    ].filter(Boolean),
  )

  const discovered = new Map<string, DiscoveredServer>()

  const socket = dgram.createSocket('udp4')
  socket.unref()

  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, '0.0.0.0', () => {
      socket.off('error', reject)
      resolve()
    })
  })

  socket.setBroadcast(true)

  socket.on('message', (msg, rinfo) => {
    try {
      const raw = JSON.parse(msg.toString('utf8')) as unknown
      if (getMessageType(raw) !== 'probe_result') return
      const result = raw as ProbeResult
      if (!result.server?.id) return

      if (!discovered.has(result.server.id)) {
        discovered.set(result.server.id, {
          ip: rinfo.address,
          server: result.server,
          stats: result.stats,
        })
      }
    } catch {
      // ignore
    }
  })

  const payload = Buffer.from(
    JSON.stringify({ type: 'probe', version: PROTOCOL_VERSION }),
    'utf8',
  )
  for (const addr of broadcasts) {
    try {
      socket.send(payload, port, addr)
    } catch {
      // ignore send errors
    }
  }

  await new Promise(resolve => setTimeout(resolve, timeoutMs))
  socket.close()

  const results = [...discovered.values()]
  results.sort((a, b) => a.ip.localeCompare(b.ip))
  return results
}

async function scanLanForBuddyServersTcp(
  options: ScanOptions,
): Promise<DiscoveredServer[]> {
  const port = options.port ?? DEFAULT_SERVER_PORT
  const timeoutMs = options.timeoutMs ?? 500
  const concurrency = Math.max(1, options.concurrency ?? 64)

  const localIps = getLocalIpv4().map(i => i.address)
  const targets = unique(localIps.flatMap(getIpv4Prefix24Candidates))

  const results: DiscoveredServer[] = []
  let index = 0

  const workers = Array.from(
    { length: Math.min(concurrency, targets.length) },
    () =>
      (async () => {
        while (true) {
          const target = targets[index++]
          if (!target) return
          const found = await probeServer(target, port, timeoutMs)
          if (found) results.push(found)
        }
      })(),
  )

  await Promise.all(workers)
  results.sort((a, b) => a.ip.localeCompare(b.ip))
  return results
}

export async function scanLanForBuddyServers(
  options: ScanOptions = {},
): Promise<DiscoveredServer[]> {
  const method = options.method ?? 'auto'
  if (method === 'udp') {
    return discoverLanBuddyServersUdp(options)
  }
  if (method === 'tcp') {
    return scanLanForBuddyServersTcp(options)
  }

  const udp = await discoverLanBuddyServersUdp(options)
  if (udp.length > 0) return udp
  return scanLanForBuddyServersTcp(options)
}
