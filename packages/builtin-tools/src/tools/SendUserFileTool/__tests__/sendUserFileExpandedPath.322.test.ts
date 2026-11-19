import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setCwdState } from 'src/bootstrap/state.js'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import { getCwd } from 'src/utils/cwd.js'
import { SendUserFileTool } from '../SendUserFileTool.js'

describe('#1768 SendUserFileTool uses validated expanded path for stat and upload', () => {
  const prevCwd = getCwd()
  const tempDirs: string[] = []

  afterEach(() => {
    setCwdState(prevCwd)
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true })
    }
  })

  test('stats file via expanded path when getCwd() differs from process.cwd()', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'send-user-file-1768-'))
    tempDirs.push(dir)
    const fileName = 'unique-expanded-only-1768.txt'
    writeFileSync(join(dir, fileName), 'hello world')

    // Point session cwd to temp dir WITHOUT calling process.chdir(dir):
    // `stat(fileName)` would fail with ENOENT, while `stat(expandPath(fileName))`
    // resolves against `getCwd()` and succeeds.
    setCwdState(dir)

    const result = await SendUserFileTool.call({ file_path: fileName }, {
      getAppState: () => ({
        replBridgeEnabled: false,
        toolPermissionContext: getEmptyToolPermissionContext(),
      }),
      abortController: new AbortController(),
    } as never)

    expect(result.data.sent).toBe(true)
    expect(result.data.size).toBe(11)
    expect(result.data.error).toBeUndefined()
  })
})
