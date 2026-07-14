/**
 * Official CLAUDE_CODE_SCRIPT_CAPS — JSON map of positive finite number caps.
 */

import { safeParseJSON } from './json.js'

export type ScriptCaps = Record<string, number>

export function parseScriptCaps(raw: string | undefined): ScriptCaps | null {
  if (!raw) return null
  const parsed = safeParseJSON(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const out: ScriptCaps = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && k.trim().length > 0) {
      out[k.trim()] = v
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

export function getScriptCaps(
  env: NodeJS.ProcessEnv = process.env,
): ScriptCaps | null {
  return parseScriptCaps(env.CLAUDE_CODE_SCRIPT_CAPS)
}
