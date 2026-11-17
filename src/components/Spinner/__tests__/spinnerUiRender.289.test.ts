import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const spinnerSrc = readFileSync(
  join(import.meta.dir, '../../Spinner.tsx'),
  'utf8',
)

describe('densable 2.1.289 xMn Spinner ui.render suffix', () => {
  test('engine suffix is U+2026, message is string|null', () => {
    expect(spinnerSrc).toContain("component: 'Spinner'")
    expect(spinnerSrc).toContain("const spinnerEllipsis = '…'")
    expect(spinnerSrc).toContain('suffix: spinnerEllipsis')
    expect(spinnerSrc).not.toContain('suffix: leftoverProps.spinnerSuffix')
    expect(spinnerSrc).toContain('word: defaultVerb')
    expect(spinnerSrc).toContain(
      'message: leftoverProps.overrideMessage ?? null',
    )
    expect(spinnerSrc).toContain(
      "leftoverProps.verbSuffix = typeof rendered.props.suffix === 'string' ? rendered.props.suffix : spinnerEllipsis",
    )
    expect(spinnerSrc).not.toContain(
      'leftoverProps.spinnerSuffix =\n    typeof rendered.props.suffix',
    )
  })
})
