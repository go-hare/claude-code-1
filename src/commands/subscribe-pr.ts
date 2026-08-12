import type { Command, LocalCommandCall } from '../types/command.js'
import { detectCurrentRepositoryWithHost } from '../utils/detectRepository.js'
import {
  findPRSubscription,
  readPRSubscriptions,
  removePRSubscription,
  upsertPRSubscription,
} from '../utils/prSubscriptions.js'

/**
 * Parse a PR URL or number into { repo, prNumber }.
 *
 * Accepts:
 *   - Full URL:  https://github.com/owner/repo/pull/123
 *   - Short ref: owner/repo#123
 *   - Bare number: 123  (uses the current git repository)
 */
async function parsePRArg(
  arg: string,
): Promise<{ repo: string; prNumber: number } | { error: string }> {
  const trimmed = arg.trim()

  // Full GitHub PR URL
  const urlMatch = trimmed.match(
    /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d+)/,
  )
  if (urlMatch) {
    return { repo: urlMatch[1]!, prNumber: parseInt(urlMatch[2]!, 10) }
  }

  // Short ref: owner/repo#123
  const shortMatch = trimmed.match(/^([^/]+\/[^/]+)#(\d+)$/)
  if (shortMatch) {
    return { repo: shortMatch[1]!, prNumber: parseInt(shortMatch[2]!, 10) }
  }

  // Bare number — resolve repo from current git checkout
  const numMatch = trimmed.match(/^#?(\d+)$/)
  if (numMatch) {
    const prNumber = parseInt(numMatch[1]!, 10)
    const detected = await detectCurrentRepositoryWithHost()
    if (!detected) {
      return {
        error:
          'Could not detect the GitHub repository for the current directory. Provide a full PR URL instead.',
      }
    }
    const repo = `${detected.owner}/${detected.name}`
    return { repo, prNumber }
  }

  return {
    error: `Unrecognised PR reference: "${trimmed}". Expected a PR URL, owner/repo#123, or a PR number.`,
  }
}

const call: LocalCommandCall = async (args, _context) => {
  const trimmed = args.trim()

  // List current subscriptions
  if (!trimmed || trimmed === '--list' || trimmed === 'list') {
    const subs = readPRSubscriptions()
    if (subs.length === 0) {
      return {
        type: 'text',
        value:
          'No active PR subscriptions. Usage: /subscribe-pr <pr-url-or-number>',
      }
    }
    const lines = subs.map(
      s => `  ${s.repo}#${s.prNumber}  (since ${s.subscribedAt})`,
    )
    return {
      type: 'text',
      value: `Active PR subscriptions:\n${lines.join('\n')}`,
    }
  }

  // Unsubscribe
  if (trimmed.startsWith('--remove ') || trimmed.startsWith('remove ')) {
    const rest = trimmed.replace(/^(--remove|remove)\s+/, '')
    const parsed = await parsePRArg(rest)
    if ('error' in parsed) {
      return { type: 'text', value: parsed.error }
    }
    const removed = removePRSubscription(parsed.repo, parsed.prNumber)
    if (!removed) {
      return {
        type: 'text',
        value: `No subscription found for ${parsed.repo}#${parsed.prNumber}.`,
      }
    }
    return {
      type: 'text',
      value: `Unsubscribed from ${parsed.repo}#${parsed.prNumber}.`,
    }
  }

  // Subscribe
  const parsed = await parsePRArg(trimmed)
  if ('error' in parsed) {
    return { type: 'text', value: parsed.error }
  }

  const existing = findPRSubscription(parsed.repo, parsed.prNumber)
  if (existing) {
    return {
      type: 'text',
      value: `Already subscribed to ${parsed.repo}#${parsed.prNumber} (since ${existing.subscribedAt}).`,
    }
  }

  upsertPRSubscription({
    repo: parsed.repo,
    prNumber: parsed.prNumber,
  })

  return {
    type: 'text',
    value: `Subscribed to ${parsed.repo}#${parsed.prNumber}. You will receive notifications for comments, CI status, and reviews.`,
  }
}

const subscribePr = {
  type: 'local',
  name: 'subscribe-pr',
  aliases: ['watch-pr'],
  description: 'Subscribe to GitHub PR activity (comments, CI, reviews)',
  argumentHint: '<pr-url-or-number>',
  supportsNonInteractive: false,
  isHidden: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default subscribePr
