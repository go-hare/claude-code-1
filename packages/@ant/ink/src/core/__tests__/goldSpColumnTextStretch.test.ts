import { describe, expect, test } from 'bun:test'
import chalk from 'chalk'
import { createLayoutNode } from '../layout/engine.js'
import { LayoutMeasureMode } from '../layout/node.js'
import applyStyles from '../styles.js'
import measureText from '../measure-text.js'
import { createNode, createTextNode, setStyle } from '../dom.js'
import Output from '../output.js'
import renderNodeToOutput, {
  createRenderFrameContext,
  runWithRenderFrameContext,
} from '../render-node-to-output.js'
import { CharPool, createScreen, HyperlinkPool, StylePool } from '../screen.js'

const TEXT = '● Agent "Verify n events race" finished'

function inkTextStyles() {
  return {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row' as const,
    textWrap: 'wrap' as const,
  }
}

function attachMeasure(
  node: ReturnType<typeof createLayoutNode>,
  text: string,
) {
  node.setMeasureFunc((width, widthMode) => {
    const dims = measureText(text, width)
    if (dims.width <= width) return dims
    if (widthMode === LayoutMeasureMode.Undefined) {
      return measureText(text, Number.POSITIVE_INFINITY)
    }
    const wrapped = measureText(text, width)
    return wrapped
  })
}

describe('gold Sp column Text stretch', () => {
  test('column 80 → Text (ink default) width is 80 not min-content', () => {
    const col = createLayoutNode()
    applyStyles(col, { flexDirection: 'column', width: 80 })
    const text = createLayoutNode()
    applyStyles(text, inkTextStyles())
    attachMeasure(text, TEXT)
    col.insertChild(text, 0)
    col.calculateLayout(80)
    expect(col.getComputedWidth()).toBe(80)
    expect(text.getComputedWidth()).toBe(80)
    expect(text.getComputedHeight()).toBe(1)
  })

  test('nested gold Sp: outer column 80 → inner column → Text is 80', () => {
    const outer = createLayoutNode()
    applyStyles(outer, { flexDirection: 'column', width: 80 })
    const inner = createLayoutNode()
    applyStyles(inner, { flexDirection: 'column' })
    const text = createLayoutNode()
    applyStyles(text, inkTextStyles())
    attachMeasure(text, TEXT)
    inner.insertChild(text, 0)
    outer.insertChild(inner, 0)
    outer.calculateLayout(80)
    expect(outer.getComputedWidth()).toBe(80)
    expect(inner.getComputedWidth()).toBe(80)
    expect(text.getComputedWidth()).toBe(80)
    expect(text.getComputedHeight()).toBe(1)
  })

  test('measureText reports unwrapped line width even when height wraps', () => {
    const dims = measureText(TEXT, 1)
    expect(dims.width).toBe(TEXT.length)
    expect(dims.height).toBe(TEXT.length)
  })

  test('shrink-wrap column stretches short sibling to the longest row', () => {
    const col = createLayoutNode()
    applyStyles(col, { flexDirection: 'column' })
    const short = createLayoutNode()
    applyStyles(short, { flexDirection: 'column', flexShrink: 0 })
    const long = createLayoutNode()
    applyStyles(long, { flexDirection: 'column', flexShrink: 0 })
    const shortText = createLayoutNode()
    applyStyles(shortText, inkTextStyles())
    attachMeasure(shortText, '  2. 2')
    const longText = createLayoutNode()
    applyStyles(longText, inkTextStyles())
    attachMeasure(longText, '  4. Type something.')
    short.insertChild(shortText, 0)
    long.insertChild(longText, 0)
    col.insertChild(short, 0)
    col.insertChild(long, 1)
    col.calculateLayout(undefined)
    expect(col.getComputedWidth()).toBe('  4. Type something.'.length)
    expect(short.getComputedWidth()).toBe(col.getComputedWidth())
    expect(long.getComputedWidth()).toBe(col.getComputedWidth())
  })

  function columnWithText(text: string, extra?: Record<string, unknown>) {
    const box = createLayoutNode()
    applyStyles(box, { flexDirection: 'column', ...extra })
    const t = createLayoutNode()
    applyStyles(t, inkTextStyles())
    attachMeasure(t, text)
    box.insertChild(t, 0)
    return box
  }

  test('gold compact-vertical: IC title stretches to description sibling', () => {
    // gold t7: column{flexShrink:0} [ IC(column, no width), description paddingLeft ]
    const option = createLayoutNode()
    applyStyles(option, { flexDirection: 'column', flexShrink: 0 })
    const ic = columnWithText('  2. 2')
    const desc = columnWithText('longer description than the title')
    applyStyles(desc, { flexDirection: 'column', paddingLeft: 5 })
    option.insertChild(ic, 0)
    option.insertChild(desc, 1)
    option.calculateLayout(undefined)
    const want = desc.getComputedWidth()
    expect(want).toBeGreaterThan('  2. 2'.length)
    expect(option.getComputedWidth()).toBe(want)
    expect(ic.getComputedWidth()).toBe(want)
  })

  test('gold IC nested in SelectOption wrapper still stretches to description', () => {
    const option = createLayoutNode()
    applyStyles(option, { flexDirection: 'column', flexShrink: 0 })
    const wrapper = createLayoutNode()
    applyStyles(wrapper, { flexDirection: 'column', flexShrink: 0 })
    const ic = columnWithText('  2. 2')
    wrapper.insertChild(ic, 0)
    const desc = columnWithText('longer description than the title')
    applyStyles(desc, { flexDirection: 'column', paddingLeft: 5 })
    option.insertChild(wrapper, 0)
    option.insertChild(desc, 1)
    option.calculateLayout(undefined)
    const want = option.getComputedWidth()
    expect(want).toBeGreaterThan('  2. 2'.length)
    expect(wrapper.getComputedWidth()).toBe(want)
    expect(ic.getComputedWidth()).toBe(want)
  })

  test('gold IC has no width %; stretch still fills the option column', () => {
    const option = createLayoutNode()
    applyStyles(option, { flexDirection: 'column', flexShrink: 0 })
    const ic = columnWithText('  2. 2')
    const desc = columnWithText('longer description than the title')
    applyStyles(desc, { flexDirection: 'column', paddingLeft: 5 })
    option.insertChild(ic, 0)
    option.insertChild(desc, 1)
    option.calculateLayout(undefined)
    expect(desc.getComputedWidth()).toBeGreaterThan('  2. 2'.length)
    expect(ic.getComputedWidth()).toBe(option.getComputedWidth())
    expect(ic.getComputedWidth()).toBe(desc.getComputedWidth())
  })

  function inkBoxDefaults(extra?: Record<string, unknown>) {
    return {
      flexGrow: 0,
      flexShrink: 1,
      flexDirection: 'row' as const,
      ...extra,
    }
  }

  test('default-row wrapper around Select keeps options min-content of the row, not the title column', () => {
    const dialog = createLayoutNode()
    applyStyles(dialog, inkBoxDefaults({ flexDirection: 'column', width: 80 }))
    const title = columnWithText(
      'Choose an option that is a long question title',
    )
    const row = createLayoutNode()
    applyStyles(row, inkBoxDefaults())
    const select = createLayoutNode()
    applyStyles(select, inkBoxDefaults({ flexDirection: 'column' }))
    const option = createLayoutNode()
    applyStyles(
      option,
      inkBoxDefaults({ flexDirection: 'column', flexShrink: 0 }),
    )
    const ic = columnWithText('  2. 2')
    option.insertChild(ic, 0)
    select.insertChild(option, 0)
    row.insertChild(select, 0)
    dialog.insertChild(title, 0)
    dialog.insertChild(row, 1)
    dialog.calculateLayout(80)
    expect(dialog.getComputedWidth()).toBe(80)
    expect(title.getComputedWidth()).toBe(80)
    expect(ic.getComputedWidth()).toBe('  2. 2'.length)
  })

  test('ihe column with DualInk defaults still stretches short IC to the longest option', () => {
    const ihe = createLayoutNode()
    applyStyles(ihe, inkBoxDefaults({ flexDirection: 'column' }))
    const shortOption = createLayoutNode()
    applyStyles(
      shortOption,
      inkBoxDefaults({ flexDirection: 'column', flexShrink: 0 }),
    )
    const wrapper = createLayoutNode()
    applyStyles(
      wrapper,
      inkBoxDefaults({ flexDirection: 'column', flexShrink: 0 }),
    )
    const ic = createLayoutNode()
    applyStyles(ic, inkBoxDefaults({ flexDirection: 'column' }))
    const titleRow = createLayoutNode()
    applyStyles(titleRow, inkBoxDefaults({ flexDirection: 'row', gap: 1 }))
    const titleText = createLayoutNode()
    applyStyles(titleText, inkTextStyles())
    attachMeasure(titleText, '  2. 2')
    titleRow.insertChild(titleText, 0)
    ic.insertChild(titleRow, 0)
    wrapper.insertChild(ic, 0)
    shortOption.insertChild(wrapper, 0)
    const longOption = createLayoutNode()
    applyStyles(
      longOption,
      inkBoxDefaults({ flexDirection: 'column', flexShrink: 0 }),
    )
    const longIc = columnWithText('  4. Type something.')
    longOption.insertChild(longIc, 0)
    ihe.insertChild(shortOption, 0)
    ihe.insertChild(longOption, 1)
    ihe.calculateLayout(undefined)
    expect(ihe.getComputedWidth()).toBe('  4. Type something.'.length)
    expect(ic.getComputedWidth()).toBe(ihe.getComputedWidth())
  })

  test('live Ask compact-vertical tree: short IC stretches to Type something', () => {
    const ihe = createLayoutNode()
    applyStyles(ihe, inkBoxDefaults({ flexDirection: 'column' }))

    function optionTitle(label: string, desc: string) {
      const option = createLayoutNode()
      applyStyles(
        option,
        inkBoxDefaults({ flexDirection: 'column', flexShrink: 0 }),
      )
      const wrapper = createLayoutNode()
      applyStyles(
        wrapper,
        inkBoxDefaults({ flexDirection: 'column', flexShrink: 0 }),
      )
      const ic = createLayoutNode()
      applyStyles(ic, inkBoxDefaults({ flexDirection: 'column' }))
      const inner = createLayoutNode()
      applyStyles(inner, inkBoxDefaults({ flexDirection: 'row', gap: 1 }))
      const pointer = createLayoutNode()
      applyStyles(pointer, inkTextStyles())
      attachMeasure(pointer, ' ')
      const title = createLayoutNode()
      applyStyles(title, inkTextStyles())
      attachMeasure(title, label)
      inner.insertChild(pointer, 0)
      inner.insertChild(title, 1)
      ic.insertChild(inner, 0)
      wrapper.insertChild(ic, 0)
      const d = createLayoutNode()
      applyStyles(d, inkBoxDefaults({ paddingLeft: 5 }))
      const dt = createLayoutNode()
      applyStyles(dt, inkTextStyles())
      attachMeasure(dt, desc)
      d.insertChild(dt, 0)
      option.insertChild(wrapper, 0)
      option.insertChild(d, 1)
      return { option, ic }
    }

    const short = optionTitle('2. 2', '2')
    const long = optionTitle('4. Type something.', 'placeholder')
    ihe.insertChild(short.option, 0)
    ihe.insertChild(long.option, 1)
    ihe.calculateLayout(undefined)
    expect(short.ic.getComputedWidth()).toBe(ihe.getComputedWidth())
    expect(short.ic.getComputedWidth()).toBeGreaterThan('2. 2'.length)
  })

  test('column wrapper around Select stretches IC to the title column', () => {
    const dialog = createLayoutNode()
    applyStyles(dialog, { flexDirection: 'column', width: 80 })
    const title = columnWithText(
      'Choose an option that is a long question title',
    )
    const col = createLayoutNode()
    applyStyles(col, { flexDirection: 'column' })
    const select = createLayoutNode()
    applyStyles(select, { flexDirection: 'column' })
    const option = createLayoutNode()
    applyStyles(option, { flexDirection: 'column', flexShrink: 0 })
    const ic = columnWithText('  2. 2')
    option.insertChild(ic, 0)
    select.insertChild(option, 0)
    col.insertChild(select, 0)
    dialog.insertChild(title, 0)
    dialog.insertChild(col, 1)
    dialog.calculateLayout(80)
    expect(ic.getComputedWidth()).toBe(80)
  })

  function liveOption(label: string, desc: string) {
    const option = createLayoutNode()
    applyStyles(
      option,
      inkBoxDefaults({ flexDirection: 'column', flexShrink: 0 }),
    )
    const wrapper = createLayoutNode()
    applyStyles(
      wrapper,
      inkBoxDefaults({ flexDirection: 'column', flexShrink: 0 }),
    )
    const ic = createLayoutNode()
    applyStyles(ic, inkBoxDefaults({ flexDirection: 'column' }))
    const inner = createLayoutNode()
    applyStyles(inner, inkBoxDefaults({ flexDirection: 'row', gap: 1 }))
    const pointer = createLayoutNode()
    applyStyles(pointer, inkTextStyles())
    attachMeasure(pointer, ' ')
    const index = createLayoutNode()
    applyStyles(index, inkTextStyles())
    attachMeasure(index, '3.')
    const title = createLayoutNode()
    applyStyles(title, inkTextStyles())
    attachMeasure(title, label)
    inner.insertChild(pointer, 0)
    inner.insertChild(index, 1)
    inner.insertChild(title, 2)
    ic.insertChild(inner, 0)
    wrapper.insertChild(ic, 0)
    const d = createLayoutNode()
    applyStyles(d, inkBoxDefaults({ paddingLeft: 5 }))
    const dt = createLayoutNode()
    applyStyles(dt, inkTextStyles())
    attachMeasure(dt, desc)
    d.insertChild(dt, 0)
    option.insertChild(wrapper, 0)
    option.insertChild(d, 1)
    return { option, ic, inner }
  }

  test('live Ask: gold wrap-row + leftoverDollarWt column stretches short IC to Type something', () => {
    const tot = createLayoutNode()
    applyStyles(tot, inkBoxDefaults({ flexDirection: 'column', width: 80 }))
    const qv = createLayoutNode()
    applyStyles(qv, inkBoxDefaults({ flexDirection: 'column' }))
    const minH = createLayoutNode()
    applyStyles(minH, inkBoxDefaults({ flexDirection: 'column' }))
    const wrap = createLayoutNode()
    applyStyles(wrap, inkBoxDefaults({ marginTop: 1 }))
    const host = createLayoutNode()
    applyStyles(host, inkBoxDefaults({ flexDirection: 'column' }))
    const ftt = createLayoutNode()
    applyStyles(ftt, inkBoxDefaults({ flexDirection: 'column' }))
    const o1 = liveOption('1', '1')
    const o3 = liveOption('3', '3')
    const o4 = liveOption('Type something.', 'placeholder')
    ftt.insertChild(o1.option, 0)
    ftt.insertChild(o3.option, 1)
    ftt.insertChild(o4.option, 2)
    host.insertChild(ftt, 0)
    wrap.insertChild(host, 0)
    minH.insertChild(wrap, 0)
    qv.insertChild(minH, 0)
    tot.insertChild(qv, 0)
    tot.calculateLayout(80)
    expect(tot.getComputedWidth()).toBe(80)
    expect(host.getComputedWidth()).toBe(o4.ic.getComputedWidth())
    expect(o3.ic.getComputedWidth()).toBe(o4.ic.getComputedWidth())
    expect(o3.ic.getComputedWidth()).toBeGreaterThan('  3. 3'.length)
  })

  test('live Ask: 80-col Divider + help inside minH still stretches short IC', () => {
    const tot = createLayoutNode()
    applyStyles(tot, inkBoxDefaults({ flexDirection: 'column', width: 80 }))
    const qv = createLayoutNode()
    applyStyles(qv, inkBoxDefaults({ flexDirection: 'column' }))
    const minH = createLayoutNode()
    applyStyles(minH, inkBoxDefaults({ flexDirection: 'column' }))
    const wrap = createLayoutNode()
    applyStyles(wrap, inkBoxDefaults({ marginTop: 1 }))
    const host = createLayoutNode()
    applyStyles(host, inkBoxDefaults({ flexDirection: 'column' }))
    const ftt = createLayoutNode()
    applyStyles(ftt, inkBoxDefaults({ flexDirection: 'column' }))
    const o3 = liveOption('3', '3')
    const o4 = liveOption('Type something.', 'placeholder')
    ftt.insertChild(o3.option, 0)
    ftt.insertChild(o4.option, 1)
    host.insertChild(ftt, 0)
    wrap.insertChild(host, 0)
    const footer = createLayoutNode()
    applyStyles(footer, inkBoxDefaults({ flexDirection: 'column' }))
    const divider = columnWithText('─'.repeat(80))
    const chat = columnWithText('  5. Chat about this')
    footer.insertChild(divider, 0)
    footer.insertChild(chat, 1)
    const help = columnWithText(
      'Enter to select · ↑/↓ to navigate · Esc to cancel',
    )
    minH.insertChild(wrap, 0)
    minH.insertChild(footer, 1)
    minH.insertChild(help, 2)
    qv.insertChild(minH, 0)
    tot.insertChild(qv, 0)
    tot.calculateLayout(80)
    expect(o3.ic.getComputedWidth()).toBe(o4.ic.getComputedWidth())
    expect(o3.ic.getComputedWidth()).toBeGreaterThan('  3. 3'.length)
  })

  const BOX = {
    flexGrow: 0,
    flexShrink: 1,
    flexWrap: 'nowrap' as const,
    overflowX: 'visible' as const,
    overflowY: 'visible' as const,
  }

  function box(extra?: Record<string, unknown>) {
    const node = createNode('ink-box')
    const style = { ...BOX, flexDirection: 'row' as const, ...extra }
    setStyle(node, style)
    applyStyles(node.yogaNode!, style)
    return node
  }

  function text(value: string) {
    const node = createNode('ink-text')
    const style = inkTextStyles()
    setStyle(node, style)
    applyStyles(node.yogaNode!, style)
    const leaf = createTextNode(value)
    leaf.parentNode = node
    node.childNodes.push(leaf)
    return node
  }

  function add(parent: ReturnType<typeof box>, child: ReturnType<typeof box>) {
    child.parentNode = parent
    parent.childNodes.push(child)
    parent.yogaNode!.insertChild(
      child.yogaNode!,
      parent.yogaNode!.getChildCount(),
    )
  }

  function optionRow(label: string, desc: string, tint: boolean) {
    const option = box({ flexDirection: 'column', flexShrink: 0 })
    const wrapper = box({ flexDirection: 'column', flexShrink: 0 })
    const ic = box({
      flexDirection: 'column',
      ...(tint ? { backgroundColor: 'rgb(240,240,240)' } : {}),
    })
    const inner = box({ flexDirection: 'row', gap: 1 })
    add(inner, text(' '))
    add(inner, text('3.'))
    add(inner, text(label))
    add(ic, inner)
    add(wrapper, ic)
    const d = box({ paddingLeft: 5 })
    add(d, text(desc))
    add(option, wrapper)
    add(option, d)
    return { option, ic }
  }

  test('DualInk paint: gold wrap-row still fills short IC to Type something', () => {
    const tot = box({ flexDirection: 'column', width: 80 })
    const wrap = box({ marginTop: 1 })
    const host = box({ flexDirection: 'column' })
    const ftt = box({ flexDirection: 'column' })
    const o3 = optionRow('3', '3', true)
    const o4 = optionRow('Type something.', 'placeholder', false)
    add(ftt, o3.option)
    add(ftt, o4.option)
    add(host, ftt)
    add(wrap, host)
    add(tot, wrap)
    tot.yogaNode!.setWidth(80)
    tot.yogaNode!.calculateLayout(80)
    expect(o3.ic.yogaNode!.getComputedWidth()).toBe(
      o4.ic.yogaNode!.getComputedWidth(),
    )
    expect(o3.ic.yogaNode!.getComputedWidth()).toBeGreaterThan('  3. 3'.length)

    const prevLevel = chalk.level
    chalk.level = 3
    try {
      const stylePool = new StylePool()
      const screen = createScreen(
        80,
        8,
        stylePool,
        new CharPool(),
        new HyperlinkPool(),
      )
      const output = new Output({ width: 80, height: 8, stylePool, screen })
      runWithRenderFrameContext(createRenderFrameContext(), () => {
        renderNodeToOutput(tot, output, { prevScreen: undefined })
      })
      const painted = output.get()
      const w = o3.ic.yogaNode!.getComputedWidth()
      let bgCells = 0
      for (let row = 0; row < painted.height; row++) {
        let n = 0
        for (let col = 0; col < painted.width; col++) {
          const styleId =
            painted.cells[((row * painted.width + col) << 1) + 1]! >>> 17
          if (styleId & 1) n++
        }
        if (n > bgCells) bgCells = n
      }
      expect(bgCells).toBe(w)
    } finally {
      chalk.level = prevLevel
    }
  })
})
