export type {
  CompanionBones,
  Eye,
  Hat,
  Rarity,
  Species,
  StatName,
} from './types.js'
export {
  EYES,
  HATS,
  RARITIES,
  RARITY_BADGES,
  RARITY_ANSI_COLORS,
  RARITY_LABELS,
  RARITY_SCORES,
  RARITY_WEIGHTS,
  SPECIES,
  STAT_NAMES,
} from './types.js'
export type { Roll } from './companion.js'
export { roll, rollRandom, rollWithSeed } from './companion.js'
export { renderFace, renderSprite, spriteFrameCount } from './sprites.js'

export type { BuddyLanServer, BuddyLanServerOptions } from './server/server.js'
export { createBuddyLanServer } from './server/server.js'
export type { BuddyLanClientOptions, BuddyLanClientState } from './server/client.js'
export { BuddyLanClient } from './server/client.js'
export type { DiscoveredServer, ScanOptions } from './server/discovery.js'
export { scanLanForBuddyServers } from './server/discovery.js'
export { probeBuddyServerTcp } from './server/probe.js'
export type { GameInfo, GameStateSnapshot, GameType, RoomInfo } from './server/protocol.js'
