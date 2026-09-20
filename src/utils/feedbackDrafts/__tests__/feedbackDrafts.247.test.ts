import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import {
  formatDraftAge,
  formatFeedbackEnumValue,
  reviewFieldIds,
  sanitizeFeedbackField,
} from '../../../components/FeedbackDrafts.js'
import { SettingsSchema } from '../../settings/types.js'
import { formatDraftedFeedbackDescription } from '../draftedBylines.js'
import { getSessionId } from '../../../bootstrap/state.js'
import {
  getProjectDir,
  getProjectsDir,
  getTranscriptPathForSession,
} from '../../sessionPaths.js'
import { createFeedbackDraft, type FeedbackDraft } from '../draft.js'
import {
  dropTornTranscriptHead,
  isFeedbackDraftTranscriptAvailable,
  resolveDraftTranscriptPath,
  transcriptAbsPathToStorageKey,
  transcriptContentCorroboratesDraft,
} from '../writeDraft.js'
import { formatFeedbackPayloadTrim } from '../fitFeedbackPayloadToBudget.js'
import {
  parseDraftTranscriptMessages,
  sessionMessagesToDraftTranscript,
} from '../parseDraftTranscriptMessages.js'
import {
  canShowFeedbackTurnOffPrompt,
  clearFeedbackNotice,
  decrementSessionDraftCount,
  getFeedbackNoticeState,
  markFeedbackNoticeShown,
  queueFeedbackDraftNotice,
  resetFeedbackNoticeStateForTests,
  seedSessionDraftCount,
  setSeededSessionDraftCount,
  tryConsumeSendFeedbackCall,
  tryStartFeedbackDraftSeed,
} from '../notice.js'

afterEach(() => {
  resetFeedbackNoticeStateForTests()
})

describe('densable leftover SendFeedback / feedbackDrafts', () => {
  test('schema accepts notify/quiet/off and describes the leftover string', () => {
    const describeText = SettingsSchema().shape.feedbackDrafts.description
    expect(describeText).toBe(
      'Model-drafted feedback (the SendFeedback tool). "notify" (default) shows a one-line notice when a draft is queued; "quiet" shows only the footer counter; "off" disables the tool entirely so drafts are never queued.',
    )
    expect(
      SettingsSchema().safeParse({ feedbackDrafts: 'notify' }).success,
    ).toBe(true)
    expect(
      SettingsSchema().safeParse({ feedbackDrafts: 'quiet' }).success,
    ).toBe(true)
    expect(SettingsSchema().safeParse({ feedbackDrafts: 'off' }).success).toBe(
      true,
    )
    expect(SettingsSchema().safeParse({ feedbackDrafts: 'on' }).success).toBe(
      false,
    )
  })

  test('parseDraftTranscriptMessages keeps user/assistant and drops sidechain', () => {
    const raw = [
      '{"type":"user","uuid":"u1","timestamp":"t1","message":{"role":"user","content":"hi"}}',
      '{"type":"assistant","uuid":"a1","timestamp":"t2","message":{"id":"m1","role":"assistant","content":[]},"requestId":"req_1"}',
      '{"type":"user","uuid":"u2","timestamp":"t3","isSidechain":true,"message":{"role":"user","content":"no"}}',
      'not-json',
      '{"type":"progress"}',
    ].join('\n')
    expect(parseDraftTranscriptMessages(raw)).toEqual([
      {
        type: 'user',
        uuid: 'u1',
        timestamp: 't1',
        message: { role: 'user', content: 'hi' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: 't2',
        message: { id: 'm1', role: 'assistant', content: [] },
        requestId: 'req_1',
      },
    ])
  })

  test('ye leftover filters live session messages with Oe predicates', () => {
    expect(
      sessionMessagesToDraftTranscript([
        {
          type: 'user',
          uuid: 'u1',
          timestamp: 't1',
          message: { role: 'user', content: 'hi' },
        },
        {
          type: 'assistant',
          uuid: 'a1',
          timestamp: 't2',
          message: { id: 'm1', role: 'assistant', content: [] },
          requestId: 'req_1',
        },
        {
          type: 'user',
          uuid: 'u2',
          timestamp: 't3',
          isSidechain: true,
          message: { role: 'user', content: 'no' },
        },
        { type: 'progress' },
        null,
      ]),
    ).toEqual([
      {
        type: 'user',
        uuid: 'u1',
        timestamp: 't1',
        message: { role: 'user', content: 'hi' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: 't2',
        message: { id: 'm1', role: 'assistant', content: [] },
        requestId: 'req_1',
      },
    ])
  })

  test('Fe leftover trim annotation', () => {
    expect(
      formatFeedbackPayloadTrim({
        keptMessageCount: 2,
        totalMessageCount: 5,
        oversizedMessageCount: 0,
        rawTail: 'omitted',
        rawTailKeptBytes: 0,
      }),
    ).toBe(
      'transcript_truncated: kept 2 of 5 transcript messages (newest kept first); omitted the raw session log (trimmed client-side to fit the upload size limit)',
    )
  })

  test('Le leftover Drafted-by-Claude bylines', () => {
    const draft: FeedbackDraft = {
      draft_id: '11111111-1111-1111-1111-111111111111',
      created_at: '2026-01-01T00:00:00.000Z',
      source_session_id: 'sess',
      cwd: '/tmp',
      model: 'claude',
      cli_version: '2.1.247',
      os: 'win32 x64',
      request_ids: ['req_1'],
      type: 'bug',
      title: 'Edit failed',
      details: '**What happened:** boom',
      area: 'file editing',
      failure_mode: 'overconfidence_and_hallucination',
      task_category: 'code_edit',
      trigger: 'model_judgment',
      transcript_ref: null,
      status: 'queued',
    }
    const panel = formatDraftedFeedbackDescription(draft)
    expect(panel).toContain(
      'Drafted by Claude via the SendFeedback tool; reviewed and approved by the user before sending.',
    )
    expect(panel).toContain('failure_mode: overconfidence_and_hallucination')
    expect(panel).toContain('task_category: code_edit')
    expect(
      formatDraftedFeedbackDescription(draft, 'card_send_as_is'),
    ).toContain(
      'Drafted by Claude via the SendFeedback tool; approved by the user from the above-prompt card without full review.',
    )
  })

  test('_gr leftover draft shape', () => {
    const draft = createFeedbackDraft(
      {
        type: 'idea',
        title: 'tip',
        details: '**What happened:** x',
        trigger: 'model_judgment',
        requestIds: ['a', 'b', 'c', 'd', 'e', 'f'],
        sessionId: 'sess',
        cwd: '/tmp',
        model: 'claude',
        cliVersion: '2.1.247',
        os: 'win32 x64',
      },
      new Date('2026-01-01T00:00:00.000Z'),
    )
    expect(draft.status).toBe('queued')
    expect(draft.trigger).toBe('model_judgment')
    expect(draft.request_ids).toEqual(['b', 'c', 'd', 'e', 'f'])
    expect(draft.created_at).toBe('2026-01-01T00:00:00.000Z')
  })

  test('Rgr leftover session call cap defaults to 10', () => {
    for (let i = 0; i < 10; i++) {
      expect(tryConsumeSendFeedbackCall()).toBe(true)
    }
    expect(tryConsumeSendFeedbackCall()).toBe(false)
  })

  test('Cgr leftover notice_pending then silent after prompt cap', () => {
    const first = queueFeedbackDraftNotice({
      draftId: 'a',
      title: 'one',
      type: 'bug',
      detailsPreview: 'p',
    })
    expect(first).toBe('notice_pending')
    expect(getFeedbackNoticeState().sessionDraftCount).toBe(1)
    expect(getFeedbackNoticeState().notice?.draftId).toBe('a')
    expect(
      queueFeedbackDraftNotice({
        draftId: 'b',
        title: 'two',
        type: 'idea',
        detailsPreview: 'q',
      }),
    ).toBe('notice_pending')
    expect(getFeedbackNoticeState().notice?.draftId).toBe('b')
    expect(getFeedbackNoticeState().sessionDraftCount).toBe(2)
  })

  test('Owc leftover logs shown once; Mwc clears notice', () => {
    queueFeedbackDraftNotice({
      draftId: 'shown',
      title: 't',
      type: 'bug',
      detailsPreview: 'p',
    })
    expect(markFeedbackNoticeShown('shown')).toBe(true)
    expect(markFeedbackNoticeShown('shown')).toBe(false)
    clearFeedbackNotice()
    expect(getFeedbackNoticeState().notice).toBeNull()
  })

  test('Dwc/$wc leftover seed once from disk', () => {
    expect(tryStartFeedbackDraftSeed()).toBe(true)
    expect(tryStartFeedbackDraftSeed()).toBe(false)
    seedSessionDraftCount(4)
    expect(getFeedbackNoticeState().sessionDraftCount).toBe(4)
    seedSessionDraftCount(1)
    expect(getFeedbackNoticeState().sessionDraftCount).toBe(4)
  })

  test('Lwc leftover replaces the seeded this-session count', () => {
    seedSessionDraftCount(4)
    setSeededSessionDraftCount(1)
    expect(getFeedbackNoticeState().sessionDraftCount).toBe(1)
    expect(getFeedbackNoticeState().seededFromDisk).toBe(true)
    setSeededSessionDraftCount(0)
    expect(getFeedbackNoticeState().sessionDraftCount).toBe(0)
  })

  test('W leftover decrements this-session draft count', () => {
    seedSessionDraftCount(2)
    decrementSessionDraftCount(1)
    expect(getFeedbackNoticeState().sessionDraftCount).toBe(1)
    decrementSessionDraftCount(1)
    expect(getFeedbackNoticeState().sessionDraftCount).toBe(0)
    decrementSessionDraftCount(1)
    expect(getFeedbackNoticeState().sessionDraftCount).toBe(0)
  })

  test('vqe leftover turn-off prompt is under cap before declines', () => {
    expect(canShowFeedbackTurnOffPrompt()).toBe(true)
  })

  test('sr leftover field order and helpers', () => {
    expect(reviewFieldIds({ transcriptAvailable: true })).toEqual([
      'type',
      'title',
      'area',
      'failure_mode',
      'task_category',
      'details',
      'transcript',
      'send',
    ])
    expect(reviewFieldIds({ transcriptAvailable: false })).toEqual([
      'type',
      'title',
      'area',
      'failure_mode',
      'task_category',
      'details',
      'send',
    ])
    expect(formatFeedbackEnumValue(undefined)).toBe('(none)')
    expect(formatFeedbackEnumValue('code_edit')).toBe('code edit')
    expect(
      formatDraftAge(
        '2026-01-01T00:00:00.000Z',
        Date.parse('2026-01-01T00:03:00.000Z'),
      ),
    ).toBe('3m')
    expect(
      formatDraftAge(
        '2026-01-01T00:00:00.000Z',
        Date.parse('2026-01-01T05:00:00.000Z'),
      ),
    ).toBe('5h')
    expect(
      formatDraftAge(
        '2026-01-01T00:00:00.000Z',
        Date.parse('2026-01-03T00:00:00.000Z'),
      ),
    ).toBe('2d')
    expect(sanitizeFeedbackField('a\r\nb', true)).toBe('a\nb')
    expect(sanitizeFeedbackField('a\r\nb', false)).toBe('a b')
  })

  test('ogr leftover corroborates sessionId+cwd jsonl', () => {
    const draft = createFeedbackDraft({
      type: 'bug',
      title: 't',
      details: 'd',
      trigger: 'model_judgment',
      requestIds: ['r'],
      sessionId: 'sess',
      cwd: '/tmp',
      model: 'claude',
      cliVersion: '2.1.247',
      os: 'win32',
    })
    expect(
      transcriptContentCorroboratesDraft(
        `${JSON.stringify({ sessionId: 'sess', cwd: '/tmp' })}\n`,
        draft,
      ),
    ).toBe(true)
    expect(
      transcriptContentCorroboratesDraft(
        `${JSON.stringify({ sessionId: 'other', cwd: '/tmp' })}\n`,
        draft,
      ),
    ).toBe(false)
  })

  test('Dfs leftover rebuilds path from session id not session_file', async () => {
    const same = createFeedbackDraft({
      type: 'bug',
      title: 't',
      details: 'd',
      trigger: 'model_judgment',
      requestIds: ['r'],
      sessionId: getSessionId(),
      cwd: '/tmp',
      model: 'claude',
      cliVersion: '2.1.247',
      os: 'win32',
      transcriptFile: 'C:/ign_ored/session.jsonl',
    })
    expect(await resolveDraftTranscriptPath(same)).toBe(
      getTranscriptPathForSession(getSessionId()),
    )
    const keyed = createFeedbackDraft({
      type: 'bug',
      title: 't',
      details: 'd',
      trigger: 'model_judgment',
      requestIds: ['r'],
      sessionId: 'other-sess',
      cwd: '/tmp',
      model: 'claude',
      cliVersion: '2.1.247',
      os: 'win32',
      transcriptFile: join('/projects', 'my-proj', 'other-sess.jsonl'),
    })
    expect(keyed.transcript_ref?.project_dir_key).toBe('my-proj')
    expect(await resolveDraftTranscriptPath(keyed)).toBe(
      join(getProjectsDir(), 'my-proj', 'other-sess.jsonl'),
    )
    const cwdOnly = createFeedbackDraft({
      type: 'bug',
      title: 't',
      details: 'd',
      trigger: 'model_judgment',
      requestIds: ['r'],
      sessionId: 'other-sess',
      cwd: '/tmp',
      model: 'claude',
      cliVersion: '2.1.247',
      os: 'win32',
      transcriptFile: 'C:/ign_ored/session.jsonl',
    })
    expect(cwdOnly.transcript_ref?.project_dir_key).toBeUndefined()
    expect(await resolveDraftTranscriptPath(cwdOnly)).toBe(
      join(getProjectDir('/tmp'), 'other-sess.jsonl'),
    )
    expect(
      await resolveDraftTranscriptPath({ ...cwdOnly, transcript_ref: null }),
    ).toBeNull()
  })

  test('Lfs leftover maps projectsDir jsonl to transcript key', () => {
    const root = getProjectsDir()
    expect(
      transcriptAbsPathToStorageKey(join(root, 'proj', 'sid.jsonl'), root),
    ).toEqual({
      namespace: 'transcript',
      projectKey: 'proj',
      sessionId: 'sid',
    })
    expect(
      transcriptAbsPathToStorageKey(join(root, 'proj', 'sid.txt'), root),
    ).toBeUndefined()
  })

  test('Lfs DE leftover rejects ol-pass keys that fail validateStorageKey', () => {
    const root = getProjectsDir()
    expect(
      transcriptAbsPathToStorageKey(join(root, 'proj', '\t.jsonl'), root),
    ).toBeUndefined()
    expect(
      transcriptAbsPathToStorageKey(join(root, 'proj', 'memory.jsonl'), root),
    ).toBeUndefined()
  })

  test('Ri leftover drops torn first line only when tail-capped', () => {
    expect(dropTornTranscriptHead('abc', 3, 3)).toBe('abc')
    expect(dropTornTranscriptHead('torn\nkeep', 4, 9)).toBe('keep')
  })

  test('Nfs leftover stats Dfs path and ogr-tails other sessions', async () => {
    const other = createFeedbackDraft({
      type: 'bug',
      title: 't',
      details: 'd',
      trigger: 'model_judgment',
      requestIds: ['r'],
      sessionId: 'nfs-avail-sess',
      cwd: '/tmp',
      model: 'claude',
      cliVersion: '2.1.247',
      os: 'win32',
      transcriptFile: 'C:/ign_ored/session.jsonl',
    })
    const file = await resolveDraftTranscriptPath(other)
    if (file === null) throw new Error('Dfs null')
    await unlink(file).catch(() => undefined)
    expect(await isFeedbackDraftTranscriptAvailable(other)).toBe(false)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(
      file,
      `${JSON.stringify({ sessionId: 'nfs-avail-sess', cwd: '/tmp' })}\n`,
    )
    expect(await isFeedbackDraftTranscriptAvailable(other)).toBe(true)
    await writeFile(
      file,
      `${JSON.stringify({ sessionId: 'wrong', cwd: '/tmp' })}\n`,
    )
    expect(await isFeedbackDraftTranscriptAvailable(other)).toBe(false)
    await unlink(file).catch(() => undefined)
  })
})
