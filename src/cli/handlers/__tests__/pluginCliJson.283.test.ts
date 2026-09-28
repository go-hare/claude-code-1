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

  test('does not invent commander --marketplace on claude plugin install', () => {
    const src = readFileSync(
      join(ROOT, 'src/cli/registerCliHostCommands.ts'),
      'utf8',
    )
    const installBlock = src.slice(
      src.indexOf("command('install <plugin>')"),
      src.indexOf("command('uninstall <plugin>')"),
    )
    expect(installBlock).not.toContain('--marketplace')
  })

  test('eval empty-case is after scan, with --case/--tag interpolation', () => {
    const src = readFileSync(
      join(ROOT, 'src/cli/handlers/pluginEval.ts'),
      'utf8',
    )
    expect(src).toContain('No eval cases found${gt} under')
    expect(src).toContain('discoverEvalCaseDirs')
    expect(src).toContain('emptyCaseFilterText')
    expect(src).toContain('resolveEvalTarget')
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
