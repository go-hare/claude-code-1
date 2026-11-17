import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { enginePropsFromTree } from '../hooks/useUiRenderHost.js'

const read = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8')

describe('Shard 1 2.1.289 alignment locks', () => {
  test('Config reclaims focus when header blurs and respects !headerFocused autoFocus', () => {
    const src = read('../Settings/Config.tsx')
    expect(src).toContain(
      'useFocusReclaim(containerRef, isScreenReader ? false : !headerFocused)',
    )
    expect(src).toContain('autoFocus: !headerFocused')
  })

  test('PluginRasterPanes firePressAnswer falls back to heldByKeyOf, PromptHint tracks wasStoodIn + onTail, and UserMessage skips rewrittenText when no hook ran', () => {
    const src = read('../PluginRasterPanes.tsx')
    expect(src).toContain('heldByKeyOf(keyLookup)')
    expect(src).toContain(
      'const standsIn = isCurrentReading ? currentStandsIn : wasStoodIn',
    )
    expect(src).toContain('abort.abort()')
    expect(src).toContain(
      'const engineProps = hasHook && drawn !== undefined ? enginePropsFromDrawn(drawn) : undefined',
    )
  })

  test('Spinner threads turnEffort, turnModel, and isCompacting from leftoverOhr without stale effortValue fallback', () => {
    const src = read('../Spinner.tsx')
    expect(src).toContain('turnEffort ?? pdSessionEffort(s, resolvedModel)')
    expect(src).not.toContain(
      'pdSessionEffort(s, sessionModel) ?? s.effortValue',
    )
    expect(src).toContain(
      'Boolean(leftoverOhr.isCompacting || props.isCompacting)',
    )
  })

  test('ToolProgressHint checks pluginTree before empty hint and useUiRenderHost supports array trees', () => {
    const hintSrc = read('../ToolProgressHint.tsx')
    const pluginIdx = hintSrc.indexOf('if (rendered.pluginTree !== undefined)')
    const drawPendingIdx = hintSrc.indexOf('if (rendered.drawPending)')
    expect(pluginIdx).toBeGreaterThan(0)
    expect(drawPendingIdx).toBeGreaterThan(pluginIdx)

    const hostSrc = read('../hooks/useUiRenderHost.ts')
    expect(hostSrc).toContain('Array.isArray(value)')
    expect(
      enginePropsFromTree([
        { type: 'box' },
        { type: 'engine', props: { hint: 'custom' } },
      ]),
    ).toEqual({
      hint: 'custom',
    })
  })

  test('Messages -> MessageRow -> Message thread followsInboundLabel and isExpanded', () => {
    const messagesSrc = read('../Messages.tsx')
    const rowSrc = read('../MessageRow.tsx')
    const msgSrc = read('../Message.tsx')
    expect(messagesSrc).toContain(
      "precedingSpeakerLabel(renderableMessages, index)?.speaker?.kind === 'inbound'",
    )
    expect(messagesSrc).toContain('followsInboundLabel={followsInboundLabel}')
    expect(rowSrc).toContain('followsInboundLabel={followsInboundLabel}')
    expect(rowSrc).toContain(
      'prev.followsInboundLabel !== next.followsInboundLabel',
    )
    expect(msgSrc).toContain('followsInboundLabel={followsInboundLabel}')
    expect(msgSrc).toContain(
      'isExpanded={Boolean(verbose || isTranscriptMode)}',
    )
    expect(msgSrc).toContain(
      'prev.followsInboundLabel !== next.followsInboundLabel',
    )
  })

  test('SkillsMenu removes unbound sortShortcut key trap in handleKeyDown', () => {
    const src = read('../skills/SkillsMenu.tsx')
    expect(src).not.toContain('e.key === sortShortcut')
    expect(src).toContain('onDownFromLast=')
  })
})
