/**
 * densable read_file / read_asset call-time write guard (2.1.289): `m4`
 * stash take, batch `consume(base)` + `Rv`, `Ro`, `y_`, the `iS` deny
 * re-check and `Ca` set-aside planning, bound to one tool use.
 */
import type { ArtifactReadSaveHooks } from 'src/services/artifactAutoReact/saveActions.js'
import type { Tool, ToolUseContext } from 'src/Tool.js'
import { parseArtifactUrlAnyCase } from 'src/utils/artifactUrl.js'

export async function artifactReadSaveHooks(
  tool: Tool,
  input: Record<string, unknown>,
  context: Partial<ToolUseContext> | undefined,
): Promise<ArtifactReadSaveHooks | undefined> {
  if (context?.getAppState === undefined) return undefined
  const ctx = {
    getAppState: context.getAppState,
    permissionLayers: context.permissionLayers,
    forRemoteExecution: context.forRemoteExecution,
  }
  const toolUseId = context.toolUseId
  const sp = await import(
    'src/services/artifactAutoReact/readPerm/savePaths.js'
  )
  const { de } = await import(
    'src/services/artifactAutoReact/readPerm/rules.js'
  )
  const grantRead = await artifactReadGrant(input, context)
  return {
    ...(grantRead !== undefined && { grantRead }),
    takeApprovedSpellings: dest =>
      sp.takeApprovedSaveSpellings(toolUseId, dest),
    takeBatchSpellings: (base, dests) => {
      const stashed = sp.takeStashedWritePermission(toolUseId, base)
      if (stashed === undefined || typeof stashed === 'symbol') return stashed
      return sp.unpackStashedSpellings(stashed, dests)
    },
    freshSpellings: dest => sp.permissionSpellingsFor(dest),
    prepareWrite: (dest, spellings, opts) =>
      sp.prepareGuardedWrite(dest, spellings, opts),
    isWriteDenied: (dest, extraSpellings) => {
      const walked = sp.savePathSpellings(dest)
      return (
        sp.checkSaveDestinationWritePermission(tool, input, de(ctx), {
          ...walked,
          spellings: [...new Set([...extraSpellings, ...walked.spellings])],
        }).behavior === 'deny'
      )
    },
    planBatch: files =>
      sp.planReadFileBatch(files, { tool, input, permissions: de(ctx) }),
  }
}

/** Binds densable `cKe` to this call; undefined without a writable AppState. */
export async function artifactReadGrant(
  input: Record<string, unknown>,
  context: Partial<ToolUseContext> | undefined,
): Promise<(() => void) | undefined> {
  const getAppState = context?.getAppState
  const setAppState = context?.setAppState
  if (getAppState === undefined || setAppState === undefined) return undefined
  const parsed =
    typeof input.url === 'string' ? parseArtifactUrlAnyCase(input.url) : null
  if (parsed === null) return undefined
  const { recordArtifactReadGrant } = await import(
    'src/services/artifactAutoReact/readPerm/grants.js'
  )
  const ctx = {
    getAppState,
    setAppState,
    toolUseId: context?.toolUseId,
    toolDecisions: context?.toolDecisions,
    permissionLayers: context?.permissionLayers,
  }
  return () => recordArtifactReadGrant(input, ctx, parsed.slug)
}

/**
 * Binds densable `NCo` (page HTML read grant) to this call; undefined without
 * a writable AppState. Semantic only — invent-ban `export function NCo`.
 */
export async function artifactPageReadGrant(
  input: Record<string, unknown>,
  context: Partial<ToolUseContext> | undefined,
): Promise<(() => void) | undefined> {
  const getAppState = context?.getAppState
  const setAppState = context?.setAppState
  if (getAppState === undefined || setAppState === undefined) return undefined
  const parsed =
    typeof input.url === 'string' ? parseArtifactUrlAnyCase(input.url) : null
  if (parsed === null) return undefined
  const { recordArtifactPageReadGrant } = await import(
    'src/services/artifactAutoReact/readPerm/grants.js'
  )
  const ctx = {
    getAppState,
    setAppState,
    toolUseId: context?.toolUseId,
    toolDecisions: context?.toolDecisions,
    permissionLayers: context?.permissionLayers,
  }
  return () => recordArtifactPageReadGrant(input, ctx, parsed.slug)
}

/**
 * densable fetch `admitPublicRead: () => mKe(g,n,slug,kind)`.
 * Undefined without AppState (callers omit → public_unasked on tokenless).
 */
export async function artifactAdmitPublicRead(
  input: Record<string, unknown>,
  context: Partial<ToolUseContext> | undefined,
  kind: 'page' | 'files' | 'assets',
): Promise<(() => boolean) | undefined> {
  const getAppState = context?.getAppState
  const setAppState = context?.setAppState
  if (getAppState === undefined || setAppState === undefined) return undefined
  const parsed =
    typeof input.url === 'string' ? parseArtifactUrlAnyCase(input.url) : null
  if (parsed === null) return undefined
  const { mayAdmitPublicArtifactRead } = await import(
    'src/services/artifactAutoReact/readPerm/grants.js'
  )
  const ctx = {
    getAppState,
    setAppState,
    toolUseId: context?.toolUseId,
    toolDecisions: context?.toolDecisions,
    permissionLayers: context?.permissionLayers,
  }
  return () => mayAdmitPublicArtifactRead(input, ctx, parsed.slug, kind)
}
