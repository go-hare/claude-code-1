import { afterEach, describe, expect, test } from 'bun:test'
import {
  _resetBgNeedsInputBridgeForTests,
  budgetProgressKey,
  DIALOG_NEEDS_BY_KIND,
  emitBgNeedsFromDialogKind,
  emitBgNeedsInput,
  fanItemsKey,
  formatMcpElicitationNeeds,
  formatPermissionNeeds,
  formatSandboxNeeds,
  getBgInFlightRegistry,
  getBgNeedsInputSnapshot,
  MANAGED_SETTINGS_NEEDS,
  MCP_URL_ELICITATION_NEEDS,
  mergeWorktreeMetaForJob,
  setBgInFlightRegistry,
  snapshotInFlight,
  subscribeBgInFlight,
  subscribeBgNeedsInput,
} from '../bgNeedsInputBridge.js'

describe('bgNeedsInputBridge densable Vce', () => {
  afterEach(() => {
    _resetBgNeedsInputBridgeForTests()
  })

  test('priority: sandbox beats elicitation', () => {
    emitBgNeedsInput(formatMcpElicitationNeeds('srv'), 'elicitation')
    emitBgNeedsInput(formatSandboxNeeds('api.example.com'), 'sandbox')
    expect(getBgNeedsInputSnapshot()?.text).toBe(
      'allow network: api.example.com',
    )
  })

  test('clear source falls back to next', () => {
    emitBgNeedsInput(formatSandboxNeeds('h'), 'sandbox')
    emitBgNeedsInput(MANAGED_SETTINGS_NEEDS, 'managed-settings')
    emitBgNeedsInput(null, 'sandbox')
    expect(getBgNeedsInputSnapshot()?.text).toBe(MANAGED_SETTINGS_NEEDS)
  })

  test('subscribe receives updates', () => {
    const seen: Array<string | null> = []
    const unsub = subscribeBgNeedsInput(p => seen.push(p?.text ?? null))
    emitBgNeedsInput(formatMcpElicitationNeeds('mcp'), 'elicitation')
    emitBgNeedsInput(null, 'elicitation')
    unsub()
    expect(seen).toEqual(['MCP input: mcp', null])
  })

  test('permission beats dialog; managed-settings beats permission', () => {
    emitBgNeedsInput('approve Bash: ls', 'permission')
    emitBgNeedsInput(MCP_URL_ELICITATION_NEEDS, 'dialog')
    expect(getBgNeedsInputSnapshot()?.text).toBe('approve Bash: ls')
    emitBgNeedsInput(MANAGED_SETTINGS_NEEDS, 'managed-settings')
    expect(getBgNeedsInputSnapshot()?.text).toBe(MANAGED_SETTINGS_NEEDS)
  })

  test('formatPermissionNeeds densable P1u', () => {
    expect(
      formatPermissionNeeds({
        toolName: 'ExitPlanMode',
      }),
    ).toBe('approve plan')
    expect(
      formatPermissionNeeds({
        toolName: 'Bash',
        userFacingName: 'Bash',
        input: { command: 'ls -la' },
      }),
    ).toBe('approve Bash: ls -la')
    expect(
      formatPermissionNeeds({
        toolName: 'Read',
        userFacingName: 'Read',
        input: { file_path: '/tmp/a' },
      }),
    ).toBe('approve Read: /tmp/a')
  })

  test('UIb dialog kinds densable msf dialog source', () => {
    expect(DIALOG_NEEDS_BY_KIND.refusal_fallback_prompt).toBe(
      'choose: retry on fallback model or edit prompt',
    )
    expect(DIALOG_NEEDS_BY_KIND.fable_overage_consent_prompt).toContain(
      'Fable 5',
    )
    expect(DIALOG_NEEDS_BY_KIND.mcp_url_elicitation).toBe(
      MCP_URL_ELICITATION_NEEDS,
    )
    emitBgNeedsFromDialogKind('refusal_fallback_prompt')
    expect(getBgNeedsInputSnapshot()?.text).toBe(
      'choose: retry on fallback model or edit prompt',
    )
    emitBgNeedsFromDialogKind(null)
    expect(getBgNeedsInputSnapshot()).toBeNull()
  })
})

describe('bgNeedsInputBridge densable tDt/shs/ihs', () => {
  afterEach(() => {
    _resetBgNeedsInputBridgeForTests()
  })

  test('tDt snapshotInFlight reflects shs registry', () => {
    setBgInFlightRegistry({
      tasks: 2,
      queued: 1,
      kinds: ['local_agent', 'local_bash'],
    })
    expect(snapshotInFlight()).toEqual({
      tasks: 2,
      queued: 1,
      kinds: ['local_agent', 'local_bash'],
    })
    expect(getBgInFlightRegistry().tasks).toBe(2)
  })

  test('shs emits ihs subscribers', () => {
    let n = 0
    const unsub = subscribeBgInFlight(() => {
      n++
    })
    setBgInFlightRegistry({ tasks: 1, queued: 0, kinds: ['local_agent'] })
    setBgInFlightRegistry({ tasks: 2, queued: 0, kinds: ['local_agent'] })
    unsub()
    expect(n).toBe(2)
  })

  test('shs full replace clears items/budget (densable t7r=e)', () => {
    setBgInFlightRegistry({
      tasks: 1,
      queued: 0,
      kinds: ['local_agent'],
      items: [{ id: 'x' }],
      budget: { spent: 1, target: 10 },
    })
    expect(getBgInFlightRegistry().items).toEqual([{ id: 'x' }])
    expect(getBgInFlightRegistry().budget).toEqual({ spent: 1, target: 10 })
    // densable shs replaces entire t7r — omitted items/budget do not stick
    setBgInFlightRegistry({ tasks: 0, queued: 0, kinds: [] })
    const reg = getBgInFlightRegistry()
    expect(reg).toEqual({
      tasks: 0,
      queued: 0,
      kinds: [],
      items: [],
      budget: undefined,
    })
    expect(snapshotInFlight()).toEqual({ tasks: 0, queued: 0, kinds: [] })
  })

  test('Jat fanItemsKey and Xat budgetProgressKey densable', () => {
    expect(fanItemsKey([])).toBe('')
    expect(
      fanItemsKey([
        { id: 'a', doneAt: 1, kind: 'todo', startedAt: 0 },
        { id: 'b', failed: true },
      ]),
    ).toBe('a:1::0|b:-:x')
    expect(budgetProgressKey(undefined)).toBe(-1)
    expect(budgetProgressKey({ spent: 50, target: 100 })).toBe(10)
  })

  test('l7r mergeWorktreeMetaForJob', () => {
    expect(
      mergeWorktreeMetaForJob(
        { worktreePath: '/w', worktreeBranch: 'b', worktreeHookBased: true },
        {},
      ),
    ).toEqual({
      worktreePath: '/w',
      worktreeBranch: 'b',
      worktreeHookBased: true,
    })
    expect(
      mergeWorktreeMetaForJob(null, {
        worktreePath: '/w',
        worktreeBranch: 'b',
      }),
    ).toEqual({
      worktreePath: undefined,
      worktreeBranch: undefined,
      worktreeHookBased: undefined,
    })
    expect(
      mergeWorktreeMetaForJob(
        { enteredExisting: true, worktreePath: '/x' },
        { worktreePath: '/w' },
      ),
    ).toEqual({
      worktreePath: undefined,
      worktreeBranch: undefined,
      worktreeHookBased: undefined,
    })
  })
})
