import net from 'node:net'
import dgram from 'node:dgram'
import { randomUUID } from 'node:crypto'
import type { Roll } from '../companion.js'
import { NdjsonParser, writeNdjson } from './ndjson.js'
import { GameRegistry } from './game/registry.js'
import { GameRuntimeManager } from './game/runtime.js'
import { mazeRaceGame } from './games/maze-race.js'
import { LobbyService } from './lobby.js'
import {
  DEFAULT_SERVER_PORT,
  PROTOCOL_VERSION,
  getMessageType,
  type AnyMessage,
  type ErrorMessage,
  type GameCommand,
  type ProbeResult,
  type RoomInfo,
  type RoomsResponse,
  type ServerInfo,
  type UserInfo,
  type UsersResponse,
  type Welcome,
} from './protocol.js'

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
  const lobby = new LobbyService()
  const registry = new GameRegistry()
  registry.register(mazeRaceGame)

  const clients = new Map<string, ClientContext>()
  const serverInfo: ServerInfo = { id: serverId, name, port }

  let udpSocket: dgram.Socket | null = null

  function getRoomId(clientId: string): string | null {
    return lobby.getRoomIdForMember(clientId)
  }

  function snapshotUsers(): UserInfo[] {
    return [...clients.values()].map(client => ({
      id: client.id,
      name: client.name,
      roomId: getRoomId(client.id),
    }))
  }

  function snapshotRooms(): RoomInfo[] {
    return lobby.listRooms()
  }

  function broadcast(message: AnyMessage): void {
    for (const client of clients.values()) {
      writeNdjson(client.socket, message)
    }
  }

  function broadcastToRoom(roomId: string, message: AnyMessage): void {
    for (const client of clients.values()) {
      if (getRoomId(client.id) !== roomId) {
        continue
      }
      writeNdjson(client.socket, message)
    }
  }

  function broadcastState(): void {
    broadcast({ type: 'users_update', users: snapshotUsers() })
    broadcast({ type: 'rooms_update', rooms: snapshotRooms() })
  }

  const runtime = new GameRuntimeManager(registry, lobby, {
    listUsers: snapshotUsers,
    broadcastToRoom: (roomId, message) => {
      broadcastToRoom(roomId, message as AnyMessage)
    },
    sendToSocket: writeNdjson,
  })

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

    function sendError(
      error: Omit<ErrorMessage, 'type'> & { requestId?: string },
    ): void {
      writeNdjson(socket, { type: 'error', ...error } satisfies ErrorMessage)
    }

    function sendServerError(message: string, requestId?: string): void {
      if (requestId) {
        sendError({ code: 'server_error', message, requestId })
        return
      }
      sendError({ code: 'server_error', message })
    }

    socket.on('data', async chunk => {
      for (const raw of parser.push(chunk)) {
        const type = getMessageType(raw)
        if (!type) {
          continue
        }

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

          if (typeof raw !== 'object' || raw === null) {
            continue
          }

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
              name: context.name,
              roomId: getRoomId(clientId),
            },
            users: snapshotUsers(),
            rooms: snapshotRooms(),
            games: runtime.listGames(),
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
        const payload = raw as Record<string, unknown>
        const requestId =
          typeof payload['requestId'] === 'string' ? payload['requestId'] : undefined

        try {
          if (type === 'ping') {
            const pingRequestId = payload['requestId']
            if (typeof pingRequestId !== 'string' || !pingRequestId) {
              continue
            }
            writeNdjson(socket, {
              type: 'pong',
              requestId: pingRequestId,
              now: new Date().toISOString(),
            })
            continue
          }

          if (type === 'list_rooms') {
            const listRequestId = payload['requestId']
            if (typeof listRequestId !== 'string' || !listRequestId) {
              continue
            }
            const response: RoomsResponse = {
              type: 'rooms',
              requestId: listRequestId,
              rooms: snapshotRooms(),
            }
            writeNdjson(socket, response)
            continue
          }

          if (type === 'list_users') {
            const listRequestId = payload['requestId']
            if (typeof listRequestId !== 'string' || !listRequestId) {
              continue
            }
            const response: UsersResponse = {
              type: 'users',
              requestId: listRequestId,
              users: snapshotUsers(),
            }
            writeNdjson(socket, response)
            continue
          }

          if (type === 'create_room') {
            const roomName = payload['name']
            if (typeof roomName !== 'string' || !roomName.trim()) {
              const error = {
                code: 'invalid_room_name',
                message: 'Missing or invalid room name.',
                ...(requestId ? { requestId } : {}),
              }
              sendError(error)
              continue
            }

            const now = new Date().toISOString()
            const created = lobby.createRoom(roomName.trim(), clientId, now)
            lobby.joinRoom(created.id, clientId, now)
            writeNdjson(socket, { type: 'joined_room', roomId: created.id })
            broadcastState()
            continue
          }

          if (type === 'join_room') {
            const roomId = payload['roomId']
            if (typeof roomId !== 'string' || !roomId) {
              const error = {
                code: 'invalid_room_id',
                message: 'Missing or invalid roomId.',
                ...(requestId ? { requestId } : {}),
              }
              sendError(error)
              continue
            }

            lobby.joinRoom(roomId, clientId, new Date().toISOString())
            writeNdjson(socket, { type: 'joined_room', roomId })
            broadcastState()
            runtime.syncStateToSocket(socket, roomId).catch(() => {})
            continue
          }

          if (type === 'leave_room') {
            lobby.leaveRoom(clientId, new Date().toISOString())
            writeNdjson(socket, { type: 'joined_room', roomId: null })
            broadcastState()
            continue
          }

          if (type === 'select_game') {
            const roomId = getRoomId(clientId)
            if (!roomId) {
              throw new Error('Join a room first.')
            }
            const gameType = payload['gameType']
            if (typeof gameType !== 'string' || !registry.has(gameType)) {
              throw new Error('Unsupported game type.')
            }
            lobby.selectGame(roomId, clientId, gameType, new Date().toISOString())
            broadcastState()
            continue
          }

          if (type === 'set_ready') {
            const roomId = getRoomId(clientId)
            if (!roomId) {
              throw new Error('Join a room first.')
            }
            const ready = payload['ready']
            if (typeof ready !== 'boolean') {
              throw new Error('Invalid ready flag.')
            }
            lobby.setReady(roomId, clientId, ready, new Date().toISOString())
            broadcastState()
            continue
          }

          if (type === 'start_game') {
            const roomId = getRoomId(clientId)
            if (!roomId) {
              throw new Error('Join a room first.')
            }
            await runtime.startGame(roomId, clientId)
            broadcastState()
            continue
          }

          if (type === 'game_command') {
            const roomId = payload['roomId']
            const command = payload['command']
            if (typeof roomId !== 'string' || !roomId) {
              throw new Error('Missing roomId.')
            }
            if (typeof command !== 'object' || command === null) {
              throw new Error('Missing command payload.')
            }
            await runtime.dispatchCommand(roomId, clientId, command as GameCommand)
            continue
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendServerError(message, requestId)
        }
      }
    })

    socket.on('close', () => {
      if (closed) {
        return
      }
      closed = true
      clearTimeout(handshakeTimeout)

      if (authedClientId) {
        lobby.leaveRoom(authedClientId, new Date().toISOString())
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
              if (getMessageType(raw) !== 'probe') {
                return
              }

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
        runtime.stop()

        const closeTcp = () =>
          server.close(err => {
            if (err) {
              reject(err)
            } else {
              resolve()
            }
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
