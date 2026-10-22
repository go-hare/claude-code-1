import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const LAYOUT = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../FullscreenLayout.tsx',
)
const PROMPT = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../PromptInput/PromptInput.tsx',
)
const REPL = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../screens/REPL.tsx',
)

describe('densable 2.1.289 tot Ne bottom chrome', () => {
  test('idle typing is half screen; history-search/elicitation take rows-VCe', async () => {
    const src = await Bun.file(LAYOUT).text()
    expect(src).toContain('Ne=Zot()||XMn()?te-VCe:Math.floor(te/2)')
    expect(src).toContain("HISTORY_SEARCH_OVERLAY = 'history-search'")
    expect(src).toContain('elicitation-url')
    expect(src).toContain('Math.floor(terminalRows / 2)')
    expect(src).toContain(
      'Math.max(1, terminalRows - FULLSCREEN_BOTTOM_CHROME_ROWS)',
    )
    expect(src).toContain('maxHeight={bottomMaxHeight}')
    expect(src).toContain('maxHeight={promptMaxHeight}')
    expect(src).not.toContain(
      'maxHeight={abovePrompt != null ? promptMaxHeight : bottomMaxHeight}',
    )
    expect(src).toContain('gt=Math.max(0,Ne-pt)')
    expect(src).toContain('AbovePromptLeftoverContext')
    expect(src).toContain('leftoverOf')
    expect(src).toContain('leftoverYe')
    expect(src).toContain('leftoverChromeReduce')
    expect(src).toContain('leftoverListVisibleCountIdle')
    expect(src).toContain('leftoverChromeLatch')
    expect(src).toContain('leftoverOverflowHint')
    expect(src).toContain('leftoverListVisibleCountModal')
    expect(src).toContain('leftoverInnerWindow')
    expect(src).toContain('LeftoverModalHostContext')
    expect(src).toContain('LeftoverChromeSubscribeContext')
    expect(src).toContain('ut.reduce(SR')
    expect(src).toContain('<AbovePromptLeftoverContext value={leftoverYe}>')
    expect(src).not.toContain('useOpenListRows')
    expect(src).not.toContain('Math.round(h)')
    expect(src).toContain('subscribeLayout')
    expect(src).not.toContain(
      'maxHeight={Math.max(1, terminalRows - FULLSCREEN_BOTTOM_CHROME_ROWS)}',
    )
  })

  test('PromptInput maxVisibleLines can be 0 (gold leftover chrome)', async () => {
    const src = await Bun.file(PROMPT).text()
    expect(src).toContain('const PROMPT_FOOTER_LINES = 5')
    expect(src).toContain(
      'Math.max(0, (promptChromeBudget ?? Math.floor(rows / 2)) - PROMPT_FOOTER_LINES)',
    )
    expect(src).not.toContain('MIN_INPUT_VIEWPORT_LINES')
  })

  test('spinner is tot.scrollable (gold bJ hJ); panes/todos are tot.abovePrompt vh', async () => {
    const src = await Bun.file(REPL).text()
    // Main REPL FullscreenLayout is the last tot(); transcript-search has
    // an earlier scrollable/bottom pair without spinner.
    const scrollable = src.lastIndexOf('scrollable={')
    const above = src.lastIndexOf('abovePrompt={')
    const bottom = src.lastIndexOf('bottom={')
    const spinner = src.indexOf('<SpinnerWithVerb')
    expect(scrollable).toBeGreaterThan(0)
    expect(above).toBeGreaterThan(scrollable)
    expect(bottom).toBeGreaterThan(above)
    expect(spinner).toBeGreaterThan(scrollable)
    expect(spinner).toBeLessThan(above)
    expect(src.slice(scrollable, above)).toContain('<SpinnerWithVerb')
    expect(src.slice(above, bottom)).toContain('<PluginAbovePromptSite')
    expect(src.slice(above, bottom)).toContain('<TaskListV2')
    expect(src.slice(bottom)).not.toContain('<SpinnerWithVerb')
    expect(src.slice(bottom)).not.toContain('<PluginAbovePromptSite')
    expect(src.slice(bottom)).not.toContain('<TaskListV2')
  })
})
