/**
 * densable 2.1.236 #23 — always force --untracked-files on auto-mode git status.
 *
 * Do NOT mock autoModeFlags (process-global mock.module pollution). Drive flags
 * via env so real resolvers + porcelain helpers stay intact for sibling suites.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import * as realExecFileNoThrow from '../../execFileNoThrow.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

const execMock = mock(
  async (
    _cmd: string,
    args: string[],
    _opts?: unknown,
  ): Promise<{ code: number; stdout: string; stderr: string }> => {
    lastArgs = args
    return { code: 0, stdout: '', stderr: '' }
  },
)
let lastArgs: string[] = []

const execSnap = snapshotModuleExports(realExecFileNoThrow)
// Keep full export surface — incomplete mocks poison sibling imports.
function execFileNoThrowModule() {
  return {
    ...execSnap,
    execFileNoThrow: execMock,
    execFileNoThrowWithCwd: execMock,
  }
}
mock.module('../../execFileNoThrow.js', execFileNoThrowModule)
mock.module('src/utils/execFileNoThrow.js', execFileNoThrowModule)
mock.module('src/utils/execFileNoThrow.ts', execFileNoThrowModule)
afterAll(() => {
  const restore = () => ({ ...execSnap })
  mock.module('../../execFileNoThrow.js', restore)
  mock.module('src/utils/execFileNoThrow.js', restore)
  mock.module('src/utils/execFileNoThrow.ts', restore)
})

const { fetchAutoModeGitStatus } = await import('../autoModeGitStatus.js')

describe('autoModeGitStatus untracked force (densable 236)', () => {
  beforeEach(() => {
    lastArgs = []
    process.env.CLAUDE_CODE_AUTO_MODE_GIT_STATUS = '1'
    delete process.env.CLAUDE_CODE_AUTO_MODE_GIT_STATUS_UPLOADS
  })

  afterEach(() => {
    delete process.env.CLAUDE_CODE_AUTO_MODE_GIT_STATUS
    delete process.env.CLAUDE_CODE_AUTO_MODE_GIT_STATUS_UPLOADS
  })

  test('always passes --untracked-files even when wantUploads is false', async () => {
    await fetchAutoModeGitStatus('Bash', {
      command: 'rm -rf build',
    })
    expect(lastArgs.includes('--untracked-files=normal')).toBe(true)
    expect(lastArgs.includes('--porcelain')).toBe(true)
  })
})
