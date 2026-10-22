import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const RASTER = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../PluginRaster.tsx',
)
const KITTY = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../utils/plugins/kittyGraphics.ts',
)
const INK = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../packages/@ant/ink/src/core/ink.tsx',
)
const APP = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../packages/@ant/ink/src/components/App.tsx',
)
const IMAGES = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../packages/@ant/ink/src/core/terminalImages.ts',
)

describe('densable 2.1.289 PluginImage uses Jd via HC().terminalImages', () => {
  test('Ink passes terminalImages into App; AppContext exposes it', async () => {
    const ink = await Bun.file(INK).text()
    const app = await Bun.file(APP).text()
    expect(ink).toContain('terminalImages={this.terminalImages}')
    expect(app).toContain('terminalImages: this.props.terminalImages,')
  })

  test('PluginImage allocate/transmit/free go through terminalImages', async () => {
    const src = await Bun.file(RASTER).text()
    expect(src).toContain('const { terminalImages } = useApp()')
    expect(src).toContain('terminalImages.allocate(')
    expect(src).toContain(
      'createKittyRefusedLogger({ plugin, requestId, key: elementKey })',
    )
    expect(src).toContain('subscribeKittyGraphicsSupported')
    expect(src).toContain('if (!triedAllocate) return undefined')
    expect(src).toContain('encodeKittyTransmit(')
    expect(src).not.toContain('Math.min(columns, KITTY_PLACEHOLDER_MAX)')
    expect(src).toContain(
      'kittyPlaceholderGrid(kittyId, imageColumns, imageRows)',
    )
    expect(src).toContain('resend: !consumed')
    expect(src).toContain('isKittyShmSource(source)')
    expect(src).toContain('terminalImages?.free(id)')
    expect(src).toContain('if (!ok) return KITTY_SINK_REFUSED')
    expect(src).not.toContain('transmitKittyImage')
    expect(src).not.toContain('allocateKittyImageId')
    expect(src).not.toContain('process.stdout.write')
    expect(src).not.toContain('export class Jd')
    expect(src).not.toContain('export function Jd')
  })

  test('kittyGraphics encodes Zmo; no stdout write and no minify Jd export', async () => {
    const src = await Bun.file(KITTY).text()
    expect(src).toContain(
      "export const KITTY_SINK_REFUSED = 'the terminal sink refused the source'",
    )
    expect(src).toContain('export function isKittyShmSource')
    expect(src).toContain('export function kittyImageIdBits')
    expect(src).toContain('export function encodeKittyTransmit')
    expect(src).toContain('export const KITTY_PLACEHOLDER_MAX')
    expect(src).not.toContain('process.stdout.write')
    expect(src).not.toContain('export class Jd')
    expect(src).not.toContain('export function Jd')
    expect(src).not.toContain('export function transmitKittyImage')
    expect(src).not.toContain('export function allocateKittyImageId')
    expect(src).toContain('format must be png, rgba, or rgb')
  })

  test('encodeKittyTransmit throws TypeError on unknown format', async () => {
    const { encodeKittyTransmit } = await import(
      '../../utils/plugins/kittyGraphics.js'
    )
    expect(() =>
      encodeKittyTransmit(
        1,
        { file: '/tmp/x', format: 'gif', width: 8, height: 8 },
        1,
        1,
      ),
    ).toThrow(TypeError)
  })

  test('Jd analog class is TerminalImages not exported minify Jd', async () => {
    const src = await Bun.file(IMAGES).text()
    expect(src).toContain('export class TerminalImages')
    expect(src).toContain('nextWide = randomInt(SMALL_ID_LIMIT, WIDE_ID_LIMIT)')
    expect(src).not.toContain('export class Jd')
    expect(src).not.toContain('export function Jd')
  })
})
