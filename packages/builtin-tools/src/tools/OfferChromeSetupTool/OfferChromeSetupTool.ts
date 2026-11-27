/**
 * Official 2.1.331 OfferChromeSetupTool (chunks #29, #193).
 *
 * Offers the user the one-time setup of Claude in Chrome when the host can
 * render the setup card (`getHostRendersChromeSetupOffer()`) and this root
 * session has reported that the Chrome extension is not connected.
 */

import { z } from 'zod/v4'
import {
  buildTool,
  type ToolDef,
  type ToolDeps,
  type ToolResultBlockParam,
} from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  getBootstrapSession,
  getHostRendersChromeSetupOffer,
  RootSessionSlot,
} from 'src/utils/sessionHost.js'

export const OFFER_CHROME_SETUP_TOOL_NAME = 'OfferChromeSetup'

const OFFER_CHROME_SETUP_DESCRIPTION =
  'Offer the user the one-time setup of Claude in Chrome so this task can use their own signed-in browser.'

const OFFER_CHROME_SETUP_PROMPT = [
  'Offer the user the one-time setup of Claude in Chrome when the task requires their own signed-in browser and the Chrome extension was reported as not connected.',
  "Pass a short `reason` naming what the task needs the user's signed-in browser for. Do not pass `outcome` — the host setup card populates it via `updatedInput`.",
  'If the result reports `outcome: "connected"`, continue the task with the `mcp__claude-in-chrome__*` tools. If `outcome: "not_now"`, carry on with the built-in browser or without a browser and do not offer Chrome setup again in this task unless the user asks.',
].join('\n\n')

const CHROME_CONNECTED_MESSAGE =
  'Claude in Chrome is now connected. Continue the task with the mcp__claude-in-chrome__* tools.'

const CHROME_NOT_NOW_MESSAGE =
  'Claude in Chrome was not set up now. Carry on with the built-in browser or without a browser, and do not offer Chrome setup again in this task unless the user asks.'

const chromeExtensionNotConnectedSlot = new RootSessionSlot<{
  reported: boolean
}>(() => ({ reported: false }))

export function hasChromeExtensionNotConnectedReport(
  session: { readonly root: object } = getBootstrapSession(),
): boolean {
  return chromeExtensionNotConnectedSlot.peek(session)?.reported ?? false
}

export function markChromeExtensionNotConnectedReported(
  reported = true,
  session: { readonly root: object } = getBootstrapSession(),
): void {
  chromeExtensionNotConnectedSlot.of(session).reported = reported
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    reason: z
      .string()
      .min(1)
      .describe(
        "Short reason naming what the task needs the user's signed-in browser for",
      ),
    outcome: z
      .enum(['connected', 'not_now'])
      .optional()
      .describe('Populated by host setup card via updatedInput'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type OfferChromeSetupInput = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    outcome: z.enum(['connected', 'not_now']),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type OfferChromeSetupOutput = z.infer<OutputSchema>

export const OfferChromeSetupTool = buildTool({
  name: OFFER_CHROME_SETUP_TOOL_NAME,
  maxResultSizeChars: 10_000,
  shouldDefer: false,

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  async description(_input?: OfferChromeSetupInput, _options?: unknown) {
    return OFFER_CHROME_SETUP_DESCRIPTION
  },
  async prompt(_options?: unknown) {
    return OFFER_CHROME_SETUP_PROMPT
  },

  userFacingName() {
    return OFFER_CHROME_SETUP_TOOL_NAME
  },

  isEnabled() {
    return (
      getHostRendersChromeSetupOffer() && hasChromeExtensionNotConnectedReport()
    )
  },

  isReadOnly(_input?: OfferChromeSetupInput) {
    return true
  },
  isConcurrencySafe(_input?: OfferChromeSetupInput) {
    return false
  },
  requiresUserInteraction() {
    return true
  },

  toAutoClassifierInput(input: OfferChromeSetupInput) {
    return input.reason
  },

  renderToolUseMessage(input: Partial<OfferChromeSetupInput>) {
    return input.reason ?? null
  },

  mapToolResultToToolResultBlockParam(
    output: OfferChromeSetupOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: output.message,
    }
  },

  create(_deps: ToolDeps) {
    return {
      async checkPermissions(input: OfferChromeSetupInput) {
        return {
          behavior: 'ask' as const,
          message:
            'Offer the user the one-time setup of Claude in Chrome, so this task can use their own signed-in browser.',
          updatedInput: { reason: input.reason },
        }
      },

      async call(input: OfferChromeSetupInput) {
        if (input.outcome === 'connected') {
          return {
            data: {
              outcome: 'connected' as const,
              message: CHROME_CONNECTED_MESSAGE,
            },
          }
        }
        return {
          data: {
            outcome: 'not_now' as const,
            message: CHROME_NOT_NOW_MESSAGE,
          },
        }
      },
    }
  },
} satisfies ToolDef<InputSchema, OfferChromeSetupOutput>)
