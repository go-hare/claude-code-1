import type { FeedbackDraft } from './draft.js'

export type FeedbackDraftSubmitSurface = 'panel' | 'card_send_as_is'

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function asOptionalCount(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : undefined
}

function pluralize(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`
}

/** densable leftover Le */
export function formatDraftedFeedbackDescription(
  draft: FeedbackDraft,
  surface: FeedbackDraftSubmitSurface = 'panel',
): string {
  const requestIds = draft.request_ids.filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  )
  const area = asOptionalString(draft.area)
  const failureMode = asOptionalString(draft.failure_mode)
  const taskCategory = asOptionalString(draft.task_category)
  const effort = asOptionalString(draft.effort)
  const thinking = asOptionalString(draft.thinking_type)
  const thinkingBudget = asOptionalCount(draft.thinking_budget)
  const messageCount = asOptionalCount(draft.message_count)
  const assistantTurns = asOptionalCount(draft.assistant_turn_count)
  const subagentCount =
    typeof draft.subagent_count === 'number' ? draft.subagent_count : undefined
  return [
    `[${draft.type}] ${draft.title}`,
    '',
    draft.details,
    '',
    '---',
    surface === 'card_send_as_is'
      ? 'Drafted by Claude via the SendFeedback tool; approved by the user from the above-prompt card without full review.'
      : 'Drafted by Claude via the SendFeedback tool; reviewed and approved by the user before sending.',
    `trigger: ${draft.trigger}`,
    ...(area !== undefined ? [`area: ${area}`] : []),
    ...(failureMode !== undefined ? [`failure_mode: ${failureMode}`] : []),
    ...(taskCategory !== undefined ? [`task_category: ${taskCategory}`] : []),
    `draft_id: ${draft.draft_id}`,
    `drafted_at: ${draft.created_at}`,
    `source_session_id: ${draft.source_session_id}`,
    `model: ${draft.model}`,
    `cli_version: ${draft.cli_version}`,
    `os: ${draft.os}`,
    ...(effort !== undefined ? [`effort: ${effort}`] : []),
    ...(thinking !== undefined
      ? [
          `thinking: ${thinking}${thinkingBudget !== undefined ? ` (budget ${thinkingBudget})` : ''}`,
        ]
      : []),
    ...(assistantTurns !== undefined
      ? [
          `turns: ${assistantTurns} assistant${messageCount !== undefined ? ` / ${messageCount} messages` : ''}${subagentCount !== undefined && subagentCount > 0 ? `, ${subagentCount} ${pluralize(subagentCount, 'subagent')}` : ''}`,
        ]
      : []),
    ...(requestIds.length > 0 ? [`request_ids: ${requestIds.join(', ')}`] : []),
  ].join('\n')
}
