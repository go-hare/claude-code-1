import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildSendNowHintLabel } from '../PromptInputQueuedCommands.js'

const PROMPT_SRC = readFileSync(
  join(import.meta.dir, '../PromptInput.tsx'),
  'utf8',
)
const QUEUE_SRC = readFileSync(
  join(import.meta.dir, '../PromptInputQueuedCommands.tsx'),
  'utf8',
)

describe('v2.1.312–314 PromptInput alignment', () => {
  test('#1316 queued commands send-now hint supports fullscreen click and empty-chord fallback', () => {
    expect(buildSendNowHintLabel('')).toBe('click to send now')
    expect(QUEUE_SRC).toContain('isFullscreenEnvEnabled')
    expect(QUEUE_SRC).toContain('<FePress onPress={handleSendNowClick}>')
  })

  test('#1380 SSH no-image notification uses copy-file-and-paste-path message and 5000ms timeout', () => {
    expect(PROMPT_SRC).toContain(
      'no image over SSH · copy the file over, paste its path',
    )
    expect(PROMPT_SRC).toContain('timeoutMs: isSSH ? 5000 : 1000')
  })

  test('#1405 PromptInput handles pasted text when a footer item is selected', () => {
    expect(PROMPT_SRC).toContain('handleFooterPaste')
    expect(PROMPT_SRC).toContain(
      'onPaste={footerItemSelected ? handleFooterPaste : undefined}',
    )
  })

  test('#1408 footerItems is empty when helpOpen, command list, or paste hint obscures footer', () => {
    expect(PROMPT_SRC).toContain(
      'const isFooterHiddenByOverlay = helpOpen || suggestions.length > 0 || isPasting;',
    )
    expect(PROMPT_SRC).toContain(
      'isFooterHiddenByOverlay\n        ? ([] as FooterItem[])',
    )
  })
})
