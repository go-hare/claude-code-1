import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  announcePrefixLedger,
  getPrefixLedgerMode,
  prefixLedgerNotice,
} from '../prefixLedger.js'

const ROOT = join(import.meta.dir, '../../../..')

describe('densable 2.1.289 Uwt prefix-ledger', () => {
  test('gZn is compile-time off and Uwt/Bwt are no-ops', () => {
    expect(getPrefixLedgerMode()).toBe('off')
    expect(announcePrefixLedger([], {}, {})).toBeUndefined()
    expect(prefixLedgerNotice([], {}, { querySource: 'repl' })).toBeUndefined()
  })

  test('queryModel calls Uwt at normalize start and Bwt after assemble', () => {
    const claudeDir = join(ROOT, 'src/services/api/claude')
    const claude = [
      readFileSync(join(ROOT, 'src/services/api/claude.ts'), 'utf8'),
      ...readdirSync(claudeDir)
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .sort()
        .map(f => readFileSync(join(claudeDir, f), 'utf8')),
    ].join('\n')
    expect(claude).toContain('announcePrefixLedger')
    expect(claude).toContain('prefixLedgerNotice')
    expect(claude).toContain('query_message_normalization_start')
  })
})
