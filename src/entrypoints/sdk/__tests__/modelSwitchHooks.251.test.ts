/**
 * densable 2.1.251 #1 — mBn event keys, SessionStart resume fields, jw input.
 */
import { describe, expect, test } from 'bun:test'
import { HooksSchema } from '../../../schemas/hooks.js'
import { HOOK_EVENTS as sdkEvents } from '../../agentSdkTypes.js'
import {
  HOOK_EVENTS,
  PostModelSwitchHookInputSchema,
  PreModelSwitchHookInputSchema,
  SessionStartHookInputSchema,
} from '../coreSchemas.js'
import { HOOK_EVENTS as typeEvents } from '../coreTypes.js'

const base = {
  session_id: 'sess',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/tmp',
}

type Zodish = {
  description?: string
  shape?: Record<string, Zodish>
  def?: { left?: Zodish; right?: Zodish }
}

function fieldDescription(schema: Zodish, key: string): string | undefined {
  if (schema.shape?.[key]) return schema.shape[key]?.description
  const def = schema.def
  if (!def) return undefined
  return (
    (def.right && fieldDescription(def.right, key)) ||
    (def.left && fieldDescription(def.left, key))
  )
}

describe('HOOK_EVENTS model switch', () => {
  test('mBn keys sit after PostCompact in schema, types, and runtime lists', () => {
    for (const events of [HOOK_EVENTS, typeEvents, sdkEvents]) {
      const list = events as readonly string[]
      const at = list.indexOf('PostCompact')
      expect(list[at + 1]).toBe('PreModelSwitch')
      expect(list[at + 2]).toBe('PostModelSwitch')
    }
  })

  test('settings schema accepts both events', () => {
    const parsed = HooksSchema().safeParse({
      PreModelSwitch: [{ hooks: [{ type: 'command', command: 'true' }] }],
      PostModelSwitch: [{ hooks: [{ type: 'command', command: 'true' }] }],
    })
    expect(parsed.success).toBe(true)
  })
})

describe('SessionStart resume fields', () => {
  test('accepts the gold resume fields and session_title', () => {
    const parsed = SessionStartHookInputSchema().safeParse({
      ...base,
      hook_event_name: 'SessionStart',
      source: 'resume',
      model: 'claude-opus-4-6',
      session_title: 'resume',
      seconds_since_last_response: 120,
      context_tokens: 4000,
      prompt_cache_likely_expired: true,
      estimated_cache_write_usd: 0.03,
    })
    expect(parsed.success).toBe(true)
  })

  test('still accepts startup with only source', () => {
    const parsed = SessionStartHookInputSchema().safeParse({
      ...base,
      hook_event_name: 'SessionStart',
      source: 'startup',
    })
    expect(parsed.success).toBe(true)
  })

  test('descriptions match the locked SessionStart schema', () => {
    const schema = SessionStartHookInputSchema() as Zodish
    expect(fieldDescription(schema, 'seconds_since_last_response')).toBe(
      "resume/fork: seconds since the resumed transcript's last assistant response",
    )
    expect(fieldDescription(schema, 'context_tokens')).toBe(
      "resume/fork: the resumed transcript's last response input + cache_read + cache_creation + output tokens (for a server-side tool loop, its last iteration's window, not the summed totals)",
    )
    expect(fieldDescription(schema, 'prompt_cache_likely_expired')).toBe(
      'resume/fork: seconds_since_last_response exceeds the prompt-cache TTL, so the first request re-caches context_tokens',
    )
    expect(fieldDescription(schema, 'estimated_cache_write_usd')).toBe(
      'resume/fork: estimated cost of re-caching context_tokens on the session model — the managed modelPricing when set, otherwise list price; excludes the response',
    )
  })
})

describe('jw model-switch input', () => {
  const fields = {
    from_model: 'claude-sonnet-4-6',
    to_model: 'claude-opus-4-6',
    requested_model: 'opus' as string | null,
    source: 'picker',
    context_tokens: 0,
    prompt_cache_warm: false,
    cache_ttl: '5m' as const,
    estimated_cache_write_usd: 0,
    pricing: 'catalog' as const,
  }

  test('PreModelSwitch accepts the jw fields including null requested_model', () => {
    const parsed = PreModelSwitchHookInputSchema().safeParse({
      ...base,
      hook_event_name: 'PreModelSwitch',
      ...fields,
      requested_model: null,
      cache_ttl: '1h',
      pricing: 'default',
    })
    expect(parsed.success).toBe(true)
  })

  test('PostModelSwitch rejects an unknown cache_ttl', () => {
    const parsed = PostModelSwitchHookInputSchema().safeParse({
      ...base,
      hook_event_name: 'PostModelSwitch',
      ...fields,
      cache_ttl: '1d',
    })
    expect(parsed.success).toBe(false)
  })

  test('pricing and from/to descriptions match jw', () => {
    const schema = PreModelSwitchHookInputSchema() as Zodish
    expect(fieldDescription(schema, 'from_model')).toBe(
      'Resolved model id the session was running before the switch',
    )
    expect(fieldDescription(schema, 'to_model')).toBe(
      'Resolved model id the session runs after the switch',
    )
    expect(fieldDescription(schema, 'pricing')).toBe(
      'configured: priced at the managed modelPricing setting; catalog: list price; default: to_model unknown, the default tier was assumed',
    )
    expect(fieldDescription(schema, 'prompt_cache_warm')).toBe(
      "Whether the current model's prompt cache is likely still warm (a switch then forfeits it)",
    )
  })
})
