/**
 * densable 2.1.283 leftover gold `Wt` @202333357 — unattended-serving consent COPY lock.
 *
 * Di English @181890146 — title / body.host / detail 1:1 including `›`.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  UNATTENDED_SERVING_CONSENT_TERMS,
  UNATTENDED_SERVING_CONSENT_VERSION,
  unattendedServingConsentCopy,
} from '../unattendedServingCopy.js'

const TITLE =
  'Let cloud sessions run commands on this computer without asking?'
const BODY_HOST =
  'This computer is serving tools to your cloud session. In auto mode, the cloud session decides which commands to run here without asking you each time — the same way auto mode works locally. Your deny rules and hooks on this computer still apply. Answer once per computer; change it later in Settings › Claude Code.'
const DETAIL =
  'Until you answer, the cloud session asks you before each command it runs here.'

describe('unattended serving consent copy (2.1.283 gold Wt)', () => {
  test('Wt locks Di title/body.host/detail, terms, version 1', () => {
    expect(unattendedServingConsentCopy('office-mac')).toEqual({
      machineName: 'office-mac',
      title: TITLE,
      body: BODY_HOST,
      detail: DETAIL,
      terms: 'unattended-serving:v1:auto-arm-classifier',
      version: 1,
    })
    expect(BODY_HOST).toContain('Settings › Claude Code')
    expect(UNATTENDED_SERVING_CONSENT_TERMS).toBe(
      'unattended-serving:v1:auto-arm-classifier',
    )
    expect(UNATTENDED_SERVING_CONSENT_VERSION).toBe(1)
  })

  test('source-lock gold Wt; payload only — no kind duplicate', () => {
    const body = readFileSync(
      join(import.meta.dir, '../unattendedServingCopy.ts'),
      'utf8',
    )
    expect(body).toContain('gold `Wt` @202333357')
    expect(body).toContain('consent.unattended.title')
    expect(body).toContain('consent.unattended.body.host')
    expect(body).toContain('consent.unattended.detail')
    expect(body).toContain('unattended-serving:v1:auto-arm-classifier')
    expect(body).toContain('Settings › Claude Code')
    expect(body).not.toContain('export const UNATTENDED_SERVING_CONSENT_KIND')
    expect(body).not.toMatch(/settings\.set\b/)
  })
})
