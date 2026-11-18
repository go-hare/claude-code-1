/**
 * `claude plugin test` (`pluginTestMain`) — v2.1.325 1:1 runner & CLI handler.
 *
 * Discovers `*.test.ts` / `*.test.tsx` under a mod directory, executes each file
 * in an isolated child process with `--file <file> <dir>`, collects
 * `claude-plugin-test-report ` JSON lines, and prints per-file & summary output.
 */
import { spawn } from 'child_process'
import { readdir } from 'fs/promises'
import { availableParallelism } from 'os'
import { isAbsolute, join, relative, resolve, sep } from 'path'

export const REPORT_MARK = 'claude-plugin-test-report '
export const CHILD_ARGV_LENGTH = 3
export const LATE_TURNS = 3
export const MAX_PLUGIN_TEST_FILES = 1000
export const CHILD_TIMEOUT_MS = 30_000

export const PLUGIN_TEST_USAGE = [
  'Usage: claude plugin test [dir]',
  '',
  "Run a mod's tests",
  '',
  'Arguments:',
  "  dir         The mod's folder (default: the current folder)",
  '',
  'Options:',
  '  -h, --help  Display help for command',
  '',
  'Runs every *.test.ts and *.test.tsx under dir, each file in a child of this',
  "binary, in an environment like the one the mod's hooks run in. A test file",
  "imports its kit from 'claude-code/testing'. Exits 1 when a test fails.",
  '',
].join('\n')

export type PluginTestCaseResult = {
  title: string
  ms: number
  failure: string | null
  advice: string[]
}

export type PluginTestFileReport = {
  file: string
  results: PluginTestCaseResult[]
  error?: string
}

export type PluginTestForm = 'file' | 'other' | 'run'

export function pluginTestFormOf(argvAfterTest: string[]): PluginTestForm {
  if (argvAfterTest[0] === '--file') return 'file'
  if (argvAfterTest.some(arg => arg.startsWith('-'))) return 'other'
  return 'run'
}

export function isTeardownError(message: string): boolean {
  return / its environment was unloaded$/.test(message)
}

export function safeMessageOf(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message
  return String(err)
}

function makeLoadErrorReport(
  file: string,
  error: string,
): PluginTestFileReport {
  return { file, results: [], error }
}

function makeSuiteFailure(failure: string): PluginTestCaseResult {
  return { title: 'a failure', ms: 0, failure, advice: [] }
}

const STACK_LINE_RE = /^\s+at (?:.+ \()?(?:\S+:\d+:\d+|native)\)?$/

export function formatTestStack(errorText: string, root: string): string {
  const lines = errorText.split('\n')
  const firstFrameIdx =
    lines.findLastIndex(line => !STACK_LINE_RE.test(line)) + 1
  const frames = lines
    .slice(firstFrameIdx)
    .filter(line => line.includes(root))
    .map(line =>
      line.replaceAll(`${root}${sep}`, '').replaceAll(`${root}/`, ''),
    )
  const kept = [...lines.slice(0, firstFrameIdx), ...frames]
  const lastNonEmpty = kept.findLastIndex(line => line.trim() !== '')
  return kept
    .slice(0, lastNonEmpty + 1)
    .map(line => `  ${line}`)
    .join('\n')
}

export function formatTestFileReport(
  report: PluginTestFileReport,
  root: string,
): string {
  const lines: string[] = ['', `${relative(root, report.file)}:`]
  if (report.error !== undefined) {
    lines.push(
      '(fail) the file did not load',
      formatTestStack(report.error, root),
    )
  }
  for (const res of report.results) {
    const msStr = `[${res.ms.toFixed(2)}ms]`
    if (res.failure === null) {
      lines.push(`(pass) ${res.title} ${msStr}`)
    } else {
      lines.push(
        `(fail) ${res.title} ${msStr}`,
        formatTestStack(res.failure ?? '', root),
      )
    }
    for (const adv of res.advice) {
      lines.push(`  ${adv}`)
    }
  }
  return `${lines.join('\n')}\n`
}

export function parseChildReport(
  file: string,
  stdout: string,
  exitCode: number | null,
): PluginTestFileReport {
  const line = stdout
    .split('\n')
    .findLast(entry => entry.startsWith(REPORT_MARK))
  let parsed: PluginTestFileReport | undefined
  if (line !== undefined) {
    try {
      const candidate = JSON.parse(line.slice(REPORT_MARK.length)) as unknown
      if (
        candidate !== null &&
        typeof candidate === 'object' &&
        (candidate as PluginTestFileReport).file === file &&
        Array.isArray((candidate as PluginTestFileReport).results)
      ) {
        parsed = candidate as PluginTestFileReport
      }
    } catch {
      parsed = undefined
    }
  }
  if (parsed === undefined) {
    return makeLoadErrorReport(
      file,
      `its run ended without a report (exit code ${exitCode ?? '?'})`,
    )
  }
  if (exitCode === 0) return parsed
  return {
    ...parsed,
    results: [
      ...parsed.results,
      makeSuiteFailure(
        `its run exited with code ${exitCode ?? '?'} after reporting: a rejection nothing handled, or a throw after its test ended`,
      ),
    ],
  }
}

export async function discoverPluginTestFiles(root: string): Promise<string[]> {
  const results: string[] = []
  const stack: string[] = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      const skipDir =
        entry.name === 'node_modules' || entry.name.startsWith('.')
      if (entry.isDirectory() && !skipDir) {
        stack.push(fullPath)
      }
      if (entry.isFile() && /\.test\.tsx?$/.test(entry.name)) {
        results.push(fullPath)
      }
      if (results.length > MAX_PLUGIN_TEST_FILES) {
        throw new Error(
          `more than ${MAX_PLUGIN_TEST_FILES} test files under ${root}; name a narrower folder`,
        )
      }
    }
  }
  return results.toSorted()
}

export async function runPluginTestFiles(opts: {
  root: string
  files: string[]
  runFile: (file: string) => Promise<PluginTestFileReport>
  write: (chunk: string) => void
}): Promise<number> {
  const { root, files, runFile, write } = opts
  const started = performance.now()
  const concurrency = Math.max(
    1,
    Math.min(files.length, availableParallelism()),
  )
  const tasks: Array<Promise<PluginTestFileReport>> = []
  let nextIdx = 0

  function pump(): void {
    const file = files[nextIdx]
    nextIdx += 1
    if (file === undefined) return
    const p = runFile(file)
    tasks.push(p)
    p.then(pump, pump)
  }

  for (let i = 0; i < concurrency; i += 1) pump()

  let passCount = 0
  let failCount = 0
  for (let i = 0; i < files.length; i += 1) {
    while (!tasks[i]) {
      await Promise.race(tasks)
    }
    const report = await tasks[i]!
    write(formatTestFileReport(report, root))
    const failedTests = report.results.filter(r => r.failure !== null).length
    passCount += report.results.length - failedTests
    failCount += failedTests + (report.error === undefined ? 0 : 1)
  }

  const elapsedSec = ((performance.now() - started) / 1000).toFixed(2)
  const total = passCount + failCount
  const testWord = total === 1 ? 'test' : 'tests'
  const fileWord = files.length === 1 ? 'file' : 'files'
  write(
    `\n ${passCount} pass\n ${failCount} fail\nRan ${total} ${testWord} across ${files.length} ${fileWord}. [${elapsedSec}s]\n`,
  )
  return failCount === 0 ? 0 : 1
}

export type SessionAppendMessageBlock = {
  type: string
  id?: string
  tool_use_id?: string
  signature?: string
  text?: string
  content?: unknown
  is_error?: boolean
  [key: string]: unknown
}

export type SessionAppendMessage = {
  type?: string
  role?: string
  content?: SessionAppendMessageBlock[] | string
  [key: string]: unknown
}

function pinnedBlockKey(
  block: SessionAppendMessageBlock,
  index: number,
): string | undefined {
  switch (block.type) {
    case 'tool_use':
      return `tool_use:${String(block.id ?? index)}`
    case 'tool_result':
      return `tool_result:${String(block.tool_use_id ?? index)}`
    case 'thinking':
    case 'redacted_thinking':
      return `${block.type}:${String(block.signature ?? index)}`
    case 'text':
      return undefined
    default:
      return `${block.type}:${index}`
  }
}

/**
 * #401 (SEA `Qe` / `Xe` / `Le`): preserve pinned blocks (`tool_use`,
 * `tool_result`, `thinking`, `redacted_thinking`, and unknown blocks) when a
 * `session.append` hook returns a modified message.
 */
export function pinSessionAppendMessage(
  original: SessionAppendMessage,
  modified: SessionAppendMessage,
): {
  message: SessionAppendMessage
  droppedTypes: string[]
  changed: boolean
} {
  if (!Array.isArray(original.content)) {
    return { message: modified, droppedTypes: [], changed: false }
  }
  const modContent = Array.isArray(modified.content) ? modified.content : []
  const modPinnedByKey = new Map<string, SessionAppendMessageBlock>()
  modContent.forEach((b, i) => {
    const key = pinnedBlockKey(b, i)
    if (key !== undefined) modPinnedByKey.set(key, b)
  })

  const droppedSet = new Set<string>()
  const resultBlocks: SessionAppendMessageBlock[] = []
  let changed = !Array.isArray(modified.content)

  // Keep any non-pinned text blocks from modified content in order, while
  // ensuring every pinned block from original is preserved at its position.
  let modTextIdx = 0
  const modTexts = modContent.filter(b => b.type === 'text')

  original.content.forEach((origBlock, idx) => {
    const key = pinnedBlockKey(origBlock, idx)
    if (key === undefined) {
      const nextText = modTexts[modTextIdx++]
      if (nextText !== undefined) {
        if (nextText.text !== origBlock.text) changed = true
        resultBlocks.push(nextText)
      } else {
        changed = true
      }
      return
    }
    const candidate = modPinnedByKey.get(key)
    if (candidate === undefined) {
      droppedSet.add(origBlock.type)
      changed = true
      resultBlocks.push(origBlock)
      return
    }
    if (origBlock.type === 'tool_result') {
      // Tool results may scrub `content` / `is_error`, but keep `tool_use_id`.
      resultBlocks.push({
        ...origBlock,
        ...(candidate.content !== undefined && { content: candidate.content }),
        ...(candidate.is_error !== undefined && {
          is_error: candidate.is_error,
        }),
      })
    } else {
      resultBlocks.push(origBlock)
    }
  })

  // Append any extra text blocks added by the hook
  while (modTextIdx < modTexts.length) {
    resultBlocks.push(modTexts[modTextIdx++]!)
    changed = true
  }

  return {
    message: { ...original, content: resultBlocks },
    droppedTypes: [...droppedSet],
    changed,
  }
}

export function formatSessionAppendPinWarning(
  door: string,
  uuid: string,
  droppedTypes: readonly string[],
): string | undefined {
  if (droppedTypes.length === 0) return undefined
  const base = `session.append: the ${door} row ${uuid} is stored with its ${droppedTypes.join(', ')} kept, as a session stores it. A session pins tool_use, tool_result, thinking and unknown blocks (a request pairs each tool call with its result and carries thinking as signed), so no hook drops one or changes its id.`
  return droppedTypes.includes('tool_result')
    ? `${base} To scrub a tool result, pass on a tool_result with the same tool_use_id and new content.`
    : base
}

export type PluginTestKit = {
  test: (
    title: string,
    fn: (
      $: {
        session: {
          append: (event: {
            door?: string
            uuid?: string
            message: SessionAppendMessage
          }) => Promise<{ message: SessionAppendMessage; uuid: string }>
        }
      },
      on: (
        event: string,
        hook: (
          $: unknown,
          e: Record<string, unknown>,
          next: (e: Record<string, unknown>) => Promise<unknown>,
        ) => unknown,
      ) => void,
    ) => unknown | Promise<unknown>,
  ) => void
  expect: (actual: unknown) => {
    toBe: (expected: unknown) => void
    toEqual: (expected: unknown) => void
    toContain: (expected: string) => void
  }
  mock: {
    session: {
      rows: () => Array<{
        door: string
        uuid: string
        message: SessionAppendMessage
      }>
      clear: () => void
    }
  }
  runRecorded: () => Promise<PluginTestCaseResult[]>
}

/**
 * #265 / #306 / #401: in-process `claude-code/testing` kit for `claude plugin test`.
 * - #265: failed `expect` inside a test-registered `on(...)` hook or a refused
 *   stub answer fails the test instead of passing silently.
 * - #306: `mock.session` captures rows appended via `$.session.append`.
 * - #401: `session.append` hooks cannot drop `tool_use`/`tool_result`/`thinking`
 *   blocks that a real session keeps.
 */
export function createPluginTestKit(): PluginTestKit {
  const cases: Array<{
    title: string
    fn: Parameters<PluginTestKit['test']>[1]
  }> = []
  let sessionRows: Array<{
    door: string
    uuid: string
    message: SessionAppendMessage
  }> = []

  const expectFn: PluginTestKit['expect'] = actual => ({
    toBe(expected) {
      if (!Object.is(actual, expected)) {
        throw new Error(
          `Expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`,
        )
      }
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
          `Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`,
        )
      }
    },
    toContain(expected) {
      if (typeof actual !== 'string' || !actual.includes(expected)) {
        throw new Error(
          `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`,
        )
      }
    },
  })

  return {
    test(title, fn) {
      cases.push({ title, fn })
    },
    expect: expectFn,
    mock: {
      session: {
        rows: () => [...sessionRows],
        clear: () => {
          sessionRows = []
        },
      },
    },
    async runRecorded() {
      const results: PluginTestCaseResult[] = []
      for (const tc of cases) {
        sessionRows = []
        const hookErrors: string[] = []
        const hooks = new Map<
          string,
          Array<
            (
              $: unknown,
              e: Record<string, unknown>,
              next: (e: Record<string, unknown>) => Promise<unknown>,
            ) => unknown
          >
        >()
        const on: Parameters<Parameters<PluginTestKit['test']>[1]>[1] = (
          event,
          hook,
        ) => {
          const list = hooks.get(event) ?? []
          list.push(hook)
          hooks.set(event, list)
        }
        const $: Parameters<Parameters<PluginTestKit['test']>[1]>[0] = {
          session: {
            append: async event => {
              const door = event.door ?? 'turn'
              const uuid = event.uuid ?? 'row-1'
              const originalMessage = event.message
              const registered = hooks.get('session.append') ?? []
              let idx = 0
              const dispatch = async (
                cur: Record<string, unknown>,
              ): Promise<Record<string, unknown>> => {
                const h = registered[idx++]
                if (!h) {
                  return { message: cur.message ?? originalMessage, uuid }
                }
                let out: unknown
                try {
                  out = await h($, cur, dispatch)
                } catch (err) {
                  hookErrors.push(safeMessageOf(err))
                  return { message: cur.message ?? originalMessage, uuid }
                }
                if (out === null || typeof out !== 'object') {
                  hookErrors.push(
                    `session.append hook returned an invalid stub answer (${String(out)})`,
                  )
                  return { message: cur.message ?? originalMessage, uuid }
                }
                return out as Record<string, unknown>
              }
              const res = await dispatch({
                door,
                uuid,
                message: originalMessage,
              })
              const candidateMsg = (res.message ??
                originalMessage) as SessionAppendMessage
              const pinned = pinSessionAppendMessage(
                originalMessage,
                candidateMsg,
              )
              const warn = formatSessionAppendPinWarning(
                door,
                uuid,
                pinned.droppedTypes,
              )
              if (warn !== undefined) {
                hookErrors.push(warn)
              }
              sessionRows.push({ door, uuid, message: pinned.message })
              return { message: pinned.message, uuid }
            },
          },
        }

        const t0 = performance.now()
        try {
          await tc.fn($, on)
          if (hookErrors.length > 0) {
            results.push({
              title: tc.title,
              ms: performance.now() - t0,
              failure: hookErrors.join('\n'),
              advice: [],
            })
          } else {
            results.push({
              title: tc.title,
              ms: performance.now() - t0,
              failure: null,
              advice: [],
            })
          }
        } catch (err) {
          results.push({
            title: tc.title,
            ms: performance.now() - t0,
            failure:
              hookErrors.length > 0
                ? `${safeMessageOf(err)}\n${hookErrors.join('\n')}`
                : safeMessageOf(err),
            advice: [],
          })
        }
      }
      return results
    },
  }
}

export async function runPluginTestFileInProcess(
  _dir: string,
  file: string,
): Promise<PluginTestFileReport> {
  const kit = createPluginTestKit()
  try {
    const mod = (await import(file)) as {
      default?: (kit: PluginTestKit) => unknown | Promise<unknown>
    }
    if (typeof mod.default === 'function') {
      await mod.default(kit)
    }
  } catch (err) {
    return makeLoadErrorReport(file, safeMessageOf(err))
  }
  const results = await kit.runRecorded()
  if (results.length === 0) {
    return makeLoadErrorReport(file, 'it declares no test(): nothing ran')
  }
  return { file, results }
}

export async function runChild(opts: {
  file: string
  dir: string
  write: (chunk: string) => void
  runInProcess?: (dir: string, file: string) => Promise<PluginTestFileReport>
}): Promise<number> {
  const { file, dir, write, runInProcess = runPluginTestFileInProcess } = opts
  const rel = relative(dir, file)
  if (!(rel !== '' && !rel.startsWith('..') && !isAbsolute(rel))) {
    process.stderr.write(`claude plugin test: ${file} is not in ${dir}\n`)
    return 1
  }
  const unhandled: string[] = []
  const onUnhandled = (reason: unknown) => {
    const msg = safeMessageOf(reason)
    if (!isTeardownError(msg)) unhandled.push(msg)
  }
  process.on('unhandledRejection', onUnhandled)
  try {
    const report = await runInProcess(dir, file)
    for (let i = 0; i < LATE_TURNS; i += 1) {
      await new Promise(r => setTimeout(r, 0))
    }
    const finalReport: PluginTestFileReport =
      unhandled.length === 0
        ? report
        : {
            ...report,
            results: [
              ...report.results,
              makeSuiteFailure(
                `a rejection nothing handled: ${unhandled.join('\n')}`,
              ),
            ],
          }
    write(`${REPORT_MARK}${JSON.stringify(finalReport)}\n`)
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
  return 0
}

function spawnPluginTestChild(
  root: string,
  file: string,
): Promise<PluginTestFileReport> {
  return new Promise(resolveReport => {
    const cmd = process.execPath
    const script = process.argv[1]
    const args = script
      ? [script, 'plugin', 'test', '--file', file, root]
      : ['plugin', 'test', '--file', file, root]
    let stdout = ''
    let timedOut = false
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, CHILD_TIMEOUT_MS)
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    child.on('error', err => {
      clearTimeout(timer)
      resolveReport(
        makeLoadErrorReport(
          file,
          `its child did not run: ${safeMessageOf(err)}`,
        ),
      )
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (timedOut) {
        resolveReport(
          makeLoadErrorReport(
            file,
            `it did not finish: its run passed ${CHILD_TIMEOUT_MS} ms and was killed, its results with it; a test that never yields (a loop with no await) outlasts its own timeout`,
          ),
        )
        return
      }
      resolveReport(parseChildReport(file, stdout, code))
    })
  })
}

export async function pluginTestMain(
  argvAfterTest: string[],
  deps?: {
    cwd?: string
    write?: (chunk: string) => void
    writeErr?: (chunk: string) => void
    runFile?: (root: string, file: string) => Promise<PluginTestFileReport>
  },
): Promise<number> {
  const write = deps?.write ?? ((chunk: string) => process.stdout.write(chunk))
  const writeErr =
    deps?.writeErr ?? ((chunk: string) => process.stderr.write(chunk))
  if (argvAfterTest.includes('--help') || argvAfterTest.includes('-h')) {
    write(PLUGIN_TEST_USAGE)
    return 0
  }
  const [flag, fileArg, dirArg] = argvAfterTest
  if (
    flag === '--file' &&
    argvAfterTest.length === CHILD_ARGV_LENGTH &&
    fileArg !== undefined &&
    dirArg !== undefined
  ) {
    return runChild({ file: fileArg, dir: dirArg, write })
  }
  const root = resolve(deps?.cwd ?? process.cwd(), argvAfterTest[0] ?? '.')
  let files: string[]
  try {
    files = await discoverPluginTestFiles(root)
  } catch (err) {
    writeErr(`claude plugin test: ${safeMessageOf(err)}\n`)
    return 1
  }
  if (files.length === 0) {
    writeErr(`claude plugin test: no *.test.ts or *.test.tsx under ${root}\n`)
    return 1
  }
  const runFile = deps?.runFile ?? spawnPluginTestChild
  return runPluginTestFiles({
    root,
    files,
    runFile: file => runFile(root, file),
    write,
  })
}
