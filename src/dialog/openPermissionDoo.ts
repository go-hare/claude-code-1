/**
 * densable doo — foo select then B() / onReprompt / generation.
 *
 * onReprompt: abort current dialog signal + teardowns + B() reopen with
 * rebuilt descriptor (file Lno / sed ISl). Stale generation answers ignored.
 * Reprompt preview failure → deny (never show stale preview).
 *
 * onRacersReady (once): densable hooks IDE idm/Mrf via addTeardown(closeTab).
 */
import { BashTool } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js'
import { errorMessage } from '../utils/errors.js'
import { getIdeDiffEligibility } from './ideDiffEligibility.js'
import { shouldQueuePermissionBehind } from './permissionQueueBehind.js'
import type { RequestDialog } from './requestDialog.js'
import {
  selectBashPermissionDialog,
  selectFilePermissionDialog,
  selectPermissionFoo,
  type SelectedPermissionDialog,
} from './selectPermissionDialog.js'
import { isFilePermissionTool } from './filePermissionPreview.js'
import {
  PERMISSION_FILE_KIND,
  type PermissionPromptResult,
} from './specs/permissionKinds.js'

export type PermissionDooRacersApi = {
  dismissAndTeardown: () => void
  isReprompted: () => boolean
  addTeardown: (fn: () => void) => void
  /** densable notifyBridge — tip maps to bridge sendResponse */
  notifyBridge: (msg: {
    behavior: 'allow' | 'deny'
    updatedInput?: Record<string, unknown>
    message?: string
  }) => void
}

export type OpenPermissionDooInput = {
  requestDialog: RequestDialog
  confirm: ToolUseConfirm
  signal?: AbortSignal
  /** densable onRacersReady — called once before first B() */
  onRacersReady?: (api: PermissionDooRacersApi) => void
  notifyBridge?: PermissionDooRacersApi['notifyBridge']
}

export type PermissionDooReprompt = {
  finalInput: Record<string, unknown>
  permissionResult: unknown
  description?: string
}

export type PermissionDooSession = {
  /** Settles once with the winning dialog answer (or preview-fail deny). */
  result: Promise<PermissionPromptResult>
  /** densable onReprompt — must NOT claim; rebuilds dialog. */
  onReprompt: (next: PermissionDooReprompt) => void
  dismissAndTeardown: () => void
  isReprompted: () => boolean
  addTeardown: (fn: () => void) => void
}

function stampIdeDiffFields(
  selected: SelectedPermissionDialog,
  confirm: ToolUseConfirm,
  reprompted: boolean,
): SelectedPermissionDialog {
  if (reprompted) return selected
  if (selected.spec.kind !== PERMISSION_FILE_KIND) return selected
  const ctx = confirm.toolUseContext
  if (!ctx) return selected
  const elig = getIdeDiffEligibility(confirm.tool, confirm.input, ctx)
  if (!elig) return selected
  return {
    ...selected,
    descriptor: {
      ...selected.descriptor,
      showingDiffInIDE: true,
      ideName: elig.ideName,
    },
  }
}

/**
 * densable doo session. Prefer this when hook reprompt must reopen B().
 */
export function startPermissionDoo(
  input: OpenPermissionDooInput,
): PermissionDooSession {
  const {
    requestDialog,
    confirm,
    signal: outerSignal,
    onRacersReady,
    notifyBridge,
  } = input
  const queueBehind = shouldQueuePermissionBehind(confirm)

  let generation = 0
  let dialogAbort: AbortController | undefined
  const teardowns: Array<() => void> = []
  let firstKind: string | null = null
  let settled = false

  const { promise: result, resolve: resolveResult } =
    Promise.withResolvers<PermissionPromptResult>()

  function runTeardowns(): void {
    const list = teardowns.splice(0, teardowns.length)
    for (const fn of list) {
      try {
        fn()
      } catch {
        /* densable logs; tip: ignore */
      }
    }
  }

  function dismissAndTeardown(): void {
    dialogAbort?.abort()
    runTeardowns()
  }

  function settle(answer: PermissionPromptResult): void {
    if (settled) return
    settled = true
    dismissAndTeardown()
    resolveResult(answer)
  }

  function isReprompted(): boolean {
    return generation > 1
  }

  function addTeardown(fn: () => void): void {
    teardowns.push(fn)
  }

  async function rebuildSelected(
    live: ToolUseConfirm,
  ): Promise<SelectedPermissionDialog> {
    let selected: SelectedPermissionDialog
    if (isReprompted() && isFilePermissionTool(live.tool)) {
      const file = await selectFilePermissionDialog(live)
      if (!file) {
        throw new Error(
          `File permission reprompt: cannot preview the hook-rewritten input of ${live.tool.name}; denying instead of showing a stale preview`,
        )
      }
      selected = file
    } else if (
      isReprompted() &&
      live.tool === BashTool &&
      firstKind === PERMISSION_FILE_KIND
    ) {
      const bash = await selectBashPermissionDialog(live)
      if (!bash || bash.spec.kind !== PERMISSION_FILE_KIND) {
        throw new Error(
          'Sed-edit permission reprompt: rewritten command no longer parses as a sed edit; denying instead of showing a stale preview',
        )
      }
      selected = bash
    } else {
      selected = await selectPermissionFoo(live)
    }
    return stampIdeDiffFields(selected, live, isReprompted())
  }

  async function B(): Promise<void> {
    const gen = ++generation
    const ac = new AbortController()
    dialogAbort = ac

    const onOuterAbort = () => ac.abort()
    if (outerSignal) {
      if (outerSignal.aborted) ac.abort()
      else outerSignal.addEventListener('abort', onOuterAbort, { once: true })
    }

    try {
      const selected = await rebuildSelected(confirm)
      if (gen !== generation) return
      if (firstKind === null) firstKind = selected.spec.kind

      const answer = await requestDialog(selected.spec, selected.descriptor, {
        signal: ac.signal,
        queueBehind,
      })
      if (gen !== generation) return
      settle(answer)
    } catch (err) {
      if (gen !== generation) return
      settle({
        behavior: 'deny',
        feedback: errorMessage(err),
      })
    } finally {
      outerSignal?.removeEventListener('abort', onOuterAbort)
    }
  }

  function onReprompt(next: PermissionDooReprompt): void {
    if (settled) return
    confirm.input = next.finalInput
    confirm.permissionResult = next.permissionResult as never
    if (next.description !== undefined) {
      confirm.description = next.description
    }
    dismissAndTeardown()
    void B()
  }

  const racersApi: PermissionDooRacersApi = {
    dismissAndTeardown,
    isReprompted,
    addTeardown,
    notifyBridge: notifyBridge ?? (() => {}),
  }
  onRacersReady?.(racersApi)

  void B()

  return {
    result,
    onReprompt,
    dismissAndTeardown,
    isReprompted,
    addTeardown,
  }
}

/**
 * densable foo then doo B() — one-shot helper (no onReprompt handle).
 */
export async function openPermissionDoo(
  input: OpenPermissionDooInput,
): Promise<PermissionPromptResult> {
  return startPermissionDoo(input).result
}
