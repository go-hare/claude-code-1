import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../../..')

describe('plugin CLI --json / --accept-command densable 2.1.283', () => {
  test('registerCliHostCommands wires accept-command and json on install/update', () => {
    const src = readFileSync(
      join(ROOT, 'src/cli/registerCliHostCommands.ts'),
      'utf8',
    )
    expect(src).toContain("'--accept-command <sha256>'")
    expect(src).toContain(".conflicts('yes')")
    expect(src).toContain("command('install <plugin>')")
    expect(src).toContain("command('update <plugin>')")
    expect(src).toContain("command('uninstall <plugin>')")
    expect(src).toContain(
      'Print one machine-readable result line on stdout instead of the human message',
    )
  })

  test('wires commander --marketplace <source> on claude plugin install', () => {
    const src = readFileSync(
      join(ROOT, 'src/cli/registerCliHostCommands.ts'),
      'utf8',
    )
    const installBlock = src.slice(
      src.indexOf("command('install <plugin>')"),
      src.indexOf("command('uninstall <plugin>')"),
    )
    expect(installBlock).toContain("'--marketplace <source>'")
    expect(installBlock).toContain('marketplace?: string')
  })

  test('eval empty-case is after scan, with --case/--tag interpolation', () => {
    const src = readFileSync(
      join(ROOT, 'src/cli/handlers/pluginEval.ts'),
      'utf8',
    )
    // Gold 289 $R delegates scanning to mc; refuse only after the suite returns.
    const suite = src.indexOf('} = await runPluginEvalSuite({')
    const empty = src.indexOf('report.cases.length === 0', suite)
    const message = src.indexOf('No eval cases found${gt} under', empty)
    expect(suite).toBeGreaterThan(-1)
    expect(empty).toBeGreaterThan(suite)
    expect(message).toBeGreaterThan(empty)
    expect(src.slice(empty, message)).toContain('errors.length === 0')
    expect(src.slice(empty, message)).toContain('!report.partial')
    expect(src.slice(empty, message)).toContain('!abort.signal.aborted')
    expect(src.slice(empty, message)).toContain(
      'emptyCaseFilterText(options.case, options.tag)',
    )
    expect(src).toContain('screenEvalTarget(root, pluginId, trust)')
  })

  test('plugin eval commander wires gold $R flags', () => {
    const src = readFileSync(
      join(ROOT, 'src/cli/registerCliHostCommands.ts'),
      'utf8',
    )
    expect(src).toContain("'--case <glob>'")
    expect(src).toContain("'--tag <tag>'")
    expect(src).toContain("'--runs <n>'")
    expect(src).toContain("'-j, --concurrency <n>'")
    expect(src).toContain("'--judge-model <model>'")
    expect(src).toContain("'--max-cost-usd <n>'")
    expect(src).toContain("'--output-dir <dir>'")
    expect(src).toContain("'--threshold <n>'")
    expect(src).toContain("'--allow-tools <tools>'")
    expect(src).toContain("'--mocks <mode>'")
    expect(src).toContain("'--allow-real-servers'")
    expect(src).toContain("'--keep-temp'")
    expect(src).toContain("'--publish-report'")
    expect(src).toContain("'--no-publish'")
  })
})
