/**
 * densable 2.1.248 #14 em/c/cGn/Dv — markdown-code wrap of model names.
 * GOLD: gold-248-unk-wave9-14.txt
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { hasMarkdownSyntax } from '../../../components/Markdown.js'
import {
  $Ie,
  Dv,
  ENt,
  FIe,
  SZ,
  a,
  c,
  cGn,
  d,
  em,
  i9,
  kNt,
  wNt,
} from '../modelNoticeCode.js'

const noticeSrc = readFileSync(
  join(import.meta.dir, '../modelNoticeCode.ts'),
  'utf8',
)
const modelCmd = readFileSync(
  join(import.meta.dir, '../../../commands/model/model.tsx'),
  'utf8',
)
const fastCmd = readFileSync(
  join(import.meta.dir, '../../../commands/fast/fast.tsx'),
  'utf8',
)
const messagesSrc = readFileSync(
  join(import.meta.dir, '../../messages.ts'),
  'utf8',
)
const promptSrc = readFileSync(
  join(import.meta.dir, '../../../components/PromptInput/PromptInput.tsx'),
  'utf8',
)
const stdoutSrc = readFileSync(
  join(
    import.meta.dir,
    '../../../components/messages/UserLocalCommandOutputMessage.tsx',
  ),
  'utf8',
)

describe('densable 2.1.248 #14 modelNoticeCode', () => {
  test('gold constants match SEA i9/SZ/wNt/ENt/kNt/$Ie/FIe', () => {
    expect(i9).toBe('Set model to ')
    expect(SZ).toBe('Kept model as ')
    expect(wNt).toBe('Current model: ')
    expect(ENt).toBe('No response from the cloud session \u2014 the switch to ')
    expect(kNt).toBe("Cloud session couldn't switch to ")
    expect($Ie).toBe('Fast mode ON')
    expect(FIe).toBe(' \xB7 model set to ')
    expect(noticeSrc).toContain('function em(')
    expect(noticeSrc).toContain('function cGn(')
    expect(noticeSrc).toContain('function Dv(')
  })

  test('em fences sonnet[1m] so leftover Markdown does not see a link', () => {
    expect(em('sonnet[1m]')).toBe('`sonnet[1m]`')
    expect(hasMarkdownSyntax('sonnet[1m]')).toBe(true)
    expect(hasMarkdownSyntax(em('sonnet[1m]'))).toBe(true)
  })

  test('em empty / newline / already-fenced match gold', () => {
    expect(em('')).toBe('` `')
    expect(em('a\nb')).toBe('`a b`')
    expect(em('`x`')).toBe('`` `x` ``')
  })

  test('cGn unwraps only gold notice prefixes', () => {
    const wrapped = `${i9}${em('sonnet[1m]')}`
    expect(cGn(wrapped, inner => `[${inner}]`)).toBe(
      'Set model to [sonnet[1m]]',
    )
    expect(cGn(`hello ${em('sonnet[1m]')}`, inner => inner)).toBe(
      `hello ${em('sonnet[1m]')}`,
    )
    expect(cGn(`Model set to ${em('sonnet[1m]')}`, inner => inner)).toBe(
      `Model set to ${em('sonnet[1m]')}`,
    )
  })

  test('a/d detect Fast mode ON · model set to ` within p=4', () => {
    const body = `${$Ie}${FIe}${em('Opus 5')}`
    expect(a(body)).toBe(true)
    expect(d(body)).toBe(true)
    expect(a(`xx ${body}`)).toBe(true)
    expect(a(`xxxxx${body}`)).toBe(false)
    expect(cGn(body, inner => inner)).toBe('Fast mode ON · model set to Opus 5')
  })

  test('c strips em wrap-spaces then maps', () => {
    expect(c(em('`x`'), inner => inner)).toBe('`x`')
  })

  test('Dv bolds unwrapped model (ae.bold leftover toast)', () => {
    expect(Dv(`${i9}${em('sonnet[1m]')}`)).toBe(
      `Set model to ${chalk.bold('sonnet[1m]')}`,
    )
  })

  test('leftover hosts call em/Dv; do not invent Model set to wrap', () => {
    expect(modelCmd).toContain('${em(displayModel)}')
    expect(modelCmd).toContain('${em(renderModelLabel(model))}')
    expect(modelCmd).toContain('${em(renderModelLabel(modelValue))}')
    expect(modelCmd).toContain(
      '${em(renderModelLabel(mainLoopModelForSession))}',
    )
    expect(modelCmd).toContain('with ${em(effort)} effort')
    expect(fastCmd).toContain('em(FAST_MODE_MODEL_DISPLAY)')
    expect(messagesSrc).toContain('em(resolvedDisplay)')
    expect(promptSrc).toContain('Dv(result)')
    expect(promptSrc).toContain("key: 'fast-mode-toggled'")
    expect(promptSrc).not.toContain('${em(modelDisplayString')
    expect(stdoutSrc).toContain('<Markdown>{children}</Markdown>')
  })
})
