import { describe, expect, test } from 'bun:test'
import { buildInsightsResponsePrompt } from '../insights.js'

describe('densable 2.1.239 #24 insights pnh', () => {
  test('locks the user-visible lines and does not wrap in <message>', () => {
    const text = buildInsightsResponsePrompt({
      insightsJson: '{"ok":true}',
      reportUrl: 'file:///tmp/report.html',
      htmlPath: '/tmp/report.html',
      facetsDir: '/tmp/facets',
      header: '# Claude Code Insights\n',
      summaryText: '## At a Glance\n',
    })
    expect(text).toContain(
      'Respond with exactly the following, and nothing else. Do not add, omit, or reword any line:',
    )
    expect(text).toContain('Your shareable insights report is ready:')
    expect(text).toContain('file:///tmp/report.html')
    expect(text).toContain(
      'Want to dig into any section or try one of the suggestions?',
    )
    expect(text).not.toContain('<message>')
    expect(text).not.toContain('</message>')
    expect(text).toContain(
      'At-a-glance summary (for your context only — the user has not seen any output yet):',
    )
  })
})
