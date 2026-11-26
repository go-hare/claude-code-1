/**
 * Official 2.1.331 hidden `claude edit-hook --json` handler (`chunk-jbe5qxcp.js`).
 *
 * Applies one hook edit (add / replace / remove) read as JSON from stdin
 * to userSettings, projectSettings, or localSettings.
 */
import { HOOK_EVENTS } from '../../entrypoints/sdk/coreTypes.js'
import { HookCommandSchema, type HookCommand } from '../../schemas/hooks.js'
import {
  getSettingsFilePathForSource,
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import {
  type EditableSettingSource,
  isSettingSourceEnabled,
} from '../../utils/settings/constants.js'
import type { SettingsJson } from '../../utils/settings/types.js'

type HookEvent = (typeof HOOK_EVENTS)[number]

const VALID_OPS = ['add', 'replace', 'remove'] as const
type HookEditOp = (typeof VALID_OPS)[number]

const EDITABLE_SOURCES: readonly EditableSettingSource[] = [
  'userSettings',
  'projectSettings',
  'localSettings',
]

const MAX_MATCHER_LENGTH = 10_000
const MAX_HOOK_JSON_BYTES = 262_144
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export type HookEditTarget = {
  event: HookEvent
  matcher: string
  hook: HookCommand
}

export type ValidatedHookEdit = {
  op: HookEditOp
  source: EditableSettingSource
  event: HookEvent
  matcher: string
  hook?: HookCommand
  target?: HookEditTarget
}

export type HookEditResult =
  | { ok: true }
  | {
      ok: false
      code: string
      error: string
      refusal?: { code: string; file?: string }
    }

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function hasForbiddenKeys(val: unknown): boolean {
  if (Array.isArray(val)) return val.some(hasForbiddenKeys)
  if (!isPlainObject(val)) return false
  return Object.keys(val).some(
    key => FORBIDDEN_KEYS.has(key) || hasForbiddenKeys(val[key]),
  )
}

function validateHookObject(
  val: unknown,
  label: string,
): { ok: true; hook: HookCommand } | { ok: false; error: string } {
  if (!isPlainObject(val)) {
    return { ok: false, error: `edit_hook: ${label} must be an object` }
  }
  if (hasForbiddenKeys(val)) {
    return {
      ok: false,
      error: `edit_hook: ${label} has a key that is not allowed`,
    }
  }
  if (JSON.stringify(val).length > MAX_HOOK_JSON_BYTES) {
    return { ok: false, error: `edit_hook: ${label} is too large` }
  }
  const parsed = HookCommandSchema().safeParse(val)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const pathPart =
      issue && issue.path.length > 0 ? ` (${issue.path.join('.')})` : ''
    return {
      ok: false,
      error: `edit_hook: ${label} is not a valid hook${pathPart}: ${issue?.message ?? 'invalid'}`,
    }
  }
  return { ok: true, hook: parsed.data }
}

function validateMatcher(
  val: unknown,
  label: string,
): { ok: true; matcher: string } | { ok: false; error: string } {
  if (val === undefined || val === null) {
    return { ok: true, matcher: '' }
  }
  if (typeof val !== 'string') {
    return { ok: false, error: `edit_hook: ${label} must be a string` }
  }
  if (val.length > MAX_MATCHER_LENGTH) {
    return { ok: false, error: `edit_hook: ${label} is too long` }
  }
  if (val in {}) {
    return { ok: false, error: `edit_hook: ${label} is not allowed` }
  }
  return { ok: true, matcher: val }
}

export function validateHookEditRequest(
  raw: unknown,
): { ok: true; value: ValidatedHookEdit } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'edit_hook: the edit must be a JSON object' }
  }
  const op = raw.op
  if (typeof op !== 'string' || !VALID_OPS.includes(op as HookEditOp)) {
    return {
      ok: false,
      error: 'edit_hook: op must be add, replace, or remove',
    }
  }
  const source = raw.source
  if (
    typeof source !== 'string' ||
    !EDITABLE_SOURCES.includes(source as EditableSettingSource)
  ) {
    return {
      ok: false,
      error:
        'edit_hook: source must be userSettings, projectSettings, or localSettings',
    }
  }
  const event = raw.event
  if (
    typeof event !== 'string' ||
    !(HOOK_EVENTS as readonly string[]).includes(event)
  ) {
    return { ok: false, error: 'edit_hook: event is not a known hook event' }
  }
  const matcherRes = validateMatcher(raw.matcher, 'matcher')
  if (!matcherRes.ok) return matcherRes

  let hook: HookCommand | undefined
  if (op === 'add' || op === 'replace') {
    const hookRes = validateHookObject(raw.hook, 'hook')
    if (!hookRes.ok) return hookRes
    hook = hookRes.hook
  }

  let target: HookEditTarget | undefined
  if (op === 'replace' || op === 'remove') {
    if (!isPlainObject(raw.target)) {
      return {
        ok: false,
        error: 'edit_hook: target must be an object for replace and remove',
      }
    }
    const targetEvent = raw.target.event
    if (
      typeof targetEvent !== 'string' ||
      !(HOOK_EVENTS as readonly string[]).includes(targetEvent)
    ) {
      return {
        ok: false,
        error: 'edit_hook: target.event is not a known hook event',
      }
    }
    const targetMatcherRes = validateMatcher(
      raw.target.matcher,
      'target.matcher',
    )
    if (!targetMatcherRes.ok) return targetMatcherRes
    const targetHookRes = validateHookObject(raw.target.hook, 'target.hook')
    if (!targetHookRes.ok) return targetHookRes
    target = {
      event: targetEvent as HookEvent,
      matcher: targetMatcherRes.matcher,
      hook: targetHookRes.hook,
    }
  }

  return {
    ok: true,
    value: {
      op: op as HookEditOp,
      source: source as EditableSettingSource,
      event: event as HookEvent,
      matcher: matcherRes.matcher,
      hook,
      target,
    },
  }
}

function stableSerialize(val: unknown): string {
  if (Array.isArray(val)) return `[${val.map(stableSerialize).join(',')}]`
  if (isPlainObject(val)) {
    return `{${Object.keys(val)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stableSerialize(val[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(val) ?? 'null'
}

function stripHttpHeaderValues(hook: HookCommand): unknown {
  if (
    hook.type === 'http' &&
    'headers' in hook &&
    isPlainObject(hook.headers)
  ) {
    const keysOnly: Record<string, string> = {}
    for (const key of Object.keys(hook.headers)) {
      keysOnly[key.toLowerCase()] = ''
    }
    return { ...hook, headers: keysOnly }
  }
  return hook
}

function normalizeHttpHeaderCase(hook: HookCommand): unknown {
  if (
    hook.type === 'http' &&
    'headers' in hook &&
    isPlainObject(hook.headers)
  ) {
    const normalized: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(hook.headers)) {
      normalized[k.toLowerCase()] = v
    }
    return { ...hook, headers: normalized }
  }
  return hook
}

function hooksMatchIgnoringHeaderValues(
  candidate: unknown,
  target: HookCommand,
): boolean {
  const parsed = HookCommandSchema().safeParse(candidate)
  if (!parsed.success) return false
  return (
    stableSerialize(stripHttpHeaderValues(parsed.data)) ===
    stableSerialize(stripHttpHeaderValues(target))
  )
}

function groupMatcherKey(group: unknown): string | null {
  if (!isPlainObject(group) || !Array.isArray(group.hooks)) return null
  const m = group.matcher
  if (m === undefined || m === null || m === '') return ''
  return typeof m === 'string' ? m : null
}

function checkDuplicateInEventList(
  groups: unknown[],
  matcher: string,
  candidate: HookCommand,
  skip?: { group: number; index: number },
): 'exact' | 'by-headers' | null {
  const candidateExact = stableSerialize(normalizeHttpHeaderCase(candidate))
  let twinByHeaders = false
  for (let gIdx = 0; gIdx < groups.length; gIdx++) {
    const group = groups[gIdx]
    if (groupMatcherKey(group) !== matcher || !isPlainObject(group)) continue
    const hooks = group.hooks as unknown[]
    for (let hIdx = 0; hIdx < hooks.length; hIdx++) {
      if (skip?.group === gIdx && skip?.index === hIdx) continue
      const existing = hooks[hIdx]
      const parsed = HookCommandSchema().safeParse(existing)
      if (!parsed.success) continue
      if (
        stableSerialize(normalizeHttpHeaderCase(parsed.data)) === candidateExact
      ) {
        return 'exact'
      }
      if (hooksMatchIgnoringHeaderValues(parsed.data, candidate)) {
        twinByHeaders = true
      }
    }
  }
  return twinByHeaders ? 'by-headers' : null
}

function checkPolicyLock(): string | null {
  const policy = getSettingsForSource('policySettings')
  if (policy?.disableAllHooks === true) {
    return 'edit_hook: hooks are disabled by managed settings'
  }
  if (policy?.allowManagedHooksOnly === true) {
    return 'edit_hook: managed settings allow managed hooks only'
  }
  return null
}

type HookMatcherEntry = { matcher?: string; hooks: HookCommand[] }

export async function runHookEdit(rawEdit: unknown): Promise<HookEditResult> {
  const policyError = checkPolicyLock()
  if (policyError !== null) {
    return { ok: false, code: 'policy_locked', error: policyError }
  }

  const validated = validateHookEditRequest(rawEdit)
  if (!validated.ok) {
    return { ok: false, code: 'bad_request', error: validated.error }
  }
  const edit = validated.value

  if (!isSettingSourceEnabled(edit.source)) {
    return {
      ok: false,
      code: 'source_disabled',
      error: `edit_hook: the ${edit.source} source is disabled for this session (--setting-sources)`,
    }
  }

  const existingSettings = getSettingsForSource(edit.source)
  const settingsFilePath = getSettingsFilePathForSource(edit.source)
  const existingHooksObj = existingSettings?.hooks
  if (existingHooksObj !== undefined && !isPlainObject(existingHooksObj)) {
    return {
      ok: false,
      code: 'not_a_list',
      error: `edit_hook: the ${edit.event} entry in ${edit.source} is not a list; fix the file by hand`,
      refusal: { code: 'not-a-list', file: settingsFilePath },
    }
  }

  const hooksMap: Record<string, unknown> = {
    ...(isPlainObject(existingHooksObj) ? existingHooksObj : {}),
  }

  const cloneEventList = (ev: HookEvent): HookMatcherEntry[] | null => {
    const raw = hooksMap[ev]
    if (raw !== undefined && !Array.isArray(raw)) return null
    return ((raw as unknown[]) ?? []).map(item =>
      isPlainObject(item) && Array.isArray(item.hooks)
        ? ({
            ...(typeof item.matcher === 'string' && item.matcher !== ''
              ? { matcher: item.matcher }
              : {}),
            hooks: [...(item.hooks as HookCommand[])],
          } satisfies HookMatcherEntry)
        : (item as HookMatcherEntry),
    )
  }

  const touched = new Map<HookEvent, HookMatcherEntry[]>()
  const getList = (ev: HookEvent): HookMatcherEntry[] | null => {
    const cached = touched.get(ev)
    if (cached) return cached
    const cloned = cloneEventList(ev)
    if (cloned === null) return null
    touched.set(ev, cloned)
    return cloned
  }

  if (edit.op === 'replace' || edit.op === 'remove') {
    const target = edit.target!
    const targetList = getList(target.event)
    if (targetList === null) {
      return {
        ok: false,
        code: 'not_a_list',
        error: `edit_hook: the ${target.event} entry in ${edit.source} is not a list; fix the file by hand`,
        refusal: { code: 'not-a-list', file: settingsFilePath },
      }
    }

    let matchCount = 0
    let matchLoc: { groupIndex: number; hookIndex: number } | null = null
    for (let g = 0; g < targetList.length; g++) {
      const grp = targetList[g]
      if (groupMatcherKey(grp) !== target.matcher) continue
      for (let h = 0; h < grp!.hooks.length; h++) {
        if (hooksMatchIgnoringHeaderValues(grp!.hooks[h], target.hook)) {
          matchCount++
          if (matchLoc === null) {
            matchLoc = { groupIndex: g, hookIndex: h }
          }
        }
      }
    }

    if (matchCount === 0 || matchLoc === null) {
      return {
        ok: false,
        code: 'target_missing',
        error: `edit_hook: that hook is no longer in ${edit.source}; it may have been changed outside this dialog`,
      }
    }
    if (matchCount > 1) {
      return {
        ok: false,
        code: 'target_ambiguous',
        error: `edit_hook: more than one identical hook is configured for ${edit.event} in ${edit.source}; edit the file by hand`,
        refusal: { code: 'twins', file: settingsFilePath },
      }
    }

    if (
      edit.op === 'replace' &&
      edit.event === target.event &&
      edit.matcher === target.matcher
    ) {
      const dup = checkDuplicateInEventList(
        targetList,
        target.matcher,
        edit.hook!,
        { group: matchLoc.groupIndex, index: matchLoc.hookIndex },
      )
      if (dup === 'exact') {
        return {
          ok: false,
          code: 'duplicate',
          error: `edit_hook: an identical hook is already configured for ${edit.event} in ${edit.source}`,
        }
      }
      if (dup === 'by-headers') {
        return {
          ok: false,
          code: 'twin_by_headers',
          error: `edit_hook: a hook that differs from this one only in header values is already configured for ${edit.event} in ${edit.source}; this dialog could not tell the two apart afterwards, so edit the file by hand to keep both`,
        }
      }
      targetList[matchLoc.groupIndex]!.hooks[matchLoc.hookIndex] = edit.hook!
    } else {
      targetList[matchLoc.groupIndex]!.hooks.splice(matchLoc.hookIndex, 1)
      if (targetList[matchLoc.groupIndex]!.hooks.length === 0) {
        targetList.splice(matchLoc.groupIndex, 1)
      }
      if (edit.op === 'replace') {
        const destList = getList(edit.event)
        if (destList === null) {
          return {
            ok: false,
            code: 'not_a_list',
            error: `edit_hook: the ${edit.event} entry in ${edit.source} is not a list; fix the file by hand`,
            refusal: { code: 'not-a-list', file: settingsFilePath },
          }
        }
        const dup = checkDuplicateInEventList(
          destList,
          edit.matcher,
          edit.hook!,
        )
        if (dup === 'exact') {
          return {
            ok: false,
            code: 'duplicate',
            error: `edit_hook: an identical hook is already configured for ${edit.event} in ${edit.source}`,
          }
        }
        if (dup === 'by-headers') {
          return {
            ok: false,
            code: 'twin_by_headers',
            error: `edit_hook: a hook that differs from this one only in header values is already configured for ${edit.event} in ${edit.source}; this dialog could not tell the two apart afterwards, so edit the file by hand to keep both`,
          }
        }
        const existingGroup = destList.find(
          grp => groupMatcherKey(grp) === edit.matcher,
        )
        if (existingGroup) {
          existingGroup.hooks.push(edit.hook!)
        } else {
          destList.push({
            ...(edit.matcher !== '' ? { matcher: edit.matcher } : {}),
            hooks: [edit.hook!],
          })
        }
      }
    }
  } else {
    // op === 'add'
    const destList = getList(edit.event)
    if (destList === null) {
      return {
        ok: false,
        code: 'not_a_list',
        error: `edit_hook: the ${edit.event} entry in ${edit.source} is not a list; fix the file by hand`,
        refusal: { code: 'not-a-list', file: settingsFilePath },
      }
    }
    const dup = checkDuplicateInEventList(destList, edit.matcher, edit.hook!)
    if (dup === 'exact') {
      return {
        ok: false,
        code: 'duplicate',
        error: `edit_hook: an identical hook is already configured for ${edit.event} in ${edit.source}`,
      }
    }
    if (dup === 'by-headers') {
      return {
        ok: false,
        code: 'twin_by_headers',
        error: `edit_hook: a hook that differs from this one only in header values is already configured for ${edit.event} in ${edit.source}; this dialog could not tell the two apart afterwards, so edit the file by hand to keep both`,
      }
    }
    const existingGroup = destList.find(
      grp => groupMatcherKey(grp) === edit.matcher,
    )
    if (existingGroup) {
      existingGroup.hooks.push(edit.hook!)
    } else {
      destList.push({
        ...(edit.matcher !== '' ? { matcher: edit.matcher } : {}),
        hooks: [edit.hook!],
      })
    }
  }

  const nextHooks: Record<string, HookMatcherEntry[] | undefined> = {}
  for (const [ev, list] of touched) {
    nextHooks[ev] = list.length > 0 ? list : undefined
  }
  const hasAnyRemaining =
    Object.keys(hooksMap).some(
      k => !(k in nextHooks) || nextHooks[k] !== undefined,
    ) || Object.values(nextHooks).some(v => v !== undefined)

  const patch: Partial<SettingsJson> = hasAnyRemaining
    ? { hooks: nextHooks as SettingsJson['hooks'] }
    : { hooks: undefined }

  const writeRes = updateSettingsForSource(edit.source, patch)
  if (writeRes.error) {
    return {
      ok: false,
      code: 'write_failed',
      error: `edit_hook: the settings write failed: ${writeRes.error.message}`,
    }
  }
  return { ok: true }
}
