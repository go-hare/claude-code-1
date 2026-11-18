import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { codeReview } from '../../commands/codeReview.js'
import type { BgJobState } from '../../daemon/jobState.js'
import {
  checkSyncReuseWithinMs,
  settleSyncReuseStamp,
} from '../accountSkillsSyncVeto.js'
import {
  CLASSIFIER_HAND_OFF_ADDENDUM,
  classifyWaitingOnYouContext,
  isHandedOverForUserMergeOrReview,
  jobNeedsInput,
} from '../fleetNeedsInputNudge.js'
import {
  getSessionRefsStore,
  inspectPluginHooksUnloadableGuards,
  resetSessionRefsStoreForTests,
  setSkillManifestGsGetForTests,
  UNLOADABLE_GUARD_REASON,
} from '../plugins/sessionRefsManifest.js'
import {
  getResumeHeadPath,
  RESUME_HEAD_WINDOW_BYTES,
  resumeHeadSha256,
  serializeResumeHead,
  tryLoadResumeHeadRows,
} from '../sessionStorage.js'
import {
  getSessionTaskListId,
  persistSessionTaskListId,
  resetTaskListState,
  restoreSessionTaskListId,
  setSessionTaskListId,
} from '../tasks.js'

describe('Group 4 2.1.310-2.1.314 alignment', () => {
  let tempDir: string | undefined
  const origConfigDir = process.env.CLAUDE_CONFIG_DIR

  afterEach(() => {
    resetTaskListState()
    resetSessionRefsStoreForTests()
    if (origConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = origConfigDir
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  test('#1205: tryLoadResumeHeadRows loads preserved rows & post-boundary tail and falls back on probe mismatch', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'resume-head-'))
    const sid = '11111111-1111-4111-8111-111111111111'
    const projSubDir = join(tempDir, 'proj')
    mkdirSync(projSubDir, { recursive: true })
    const transcriptPath = join(projSubDir, `${sid}.jsonl`)
    const row0 = '{"type":"summary","summary":"s1"}\n'
    const padding = 'x'.repeat(RESUME_HEAD_WINDOW_BYTES * 5)
    const boundary = '{"type":"system","subtype":"compact_boundary"}\n'
    const tail = '{"type":"user","message":{"role":"user","content":"hi"}}\n'
    const transcriptBuf = Buffer.from(row0 + padding + boundary + tail, 'utf8')
    writeFileSync(transcriptPath, transcriptBuf)

    const boundaryOffset = Buffer.byteLength(row0 + padding, 'utf8')
    const boundaryLength = Buffer.byteLength(boundary, 'utf8')
    const headBuf = serializeResumeHead({
      boundaryOffset,
      boundaryLength,
      probe: resumeHeadSha256(
        transcriptBuf.subarray(boundaryOffset, boundaryOffset + boundaryLength),
      ),
      rowOffsets: [0],
      rowLengths: [Buffer.byteLength(row0, 'utf8') - 1],
      generation: 1,
    })
    const headPath = getResumeHeadPath(transcriptPath, tempDir)!
    mkdirSync(join(projSubDir, sid), { recursive: true })
    writeFileSync(headPath, headBuf)

    const loaded = await tryLoadResumeHeadRows(
      transcriptPath,
      transcriptBuf.length,
    )
    expect(loaded).not.toBeNull()
    expect(loaded!.postBoundaryBuf.toString('utf8')).toBe(boundary + tail)
    const scanned: string[] = []
    loaded!.preservedRows.scan((buf, start, len) => {
      scanned.push(buf.toString('utf8', start, start + len))
    })
    expect(scanned).toEqual(['{"type":"summary","summary":"s1"}'])

    // Corrupt probe -> returns null so caller falls back
    writeFileSync(
      headPath,
      serializeResumeHead({
        boundaryOffset,
        boundaryLength,
        probe: '0'.repeat(64),
        rowOffsets: [0],
        rowLengths: [Buffer.byteLength(row0, 'utf8') - 1],
        generation: 1,
      }),
    )
    const mismatch = await tryLoadResumeHeadRows(
      transcriptPath,
      transcriptBuf.length,
    )
    expect(mismatch).toBeNull()
  })

  test('#1252: persistSessionTaskListId and restoreSessionTaskListId roundtrip & main.tsx wiring', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'task-list-persist-'))
    process.env.CLAUDE_CONFIG_DIR = tempDir
    const sid = '22222222-2222-4222-8222-222222222222'
    setSessionTaskListId('team-alpha-list')
    await persistSessionTaskListId(sid)

    resetTaskListState()
    expect(getSessionTaskListId()).toBeUndefined()

    const restored = await restoreSessionTaskListId(sid)
    expect(restored).toBe('team-alpha-list')
    expect(getSessionTaskListId()).toBe('team-alpha-list')

    const mainSrc = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
    expect(mainSrc).toContain('restoreSessionTaskListId(getSessionId())')
    expect(mainSrc).toContain('CLAUDE_INTERNAL_SESSION_TASK_LIST_ID')
  })

  test('#1292: main.tsx deduplicates invalid permission rule warnings via filterUnseenSecurityWarnings', () => {
    const mainSrc = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
    expect(mainSrc).toContain('filterUnseenSecurityWarnings(keyedErrors)')
    expect(mainSrc).toContain('markSecurityWarningsSeen(seenKeys)')
  })

  test('#1293: codeReview puts effort level first and restricts max to explicit requests', () => {
    expect(codeReview.description).toContain(
      'at the effort level given first, before any target',
    )
    expect(codeReview.whenToUse).toContain('explicitly ask for')
    expect(codeReview.whenToUse).toContain('never on your own judgment')
  })

  test('#1296: 10-minute cross-session sync reuse stamp write and checkSyncReuseWithinMs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'skills-sync-stamp-'))
    const stamp = await settleSyncReuseStamp(
      tempDir,
      'skills',
      true,
      null,
      'org-bucket',
    )
    expect(stamp).not.toBeNull()
    expect(stamp!.listedFor).toEqual(['org-bucket'])

    const fresh = await checkSyncReuseWithinMs(tempDir, 600_000)
    expect(fresh.reuse).toBe(true)

    const stale = await checkSyncReuseWithinMs(
      tempDir,
      600_000,
      Date.now() + 700_000,
    )
    expect(stale).toEqual({ reuse: false })
  })

  test('#1317: HeadlessControlPlane claude_authenticate refreshes policy limits after OAuth install', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/cli/headless/HeadlessControlPlane.ts'),
      'utf8',
    )
    expect(src).toContain('refreshPolicyLimits()')
    expect(src).toContain('claude_authenticate: the policy refresh threw')
  })

  test('#1325: CLASSIFIER_HAND_OFF_ADDENDUM and waiting-on-you context classification', () => {
    expect(CLASSIFIER_HAND_OFF_ADDENDUM).toContain(
      "HANDED OVER FOR THE USER'S OWN MERGE OR REVIEW",
    )
    expect(
      classifyWaitingOnYouContext(
        'Nothing new on PR #212: it is still green, approved and free of conflicts, waiting on you to merge.',
      ),
    ).toBe('done')
    expect(
      isHandedOverForUserMergeOrReview(
        'PR #212 is waiting on you to merge. Once it is in, tell me and I will rebase #213 onto it.',
      ),
    ).toBe(false)
    expect(
      classifyWaitingOnYouContext(
        'PR #212 is waiting on you to merge. Once it is in, tell me and I will rebase #213 onto it.',
      ),
    ).toBe('blocked')

    const doneHandOffJob = {
      state: 'done',
      tempo: 'blocked',
      detail: 'PR #212 is ready for you to merge',
      children: null,
    } as unknown as BgJobState
    expect(jobNeedsInput(doneHandOffJob)).toBe(false)
  })

  test('#1367: remoteControlFlags wires canPromptForRemoteControlTrust into enterRemoteControl', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/entrypoints/remoteControlFlags.ts'),
      'utf8',
    )
    expect(src).toContain('ensureRemoteControlTrust')
    expect(src).toContain('await canPromptForRemoteControlTrust(env)')
  })

  test('#1369: sessionRefsManifest tracks isPinnedPluginListFailed and quarantines unloadableGuard hooks', async () => {
    const store = getSessionRefsStore()
    setSkillManifestGsGetForTests(async () => ({
      ok: false,
      reason: 'network',
    }))
    const failed = await store.listEntries('plugins')
    expect(failed.success).toBe(false)
    expect(store.isPinnedPluginListFailed).toBe(true)
    expect(
      store.isPluginAllowedByPinnedList({
        pluginId: 'p1',
        name: 'my-plugin',
        viaCodeRail: false,
      }),
    ).toBe(true)
    expect(
      store.isPluginAllowedByPinnedList({
        pluginId: 'p2',
        name: 'rail-plugin',
        viaCodeRail: true,
      }),
    ).toBe(false)

    const guardCheck = inspectPluginHooksUnloadableGuards(
      {
        PreToolUse: [{ hooks: 'not-an-array' }],
        BadEvent: [{ matcher: 'Bash', hooks: [] }],
      },
      new Set(['PreToolUse', 'PermissionRequest']),
    )
    expect(guardCheck.unloadableGuards).toHaveLength(2)
    expect(UNLOADABLE_GUARD_REASON).toContain('PreToolUse/PermissionRequest')
  })

  test('#1373: print.ts wires settleUltracodeActive after syncWorkerPermissionModeRecord', () => {
    const printSrc = readFileSync(
      join(process.cwd(), 'src/cli/print.ts'),
      'utf8',
    )
    expect(printSrc).toContain('settleUltracodeActive(')
  })
})
