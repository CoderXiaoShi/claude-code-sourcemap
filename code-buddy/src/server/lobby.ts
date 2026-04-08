import { randomInt } from 'node:crypto'
import type { GameType, RoomInfo, RoomStatus } from './protocol.js'

type LobbyRoom = {
  id: string
  name: string
  ownerId: string
  memberIds: Set<string>
  readyMemberIds: Set<string>
  gameType: GameType | null
  currentGameId: string | null
  status: RoomStatus
  createdAt: string
  updatedAt: string
}

function generateRoomCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0')
}

function snapshotRoom(room: LobbyRoom): RoomInfo {
  return {
    id: room.id,
    name: room.name,
    ownerId: room.ownerId,
    memberIds: [...room.memberIds.values()],
    readyMemberIds: [...room.readyMemberIds.values()],
    gameType: room.gameType,
    currentGameId: room.currentGameId,
    status: room.status,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  }
}

export class LobbyService {
  readonly #rooms = new Map<string, LobbyRoom>()
  readonly #memberToRoom = new Map<string, string>()

  listRooms(): RoomInfo[] {
    return [...this.#rooms.values()].map(snapshotRoom)
  }

  getRoom(roomId: string): RoomInfo | null {
    const room = this.#rooms.get(roomId)
    return room ? snapshotRoom(room) : null
  }

  getRoomIdForMember(memberId: string): string | null {
    return this.#memberToRoom.get(memberId) ?? null
  }

  createRoom(name: string, ownerId: string, now: string): RoomInfo {
    let id: string | null = null
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const candidate = generateRoomCode()
      if (!this.#rooms.has(candidate)) {
        id = candidate
        break
      }
    }

    if (!id) {
      for (let value = 0; value < 10_000; value += 1) {
        const candidate = String(value).padStart(4, '0')
        if (!this.#rooms.has(candidate)) {
          id = candidate
          break
        }
      }
    }

    if (!id) {
      throw new Error('No available room codes.')
    }

    const room: LobbyRoom = {
      id,
      name,
      ownerId,
      memberIds: new Set<string>(),
      readyMemberIds: new Set<string>(),
      gameType: null,
      currentGameId: null,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    }
    this.#rooms.set(room.id, room)
    return snapshotRoom(room)
  }

  joinRoom(roomId: string, memberId: string, now: string): RoomInfo {
    const room = this.#rooms.get(roomId)
    if (!room) {
      throw new Error(`Room not found: ${roomId}`)
    }

    const currentRoomId = this.#memberToRoom.get(memberId)
    if (currentRoomId === roomId) {
      return snapshotRoom(room)
    }
    if (currentRoomId) {
      this.leaveRoom(memberId, now)
    }

    room.memberIds.add(memberId)
    room.updatedAt = now
    this.#memberToRoom.set(memberId, room.id)
    return snapshotRoom(room)
  }

  leaveRoom(memberId: string, now: string): RoomInfo | null {
    const roomId = this.#memberToRoom.get(memberId)
    if (!roomId) {
      return null
    }

    const room = this.#rooms.get(roomId)
    this.#memberToRoom.delete(memberId)
    if (!room) {
      return null
    }

    room.memberIds.delete(memberId)
    room.readyMemberIds.delete(memberId)
    room.updatedAt = now

    if (room.memberIds.size === 0 && room.currentGameId === null) {
      this.#rooms.delete(room.id)
      return null
    }

    if (!room.memberIds.has(room.ownerId)) {
      const nextOwnerId = room.memberIds.values().next().value as string | undefined
      if (nextOwnerId) {
        room.ownerId = nextOwnerId
      }
    }

    return snapshotRoom(room)
  }

  selectGame(roomId: string, actorId: string, gameType: GameType, now: string): RoomInfo {
    const room = this.#requireOwnedRoom(roomId, actorId)
    if (room.status === 'playing') {
      throw new Error('Cannot change game while room is playing.')
    }

    room.gameType = gameType
    room.readyMemberIds.clear()
    room.updatedAt = now
    return snapshotRoom(room)
  }

  setReady(roomId: string, memberId: string, ready: boolean, now: string): RoomInfo {
    const room = this.#requireRoomMember(roomId, memberId)
    if (ready) {
      room.readyMemberIds.add(memberId)
    } else {
      room.readyMemberIds.delete(memberId)
    }
    room.updatedAt = now
    return snapshotRoom(room)
  }

  markGameStarted(roomId: string, gameInstanceId: string, now: string): RoomInfo {
    const room = this.#requireRoom(roomId)
    room.currentGameId = gameInstanceId
    room.status = 'playing'
    room.readyMemberIds.clear()
    room.updatedAt = now
    return snapshotRoom(room)
  }

  markGameFinished(roomId: string, now: string): RoomInfo {
    const room = this.#requireRoom(roomId)
    room.currentGameId = null
    room.status = 'open'
    room.readyMemberIds.clear()
    room.updatedAt = now
    return snapshotRoom(room)
  }

  #requireRoom(roomId: string): LobbyRoom {
    const room = this.#rooms.get(roomId)
    if (!room) {
      throw new Error(`Room not found: ${roomId}`)
    }
    return room
  }

  #requireOwnedRoom(roomId: string, actorId: string): LobbyRoom {
    const room = this.#requireRoom(roomId)
    if (room.ownerId !== actorId) {
      throw new Error('Only room owner can perform this action.')
    }
    return room
  }

  #requireRoomMember(roomId: string, memberId: string): LobbyRoom {
    const room = this.#requireRoom(roomId)
    if (!room.memberIds.has(memberId)) {
      throw new Error('Player is not in the room.')
    }
    return room
  }
}
