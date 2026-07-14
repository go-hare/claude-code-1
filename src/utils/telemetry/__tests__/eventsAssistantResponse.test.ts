import { describe, expect, test } from 'bun:test'
import {
  formatAssistantResponseForOTel,
  isAssistantResponseLoggingEnabled,
  OTEL_CONTENT_TRUNCATE_LIMIT,
  truncateOTelContent,
} from '../events.js'

describe('isAssistantResponseLoggingEnabled (official xkc)', () => {
  test('falls back to OTEL_LOG_USER_PROMPTS when ASSISTANT unset', () => {
    expect(
      isAssistantResponseLoggingEnabled({
        OTEL_LOG_USER_PROMPTS: '1',
      } as NodeJS.ProcessEnv),
    ).toBe(true)
    expect(isAssistantResponseLoggingEnabled({} as NodeJS.ProcessEnv)).toBe(
      false,
    )
  })

  test('explicit ASSISTANT=0 does not fall through to USER=1', () => {
    expect(
      isAssistantResponseLoggingEnabled({
        OTEL_LOG_ASSISTANT_RESPONSES: '0',
        OTEL_LOG_USER_PROMPTS: '1',
      } as NodeJS.ProcessEnv),
    ).toBe(false)
  })

  test('explicit ASSISTANT=1 enables even when USER unset', () => {
    expect(
      isAssistantResponseLoggingEnabled({
        OTEL_LOG_ASSISTANT_RESPONSES: '1',
      } as NodeJS.ProcessEnv),
    ).toBe(true)
  })
})

describe('truncateOTelContent (official WU / bLh=61440)', () => {
  test('passes short content through', () => {
    expect(truncateOTelContent('hello')).toEqual({
      content: 'hello',
      truncated: false,
    })
  })

  test('truncates past 60KB with marker', () => {
    const big = 'a'.repeat(OTEL_CONTENT_TRUNCATE_LIMIT + 10)
    const out = truncateOTelContent(big)
    expect(out.truncated).toBe(true)
    expect(
      out.content.startsWith('a'.repeat(OTEL_CONTENT_TRUNCATE_LIMIT)),
    ).toBe(true)
    expect(out.content).toContain('[TRUNCATED - Content exceeds 60KB limit]')
    expect(out.content.length).toBe(
      OTEL_CONTENT_TRUNCATE_LIMIT +
        '\n\n[TRUNCATED - Content exceeds 60KB limit]'.length,
    )
  })
})

describe('formatAssistantResponseForOTel', () => {
  test('redacts when logging disabled', () => {
    expect(
      formatAssistantResponseForOTel('secret', {} as NodeJS.ProcessEnv),
    ).toBe('<REDACTED>')
  })

  test('returns content when ASSISTANT enabled', () => {
    expect(
      formatAssistantResponseForOTel('visible', {
        OTEL_LOG_ASSISTANT_RESPONSES: '1',
      } as NodeJS.ProcessEnv),
    ).toBe('visible')
  })
})
