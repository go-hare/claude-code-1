import { describe, expect, test } from 'bun:test'
import { BINARY_EXTENSIONS, hasBinaryExtension } from '../files.js'
import { getScratchpadInstructions } from '../prompts.js'
import { extractDiscoveredToolNames } from '../../utils/searchExtraTools.js'

describe('BINARY_EXTENSIONS, scratchpad prompt, and searchExtraTools (#866, #785, #800)', () => {
  test('#866: BINARY_EXTENSIONS includes .xlsm, .parquet, .epub, .heic, and other SEA binary formats', () => {
    for (const ext of [
      '.xlsm',
      '.parquet',
      '.epub',
      '.heic',
      '.heif',
      '.avif',
      '.dmg',
      '.apk',
      '.numbers',
      '.feather',
      '.npy',
      '.npz',
      '.pickle',
    ]) {
      expect(BINARY_EXTENSIONS.has(ext)).toBe(true)
      expect(hasBinaryExtension(`/tmp/sample${ext}`)).toBe(true)
    }
  })

  test('#785: getScratchpadInstructions instructs writing complete absolute paths', () => {
    const prev = process.env.CLAUDE_CODE_SESSION_KIND
    delete process.env.CLAUDE_CODE_SESSION_KIND
    try {
      const instructions = getScratchpadInstructions()
      if (instructions !== null) {
        expect(instructions).toContain(
          "write the file's complete absolute path in one piece",
        )
      }
    } finally {
      if (prev !== undefined) process.env.CLAUDE_CODE_SESSION_KIND = prev
    }
  })

  test('#800: extractDiscoveredToolNames seeds surfacedNames from deferred_tools_delta', () => {
    const messages = [
      {
        type: 'attachment',
        uuid: 'att-1',
        attachment: {
          type: 'deferred_tools_delta',
          addedNames: ['ToolAnnouncedOnly'],
          surfacedNames: ['ToolSurfacedA', 'ToolSurfacedB'],
        },
      },
    ] as any[]

    const allSurfaced = extractDiscoveredToolNames(messages)
    expect(allSurfaced.has('ToolSurfacedA')).toBe(true)
    expect(allSurfaced.has('ToolSurfacedB')).toBe(true)
    expect(allSurfaced.has('ToolAnnouncedOnly')).toBe(false)

    const filtered = extractDiscoveredToolNames(messages, {
      surfacedOnWire: new Set(['ToolSurfacedA']),
    })
    expect(filtered.has('ToolSurfacedA')).toBe(true)
    expect(filtered.has('ToolSurfacedB')).toBe(false)
  })
})
