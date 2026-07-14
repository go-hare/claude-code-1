import { afterEach, describe, expect, test } from 'bun:test'
import {
  isReportFindingsEnabled,
  ReportFindingsTool,
} from '../ReportFindingsTool.js'

afterEach(() => {
  delete process.env.CLAUDE_CODE_REPORT_FINDINGS
})

describe('isReportFindingsEnabled', () => {
  test('env truthy enables', () => {
    expect(isReportFindingsEnabled({ CLAUDE_CODE_REPORT_FINDINGS: '1' })).toBe(
      true,
    )
  })
  test('env falsy disables', () => {
    expect(isReportFindingsEnabled({ CLAUDE_CODE_REPORT_FINDINGS: '0' })).toBe(
      false,
    )
  })
})

describe('ReportFindingsTool', () => {
  test('schema accepts findings payload', () => {
    const parsed = ReportFindingsTool.inputSchema.safeParse({
      level: 'high',
      findings: [
        {
          file: 'src/foo.ts',
          line: 12,
          summary: 'Null deref on empty list',
          failure_scenario: 'call with [] throws TypeError',
          category: 'correctness',
          verdict: 'CONFIRMED',
        },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  test('call returns count + findings', async () => {
    const findings = [
      {
        file: 'a.ts',
        summary: 'bug',
        failure_scenario: 'crashes',
        outcome: 'fixed' as const,
      },
    ]
    const result = await ReportFindingsTool.call({
      level: 'medium',
      findings,
    })
    expect(result.data.count).toBe(1)
    expect(result.data.level).toBe('medium')
    expect(result.data.findings).toEqual(findings)
  })

  test('empty findings ok', async () => {
    const result = await ReportFindingsTool.call({ findings: [] })
    expect(result.data.count).toBe(0)
    expect(
      ReportFindingsTool.mapToolResultToToolResultBlockParam(
        result.data,
        'tu_1',
      ).content,
    ).toBe('Reported 0 findings.')
  })

  test('userFacingName is Code review', () => {
    expect(ReportFindingsTool.userFacingName()).toBe('Code review')
  })
})
