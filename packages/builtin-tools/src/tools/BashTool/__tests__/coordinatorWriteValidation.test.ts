import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { resetFileLockStateForTests } from 'src/coordinator/fileLockManager.js'
import { runWithAgentContext } from 'src/utils/agentContext.js'
import { expandPath } from 'src/utils/path.js'
import * as realCoordinatorMode from 'src/coordinator/coordinatorMode.js'
import { snapshotModuleExports } from '../../../../../../tests/mocks/settings.js'

// Snapshot BEFORE mock. Re-apply in beforeEach so processBashCommand / others
// that last-write BashTool or coordinatorMode cannot skip the write guard.
const coordinatorModeSnap = snapshotModuleExports(realCoordinatorMode)
function coordinatorModeMock() {
  return {
    ...coordinatorModeSnap,
    isCoordinatorMode: () => true,
    getWorkerAntiInjectionAddendum: () => '',
  }
}
mock.module('src/coordinator/coordinatorMode.js', coordinatorModeMock)
afterAll(() => {
  mock.module('src/coordinator/coordinatorMode.js', () => ({
    ...coordinatorModeSnap,
  }))
})

const { validateCoordinatorBashWriteAccess } = await import(
  '../coordinatorWriteValidation.js'
)

function validateAsWorker(command: string, agentId = 'worker-1') {
  return runWithAgentContext(
    {
      agentId,
      agentType: 'subagent',
    },
    () => validateCoordinatorBashWriteAccess(command, agentId),
  )
}

describe('validateCoordinatorBashWriteAccess', () => {
  beforeEach(() => {
    resetFileLockStateForTests()
    mock.module('src/coordinator/coordinatorMode.js', coordinatorModeMock)
  })

  test('validates output redirection targets through the coordinator write guard', async () => {
    const result = await validateAsWorker('printf ok > owned.txt')

    expect(result.result).toBe(true)
  })

  test('allows a second worker writing a file another worker already wrote', async () => {
    const first = await validateAsWorker(
      `printf ok > ${expandPath('shared.txt')}`,
      'worker-1',
    )
    expect(first.result).toBe(true)

    const result = await validateAsWorker(
      `printf ok > ${expandPath('shared.txt')}`,
      'worker-2',
    )

    expect(result.result).toBe(true)
  })

  test('allows heredoc output redirection after another worker wrote the same path', async () => {
    const first = await validateAsWorker(
      `printf ok > ${expandPath('shared.txt')}`,
      'worker-1',
    )
    expect(first.result).toBe(true)

    const result = await validateAsWorker(
      `cat <<'EOF' > ${expandPath('shared.txt')}\ncontent\nEOF`,
      'worker-2',
    )

    expect(result.result).toBe(true)
  })

  test('rejects inline interpreter writes that cannot be statically targeted', async () => {
    const result = await validateAsWorker(
      `python -c "open('other.txt', 'w').write('x')"`,
    )

    expect(result.result).toBe(false)
    if (result.result) {
      throw new Error('expected inline interpreter rejection')
    }
    expect(result.message).toContain('statically valid target paths')
  })

  test('rejects heredoc-fed interpreter writes that cannot be statically targeted', async () => {
    const result = await validateAsWorker(
      "python - <<'PY'\nopen('other.txt', 'w').write('x')\nPY",
    )

    expect(result.result).toBe(false)
    if (result.result) {
      throw new Error('expected heredoc interpreter rejection')
    }
    expect(result.message).toContain('statically valid target paths')
  })

  test('rejects perl inline open writes that cannot be statically targeted', async () => {
    const result = await validateAsWorker(
      `perl -e "open(my $fh, '>', 'other.txt')"`,
    )

    expect(result.result).toBe(false)
    if (result.result) {
      throw new Error('expected perl inline write rejection')
    }
    expect(result.message).toContain('statically valid target paths')
  })

  test('allows inline interpreter reads without write patterns', async () => {
    const result = await validateAsWorker(
      `python -c "print(open('other.txt').read())"`,
    )

    expect(result.result).toBe(true)
  })

  test('validates nested shell -c write targets through the coordinator write guard', async () => {
    const first = await validateAsWorker(
      `printf ok > ${expandPath('shared.txt')}`,
      'worker-1',
    )
    expect(first.result).toBe(true)

    const result = await validateAsWorker(
      `bash -lc 'printf ok > ${expandPath('shared.txt')}'`,
      'worker-2',
    )

    expect(result.result).toBe(true)
  })

  test('allows nested shell -c writes when the path is unlocked', async () => {
    const result = await validateAsWorker(`sh -c 'printf ok > owned.txt'`)

    expect(result.result).toBe(true)
  })

  test('validates tee output targets through the coordinator write guard', async () => {
    const first = await validateAsWorker(
      `printf ok > ${expandPath('shared.txt')}`,
      'worker-1',
    )
    expect(first.result).toBe(true)

    const result = await validateAsWorker(
      `printf ok | tee ${expandPath('shared.txt')}`,
      'worker-2',
    )

    expect(result.result).toBe(true)
  })

  test('does not treat option values as write targets for common write commands', async () => {
    const result = await validateAsWorker('touch -r ref.txt owned.txt')

    expect(result.result).toBe(true)
  })

  test('validates sed in-place targets without treating expressions as files', async () => {
    const result = await validateAsWorker(`sed -i -e 's/a/b/' owned.txt`)

    expect(result.result).toBe(true)
  })

  test('allows output redirection to null devices', async () => {
    const result = await validateAsWorker('printf ok > /dev/null')

    expect(result.result).toBe(true)
  })

  test('rejects relative write targets after directory changes', async () => {
    const result = await validateAsWorker('cd subdir && printf ok > owned.txt')

    expect(result.result).toBe(false)
    if (result.result) {
      throw new Error('expected directory change rejection')
    }
    expect(result.message).toContain('directory changes')
  })

  test('BashTool.call returns coordinator rejection before shell execution', async () => {
    const { BashTool } = await import('../BashTool.js')

    const result = await runWithAgentContext(
      {
        agentId: 'worker-1',
        agentType: 'subagent',
      },
      () =>
        (BashTool.call as any)(
          {
            command: `python -c "open('other.txt', 'w').write('x')"`,
          },
          {
            agentId: 'worker-1',
            abortController: new AbortController(),
            getAppState: () => ({
              toolPermissionContext: { mode: 'default' },
            }),
            setAppState: () => {},
            setToolJSX: () => {},
          },
        ),
    )

    expect(result.data.stderr).toContain('statically valid target paths')
    expect(result.data.stderr).toContain('Exit code 1')
  })
})
