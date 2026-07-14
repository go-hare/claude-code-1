export const BUDDY_PROTOCOL_VERSION = 'gohare.buddy.v1' as const

export const BUDDY_STATES = [
  'idle',
  'thinking',
  'running',
  'waiting',
  'review',
  'failed',
  'success',
  'pet',
  'speaking',
] as const

export type BuddyState = (typeof BUDDY_STATES)[number]

export const BUDDY_RENDERERS = ['ascii', 'spritesheet', 'three'] as const

export type BuddyRenderer = (typeof BUDDY_RENDERERS)[number]

export type BuddyAssetMap = {
  ascii?: string
  spritesheet?: string
  model3d?: string
  icon?: string
  preview?: string
}

export type BuddyStateSpec = {
  animation: string
  row?: number
  frames?: number
  durationMs?: number | number[]
}

export type BuddyCapabilities = {
  react?: boolean
  interactive?: boolean
  model3d?: boolean
}

export type BuddyPermissions = {
  network?: boolean
  filesystem?: boolean
  model?: false | 'optional' | 'required'
}

export type BuddyManifest = {
  schemaVersion: typeof BUDDY_PROTOCOL_VERSION
  id: string
  displayName: string
  description?: string
  renderers: BuddyRenderer[]
  defaultRenderer: BuddyRenderer
  assets?: BuddyAssetMap
  states: Partial<Record<BuddyState, BuddyStateSpec>>
  capabilities?: BuddyCapabilities
  permissions?: BuddyPermissions
}

export type LoadedBuddyPack = {
  dir: string
  manifestPath: string
  manifest: BuddyManifest
}

export type ResolvedBuddyAsset = {
  kind: keyof BuddyAssetMap
  path: string
}

export type BuddyEvent =
  | { type: 'state.changed'; state: BuddyState }
  | { type: 'task.started'; title?: string }
  | { type: 'task.progress'; text: string }
  | { type: 'task.waiting'; reason?: string }
  | { type: 'task.completed'; result?: string }
  | { type: 'task.failed'; error?: string }
  | { type: 'user.message'; text: string }
  | { type: 'assistant.message'; text: string }
  | { type: 'buddy.pet' }
  | { type: 'theme.changed'; theme: 'light' | 'dark' }

export type BuddyResponse =
  | { type: 'reaction'; text: string }
  | { type: 'state.request'; state: BuddyState }
  | { type: 'bubble.show'; text: string; ttlMs?: number }
  | { type: 'sound.play'; asset: string }

export type BuddyRuntimeHook = (
  event: BuddyEvent,
) =>
  | BuddyResponse
  | BuddyResponse[]
  | undefined
  | Promise<BuddyResponse | BuddyResponse[] | undefined>

export type BuddyRuntime = {
  manifest: BuddyManifest
  state: BuddyState
  dispatch(event: BuddyEvent): Promise<BuddyResponse[]>
}

export type BuddyReactionGenerateInput = {
  systemPrompt: string
  userPrompt: string
  schema: {
    type: 'object'
    properties: {
      reaction: { type: 'string' }
    }
    required: ['reaction']
    additionalProperties: false
  }
}

export type BuddyReactionGenerator = (
  input: BuddyReactionGenerateInput,
) => Promise<string>

export type BuddyReactionInput = {
  buddy: {
    name: string
    personality: string
    species?: string
    rarity?: string
    stats?: Record<string, number>
  }
  transcript: string
  addressed?: boolean
  recentReactions?: string[]
  generate: BuddyReactionGenerator
}
