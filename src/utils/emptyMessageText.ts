/**
 * Leaf helpers for "is this assistant/streaming text visually empty?"
 *
 * Kept out of messages.ts so streamingTextStore can share the same empty
 * rule as AssistantTextMessage / StreamingTextPreview without a circular
 * import (messages.ts → … → streamingTextStore → messages.ts).
 */
import { NO_CONTENT_MESSAGE } from '../constants/messages.js'

const STRIPPED_TAGS_RE =
  /<(commit_analysis|context|function_analysis|pr_analysis)>.*?<\/\1>\n?/gs

/** densable-aligned strip of prompt XML wrappers used for emptiness checks. */
export function stripPromptXMLTags(content: string): string {
  return content.replace(STRIPPED_TAGS_RE, '').trim()
}

/**
 * True when text would paint no visible body (whitespace / strip-only XML /
 * official "(no content)" sentinel). Final + streaming ● gates share this.
 *
 * Sentinel is checked on both raw trim and post-strip trim so
 * `<context>…</context>\n(no content)` does not set STREAM_FLAG_DISPLAYED
 * (would hide Cooking while preview body is the empty sentinel).
 */
export function isEmptyMessageText(text: string): boolean {
  if (text.trim() === NO_CONTENT_MESSAGE) return true
  const stripped = stripPromptXMLTags(text).trim()
  return stripped === '' || stripped === NO_CONTENT_MESSAGE
}
