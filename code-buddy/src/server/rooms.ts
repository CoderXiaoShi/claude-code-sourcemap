import { randomInt } from 'node:crypto'
import type { RoomInfo } from './protocol.js'

type Room = {
  id: string
  name: string
  ownerId: string
  members: Set<string>
  createdAt: string
}

function generateRoomCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0')
}

export class RoomRegistry {
  #rooms = new Map<string, Room>()
  #memberToRoom = new Map<string, string>()

  listRooms(): RoomInfo[] {
    return [...this.#rooms.values()].map(room => ({
      id: room.id,
      name: room.name,
      ownerId: room.ownerId,
      memberIds: [...room.members.values()],
      createdAt: room.createdAt,
    }))
  }

  getRoomIdForMember(memberId: string): string | null {
    return this.#memberToRoom.get(memberId) ?? null
  }

  createRoom(name: string, ownerId: string): RoomInfo {
    let id: string | null = null
    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = generateRoomCode()
      if (!this.#rooms.has(candidate)) {
        id = candidate
        break
      }
    }

    if (!id) {
      for (let value = 0; value < 10_000; value++) {
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

    const room: Room = {
      id,
      name,
      ownerId,
      members: new Set<string>(),
      createdAt: new Date().toISOString(),
    }
    this.#rooms.set(room.id, room)
    return {
      id: room.id,
      name: room.name,
      ownerId: room.ownerId,
      memberIds: [],
      createdAt: room.createdAt,
    }
  }

  joinRoom(roomId: string, memberId: string): void {
    const room = this.#rooms.get(roomId)
    if (!room) {
      throw new Error(`Room not found: ${roomId}`)
    }

    const current = this.#memberToRoom.get(memberId)
    if (current === roomId) return
    if (current) this.leaveRoom(memberId)

    room.members.add(memberId)
    this.#memberToRoom.set(memberId, roomId)
  }

  leaveRoom(memberId: string): void {
    const roomId = this.#memberToRoom.get(memberId)
    if (!roomId) return

    const room = this.#rooms.get(roomId)
    if (room) {
      room.members.delete(memberId)
      if (room.members.size === 0) {
        this.#rooms.delete(room.id)
      }
    }

    this.#memberToRoom.delete(memberId)
  }
}
