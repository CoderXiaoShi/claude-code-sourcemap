import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { Roll } from '../companion.js'
import { NdjsonParser, writeNdjson } from './ndjson.js'
import {
  PROTOCOL_VERSION,
  getMessageType,
  type AnyMessage,
  type ErrorMessage,
  type RoomInfo,
  type RoomsResponse,
  type ServerInfo,
  type UserInfo,
  type UsersResponse,
  type Welcome,
} from './protocol.js'

export type BuddyLanClientState = {
  server: ServerInfo
  you: UserInfo
  users: UserInfo[]
  rooms: RoomInfo[]
}

export type BuddyLanClientOptions = {
  host: string
  port: number
  name: string
  clientId?: string
  buddy?: Roll
  timeoutMs?: number
}

type PendingRequest =
  | {
      type: 'rooms'
      resolve: (value: RoomInfo[]) => void
      reject: (error: Error) => void
      timeout: NodeJS.Timeout
    }
  | {
      type: 'users'
      resolve: (value: UserInfo[]) => void
      reject: (error: Error) => void
      timeout: NodeJS.Timeout
    }

export class BuddyLanClient extends EventEmitter {
  readonly #socket: net.Socket
  readonly #parser = new NdjsonParser()
  readonly #pending = new Map<string, PendingRequest>()

  #state: BuddyLanClientState

  private constructor(socket: net.Socket, state: BuddyLanClientState) {
    super()
    this.#socket = socket
    this.#state = state
  }

  get state(): BuddyLanClientState {
    return this.#state
  }

  static async connect(options: BuddyLanClientOptions): Promise<BuddyLanClient> {
    const timeoutMs = options.timeoutMs ?? 5_000
    const socket = new net.Socket()
    socket.setNoDelay(true)

    const connected = new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        cleanup()
        reject(err)
      }
      const onConnect = () => {
        cleanup()
        resolve()
      }
      const timer = setTimeout(() => {
        cleanup()
        socket.destroy(new Error('connect_timeout'))
        reject(new Error('connect_timeout'))
      }, timeoutMs)

      function cleanup() {
        clearTimeout(timer)
        socket.off('error', onError)
        socket.off('connect', onConnect)
      }

      socket.once('error', onError)
      socket.once('connect', onConnect)
    })

    socket.connect(options.port, options.host)
    await connected

    const welcome = await new Promise<Welcome>((resolve, reject) => {
      const parser = new NdjsonParser()

      const onData = (chunk: Buffer) => {
        for (const raw of parser.push(chunk)) {
          const type = getMessageType(raw)
          if (type === 'welcome') {
            cleanup()
            resolve(raw as Welcome)
            return
          }
          if (type === 'error') {
            cleanup()
            const msg = raw as ErrorMessage
            reject(new Error(`${msg.code}: ${msg.message}`))
            return
          }
        }
      }

      const onError = (err: Error) => {
        cleanup()
        reject(err)
      }

      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('handshake_timeout'))
      }, timeoutMs)

      function cleanup() {
        clearTimeout(timer)
        socket.off('data', onData)
        socket.off('error', onError)
      }

      socket.on('data', onData)
      socket.once('error', onError)

      const hello: Record<string, unknown> = {
        type: 'hello',
        version: PROTOCOL_VERSION,
        name: options.name,
      }
      if (options.clientId) {
        hello['clientId'] = options.clientId
      }
      if (options.buddy) {
        hello['buddy'] = options.buddy
      }
      writeNdjson(socket, hello)
    })

    const client = new BuddyLanClient(socket, {
      server: welcome.server,
      you: welcome.you,
      users: welcome.users,
      rooms: welcome.rooms,
    })
    client.#wireSocket()
    return client
  }

  #wireSocket(): void {
    this.#socket.on('data', chunk => {
      for (const raw of this.#parser.push(chunk)) {
        this.#handleMessage(raw)
      }
    })

    this.#socket.on('close', () => {
      for (const [requestId, pending] of this.#pending.entries()) {
        clearTimeout(pending.timeout)
        pending.reject(new Error('disconnected'))
        this.#pending.delete(requestId)
      }
      this.emit('close')
    })

    this.#socket.on('error', err => {
      this.emit('socket_error', err)
    })
  }

  #handleMessage(raw: unknown): void {
    const type = getMessageType(raw)
    if (!type) return

    if (type === 'users_update') {
      const users = (raw as { users: UserInfo[] }).users
      this.#state = { ...this.#state, users }
      this.emit('users_update', users)
      return
    }

    if (type === 'rooms_update') {
      const rooms = (raw as { rooms: RoomInfo[] }).rooms
      this.#state = { ...this.#state, rooms }
      this.emit('rooms_update', rooms)
      return
    }

    if (type === 'joined_room') {
      const roomId = (raw as { roomId: string | null }).roomId
      this.#state = { ...this.#state, you: { ...this.#state.you, roomId } }
      this.emit('joined_room', roomId)
      return
    }

    if (type === 'rooms') {
      const { requestId, rooms } = raw as RoomsResponse
      const pending = this.#pending.get(requestId)
      if (pending?.type === 'rooms') {
        clearTimeout(pending.timeout)
        this.#pending.delete(requestId)
        pending.resolve(rooms)
      }
      return
    }

    if (type === 'users') {
      const { requestId, users } = raw as UsersResponse
      const pending = this.#pending.get(requestId)
      if (pending?.type === 'users') {
        clearTimeout(pending.timeout)
        this.#pending.delete(requestId)
        pending.resolve(users)
      }
      return
    }

    if (type === 'error') {
      const msg = raw as ErrorMessage
      if (msg.requestId) {
        const pending = this.#pending.get(msg.requestId)
        if (pending) {
          clearTimeout(pending.timeout)
          this.#pending.delete(msg.requestId)
          pending.reject(new Error(`${msg.code}: ${msg.message}`))
        }
      }
      this.emit('error', msg)
      return
    }

    this.emit('message', raw as AnyMessage)
  }

  close(): void {
    this.#socket.end()
  }

  createRoom(name: string): void {
    writeNdjson(this.#socket, { type: 'create_room', name })
  }

  joinRoom(roomId: string): void {
    writeNdjson(this.#socket, { type: 'join_room', roomId })
  }

  leaveRoom(): void {
    writeNdjson(this.#socket, { type: 'leave_room' })
  }

  async listRooms(timeoutMs = 3_000): Promise<RoomInfo[]> {
    const requestId = randomUUID()
    const promise = new Promise<RoomInfo[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId)
        reject(new Error('timeout'))
      }, timeoutMs)
      this.#pending.set(requestId, { type: 'rooms', resolve, reject, timeout })
    })

    writeNdjson(this.#socket, { type: 'list_rooms', requestId })
    return promise
  }

  async listUsers(timeoutMs = 3_000): Promise<UserInfo[]> {
    const requestId = randomUUID()
    const promise = new Promise<UserInfo[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId)
        reject(new Error('timeout'))
      }, timeoutMs)
      this.#pending.set(requestId, { type: 'users', resolve, reject, timeout })
    })

    writeNdjson(this.#socket, { type: 'list_users', requestId })
    return promise
  }
}
