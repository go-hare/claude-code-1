import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { containsPath, isForbiddenWorkflowScriptPath } from './paths.js'

export { isForbiddenWorkflowScriptPath }

/** densable `yt` — FileRead wire name. */
export const WORKFLOW_SCRIPT_READ_TOOL_NAME = 'Read'

/** densable `Fs` — FileWrite wire name. */
export const WORKFLOW_SCRIPT_WRITE_TOOL_NAME = 'Write'

/** densable checkPermissions deny when Rst is outside the readable set. */
export const WORKFLOW_SCRIPT_OUTSIDE_READABLE_SET =
  'workflow scriptPath outside the readable set'

/** densable `on(tool, name)` — primary name or alias. */
export type WorkflowScriptToolRef = {
  name: string
  aliases?: readonly string[]
}

/** densable `ow` result used by `Ryr`. */
export type WorkflowScriptPathDecision = {
  behavior: string
  decisionReason?: {
    type?: string
    rule?: { ruleBehavior?: string }
  }
}

/**
 * densable `i.options.tools` + `he(i)` fields for `Oo` / `iJ` / `zl` / `Ryr`.
 * `nu` is not a locked string; pass `probeToolName` when zl should fire.
 */
export type WorkflowScriptReadableSet = {
  tools?: readonly WorkflowScriptToolRef[]
  /** densable `nu` — first arg to `iJ` / `zl`. */
  probeToolName?: string
  /** densable `ys(t, Q_)` — non-null blocks. */
  readToolDenyRule?: unknown
  /** densable `Wg(t, Q_)` — non-null blocks. */
  readToolAskRule?: unknown
  /** densable `ow(e, t)`. */
  pathDecision?: WorkflowScriptPathDecision
  /** densable `t.mode`. */
  permissionMode?: string
}

/** densable `It` — still quotes the caller-supplied path. */
export function workflowScriptReadRefusal(scriptPath: string): string {
  return `scriptPath must be a script path this tool returned, or a file you can already read (the working directory or a directory you have added): ${scriptPath}`
}

function errnoCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

/** densable `on`. */
function toolMatchesName(tool: WorkflowScriptToolRef, name: string): boolean {
  return tool.name === name || (tool.aliases?.includes(name) ?? false)
}

function toolsOf(
  gate: WorkflowScriptReadableSet | undefined,
): readonly WorkflowScriptToolRef[] {
  return gate?.tools ?? []
}

function probeToolNameOf(gate: WorkflowScriptReadableSet | undefined): string {
  return gate?.probeToolName ?? WORKFLOW_SCRIPT_READ_TOOL_NAME
}

/**
 * densable `i.options.tools` — duck-type a toolUseContext.
 * Missing or non-array tools → `[]` (same as official `?? []`).
 */
export function workflowToolsFromToolUseContext(
  context: unknown,
): WorkflowScriptToolRef[] {
  if (typeof context !== 'object' || context === null) return []
  const options = (context as { options?: unknown }).options
  if (typeof options !== 'object' || options === null) return []
  const tools = (options as { tools?: unknown }).tools
  if (!Array.isArray(tools)) return []
  const out: WorkflowScriptToolRef[] = []
  for (const tool of tools) {
    if (typeof tool !== 'object' || tool === null) continue
    const name = (tool as { name?: unknown }).name
    if (typeof name !== 'string') continue
    const aliases = (tool as { aliases?: unknown }).aliases
    out.push({
      name,
      ...(Array.isArray(aliases) && aliases.every(a => typeof a === 'string')
        ? { aliases: aliases as string[] }
        : {}),
    })
  }
  return out
}

/** Host `readableSet` / `tools`, else `i.options.tools`. */
export function resolveWorkflowScriptReadableSet(
  host: {
    tools?: readonly WorkflowScriptToolRef[]
    readableSet?: WorkflowScriptReadableSet
  },
  context: unknown,
): WorkflowScriptReadableSet {
  if (host.readableSet) return host.readableSet
  return {
    tools: host.tools ?? workflowToolsFromToolUseContext(context),
  }
}

function pathIsUnderApprovedRoot(
  resolved: string,
  cwd: string,
  extraRoots: readonly string[],
): boolean {
  return [cwd, ...extraRoots].some(root => {
    try {
      return containsPath(resolve(root), resolved)
    } catch {
      return false
    }
  })
}

/**
 * densable `zl`: tools list has the probe tool and neither Read nor Write.
 * That is a deny-only / narrowed set — not a readable set.
 */
export function workflowToolsAreDenyOnly(
  probeToolName: string,
  tools: readonly WorkflowScriptToolRef[],
): boolean {
  return (
    tools.some(t => toolMatchesName(t, probeToolName)) &&
    !tools.some(t => toolMatchesName(t, WORKFLOW_SCRIPT_READ_TOOL_NAME)) &&
    !tools.some(t => toolMatchesName(t, WORKFLOW_SCRIPT_WRITE_TOOL_NAME))
  )
}

/**
 * densable `Ryr`. When `pathDecision` is omitted, the existing cwd / added-dir
 * helper is the local `ow` stand-in (`pathInAllowedWorkingPath` / containsPath).
 */
export function workflowScriptPathPermissionAllows(
  resolvedPath: string,
  cwd: string,
  extraRoots: readonly string[],
  gate?: WorkflowScriptReadableSet,
): boolean {
  if (gate?.readToolDenyRule != null || gate?.readToolAskRule != null) {
    return false
  }
  const decision = gate?.pathDecision
  if (decision) {
    if (decision.behavior === 'allow') return true
    if (decision.behavior !== 'ask') return false
    if (gate?.permissionMode !== 'bypassPermissions') return false
    const reason = decision.decisionReason
    return !(reason?.type === 'rule' && reason.rule?.ruleBehavior === 'ask')
  }
  return pathIsUnderApprovedRoot(resolvedPath, cwd, extraRoots)
}

/** Oo first check + zl (no path / Ryr). */
function ooToolsListAllows(
  gate: WorkflowScriptReadableSet | undefined,
): boolean {
  const tools = toolsOf(gate)
  if (
    tools.length > 0 &&
    !tools.some(t => toolMatchesName(t, WORKFLOW_SCRIPT_READ_TOOL_NAME)) &&
    !tools.some(t => toolMatchesName(t, WORKFLOW_SCRIPT_WRITE_TOOL_NAME))
  ) {
    return false
  }
  return !workflowToolsAreDenyOnly(probeToolNameOf(gate), tools)
}

/** densable `iJ`: `!zl(e, r) && Ryr(t, o)`. */
export function workflowScriptReadableSetAllows(
  probeToolName: string,
  resolvedPath: string,
  cwd: string,
  extraRoots: readonly string[],
  gate?: WorkflowScriptReadableSet,
): boolean {
  return (
    !workflowToolsAreDenyOnly(probeToolName, toolsOf(gate)) &&
    workflowScriptPathPermissionAllows(resolvedPath, cwd, extraRoots, gate)
  )
}

/**
 * densable `Oo`: nonempty tools without Read/Write is not a readable set;
 * else `iJ(nu, path, ctx, he(ctx))`.
 */
export function workflowScriptToolsReadableSet(
  resolvedPath: string,
  cwd: string,
  extraRoots: readonly string[],
  gate?: WorkflowScriptReadableSet,
): boolean {
  return (
    ooToolsListAllows(gate) &&
    workflowScriptPathPermissionAllows(resolvedPath, cwd, extraRoots, gate)
  )
}

/**
 * densable `qhn` then `Oo`. cwd / added-dir plus the tools-readable-set gate.
 * Network paths are not readable. Does not open the file.
 */
export function workflowScriptPathIsReadable(
  scriptPath: string,
  cwd: string,
  extraRoots: readonly string[] = [],
  gate?: WorkflowScriptReadableSet,
): boolean {
  let resolved: string
  try {
    resolved = resolve(cwd, scriptPath)
  } catch {
    return false
  }
  if (
    isForbiddenWorkflowScriptPath(scriptPath) ||
    isForbiddenWorkflowScriptPath(resolved)
  ) {
    return false
  }
  return workflowScriptToolsReadableSet(resolved, cwd, extraRoots, gate)
}

/**
 * After open, `realpath` may spell an approved root differently (Windows
 * 8.3). Compare against the real path of each already-approved root.
 * A symlink that leaves those roots still fails.
 * Tools / deny-ask / pathDecision cannot be rescued by 8.3.
 */
async function realpathStaysReadable(
  realTarget: string,
  cwd: string,
  extraRoots: readonly string[],
  gate?: WorkflowScriptReadableSet,
): Promise<boolean> {
  if (isForbiddenWorkflowScriptPath(realTarget) || !ooToolsListAllows(gate)) {
    return false
  }
  if (gate?.readToolDenyRule != null || gate?.readToolAskRule != null) {
    return false
  }
  if (gate?.pathDecision) {
    return workflowScriptPathPermissionAllows(realTarget, cwd, extraRoots, gate)
  }
  if (pathIsUnderApprovedRoot(realTarget, cwd, extraRoots)) return true
  for (const root of [cwd, ...extraRoots]) {
    try {
      if (containsPath(await realpath(root), realTarget)) return true
    } catch {
      // missing root — lexical check already ran
    }
  }
  return false
}

/**
 * densable `htn` then `Rst`. The readable-set check runs before open.
 * After open, a realpath that leaves the set still returns `It` and no bytes.
 */
export async function readAllowedWorkflowScript(
  scriptPath: string,
  cwd: string,
  extraRoots: readonly string[] = [],
  gate?: WorkflowScriptReadableSet,
): Promise<{ script: string; path: string }> {
  let resolved: string
  try {
    resolved = resolve(cwd, scriptPath)
  } catch {
    throw new Error(workflowScriptReadRefusal(scriptPath))
  }
  if (
    isForbiddenWorkflowScriptPath(scriptPath) ||
    isForbiddenWorkflowScriptPath(resolved)
  ) {
    throw new Error(
      `Network (UNC, NT-namespace, or automount) paths are not allowed for workflow scriptPath: ${scriptPath}`,
    )
  }
  if (!workflowScriptPathIsReadable(scriptPath, cwd, extraRoots, gate)) {
    throw new Error(workflowScriptReadRefusal(scriptPath))
  }

  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(resolved, constants.O_RDONLY)
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') {
      throw new Error(`Workflow script file not found: ${scriptPath}`)
    }
    throw new Error(`Failed to read workflow script file ${scriptPath}`)
  }

  try {
    const st = await handle.stat({ bigint: true })
    if (st.ino === 0n || st.nlink > 1n) {
      throw new Error(workflowScriptReadRefusal(scriptPath))
    }
    if (!st.isFile()) {
      throw new Error(
        `Workflow script file ${scriptPath} is not a regular file`,
      )
    }
    let real: string
    try {
      real = await realpath(resolved)
    } catch {
      throw new Error(workflowScriptReadRefusal(scriptPath))
    }
    if (!(await realpathStaysReadable(real, cwd, extraRoots, gate))) {
      throw new Error(workflowScriptReadRefusal(scriptPath))
    }
    const script = await handle.readFile({ encoding: 'utf8' })
    return { script, path: real }
  } finally {
    await handle.close()
  }
}
