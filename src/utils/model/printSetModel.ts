/**
 * densable 2.1.212 print/SDK `set_model` control-request path (RGf / DGf / h5 / Z0).
 *
 * Success writes three targets (Ye / HS / mainLoopModelForSession) so the next
 * ask() / model round-trip uses the new model mid-session.
 */
import { has1mContext } from '../context.js'
import { isModelAlias, isModelFamilyAlias } from './aliases.js'
import {
  getDefaultFableModel,
  getDefaultHaikuModel,
  getDefaultMainLoopModel,
  getDefaultOpusModel,
  getDefaultSonnetModel,
  getMainLoopModel,
  parseUserSpecifiedModel,
} from './model.js'
import { isModelAllowed } from './modelAllowlist.js'
import { getModelOptions } from './modelOptions.js'
import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from './providers.js'

export type ModelRecognitionShape =
  | 'empty'
  | 'display_name'
  | 'numeric'
  | 'bracketed'
  | 'whitespace'
  | 'other'

export type ModelRecognition =
  | { recognized: true }
  | {
      recognized: false
      shape: ModelRecognitionShape
      suggestion?: string
    }

/**
 * densable `_5e` — scrub model id for error strings (no control chars / long junk).
 */
export function sanitizeModelIdForError(model: string): string {
  const cleaned = model.replace(/[^A-Za-z0-9._:/@[\]-]/g, '')
  if (cleaned.length === 0) return '(unrecognized model name)'
  return cleaned.length > 128 ? `${cleaned.slice(0, 128)}…` : cleaned
}

/**
 * densable `DGf` — unrecognized model control_response error body.
 */
export function unrecognizedModelMessage(
  model: string,
  suggestion?: string,
): string {
  const safe = sanitizeModelIdForError(model)
  const hint =
    suggestion !== undefined
      ? ` Did you mean '${suggestion}'?`
      : ' Run /model to see available models.'
  return `Model "${safe}" is not a recognized model id.${hint}`
}

/**
 * densable `r4` — not_allowed control_response error body.
 * densable does not switch on this path; the "Using X instead" text names the
 * still-active session model.
 */
export function modelNotAllowedMessage(
  requested: string,
  activeFallback: string,
): string {
  return `Model "${sanitizeModelIdForError(requested)}" is restricted by your organization's settings. Using ${sanitizeModelIdForError(activeFallback)} instead.`
}

/**
 * densable `RGf` — first-party-only recognition gate for print set_model.
 * Non-firstParty / non-firstParty base URL always recognized (3P pass-through).
 */
export function recognizePrintModel(model: string): ModelRecognition {
  const trimmed = model.trim()
  if (!trimmed) return { recognized: false, shape: 'empty' }

  if (getAPIProvider() !== 'firstParty' || !isFirstPartyAnthropicBaseUrl()) {
    return { recognized: true }
  }

  const lower = trimmed.toLowerCase()
  const without1m = has1mContext(lower)
    ? lower.replace(/\[1m\]$/i, '').trim()
    : lower

  if (isModelAlias(without1m) || isModelAlias(lower)) {
    return { recognized: true }
  }

  // densable $k / WC / Bkr — family aliases, known picker values, custom env
  if (isModelFamilyAlias(without1m)) {
    return { recognized: true }
  }

  if (trimmed === process.env.ANTHROPIC_CUSTOM_MODEL_OPTION) {
    return { recognized: true }
  }

  // densable HZe(t)!==t — modelOverrides rewrite
  // densable pet().some(o => o.value === t) — model options list
  if (getModelOptions().some(o => o.value === trimmed || o.value === lower)) {
    return { recognized: true }
  }

  // densable /^claude-\S+$/
  if (/^claude-\S+$/i.test(lower)) {
    return { recognized: true }
  }

  return { recognized: false, ...classifyUnrecognizedShape(trimmed) }
}

function classifyUnrecognizedShape(
  raw: string,
): Omit<Extract<ModelRecognition, { recognized: false }>, 'recognized'> {
  const unbracketed = raw.replace(/^\[(.+)\]$/s, '$1').trim()
  // densable XY().models display_name match — local has no live catalog; skip
  if (/^\d+$/.test(raw)) return { shape: 'numeric' }
  if (raw.startsWith('[')) {
    return { shape: 'bracketed', ...suggestClosestModelId(unbracketed) }
  }
  if (/\s/.test(raw)) {
    return { shape: 'whitespace', ...suggestClosestModelId(raw) }
  }
  return { shape: 'other', ...suggestClosestModelId(raw) }
}

function suggestClosestModelId(input: string): { suggestion?: string } {
  const candidates = new Set<string>()
  for (const opt of getModelOptions()) {
    if (typeof opt.value === 'string' && opt.value.length > 0) {
      candidates.add(opt.value)
    }
  }
  for (const alias of [
    'sonnet',
    'opus',
    'haiku',
    'fable',
    'best',
    'opusplan',
    'fable[1m]',
  ] as const) {
    candidates.add(alias)
  }
  const needle = input.toLowerCase()
  let best: string | undefined
  let bestScore = 0
  for (const c of candidates) {
    const score = sharedPrefixScore(needle, c.toLowerCase())
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  // densable Ier fuzzy top-1; require a meaningful prefix overlap
  if (best && bestScore >= Math.min(3, Math.floor(needle.length / 2))) {
    return { suggestion: best }
  }
  return {}
}

function sharedPrefixScore(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return i
}

/**
 * densable `Z0` — requesting a model that already is (or resolves to) the
 * session default is always allowlisted.
 */
export function isDefaultEquivalentModel(model: string): boolean {
  const stripped = has1mContext(model)
    ? model
        .replace(/\[1m\]$/i, '')
        .trim()
        .toLowerCase()
    : model.trim().toLowerCase()
  if (stripped === 'best') return false
  if (has1mContext(model)) return false
  try {
    return (
      parseUserSpecifiedModel(model).toLowerCase() ===
      getDefaultMainLoopModel().toLowerCase()
    )
  } catch {
    return false
  }
}

/**
 * densable `h5` — step a restricted family alias down to the newest permitted
 * concrete model in that family (availableModels allowlist).
 */
export function stepFamilyAliasToAllowed(model: string): string | null {
  const lower = model.trim().toLowerCase()
  const family = has1mContext(lower)
    ? lower.replace(/\[1m\]$/i, '').trim()
    : lower
  if (!isModelFamilyAlias(family)) return null

  const candidate =
    family === 'opus'
      ? getDefaultOpusModel()
      : family === 'sonnet'
        ? getDefaultSonnetModel()
        : family === 'fable'
          ? getDefaultFableModel()
          : getDefaultHaikuModel()

  if (!isModelAllowed(candidate)) return null

  // densable may re-attach [1m] when the request carried it and the candidate
  // supports it; local keep plain candidate unless request had [1m] and allowed.
  if (has1mContext(lower) && isModelAllowed(`${candidate}[1m]`)) {
    return `${candidate}[1m]`
  }
  return candidate
}

export type PrintSetModelDecision =
  | {
      ok: true
      requestedArg: string
      /** densable Ye / HS / mainLoopModelForSession value */
      model: string
      steppedDown: boolean
      injectBreadcrumbs: boolean
    }
  | {
      ok: false
      error: string
      analytics: 'invalid_model_type' | 'unrecognized_model' | 'not_allowed'
      recognitionShape?: ModelRecognitionShape
      hadSuggestion?: boolean
    }

/**
 * densable print set_model decision (no side effects).
 *
 * @param rawModel msg.request.model (may be undefined → "default")
 * @param previousActive Ye before the switch (activeUserSpecifiedModel)
 */
export function decidePrintSetModel(
  rawModel: unknown,
  previousActive: string | undefined,
): PrintSetModelDecision {
  if (rawModel != null && typeof rawModel !== 'string') {
    return {
      ok: false,
      error: 'set_model: model must be a string',
      analytics: 'invalid_model_type',
    }
  }

  const requestedArg = typeof rawModel === 'string' ? rawModel : 'default'
  const isDefault = requestedArg.trim().toLowerCase() === 'default'
  const candidate = isDefault ? getDefaultMainLoopModel() : requestedArg

  const recognition = isDefault
    ? ({ recognized: true } as const)
    : recognizePrintModel(candidate)

  if (!recognition.recognized) {
    return {
      ok: false,
      error: unrecognizedModelMessage(requestedArg, recognition.suggestion),
      analytics: 'unrecognized_model',
      recognitionShape: recognition.shape,
      hadSuggestion: recognition.suggestion !== undefined,
    }
  }

  const needsAllowCheck =
    !isDefault &&
    !isDefaultEquivalentModel(candidate) &&
    !isModelAllowed(candidate)

  let resolved = candidate
  let steppedDown = false
  if (needsAllowCheck) {
    const stepped = stepFamilyAliasToAllowed(candidate)
    if (stepped === null) {
      const active =
        previousActive !== undefined &&
        (isDefaultEquivalentModel(previousActive) ||
          isModelAllowed(previousActive))
          ? parseUserSpecifiedModel(previousActive)
          : getMainLoopModel()
      return {
        ok: false,
        error: modelNotAllowedMessage(requestedArg, active),
        analytics: 'not_allowed',
      }
    }
    resolved = stepped
    steppedDown = true
  }

  // densable: if (xi() !== Wn || oi(Zn) !== oi($s ?? Wn)) Ge(Hn, Zn)
  const beforeMain = getMainLoopModel()
  const prevForFamily = previousActive ?? beforeMain
  const afterResolved = parseUserSpecifiedModel(resolved)
  const familyChanged =
    parseUserSpecifiedModel(prevForFamily).toLowerCase() !==
    afterResolved.toLowerCase()
  // After HS(Zn), getMainLoopModel will track override — compare resolved ids
  const mainChanged = beforeMain.toLowerCase() !== afterResolved.toLowerCase()

  return {
    ok: true,
    requestedArg,
    model: resolved,
    steppedDown,
    injectBreadcrumbs: mainChanged || familyChanged,
  }
}

/**
 * densable REPL/SDK bridge `onSetModel` (Zkd callback, not print RGf).
 *
 * SEA: `po=$o==null||$o.trim().toLowerCase()==="default"`, `qi=po?CE():$o`,
 * `Dr=!po&&!$P(qi)&&!(m9(qi)??Uu(qi))`, `cn=Dr?u3(qi):null`. Restricted
 * family-alias steps down; else `{ok:false}` + r4 copy. Unrecognized ids
 * still apply — print recognition (RGf) is a print/SDK stdin gate only.
 */
export function decideReplBridgeSetModel(
  rawModel: string | undefined | null,
  previousActive: string | undefined,
): PrintSetModelDecision {
  const isDefault =
    rawModel == null || rawModel.trim().toLowerCase() === 'default'
  const requestedArg = typeof rawModel === 'string' ? rawModel : 'default'
  // densable `qi=po?CE():$o` — default/null uses CE(); otherwise the raw id.
  const candidate: string = isDefault
    ? getDefaultMainLoopModel()
    : (rawModel as string)

  const needsAllowCheck =
    !isDefault &&
    !isDefaultEquivalentModel(candidate) &&
    !isModelAllowed(candidate)

  let resolved = candidate
  let steppedDown = false
  if (needsAllowCheck) {
    const stepped = stepFamilyAliasToAllowed(candidate)
    if (stepped === null) {
      const active =
        previousActive !== undefined &&
        (isDefaultEquivalentModel(previousActive) ||
          isModelAllowed(previousActive))
          ? parseUserSpecifiedModel(previousActive)
          : getMainLoopModel()
      return {
        ok: false,
        error: modelNotAllowedMessage(requestedArg, active),
        analytics: 'not_allowed',
      }
    }
    resolved = stepped
    steppedDown = true
  }

  return {
    ok: true,
    requestedArg,
    model: resolved,
    steppedDown,
    injectBreadcrumbs: false,
  }
}
