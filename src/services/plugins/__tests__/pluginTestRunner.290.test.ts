import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  PLUGIN_TEST_USAGE,
  REPORT_MARK,
  discoverPluginTestFiles,
  formatTestFileReport,
  parseChildReport,
  pluginTestFormOf,
  pluginTestMain,
  runChild,
} from '../../../cli/handlers/plugins.js'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('v2.1.290 #77 claude plugin test (pluginTestMain)', () => {
  test('pluginTestFormOf classifies --file, flags, and positional runs', () => {
    expect(pluginTestFormOf(['--file', 'a.test.ts', '.'])).toBe('file')
    expect(pluginTestFormOf(['--help'])).toBe('other')
    expect(pluginTestFormOf(['./my-mod'])).toBe('run')
    expect(pluginTestFormOf([])).toBe('run')
  })

  test('--help prints PLUGIN_TEST_USAGE and exits 0', async () => {
    let out = ''
    const code = await pluginTestMain(['--help'], {
      write: chunk => {
        out += chunk
      },
    })
    expect(code).toBe(0)
    expect(out).toBe(PLUGIN_TEST_USAGE)
    expect(out).toContain("imports its kit from 'claude-code/testing'")
  })

  test('discoverPluginTestFiles finds *.test.ts/*.test.tsx and skips node_modules and dotdirs', async () => {
    const root = makeTempDir('plugin-test-discover-')
    mkdirSync(join(root, 'hooks'), { recursive: true })
    mkdirSync(join(root, 'node_modules/pkg'), { recursive: true })
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, 'hooks/b.test.tsx'), '')
    writeFileSync(join(root, 'hooks/a.test.ts'), '')
    writeFileSync(join(root, 'hooks/helper.ts'), '')
    writeFileSync(join(root, 'node_modules/pkg/ignored.test.ts'), '')
    writeFileSync(join(root, '.git/ignored.test.ts'), '')

    const files = await discoverPluginTestFiles(root)
    expect(files).toEqual([
      join(root, 'hooks/a.test.ts'),
      join(root, 'hooks/b.test.tsx'),
    ])
  })

  test('parseChildReport & formatTestFileReport handle pass, fail, and missing report', () => {
    const missing = parseChildReport('/mod/a.test.ts', 'no marker', 1)
    expect(missing.error).toBe('its run ended without a report (exit code 1)')

    const validLine = `${REPORT_MARK}${JSON.stringify({
      file: '/mod/a.test.ts',
      results: [{ title: 'works', ms: 1.5, failure: null, advice: [] }],
    })}\n`
    const ok = parseChildReport('/mod/a.test.ts', validLine, 0)
    expect(ok.results).toHaveLength(1)
    expect(formatTestFileReport(ok, '/mod')).toContain('(pass) works [1.50ms]')

    const lateCrash = parseChildReport('/mod/a.test.ts', validLine, 2)
    expect(lateCrash.results).toHaveLength(2)
    expect(lateCrash.results[1]!.failure).toContain(
      'its run exited with code 2 after reporting',
    )
  })

  test('pluginTestMain runs discovered files, prints summary, and returns 0/1', async () => {
    const root = makeTempDir('plugin-test-run-')
    writeFileSync(join(root, 'one.test.ts'), '')
    writeFileSync(join(root, 'two.test.ts'), '')

    let out = ''
    const passCode = await pluginTestMain([root], {
      write: c => {
        out += c
      },
      runFile: async (_r, file) => ({
        file,
        results: [{ title: 'passes', ms: 2, failure: null, advice: [] }],
      }),
    })
    expect(passCode).toBe(0)
    expect(out).toContain('2 pass')
    expect(out).toContain('0 fail')
    expect(out).toContain('Ran 2 tests across 2 files.')

    let failOut = ''
    const failCode = await pluginTestMain([root], {
      write: c => {
        failOut += c
      },
      runFile: async (_r, file) => ({
        file,
        results: file.endsWith('one.test.ts')
          ? [{ title: 'passes', ms: 1, failure: null, advice: [] }]
          : [{ title: 'fails', ms: 1, failure: 'boom', advice: [] }],
      }),
    })
    expect(failCode).toBe(1)
    expect(failOut).toContain('1 pass')
    expect(failOut).toContain('1 fail')
    expect(failOut).toContain('(fail) fails [1.00ms]')
  })

  test('runChild rejects files outside dir and emits REPORT_MARK for valid files', async () => {
    const root = makeTempDir('plugin-test-child-')
    const badCode = await runChild({
      file: '/outside/x.test.ts',
      dir: root,
      write: () => {},
    })
    expect(badCode).toBe(1)

    let out = ''
    const okCode = await runChild({
      file: join(root, 'a.test.ts'),
      dir: root,
      write: c => {
        out += c
      },
      runInProcess: async (_d, file) => ({
        file,
        results: [{ title: 'ok', ms: 0.5, failure: null, advice: [] }],
      }),
    })
    expect(okCode).toBe(0)
    expect(out.startsWith(REPORT_MARK)).toBe(true)
  })
})
