import type {
  GameInfo,
  GameType,
  RoomInfo,
  UserInfo,
} from '../protocol.js'

export type ScheduledTask = {
  key: string
  jobType: string
  runAt: string
  payload?: unknown
}

export type GameEvent = {
  type: string
  actorId: string | null
  payload?: unknown
  at: string
}

export type GameMutation = {
  state: unknown
  events: GameEvent[]
  finished?: boolean
}

export type GameBaseContext = {
  now: string
  room: RoomInfo
  players: UserInfo[]
  instanceId: string
}

export type CreateGameContext = GameBaseContext

export type ApplyCommandContext = GameBaseContext & {
  actorId: string
  command: {
    type: string
    payload?: Record<string, unknown>
  }
  state: unknown
}

export type ApplyTaskContext = GameBaseContext & {
  task: ScheduledTask
  state: unknown
}

export interface GameDefinition {
  readonly info: GameInfo
  createInitialState(context: CreateGameContext): unknown
  applyCommand(context: ApplyCommandContext): GameMutation
  applyScheduledTask(context: ApplyTaskContext): GameMutation | null
  listScheduledTasks(state: unknown): ScheduledTask[]
  hydrateState?(state: unknown): unknown
}

export function assertGameType(value: string): GameType {
  if (value === 'maze-race') {
    return value
  }
  throw new Error(`Unsupported game type: ${value}`)
}

export function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected object payload.')
  }
  return value as Record<string, unknown>
}

export function asInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid ${label}.`)
  }
  return value as number
}

export function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`Invalid ${label}.`)
  }
  return value
}
