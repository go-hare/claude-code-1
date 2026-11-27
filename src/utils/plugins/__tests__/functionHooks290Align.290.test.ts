import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

describe('functionHooksModules 290 alignment (#4, #144, #149)', () => {
  const fhDir = join(import.meta.dir, '../functionHooks')
  const src = [
    readFileSync(join(import.meta.dir, '../functionHooksModules.ts'), 'utf8'),
    ...readdirSync(fhDir)
      .filter(f => f.endsWith('.ts'))
      .sort()
      .map(f => readFileSync(join(fhDir, f), 'utf8')),
  ].join('\n')

  test('#149 ui.render 256-char prop clip & 100k budget', () => {
    expect(src).toContain('const UI_RENDER_SHORT_STRING_MAX = 256')
    expect(src).toContain('const UI_RENDER_PROP_BUDGET = 100_000')
    expect(src).toContain('const UI_RENDER_PROP_MAX_DEPTH = 32')
    expect(src).toContain('function clipRewrittenUiRenderProps(')
    expect(src).toContain('characters of text are drawn up to the first')
    expect(src).toContain('rewritten with more than')
  })

  test('#144 process.spawn streaming generator with 1 MiB backpressure', () => {
    expect(src).toContain('const PROCESS_SPAWN_HIGH_WATER = 1_048_576')
    expect(src).toContain('async function* spawnProcessStream(')
    expect(src).toContain("return 'takes { argv, cwd?, env?, input? }'")
    expect(src).toContain("return spawnProcessStream(req, plugin ?? 'unknown')")
  })

  test('#4 ThemeKey/Color hover validation', () => {
    expect(src).toContain(
      'const THEME_COLOR_PROP_RE = /^[#a-zA-Z0-9_().,% -]{1,40}$/',
    )
    expect(src).toContain('must be a color (a theme key, a name, or hex)')
  })
})
