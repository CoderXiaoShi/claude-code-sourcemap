import type { Roll } from '../companion.js'

export const PROTOCOL_VERSION = 1 as const
export const DEFAULT_SERVER_PORT = 4432 as const

export type ServerInfo = {
  id: string
  name: string
  port: number
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
  createdAt: string
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
}

export type CreateRoomRequest = {
  type: 'create_room'
  name: string
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
  | JoinRoomRequest
  | LeaveRoomRequest
  | ListRoomsRequest
  | ListUsersRequest
  | Ping

export type ServerToClientMessage =
  | ProbeResult
  | Welcome
  | RoomsResponse
  | UsersResponse
  | UsersUpdate
  | RoomsUpdate
  | JoinedRoom
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

