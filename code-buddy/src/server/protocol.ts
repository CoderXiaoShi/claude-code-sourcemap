import type { Roll } from '../companion.js'

export const PROTOCOL_VERSION = 1 as const
export const DEFAULT_SERVER_PORT = 4432 as const
export const GAME_TYPES = ['maze-race'] as const

export type GameType = (typeof GAME_TYPES)[number]
export type GameKind = 'match' | 'world'
export type RoomStatus = 'open' | 'playing'

export type ServerInfo = {
  id: string
  name: string
  port: number
}

export type GameInfo = {
  type: GameType
  name: string
  kind: GameKind
  minPlayers: number
  maxPlayers: number | null
  description: string
}

export type UserInfo = {
  id: string
  name: string
  roomId: string | null
}

export type RoomInfo = {
  id: string
  name: string
  ownerId: string
  memberIds: string[]
  readyMemberIds: string[]
  gameType: GameType | null
  currentGameId: string | null
  status: RoomStatus
  createdAt: string
  updatedAt: string
}

export type ProbeRequest = {
  type: 'probe'
  version: number
}

export type ProbeResult = {
  type: 'probe_result'
  version: number
  server: ServerInfo
  stats: {
    users: number
    rooms: number
  }
}

export type HelloRequest = {
  type: 'hello'
  version: number
  name: string
  clientId?: string
  buddy?: Roll
}

export type Welcome = {
  type: 'welcome'
  version: number
  server: ServerInfo
  you: UserInfo
  users: UserInfo[]
  rooms: RoomInfo[]
  games: GameInfo[]
}

export type CreateRoomRequest = {
  type: 'create_room'
  name: string
}

export type SelectGameRequest = {
  type: 'select_game'
  gameType: GameType
}

export type SetReadyRequest = {
  type: 'set_ready'
  ready: boolean
}

export type StartGameRequest = {
  type: 'start_game'
}

export type JoinRoomRequest = {
  type: 'join_room'
  roomId: string
}

export type LeaveRoomRequest = {
  type: 'leave_room'
}

export type ListRoomsRequest = {
  type: 'list_rooms'
  requestId: string
}

export type ListUsersRequest = {
  type: 'list_users'
  requestId: string
}

export type RoomsResponse = {
  type: 'rooms'
  requestId: string
  rooms: RoomInfo[]
}

export type UsersResponse = {
  type: 'users'
  requestId: string
  users: UserInfo[]
}

export type UsersUpdate = {
  type: 'users_update'
  users: UserInfo[]
}

export type RoomsUpdate = {
  type: 'rooms_update'
  rooms: RoomInfo[]
}

export type JoinedRoom = {
  type: 'joined_room'
  roomId: string | null
}

export type GameCommand = {
  type: string
  payload?: Record<string, unknown>
}

export type GameCommandRequest = {
  type: 'game_command'
  roomId: string
  command: GameCommand
  requestId?: string
}

export type GameStarted = {
  type: 'game_started'
  roomId: string
  gameInstanceId: string
  gameType: GameType
}

export type GameEventEnvelope = {
  type: string
  actorId: string | null
  payload?: unknown
  at: string
}

export type GameEventMessage = {
  type: 'game_event'
  roomId: string
  gameInstanceId: string
  gameType: GameType
  event: GameEventEnvelope
}

export type GameStateSnapshot = {
  type: 'game_state'
  roomId: string
  gameInstanceId: string
  gameType: GameType
  version: number
  state: unknown
}

export type Ping = {
  type: 'ping'
  requestId: string
}

export type Pong = {
  type: 'pong'
  requestId: string
  now: string
}

export type ErrorMessage = {
  type: 'error'
  code: string
  message: string
  requestId?: string
}

export type ClientToServerMessage =
  | ProbeRequest
  | HelloRequest
  | CreateRoomRequest
  | SelectGameRequest
  | SetReadyRequest
  | StartGameRequest
  | JoinRoomRequest
  | LeaveRoomRequest
  | ListRoomsRequest
  | ListUsersRequest
  | GameCommandRequest
  | Ping

export type ServerToClientMessage =
  | ProbeResult
  | Welcome
  | RoomsResponse
  | UsersResponse
  | UsersUpdate
  | RoomsUpdate
  | JoinedRoom
  | GameStarted
  | GameEventMessage
  | GameStateSnapshot
  | Pong
  | ErrorMessage

export type AnyMessage = ClientToServerMessage | ServerToClientMessage

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function getMessageType(value: unknown): string | null {
  if (!isObject(value)) return null
  const type = value['type']
  return typeof type === 'string' ? type : null
}
