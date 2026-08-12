import { z } from 'zod/v4'
import type { ToolResultBlockParam } from 'src/Tool.js'
import { buildTool } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  prSubscriptionId,
  upsertPRSubscription,
} from 'src/utils/prSubscriptions.js'

const SUBSCRIBE_PR_TOOL_NAME = 'SubscribePR'

const inputSchema = lazySchema(() =>
  z.strictObject({
    repo: z.string().describe('Repository in owner/repo format.'),
    pr_number: z.number().describe('Pull request number to subscribe to.'),
    events: z
      .array(z.enum(['comment', 'review', 'ci', 'merge', 'close']))
      .optional()
      .describe('Event types to subscribe to. Defaults to all events.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type SubscribeInput = z.infer<InputSchema>

type SubscribeOutput = {
  subscribed: boolean
  subscription_id: string
  error?: string
}

export const SubscribePRTool = buildTool({
  name: SUBSCRIBE_PR_TOOL_NAME,
  searchHint: 'subscribe pull request github webhook events watch',
  maxResultSizeChars: 5_000,
  strict: true,

  get inputSchema(): InputSchema {
    return inputSchema()
  },

  async description() {
    return 'Subscribe to pull request events via GitHub webhooks'
  },
  async prompt() {
    return `Subscribe to events on a GitHub pull request. You'll receive notifications when selected events occur (comments, reviews, CI status changes, merge, close).

Use this to monitor PRs you've created or are reviewing. Events are delivered as messages you can act on.

Subscriptions are stored locally (~/.claude/pr-subscriptions.json) and shared with /subscribe-pr. Inbound webhook payloads are sanitized when KAIROS_GITHUB_WEBHOOKS is enabled.`
  },

  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    // Writes local subscription state (not the repo) — treat as non-mutating
    // for permission prompts; file is under config home.
    return true
  },

  userFacingName() {
    return 'SubscribePR'
  },

  renderToolUseMessage(input: Partial<SubscribeInput>) {
    const pr =
      input.repo && input.pr_number ? `${input.repo}#${input.pr_number}` : '...'
    return `Subscribe PR: ${pr}`
  },

  mapToolResultToToolResultBlockParam(
    content: SubscribeOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: content.subscribed
        ? `Subscribed to PR events (id: ${content.subscription_id})`
        : `Failed to subscribe to PR events${content.error ? `: ${content.error}` : '.'}`,
    }
  },

  async call(input: SubscribeInput) {
    const repo = input.repo.trim()
    if (!/^[^/]+\/[^/]+$/.test(repo)) {
      return {
        data: {
          subscribed: false,
          subscription_id: '',
          error: 'repo must be owner/repo',
        } satisfies SubscribeOutput,
      }
    }
    if (!Number.isFinite(input.pr_number) || input.pr_number <= 0) {
      return {
        data: {
          subscribed: false,
          subscription_id: '',
          error: 'pr_number must be a positive number',
        } satisfies SubscribeOutput,
      }
    }

    try {
      const { subscription } = upsertPRSubscription({
        repo,
        prNumber: input.pr_number,
        events: input.events,
      })
      return {
        data: {
          subscribed: true,
          subscription_id: prSubscriptionId(subscription),
        } satisfies SubscribeOutput,
      }
    } catch (e) {
      return {
        data: {
          subscribed: false,
          subscription_id: '',
          error: e instanceof Error ? e.message : String(e),
        } satisfies SubscribeOutput,
      }
    }
  },
})
