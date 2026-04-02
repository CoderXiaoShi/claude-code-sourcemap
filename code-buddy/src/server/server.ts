import net from 'node:net'
import dgram from 'node:dgram'
import { randomUUID } from 'node:crypto'
import type { Roll } from '../companion.js'
import { writeNdjson, NdjsonParser } from './ndjson.js'
import {
  DEFAULT_SERVER_PORT,
  PROTOCOL_VERSION,
  getMessageType,
  type AnyMessage,
  type ErrorMessage,
  type ProbeResult,
  type RoomInfo,
  type RoomsResponse,
  type ServerInfo,
  type UserInfo,
  type UsersResponse,
  type Welcome,
} from './protocol.js'
import { RoomRegistry } from './rooms.js'

export type BuddyLanServer = {
  start: () => Promise<void>
  stop: () => Promise<void>
  info: () => ServerInfo
}

export type BuddyLanServerOptions = {
  port?: number
  host?: string
  name?: string
}

type ClientContext = {
  id: string
  name: string
  socket: net.Socket
  parser: NdjsonParser
  buddy?: Roll
}

export function createBuddyLanServer(
  options: BuddyLanServerOptions = {},
): BuddyLanServer {
  const port = options.port ?? DEFAULT_SERVER_PORT
  const host = options.host ?? '0.0.0.0'
  const name = options.name ?? 'Code Buddy LAN'
  const serverId = randomUUID()

  const rooms = new RoomRegistry()
  const clients = new Map<string, ClientContext>()

  const serverInfo: ServerInfo = { id: serverId, name, port }

  let udpSocket: dgram.Socket | null = null

  function snapshotRooms(): RoomInfo[] {
    return rooms.listRooms()
  }

  const server = net.createServer(socket => {
    socket.setNoDelay(true)

    const parser = new NdjsonParser()
    let authedClientId: string | null = null
    let closed = false

    const handshakeTimeout = setTimeout(() => {
      if (!authedClientId) {
        socket.end()
      }
    }, 5_000)

    function getRoomId(clientId: string): string | null {
      return rooms.getRoomIdForMember(clientId)
    }

    function snapshotUsers(): UserInfo[] {
      return [...clients.values()].map(client => ({
        id: client.id,
        name: client.name,
        roomId: getRoomId(client.id),
      }))
    }

    function sendError(
      error: Omit<ErrorMessage, 'type'> & { requestId?: string },
    ): void {
      writeNdjson(socket, { type: 'error', ...error } satisfies ErrorMessage)
    }

    function broadcast(message: AnyMessage): void {
      for (const client of clients.values()) {
        writeNdjson(client.socket, message)
      }
    }

    function broadcastState(): void {
      broadcast({ type: 'users_update', users: snapshotUsers() })
      broadcast({ type: 'rooms_update', rooms: snapshotRooms() })
    }

    socket.on('data', chunk => {
      for (const raw of parser.push(chunk)) {
        const type = getMessageType(raw)
        if (!type) continue

        if (type === 'probe') {
          const result: ProbeResult = {
            type: 'probe_result',
            version: PROTOCOL_VERSION,
            server: serverInfo,
            stats: {
              users: clients.size,
              rooms: snapshotRooms().length,
            },
          }
          writeNdjson(socket, result)
          socket.end()
          return
        }

        if (type === 'hello') {
          if (authedClientId) {
            sendError({
              code: 'already_authed',
              message: 'Client already authenticated.',
            })
            continue
          }

          if (typeof raw !== 'object' || raw === null) continue
          const payload = raw as Record<string, unknown>
          const clientName = payload['name']
          if (typeof clientName !== 'string' || !clientName.trim()) {
            sendError({
              code: 'invalid_name',
              message: 'Missing or invalid client name.',
            })
            socket.end()
            return
          }

          const requestedId = payload['clientId']
          const clientId =
            typeof requestedId === 'string' && requestedId
              ? requestedId
              : randomUUID()

          authedClientId = clientId
          clearTimeout(handshakeTimeout)

          const buddy = payload['buddy'] as Roll | undefined
          const context: ClientContext = {
            id: clientId,
            name: clientName.trim(),
            socket,
            parser,
          }
          if (buddy) {
            context.buddy = buddy
          }
          clients.set(clientId, context)

          const welcome: Welcome = {
            type: 'welcome',
            version: PROTOCOL_VERSION,
            server: serverInfo,
            you: {
              id: clientId,
              name: clientName.trim(),
              roomId: getRoomId(clientId),
            },
            users: snapshotUsers(),
            rooms: snapshotRooms(),
          }
          writeNdjson(socket, welcome)

          broadcastState()
          continue
        }

        if (!authedClientId) {
          sendError({
            code: 'unauthorized',
            message: 'Send hello first.',
          })
          socket.end()
          return
        }

        const clientId = authedClientId

        try {
          if (type === 'ping') {
            if (typeof raw !== 'object' || raw === null) continue
            const requestId = (raw as Record<string, unknown>)['requestId']
            if (typeof requestId !== 'string' || !requestId) continue
            writeNdjson(socket, {
              type: 'pong',
              requestId,
              now: new Date().toISOString(),
            })
            continue
          }

          if (type === 'list_rooms') {
            if (typeof raw !== 'object' || raw === null) continue
            const requestId = (raw as Record<string, unknown>)['requestId']
            if (typeof requestId !== 'string' || !requestId) continue
            const response: RoomsResponse = {
              type: 'rooms',
              requestId,
              rooms: snapshotRooms(),
            }
            writeNdjson(socket, response)
            continue
          }

          if (type === 'list_users') {
            if (typeof raw !== 'object' || raw === null) continue
            const requestId = (raw as Record<string, unknown>)['requestId']
            if (typeof requestId !== 'string' || !requestId) continue
            const response: UsersResponse = {
              type: 'users',
              requestId,
              users: snapshotUsers(),
            }
            writeNdjson(socket, response)
            continue
          }

          if (type === 'create_room') {
            if (typeof raw !== 'object' || raw === null) continue
            const roomName = (raw as Record<string, unknown>)['name']
            if (typeof roomName !== 'string' || !roomName.trim()) {
              sendError({
                code: 'invalid_room_name',
                message: 'Missing or invalid room name.',
              })
              continue
            }

            const created = rooms.createRoom(roomName.trim(), clientId)
            rooms.joinRoom(created.id, clientId)
            writeNdjson(socket, { type: 'joined_room', roomId: created.id })
            broadcastState()
            continue
          }

          if (type === 'join_room') {
            if (typeof raw !== 'object' || raw === null) continue
            const roomId = (raw as Record<string, unknown>)['roomId']
            if (typeof roomId !== 'string' || !roomId) {
              sendError({
                code: 'invalid_room_id',
                message: 'Missing or invalid roomId.',
              })
              continue
            }

            rooms.joinRoom(roomId, clientId)
            writeNdjson(socket, { type: 'joined_room', roomId })
            broadcastState()
            continue
          }

          if (type === 'leave_room') {
            rooms.leaveRoom(clientId)
            writeNdjson(socket, { type: 'joined_room', roomId: null })
            broadcastState()
            continue
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendError({ code: 'server_error', message })
        }
      }
    })

    socket.on('close', () => {
      if (closed) return
      closed = true

      clearTimeout(handshakeTimeout)
      if (authedClientId) {
        rooms.leaveRoom(authedClientId)
        clients.delete(authedClientId)
        broadcastState()
      }
    })

    socket.on('error', () => {
      // handled by close cleanup
    })
  })

  return {
    info: () => serverInfo,
    start: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          server.off('error', reject)
          const udp = dgram.createSocket('udp4')
          udpSocket = udp
          udp.unref()

          udp.on('message', (msg, rinfo) => {
            try {
              const raw = JSON.parse(msg.toString('utf8')) as unknown
              if (getMessageType(raw) !== 'probe') return

              const result: ProbeResult = {
                type: 'probe_result',
                version: PROTOCOL_VERSION,
                server: serverInfo,
                stats: {
                  users: clients.size,
                  rooms: snapshotRooms().length,
                },
              }
              udp.send(
                Buffer.from(JSON.stringify(result), 'utf8'),
                rinfo.port,
                rinfo.address,
              )
            } catch {
              // ignore
            }
          })

          udp.once('error', error => {
            udpSocket = null
            reject(error)
          })

          udp.bind(port, '0.0.0.0', () => {
            udp.off('error', reject)
            resolve()
          })
        })
      }),
    stop: () =>
      new Promise((resolve, reject) => {
        for (const client of clients.values()) {
          client.socket.end()
        }
        const closeTcp = () =>
          server.close(err => {
            if (err) reject(err)
            else resolve()
          })

        if (udpSocket) {
          const udp = udpSocket
          udpSocket = null
          try {
            udp.close(() => closeTcp())
          } catch {
            closeTcp()
          }
          return
        }

        closeTcp()
      }),
  }
}
