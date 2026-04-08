import type { GameDefinition, GameEvent } from '../game/types.js'
import { asObject, asString } from '../game/types.js'

type Position = {
  x: number
  y: number
  steps: number
}

type MazeRaceState = {
  kind: 'maze-race'
  width: number
  height: number
  walls: string[]
  finish: { x: number; y: number }
  players: Record<string, Position>
  status: 'playing' | 'finished'
  winnerId: string | null
}

const WALLS = [
  '1,1',
  '2,1',
  '4,1',
  '5,1',
  '1,3',
  '2,3',
  '3,3',
  '5,3',
  '3,4',
  '1,5',
  '4,5',
]

const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
} as const

export const mazeRaceGame: GameDefinition = {
  info: {
    type: 'maze-race',
    name: '双人闯迷宫',
    kind: 'match',
    minPlayers: 2,
    maxPlayers: 2,
    description: '双人同时移动，先到终点者获胜。',
  },

  createInitialState(context) {
    const [firstPlayer, secondPlayer] = context.players
    if (!firstPlayer || !secondPlayer) {
      throw new Error('Maze race requires two players.')
    }

    const state: MazeRaceState = {
      kind: 'maze-race',
      width: 7,
      height: 7,
      walls: WALLS,
      finish: { x: 6, y: 6 },
      players: {
        [firstPlayer.id]: { x: 0, y: 0, steps: 0 },
        [secondPlayer.id]: { x: 6, y: 0, steps: 0 },
      },
      status: 'playing',
      winnerId: null,
    }
    return state
  },

  applyCommand(context) {
    const state = context.state as MazeRaceState
    if (state.kind !== 'maze-race') {
      throw new Error('Invalid maze state.')
    }

    const commandType = context.command.type
    if (commandType !== 'move') {
      throw new Error(`Unsupported maze command: ${commandType}`)
    }

    if (state.status === 'finished') {
      return {
        state,
        events: [
          {
            type: 'command_rejected',
            actorId: context.actorId,
            payload: { reason: 'game_finished' },
            at: context.now,
          },
        ],
      }
    }

    const actor = state.players[context.actorId]
    if (!actor) {
      throw new Error('Player is not part of this maze race.')
    }

    const payload = asObject(context.command.payload ?? {})
    const directionName = asString(payload['direction'], 'direction')
    const offset = DIRECTIONS[directionName as keyof typeof DIRECTIONS]
    if (!offset) {
      throw new Error(`Unsupported direction: ${directionName}`)
    }

    const nextX = actor.x + offset.x
    const nextY = actor.y + offset.y
    const nextKey = `${nextX},${nextY}`
    if (
      nextX < 0 ||
      nextY < 0 ||
      nextX >= state.width ||
      nextY >= state.height ||
      state.walls.includes(nextKey)
    ) {
      return {
        state,
        events: [
          {
            type: 'move_blocked',
            actorId: context.actorId,
            payload: { direction: directionName },
            at: context.now,
          },
        ],
      }
    }

    const nextState: MazeRaceState = {
      ...state,
      players: {
        ...state.players,
        [context.actorId]: {
          x: nextX,
          y: nextY,
          steps: actor.steps + 1,
        },
      },
    }

    const events: GameEvent[] = [
      {
        type: 'player_moved',
        actorId: context.actorId,
        payload: { x: nextX, y: nextY, steps: actor.steps + 1 },
        at: context.now,
      },
    ]

    if (nextX === state.finish.x && nextY === state.finish.y) {
      nextState.status = 'finished'
      nextState.winnerId = context.actorId
      events.push({
        type: 'game_finished',
        actorId: context.actorId,
        payload: { winnerId: context.actorId },
        at: context.now,
      })
      return { state: nextState, events, finished: true }
    }

    return { state: nextState, events }
  },

  applyScheduledTask() {
    return null
  },

  listScheduledTasks() {
    return []
  },
}
