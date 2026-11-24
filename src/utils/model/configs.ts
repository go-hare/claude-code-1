import type { ModelName } from './model.js'
import type { APIProvider } from './providers.js'

export type ModelConfig = Record<APIProvider, ModelName>

// @[MODEL LAUNCH]: Add a new CLAUDE_*_CONFIG constant here. Double check the correct model strings
// here since the pattern may change.

export const CLAUDE_3_7_SONNET_CONFIG = {
  firstParty: 'claude-3-7-sonnet-20250219',
  bedrock: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
  vertex: 'claude-3-7-sonnet@20250219',
  foundry: 'claude-3-7-sonnet',
  anthropicAws: 'claude-3-7-sonnet-20250219',
  anthropicGoogleCloud: 'claude-3-7-sonnet-20250219',
  mantle: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
  gateway: 'claude-3-7-sonnet-20250219',
  openai: 'claude-3-7-sonnet-20250219',
  gemini: 'claude-3-7-sonnet-20250219',
  grok: 'claude-3-7-sonnet-20250219',
} as const satisfies ModelConfig

export const CLAUDE_3_5_V2_SONNET_CONFIG = {
  firstParty: 'claude-3-5-sonnet-20241022',
  bedrock: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  vertex: 'claude-3-5-sonnet-v2@20241022',
  foundry: 'claude-3-5-sonnet',
  anthropicAws: 'claude-3-5-sonnet-20241022',
  anthropicGoogleCloud: 'claude-3-5-sonnet-20241022',
  mantle: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  gateway: 'claude-3-5-sonnet-20241022',
  openai: 'claude-3-5-sonnet-20241022',
  gemini: 'claude-3-5-sonnet-20241022',
  grok: 'claude-3-5-sonnet-20241022',
} as const satisfies ModelConfig

export const CLAUDE_3_5_HAIKU_CONFIG = {
  firstParty: 'claude-3-5-haiku-20241022',
  bedrock: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
  vertex: 'claude-3-5-haiku@20241022',
  foundry: 'claude-3-5-haiku',
  anthropicAws: 'claude-3-5-haiku-20241022',
  anthropicGoogleCloud: 'claude-3-5-haiku-20241022',
  mantle: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
  gateway: 'claude-3-5-haiku-20241022',
  openai: 'claude-3-5-haiku-20241022',
  gemini: 'claude-3-5-haiku-20241022',
  grok: 'claude-3-5-haiku-20241022',
} as const satisfies ModelConfig

export const CLAUDE_HAIKU_4_5_CONFIG = {
  firstParty: 'claude-haiku-4-5-20251001',
  bedrock: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  vertex: 'claude-haiku-4-5@20251001',
  foundry: 'claude-haiku-4-5',
  anthropicAws: 'claude-haiku-4-5-20251001',
  anthropicGoogleCloud: 'claude-haiku-4-5-20251001',
  mantle: 'anthropic.claude-haiku-4-5',
  gateway: 'claude-haiku-4-5-20251001',
  openai: 'claude-haiku-4-5-20251001',
  gemini: 'claude-haiku-4-5-20251001',
  grok: 'claude-haiku-4-5-20251001',
} as const satisfies ModelConfig

// Official 2.1.293 #285: Claude Haiku 5.5 (1M context, default Haiku on 1P).
export const CLAUDE_HAIKU_5_5_CONFIG = {
  firstParty: 'claude-haiku-5-5',
  bedrock: 'us.anthropic.claude-haiku-5-5',
  vertex: 'claude-haiku-5-5',
  foundry: 'claude-haiku-5-5',
  anthropicAws: 'claude-haiku-5-5',
  anthropicGoogleCloud: 'claude-haiku-5-5',
  mantle: 'anthropic.claude-haiku-5-5',
  gateway: 'claude-haiku-5-5',
  openai: 'claude-haiku-5-5',
  gemini: 'claude-haiku-5-5',
  grok: 'claude-haiku-5-5',
} as const satisfies ModelConfig

export const CLAUDE_SONNET_4_CONFIG = {
  firstParty: 'claude-sonnet-4-20250514',
  bedrock: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  vertex: 'claude-sonnet-4@20250514',
  foundry: 'claude-sonnet-4',
  anthropicAws: 'claude-sonnet-4-20250514',
  anthropicGoogleCloud: 'claude-sonnet-4-20250514',
  mantle: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  gateway: 'claude-sonnet-4-20250514',
  openai: 'claude-sonnet-4-20250514',
  gemini: 'claude-sonnet-4-20250514',
  grok: 'claude-sonnet-4-20250514',
} as const satisfies ModelConfig

export const CLAUDE_SONNET_4_5_CONFIG = {
  firstParty: 'claude-sonnet-4-5-20250929',
  bedrock: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  vertex: 'claude-sonnet-4-5@20250929',
  foundry: 'claude-sonnet-4-5',
  anthropicAws: 'claude-sonnet-4-5-20250929',
  anthropicGoogleCloud: 'claude-sonnet-4-5-20250929',
  mantle: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  gateway: 'claude-sonnet-4-5-20250929',
  openai: 'claude-sonnet-4-5-20250929',
  gemini: 'claude-sonnet-4-5-20250929',
  grok: 'claude-sonnet-4-5-20250929',
} as const satisfies ModelConfig

export const CLAUDE_OPUS_4_CONFIG = {
  firstParty: 'claude-opus-4-20250514',
  bedrock: 'us.anthropic.claude-opus-4-20250514-v1:0',
  vertex: 'claude-opus-4@20250514',
  foundry: 'claude-opus-4',
  anthropicAws: 'claude-opus-4-20250514',
  anthropicGoogleCloud: 'claude-opus-4-20250514',
  mantle: 'us.anthropic.claude-opus-4-20250514-v1:0',
  gateway: 'claude-opus-4-20250514',
  openai: 'claude-opus-4-20250514',
  gemini: 'claude-opus-4-20250514',
  grok: 'claude-opus-4-20250514',
} as const satisfies ModelConfig

export const CLAUDE_OPUS_4_1_CONFIG = {
  firstParty: 'claude-opus-4-1-20250805',
  bedrock: 'us.anthropic.claude-opus-4-1-20250805-v1:0',
  vertex: 'claude-opus-4-1@20250805',
  foundry: 'claude-opus-4-1',
  anthropicAws: 'claude-opus-4-1-20250805',
  anthropicGoogleCloud: 'claude-opus-4-1-20250805',
  mantle: 'us.anthropic.claude-opus-4-1-20250805-v1:0',
  gateway: 'claude-opus-4-1-20250805',
  openai: 'claude-opus-4-1-20250805',
  gemini: 'claude-opus-4-1-20250805',
  grok: 'claude-opus-4-1-20250805',
} as const satisfies ModelConfig

export const CLAUDE_OPUS_4_5_CONFIG = {
  firstParty: 'claude-opus-4-5-20251101',
  bedrock: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
  vertex: 'claude-opus-4-5@20251101',
  foundry: 'claude-opus-4-5',
  anthropicAws: 'claude-opus-4-5-20251101',
  anthropicGoogleCloud: 'claude-opus-4-5-20251101',
  mantle: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
  gateway: 'claude-opus-4-5-20251101',
  openai: 'claude-opus-4-5-20251101',
  gemini: 'claude-opus-4-5-20251101',
  grok: 'claude-opus-4-5-20251101',
} as const satisfies ModelConfig

export const CLAUDE_OPUS_4_6_CONFIG = {
  firstParty: 'claude-opus-4-6',
  bedrock: 'us.anthropic.claude-opus-4-6-v1',
  vertex: 'claude-opus-4-6',
  foundry: 'claude-opus-4-6',
  anthropicAws: 'claude-opus-4-6',
  anthropicGoogleCloud: 'claude-opus-4-6',
  mantle: 'us.anthropic.claude-opus-4-6-v1',
  gateway: 'claude-opus-4-6',
  openai: 'claude-opus-4-6',
  gemini: 'claude-opus-4-6',
  grok: 'claude-opus-4-6',
} as const satisfies ModelConfig

export const CLAUDE_OPUS_4_7_CONFIG = {
  firstParty: 'claude-opus-4-7',
  bedrock: 'us.anthropic.claude-opus-4-7-v1',
  vertex: 'claude-opus-4-7',
  foundry: 'claude-opus-4-7',
  anthropicAws: 'claude-opus-4-7',
  anthropicGoogleCloud: 'claude-opus-4-7',
  mantle: 'anthropic.claude-opus-4-7',
  gateway: 'claude-opus-4-7',
  openai: 'claude-opus-4-7',
  gemini: 'claude-opus-4-7',
  grok: 'claude-opus-4-7',
} as const satisfies ModelConfig

// densable 2.1.217 catalog: claude-opus-4-8 (native 1M / supports_1m_beta)
export const CLAUDE_OPUS_4_8_CONFIG = {
  firstParty: 'claude-opus-4-8',
  bedrock: 'us.anthropic.claude-opus-4-8',
  vertex: 'claude-opus-4-8',
  foundry: 'claude-opus-4-8',
  anthropicAws: 'claude-opus-4-8',
  anthropicGoogleCloud: 'claude-opus-4-8',
  mantle: 'anthropic.claude-opus-4-8',
  gateway: 'claude-opus-4-8',
  openai: 'claude-opus-4-8',
  gemini: 'claude-opus-4-8',
  grok: 'claude-opus-4-8',
} as const satisfies ModelConfig

// densable 2.1.219 #1: Claude Opus 5 (native 1M; fast mode)
export const CLAUDE_OPUS_5_CONFIG = {
  firstParty: 'claude-opus-5',
  bedrock: 'us.anthropic.claude-opus-5',
  vertex: 'claude-opus-5',
  foundry: 'claude-opus-5',
  anthropicAws: 'claude-opus-5',
  anthropicGoogleCloud: 'claude-opus-5',
  mantle: 'anthropic.claude-opus-5',
  gateway: 'claude-opus-5',
  openai: 'claude-opus-5',
  gemini: 'claude-opus-5',
  grok: 'claude-opus-5',
} as const satisfies ModelConfig

// densable 2.1.283: Claude Opus 5.5 (live default Opus; native 1M; fast mode)
export const CLAUDE_OPUS_5_5_CONFIG = {
  firstParty: 'claude-opus-5-5',
  bedrock: 'us.anthropic.claude-opus-5-5',
  vertex: 'claude-opus-5-5',
  foundry: 'claude-opus-5-5',
  anthropicAws: 'claude-opus-5-5',
  anthropicGoogleCloud: 'claude-opus-5-5',
  mantle: 'anthropic.claude-opus-5-5',
  gateway: 'claude-opus-5-5',
  openai: 'claude-opus-5-5',
  gemini: 'claude-opus-5-5',
  grok: 'claude-opus-5-5',
} as const satisfies ModelConfig

// Official 2.1.239 qNn / EHl claude-fable-5
export const CLAUDE_FABLE_5_CONFIG = {
  firstParty: 'claude-fable-5',
  bedrock: 'us.anthropic.claude-fable-5',
  vertex: 'claude-fable-5',
  foundry: 'claude-fable-5',
  anthropicAws: 'claude-fable-5',
  anthropicGoogleCloud: 'claude-fable-5',
  mantle: 'anthropic.claude-fable-5',
  gateway: 'claude-fable-5',
  openai: 'claude-fable-5',
  gemini: 'claude-fable-5',
  grok: 'claude-fable-5',
} as const satisfies ModelConfig

// densable 2.1.283: Claude Fable 5.1 (native 1M)
export const CLAUDE_FABLE_5_1_CONFIG = {
  firstParty: 'claude-fable-5-1',
  bedrock: 'us.anthropic.claude-fable-5-1',
  vertex: 'claude-fable-5-1',
  foundry: 'claude-fable-5-1',
  anthropicAws: 'claude-fable-5-1',
  anthropicGoogleCloud: 'claude-fable-5-1',
  mantle: 'anthropic.claude-fable-5-1',
  gateway: 'claude-fable-5-1',
  openai: 'claude-fable-5-1',
  gemini: 'claude-fable-5-1',
  grok: 'claude-fable-5-1',
} as const satisfies ModelConfig

// Official 2.1.321 (#1845): Claude Fable 5.2 (default Fable model; 1M context, $8/$40, $0.20 cache read)
export const CLAUDE_FABLE_5_2_CONFIG = {
  firstParty: 'claude-fable-5-2',
  bedrock: 'us.anthropic.claude-fable-5-2',
  vertex: 'claude-fable-5-2',
  foundry: 'claude-fable-5-2',
  anthropicAws: 'claude-fable-5-2',
  anthropicGoogleCloud: 'claude-fable-5-2',
  mantle: 'anthropic.claude-fable-5-2',
  gateway: 'claude-fable-5-2',
  openai: 'claude-fable-5-2',
  gemini: 'claude-fable-5-2',
  grok: 'claude-fable-5-2',
} as const satisfies ModelConfig

export const CLAUDE_SONNET_4_6_CONFIG = {
  firstParty: 'claude-sonnet-4-6',
  bedrock: 'us.anthropic.claude-sonnet-4-6',
  vertex: 'claude-sonnet-4-6',
  foundry: 'claude-sonnet-4-6',
  anthropicAws: 'claude-sonnet-4-6',
  anthropicGoogleCloud: 'claude-sonnet-4-6',
  mantle: 'us.anthropic.claude-sonnet-4-6',
  gateway: 'claude-sonnet-4-6',
  openai: 'claude-sonnet-4-6',
  gemini: 'claude-sonnet-4-6',
  grok: 'claude-sonnet-4-6',
} as const satisfies ModelConfig

// Official 2.1.197+ Claude Sonnet 5 (native 1M context).
export const CLAUDE_SONNET_5_CONFIG = {
  firstParty: 'claude-sonnet-5',
  bedrock: 'us.anthropic.claude-sonnet-5',
  vertex: 'claude-sonnet-5',
  foundry: 'claude-sonnet-5',
  anthropicAws: 'claude-sonnet-5',
  anthropicGoogleCloud: 'claude-sonnet-5',
  mantle: 'anthropic.claude-sonnet-5',
  gateway: 'claude-sonnet-5',
  openai: 'claude-sonnet-5',
  gemini: 'claude-sonnet-5',
  grok: 'claude-sonnet-5',
} as const satisfies ModelConfig

// densable 2.1.289: Claude Sonnet 5.5 (live default Sonnet; native 1M).
export const CLAUDE_SONNET_5_5_CONFIG = {
  firstParty: 'claude-sonnet-5-5',
  bedrock: 'us.anthropic.claude-sonnet-5-5',
  vertex: 'claude-sonnet-5-5',
  foundry: 'claude-sonnet-5-5',
  anthropicAws: 'claude-sonnet-5-5',
  anthropicGoogleCloud: 'claude-sonnet-5-5',
  mantle: 'anthropic.claude-sonnet-5-5',
  gateway: 'claude-sonnet-5-5',
  openai: 'claude-sonnet-5-5',
  gemini: 'claude-sonnet-5-5',
  grok: 'claude-sonnet-5-5',
} as const satisfies ModelConfig

// Official 2.1.328 (`chunk@284530264.js@19815`): Mythos 5 family (first-party 1M context).
export const CLAUDE_MYTHOS_5_CONFIG = {
  firstParty: 'claude-mythos-5',
  bedrock: 'claude-mythos-5',
  vertex: 'claude-mythos-5',
  foundry: 'claude-mythos-5',
  anthropicAws: 'claude-mythos-5',
  anthropicGoogleCloud: 'claude-mythos-5',
  mantle: 'claude-mythos-5',
  gateway: 'claude-mythos-5',
  openai: 'claude-mythos-5',
  gemini: 'claude-mythos-5',
  grok: 'claude-mythos-5',
} as const satisfies ModelConfig

export const CLAUDE_MYTHOS_5_1_CONFIG = {
  firstParty: 'claude-mythos-5-1',
  bedrock: 'claude-mythos-5-1',
  vertex: 'claude-mythos-5-1',
  foundry: 'claude-mythos-5-1',
  anthropicAws: 'claude-mythos-5-1',
  anthropicGoogleCloud: 'claude-mythos-5-1',
  mantle: 'claude-mythos-5-1',
  gateway: 'claude-mythos-5-1',
  openai: 'claude-mythos-5-1',
  gemini: 'claude-mythos-5-1',
  grok: 'claude-mythos-5-1',
} as const satisfies ModelConfig

export const CLAUDE_MYTHOS_5_2_CONFIG = {
  firstParty: 'claude-mythos-5-2',
  bedrock: 'claude-mythos-5-2',
  vertex: 'claude-mythos-5-2',
  foundry: 'claude-mythos-5-2',
  anthropicAws: 'claude-mythos-5-2',
  anthropicGoogleCloud: 'claude-mythos-5-2',
  mantle: 'claude-mythos-5-2',
  gateway: 'claude-mythos-5-2',
  openai: 'claude-mythos-5-2',
  gemini: 'claude-mythos-5-2',
  grok: 'claude-mythos-5-2',
} as const satisfies ModelConfig

// @[MODEL LAUNCH]: Register the new config here.
export const ALL_MODEL_CONFIGS = {
  haiku35: CLAUDE_3_5_HAIKU_CONFIG,
  haiku45: CLAUDE_HAIKU_4_5_CONFIG,
  haiku55: CLAUDE_HAIKU_5_5_CONFIG,
  sonnet35: CLAUDE_3_5_V2_SONNET_CONFIG,
  sonnet37: CLAUDE_3_7_SONNET_CONFIG,
  sonnet40: CLAUDE_SONNET_4_CONFIG,
  sonnet45: CLAUDE_SONNET_4_5_CONFIG,
  sonnet46: CLAUDE_SONNET_4_6_CONFIG,
  sonnet5: CLAUDE_SONNET_5_CONFIG,
  // densable 2.1.289 live Sonnet
  sonnet55: CLAUDE_SONNET_5_5_CONFIG,
  opus40: CLAUDE_OPUS_4_CONFIG,
  opus41: CLAUDE_OPUS_4_1_CONFIG,
  opus45: CLAUDE_OPUS_4_5_CONFIG,
  opus46: CLAUDE_OPUS_4_6_CONFIG,
  opus47: CLAUDE_OPUS_4_7_CONFIG,
  opus48: CLAUDE_OPUS_4_8_CONFIG,
  // densable 2.1.219 #1
  opus5: CLAUDE_OPUS_5_CONFIG,
  // densable 2.1.283 live Opus
  opus55: CLAUDE_OPUS_5_5_CONFIG,
  // Official 2.1.239 qNn
  fable5: CLAUDE_FABLE_5_CONFIG,
  // densable 2.1.283 Fable 5.1
  fable51: CLAUDE_FABLE_5_1_CONFIG,
  // Official 2.1.321 (#1845) live default Fable (gateway fable still fable5 per catalog aliases)
  fable52: CLAUDE_FABLE_5_2_CONFIG,
  // Official 2.1.328 (`chunk@284530264.js@19815`) Mythos 5 family
  mythos5: CLAUDE_MYTHOS_5_CONFIG,
  mythos51: CLAUDE_MYTHOS_5_1_CONFIG,
  mythos52: CLAUDE_MYTHOS_5_2_CONFIG,
} as const satisfies Record<string, ModelConfig>

export type ModelKey = keyof typeof ALL_MODEL_CONFIGS

/**
 * Official 2.1.328 (`chunk@284530264.js`) Mantle provider model IDs.
 * Models not available on Mantle (legacy 3.x/4.x models and Mythos 5 family)
 * explicitly map to `null` here while `ModelConfig` keeps non-null strings for
 * `ModelStrings` compatibility.
 */
export const OFFICIAL_MANTLE_MODEL_IDS: Readonly<
  Record<ModelKey, ModelName | null>
> = Object.freeze({
  haiku35: null,
  haiku45: 'anthropic.claude-haiku-4-5',
  haiku55: 'anthropic.claude-haiku-5-5',
  sonnet35: null,
  sonnet37: null,
  sonnet40: null,
  sonnet45: null,
  sonnet46: null,
  sonnet5: 'anthropic.claude-sonnet-5',
  sonnet55: 'anthropic.claude-sonnet-5-5',
  opus40: null,
  opus41: null,
  opus45: null,
  opus46: null,
  opus47: 'anthropic.claude-opus-4-7',
  opus48: 'anthropic.claude-opus-4-8',
  opus5: 'anthropic.claude-opus-5',
  opus55: 'anthropic.claude-opus-5-5',
  fable5: 'anthropic.claude-fable-5',
  fable51: 'anthropic.claude-fable-5-1',
  fable52: 'anthropic.claude-fable-5-2',
  mythos5: null,
  mythos51: null,
  mythos52: null,
})

export function getOfficialMantleModelId(key: ModelKey): ModelName | null {
  return OFFICIAL_MANTLE_MODEL_IDS[key]
}

/** Union of all canonical first-party model IDs, e.g. 'claude-opus-4-6' | 'claude-sonnet-4-5-20250929' | … */
export type CanonicalModelId =
  (typeof ALL_MODEL_CONFIGS)[ModelKey]['firstParty']

/** Runtime list of canonical model IDs — used by comprehensiveness tests. */
export const CANONICAL_MODEL_IDS = Object.values(ALL_MODEL_CONFIGS).map(
  c => c.firstParty,
) as [CanonicalModelId, ...CanonicalModelId[]]

/** Map canonical ID → internal short key. Used to apply settings-based modelOverrides. */
export const CANONICAL_ID_TO_KEY: Record<CanonicalModelId, ModelKey> =
  Object.fromEntries(
    (Object.entries(ALL_MODEL_CONFIGS) as [ModelKey, ModelConfig][]).map(
      ([key, cfg]) => [cfg.firstParty, key],
    ),
  ) as Record<CanonicalModelId, ModelKey>
