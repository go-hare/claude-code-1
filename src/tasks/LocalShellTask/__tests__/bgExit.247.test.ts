import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import {
  formatLocalShellExitFooter,
  shouldAppendLocalShellExitFooter,
} from '../exitFooter.js'

const footerSrc = readFileSync(
  join(import.meta.dir, '../exitFooter.ts'),
  'utf8',
)
const notifySrc = readFileSync(
  join(import.meta.dir, '../LocalShellTask.tsx'),
  'utf8',
)
const killSrc = readFileSync(
  join(import.meta.dir, '../killShellTasks.ts'),
  'utf8',
)
const adoptSrc = readFileSync(
  join(import.meta.dir, '../../../utils/bgCheckpoint.ts'),
  'utf8',
)

describe('densable 2.1.247 #18 ADt fg-shell-bg-exit', () => {
  test('official footer format: killed / code / unknown / -1 unchanged', () => {
    expect(formatLocalShellExitFooter('killed', 0)).toBe('\n[killed]\n')
    expect(formatLocalShellExitFooter('killed', -1)).toBe('\n[killed]\n')
    expect(formatLocalShellExitFooter('completed', 0)).toBe(
      '\n[exited with code 0]\n',
    )
    expect(formatLocalShellExitFooter('failed', 1)).toBe(
      '\n[exited with code 1]\n',
    )
    expect(formatLocalShellExitFooter('completed', -1)).toBe(
      '\n[exited with code -1]\n',
    )
    expect(formatLocalShellExitFooter('completed', undefined)).toBe(
      '\n[exited with code unknown]\n',
    )
    expect(formatLocalShellExitFooter('failed', null)).toBe(
      '\n[exited with code unknown]\n',
    )
  })

  test('official ADt/eA suppress only when isAdopted', () => {
    expect(shouldAppendLocalShellExitFooter(undefined)).toBe(true)
    expect(shouldAppendLocalShellExitFooter({})).toBe(true)
    expect(shouldAppendLocalShellExitFooter({ isAdopted: false })).toBe(true)
    expect(shouldAppendLocalShellExitFooter({ isAdopted: true })).toBe(false)
  })

  test('source locks official ADt / eA / nsc strings', () => {
    expect(footerSrc).toContain("exited with code ${exitCode ?? 'unknown'}")
    expect(footerSrc).toContain("status === 'killed' ? 'killed'")
    expect(footerSrc).toContain('!task?.isAdopted')
    expect(notifySrc).toContain('shouldAppendLocalShellExitFooter')
    expect(notifySrc).toContain('skipAttachments: true')
    expect(killSrc).toContain('shouldAppendLocalShellExitFooter')
    expect(killSrc).toContain("formatLocalShellExitFooter('killed'")
    expect(adoptSrc).toContain('isAdopted: true')
    expect(adoptSrc).toContain('enqueueShellNotification')
  })
})
