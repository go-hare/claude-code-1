import { describe, expect, test } from 'bun:test'
import { ArtifactTool } from '../ArtifactTool.js'

describe('ArtifactTool streaming renderToolUseMessage (#775)', () => {
  test('returns empty string while streaming input has not arrived yet', () => {
    expect(ArtifactTool.renderToolUseMessage({} as any)).toBe('')
    expect(
      ArtifactTool.renderToolUseMessage({ action: 'publish' } as any),
    ).toBe('')
  })

  test('renders normal label once file_path or action arrives', () => {
    expect(
      ArtifactTool.renderToolUseMessage({ file_path: '/tmp/page.html' } as any),
    ).toContain('/tmp/page.html')
    expect(ArtifactTool.renderToolUseMessage({ action: 'list' } as any)).toBe(
      'List artifacts',
    )
  })
})
