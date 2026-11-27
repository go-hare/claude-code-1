import axios from 'axios'
import { readFile, stat } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod/v4'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { logEvent } from '../../services/analytics/index.js'
import { buildTool, type ToolResultBlockParam } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'

export const SHARE_ONBOARDING_GUIDE_TOOL_NAME = 'ShareOnboardingGuide'

const SHARE_ONBOARDING_GUIDE_DESCRIPTION = `Upload the ONBOARDING.md in the current directory and return a share link teammates can open in Claude Code. Call this after the user has confirmed the final content.

When called with the default mode='check': if a local ONBOARDING.md is present, uploads it to the most-recently-updated org guide (or creates one if none exist) and returns a fresh link. If no local file is present, returns the existing link without uploading (status: has_existing).`

/** Official UAr — team-onboarding command enable gate (default true). */
export function isTeamOnboardingEnabled(): boolean {
  return (
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_logical_nebula', true) === true
  )
}

/** Official Xrn — ShareOnboardingGuide tool enable gate (default false). */
export function isShareOnboardingGuideEnabled(): boolean {
  if (!isTeamOnboardingEnabled()) return false
  return (
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_flint_harbor_share', false) ===
    true
  )
}

export type OnboardingGuideSummary = {
  short_code: string
  share_url: string
  updated_at: string
}

export type ShareOnboardingGuideInput = {
  mode?: 'check' | 'update' | 'create' | 'delete'
  short_code?: string
}

export type ShareOnboardingGuideResult = {
  status: 'created' | 'updated' | 'deleted' | 'has_existing' | 'unavailable'
  share_url?: string
  short_code?: string
  message: string
}

const ONBOARDING_FILENAME = 'ONBOARDING.md'
const MAX_ONBOARDING_BYTES = 65536

export async function listOnboardingGuides(
  headers: Record<string, string>,
  baseUrl: string,
): Promise<OnboardingGuideSummary[]> {
  const response = await axios.get<{ guides?: OnboardingGuideSummary[] }>(
    `${baseUrl}/api/organizations/:orgUUID/claude_code/onboarding`,
    { headers, timeout: 15000 },
  )
  return response.data?.guides ?? []
}

/**
 * #1559: Delete an onboarding guide by short_code.
 * Returns 'already_gone' on 404, throws on status >= 300 (server refusal),
 * and returns 'deleted' only on 2xx.
 */
export async function deleteOnboardingGuideByCode(
  shortCode: string,
  headers: Record<string, string>,
  baseUrl: string,
): Promise<'deleted' | 'already_gone'> {
  const response = await axios.delete(
    `${baseUrl}/api/organizations/:orgUUID/claude_code/onboarding/${encodeURIComponent(shortCode)}`,
    {
      headers,
      timeout: 15000,
      validateStatus: s => s < 300 || s === 404,
    },
  )
  if (response.status === 404) {
    return 'already_gone'
  }
  if (response.status >= 300) {
    throw new Error(`Onboarding guide unavailable: status ${response.status}`)
  }
  logEvent('tengu_team_onboarding_share_deleted', {})
  return 'deleted'
}

export async function runShareOnboardingGuide(
  input: ShareOnboardingGuideInput,
  deps: {
    headers?: Record<string, string>
    baseUrl?: string
    cwd?: string
  } = {},
): Promise<ShareOnboardingGuideResult> {
  const mode = input.mode ?? 'check'
  const shortCode = input.short_code
  const headers = deps.headers ?? {}
  const baseUrl = deps.baseUrl ?? 'https://api.anthropic.com'
  const cwd = deps.cwd ?? getCwd()

  if (mode === 'delete') {
    try {
      // #1558: Never delete the most-recently-updated guide when no short_code was named.
      if (!shortCode) {
        const guides = await listOnboardingGuides(headers, baseUrl)
        if (guides.length === 0) {
          return {
            status: 'unavailable',
            message: 'The user has no guides to delete.',
          }
        }
        const summary = guides
          .map(g => `${g.short_code} (updated ${g.updated_at})`)
          .join(', ')
        return {
          status: 'unavailable',
          message: `Nothing was deleted. Ask the user which guide to delete, then call again with its short_code. The user's guides: ${summary}.`,
        }
      }
      const outcome = await deleteOnboardingGuideByCode(
        shortCode,
        headers,
        baseUrl,
      )
      return {
        status: 'deleted',
        message:
          outcome === 'already_gone'
            ? `The server found no guide ${shortCode} in this organization: it was already deleted, or the code is wrong. Call delete with no short_code to list the user's guides.`
            : `Guide ${shortCode} deleted.`,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        status: 'unavailable',
        message: `Delete didn't go through (${msg}).`,
      }
    }
  }

  const filePath = join(cwd, ONBOARDING_FILENAME)
  let size: number | null = null
  try {
    size = (await stat(filePath)).size
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }

  if (mode === 'check' && size === null) {
    try {
      const guides = await listOnboardingGuides(headers, baseUrl)
      const existing = shortCode
        ? guides.find(g => g.short_code === shortCode)
        : guides[0]
      if (existing) {
        return {
          status: 'has_existing',
          share_url: existing.share_url,
          short_code: existing.short_code,
          message: `A guide already exists for this org at ${existing.share_url} (short_code: ${existing.short_code}).`,
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        status: 'unavailable',
        message: `Upload didn't go through (${msg}). Fall back to the manual share copy.`,
      }
    }
  }

  if (size === null) {
    return {
      status: 'unavailable',
      message: `${ONBOARDING_FILENAME} not found in the current directory. Write the guide first.`,
    }
  }
  if (size > MAX_ONBOARDING_BYTES) {
    return {
      status: 'unavailable',
      message: `${ONBOARDING_FILENAME} is over ${MAX_ONBOARDING_BYTES / 1024}KB. Trim it before sharing.`,
    }
  }

  const content = await readFile(filePath, 'utf8')
  try {
    if (mode === 'update' && shortCode) {
      const res = await axios.put<{ share_url: string; short_code: string }>(
        `${baseUrl}/api/organizations/:orgUUID/claude_code/onboarding/${encodeURIComponent(shortCode)}`,
        { content },
        { headers, timeout: 15000 },
      )
      logEvent('tengu_team_onboarding_share_updated', {})
      return {
        status: 'updated',
        share_url: res.data.share_url,
        short_code: res.data.short_code,
        message: `Updated onboarding guide: ${res.data.share_url}`,
      }
    }
    const res = await axios.post<{ share_url: string; short_code: string }>(
      `${baseUrl}/api/organizations/:orgUUID/claude_code/onboarding`,
      { content },
      { headers, timeout: 15000 },
    )
    logEvent('tengu_team_onboarding_share_created', {})
    return {
      status: 'created',
      share_url: res.data.share_url,
      short_code: res.data.short_code,
      message: `Created onboarding guide: ${res.data.share_url}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      status: 'unavailable',
      message: `Upload didn't go through (${msg}). Fall back to the manual share copy.`,
    }
  }
}

const shareOnboardingGuideInputSchema = lazySchema(() =>
  z.object({
    mode: z
      .enum(['check', 'update', 'create', 'delete'])
      .default('check')
      .describe(
        "'check' (default): if ONBOARDING.md is present locally, uploads it to the most-recent guide (creates one if none exist); otherwise reports the existing link without uploading. 'update': upload to a specific guide by short_code. 'create': always make a new link. 'delete': remove the guide named by short_code; with no short_code, nothing is deleted and the user's guides are listed.",
      ),
    short_code: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional()
      .describe(
        "Short code of one guide, from an earlier call's result. Required by delete. With check or update, targets that guide instead of the most recently updated one.",
      ),
  }),
)

const shareOnboardingGuideOutputSchema = lazySchema(() =>
  z.object({
    status: z.enum([
      'created',
      'updated',
      'deleted',
      'has_existing',
      'unavailable',
    ]),
    share_url: z.string().optional(),
    short_code: z.string().optional(),
    message: z.string(),
  }),
)

/**
 * Official `ir` (`ShareOnboardingGuide`, #1558 & #1559):
 * Built-in tool registered in `getAllBaseTools()` and referenced by `/team-onboarding`.
 */
export const ShareOnboardingGuideTool = buildTool({
  name: SHARE_ONBOARDING_GUIDE_TOOL_NAME,
  searchHint: 'upload ONBOARDING.md and get a team share link',
  backgrounding: 'never',
  maxResultSizeChars: 1000,
  shouldDefer: false,
  async description() {
    return SHARE_ONBOARDING_GUIDE_DESCRIPTION
  },
  async prompt() {
    return SHARE_ONBOARDING_GUIDE_DESCRIPTION
  },
  get inputSchema() {
    return shareOnboardingGuideInputSchema()
  },
  get outputSchema() {
    return shareOnboardingGuideOutputSchema()
  },
  isEnabled() {
    return isShareOnboardingGuideEnabled()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  isDestructive(input) {
    return input.mode === 'delete'
  },
  toAutoClassifierInput(input) {
    const code = input.short_code ? `, short_code: ${input.short_code}` : ''
    return `share onboarding guide (mode: ${input.mode ?? 'check'}${code})`
  },
  renderToolUseMessage(input) {
    if (input.mode === 'delete' && input.short_code) {
      return `delete ${input.short_code}`
    }
    return input.mode && input.mode !== 'check' ? input.mode : null
  },
  create() {
    return {
      async call(input) {
        const data = await runShareOnboardingGuide(input)
        return { data }
      },
    }
  },
  mapToolResultToToolResultBlockParam(
    output: ShareOnboardingGuideResult,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `[${output.status}] ${output.message}`,
    }
  },
})
