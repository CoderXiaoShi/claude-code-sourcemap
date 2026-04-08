import type { GameInfo, GameType } from '../protocol.js'
import type { GameDefinition } from './types.js'

export class GameRegistry {
  readonly #games = new Map<GameType, GameDefinition>()

  register(game: GameDefinition): void {
    this.#games.set(game.info.type, game)
  }

  get(type: GameType): GameDefinition {
    const game = this.#games.get(type)
    if (!game) {
      throw new Error(`Game not registered: ${type}`)
    }
    return game
  }

  has(type: string): type is GameType {
    return this.#games.has(type as GameType)
  }

  list(): GameInfo[] {
    return [...this.#games.values()].map(game => game.info)
  }
}
