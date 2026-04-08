import { randomUUID } from 'node:crypto'
import type net from 'node:net'
import { LobbyService } from '../lobby.js'
import type {
  GameCommand,
  GameEventMessage,
  GameType,
  GameStarted,
  GameStateSnapshot,
  RoomInfo,
  UserInfo,
} from '../protocol.js'
import { GameRegistry } from './registry.js'
import type { GameDefinition, GameMutation } from './types.js'

type ActiveRuntime = {
  roomId: string
  instanceId: string
  gameType: GameType
  state: unknown
  version: number
}

type RuntimeHooks = {
  listUsers: () => UserInfo[]
  broadcastToRoom: (roomId: string, message: unknown) => void
  sendToSocket: (socket: net.Socket, message: unknown) => void
}

export class GameRuntimeManager {
  readonly #registry: GameRegistry
  readonly #lobby: LobbyService
  readonly #hooks: RuntimeHooks
  readonly #runtimes = new Map<string, ActiveRuntime>()
  readonly #queues = new Map<string, Promise<unknown>>()

  constructor(
    registry: GameRegistry,
    lobby: LobbyService,
    hooks: RuntimeHooks,
  ) {
    this.#registry = registry
    this.#lobby = lobby
    this.#hooks = hooks
  }

  listGames() {
    return this.#registry.list()
  }

  stop(): void {
    this.#queues.clear()
    this.#runtimes.clear()
  }

  async startGame(roomId: string, actorId: string): Promise<GameStateSnapshot> {
    return this.#runExclusive(roomId, async () => {
      const room = this.#lobby.getRoom(roomId)
      if (!room) {
        throw new Error('Room not found.')
      }
      if (room.ownerId !== actorId) {
        throw new Error('Only room owner can start the game.')
      }
      if (!room.gameType) {
        throw new Error('Select a game before starting.')
      }
      if (room.currentGameId) {
        throw new Error('This room already has a running game.')
      }

      const definition = this.#registry.get(room.gameType)
      const players = this.#getRoomPlayers(room)
      this.#validateStart(definition, room, players)

      const now = new Date().toISOString()
      const instanceId = randomUUID()
      const runtime: ActiveRuntime = {
        roomId,
        instanceId,
        gameType: room.gameType,
        state: definition.createInitialState({
          now,
          room,
          players,
          instanceId,
        }),
        version: 1,
      }

      this.#runtimes.set(room.id, runtime)
      this.#lobby.markGameStarted(roomId, instanceId, now)

      const startedMessage: GameStarted = {
        type: 'game_started',
        roomId,
        gameInstanceId: instanceId,
        gameType: room.gameType,
      }
      this.#hooks.broadcastToRoom(roomId, startedMessage)

      const snapshot = this.#buildStateMessage(runtime)
      this.#hooks.broadcastToRoom(roomId, snapshot)
      return snapshot
    })
  }

  async dispatchCommand(
    roomId: string,
    actorId: string,
    command: GameCommand,
  ): Promise<GameStateSnapshot> {
    return this.#runExclusive(roomId, async () => {
      const room = this.#lobby.getRoom(roomId)
      if (!room) {
        throw new Error('Room not found.')
      }
      if (!room.memberIds.includes(actorId)) {
        throw new Error('Player is not in the room.')
      }

      const runtime = this.#requireRuntime(room)
      const definition = this.#registry.get(runtime.gameType)
      const now = new Date().toISOString()
      const mutation = definition.applyCommand({
        now,
        room,
        players: this.#getRoomPlayers(room),
        instanceId: runtime.instanceId,
        actorId,
        command,
        state: runtime.state,
      })

      return this.#commitMutation(room, runtime, mutation, now)
    })
  }

  async syncStateToSocket(socket: net.Socket, roomId: string): Promise<void> {
    const room = this.#lobby.getRoom(roomId)
    if (!room || !room.currentGameId) {
      return
    }

    const runtime = await this.#runExclusive(roomId, () => this.#requireRuntime(room))
    this.#hooks.sendToSocket(socket, this.#buildStateMessage(runtime))
  }

  async #commitMutation(
    room: RoomInfo,
    runtime: ActiveRuntime,
    mutation: GameMutation,
    now: string,
  ): Promise<GameStateSnapshot> {
    runtime.state = mutation.state
    runtime.version += 1

    for (const event of mutation.events) {
      const message: GameEventMessage = {
        type: 'game_event',
        roomId: room.id,
        gameInstanceId: runtime.instanceId,
        gameType: runtime.gameType,
        event,
      }
      this.#hooks.broadcastToRoom(room.id, message)
    }

    if (mutation.finished) {
      this.#lobby.markGameFinished(room.id, now)
      this.#runtimes.delete(room.id)
    } else {
      this.#runtimes.set(room.id, runtime)
    }

    const snapshot = this.#buildStateMessage(runtime)
    this.#hooks.broadcastToRoom(room.id, snapshot)
    return snapshot
  }

  #buildStateMessage(runtime: ActiveRuntime): GameStateSnapshot {
    return {
      type: 'game_state',
      roomId: runtime.roomId,
      gameInstanceId: runtime.instanceId,
      gameType: runtime.gameType,
      version: runtime.version,
      state: runtime.state,
    }
  }

  #requireRuntime(room: RoomInfo): ActiveRuntime {
    const active = this.#runtimes.get(room.id)
    if (!active) {
      throw new Error('This room has no running game.')
    }
    return active
  }

  #getRoomPlayers(room: RoomInfo): UserInfo[] {
    const onlineUsers = this.#hooks.listUsers()
    return room.memberIds
      .map(memberId => onlineUsers.find(user => user.id === memberId) ?? null)
      .filter((user): user is UserInfo => user !== null)
  }

  #validateStart(
    definition: GameDefinition,
    room: RoomInfo,
    players: UserInfo[],
  ): void {
    if (players.length < definition.info.minPlayers) {
      throw new Error('Not enough players to start this game.')
    }
    if (
      definition.info.maxPlayers !== null &&
      players.length > definition.info.maxPlayers
    ) {
      throw new Error('Too many players for this game.')
    }

    if (definition.info.kind === 'match') {
      const allReady = room.memberIds.every(memberId =>
        room.readyMemberIds.includes(memberId),
      )
      if (!allReady) {
        throw new Error('All players must be ready before the match starts.')
      }
    }
  }

  async #runExclusive<T>(
    roomId: string,
    task: () => Promise<T> | T,
  ): Promise<T> {
    const previous = this.#queues.get(roomId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(task)
    this.#queues.set(
      roomId,
      current.then(
        () => undefined,
        () => undefined,
      ),
    )
    return current
  }
}
