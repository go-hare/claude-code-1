import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { em } from '../modelNoticeCode.js'
import { modelDisplayString, renderModelName } from '../model.js'

const modelSrc = readFileSync(join(import.meta.dir, '../model.ts'), 'utf8')
const modelCmd = readFileSync(
  join(import.meta.dir, '../../../commands/model/model.tsx'),
  'utf8',
)
const modelIndex = readFileSync(
  join(import.meta.dir, '../../../commands/model/index.ts'),
  'utf8',
)
const pickerSrc = readFileSync(
  join(import.meta.dir, '../../../components/ModelPicker.tsx'),
  'utf8',
)

describe('densable 2.1.289 model [1m] display + picker footer', () => {
  test('renderModelName keeps [1m] suffix for kept-model / slash description', () => {
    expect(renderModelName('opus[1m]')).toContain('[1m]')
    expect(renderModelName('sonnet[1m]')).toContain('[1m]')
    expect(em(renderModelName('opus[1m]'))).toContain('[1m]')
  })

  test('modelDisplayString keeps [1m] on the source spelling', () => {
    expect(modelDisplayString('opus[1m]')).toContain('[1m]')
  })

  test('handleCancel uses renderModelLabel then em (gold xE/Jb)', () => {
    expect(modelCmd).toContain(
      'const displayModel = renderModelLabel(mainLoopModel)',
    )
    expect(modelCmd).toContain('Kept model as ${em(displayModel)}')
    expect(modelCmd).toContain('return renderModelName(model)')
  })

  test('slash /model description uses renderModelName of the user setting', () => {
    expect(modelIndex).toContain('renderModelName(current)')
    expect(modelIndex).toContain('getUserSpecifiedModelSetting()')
  })

  test('picker footer is Enter default / s session-only; no 1M toggle row', () => {
    expect(pickerSrc).toContain('action="set as default"')
    expect(pickerSrc).toContain('action="use this session only"')
    expect(pickerSrc).not.toContain('Space to toggle 1M')
    expect(pickerSrc).not.toContain('1M context on')
    expect(pickerSrc).not.toContain('modelPicker:toggle1M')
    expect(pickerSrc).toContain('onSetDefault')
  })
})
