import { PassThrough } from 'node:stream'
import { describe, expect, test } from 'bun:test'
import React from 'react'
import { AccessibilityContext } from '@anthropic/ink'
import Ink from '../../../../packages/@ant/ink/src/core/ink.js'
import { extractScreenReaderText } from '../../../../packages/@ant/ink/src/core/screenReaderTree.js'
import { AppStateProvider } from '../../../state/AppState.js'
import { AgentsFooterHint } from '../PromptInputFooterLeftSide.js'
import { HighlightedInput } from '../ShimmeredInput.js'

function renderText(element: React.ReactElement): string {
  const stdout = Object.assign(new PassThrough(), {
    columns: 80,
    rows: 24,
    isTTY: true,
  })
  stdout.resume()
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode() {},
    ref() {},
    unref() {},
  })
  const ink = new Ink({
    stdout: stdout as never,
    stdin: stdin as never,
    stderr: new PassThrough() as never,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  ink.render(element)
  const text = extractScreenReaderText(
    (ink as unknown as { rootNode: never }).rootNode,
  )
  ink.unmount()
  return text
}

describe('PromptInput 2.1.302–2.1.305 alignment', () => {
  test('#926 AgentsFooterHint hides "← for agents" when restingHintExpired is true', () => {
    const shown = renderText(
      React.createElement(
        AppStateProvider,
        null,
        React.createElement(AgentsFooterHint, { restingHintExpired: false }),
      ),
    )
    expect(shown).toContain('for agents')

    const hidden = renderText(
      React.createElement(
        AppStateProvider,
        null,
        React.createElement(AgentsFooterHint, { restingHintExpired: true }),
      ),
    )
    expect(hidden).not.toContain('for agents')
  })

  test('#1048 HighlightedInput renders plain Text without spaces inside words in screen reader mode', () => {
    const out = renderText(
      React.createElement(
        AccessibilityContext.Provider,
        { value: true },
        React.createElement(HighlightedInput, {
          text: 'use ultrathink now',
          highlights: [
            {
              start: 4,
              end: 14,
              color: 'rainbow_red',
              shimmerColor: 'rainbow_red_shimmer',
              priority: 10,
            },
          ],
        }),
      ),
    )
    expect(out).toContain('use ultrathink now')
    expect(out).not.toContain('u l t r a t h i n k')
  })
})
