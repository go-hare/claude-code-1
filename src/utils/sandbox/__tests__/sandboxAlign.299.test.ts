import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { formatSandboxSaveResult } from '../../../components/sandbox/SandboxSettings.js'
import {
  recheckReadDenyAndCredentialMasksBeforeWrap,
  recordReadDenyRecheckBaseline,
  resetReadDenyRecheckState,
} from '../readDenyRecheck.js'

const tempDirs: string[] = []

afterEach(() => {
  resetReadDenyRecheckState()
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('2.1.299-300 sandbox alignment', () => {
  test('#604 formatSandboxSaveResult formats unwritable error with hint', () => {
    const err = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
    })
    const msg = formatSandboxSaveResult({ error: err }, '✓ Sandbox enabled')
    expect(msg).toContain('✗ Sandbox settings not changed:')
    expect(msg).toContain("couldn't be updated (EACCES)")
    expect(msg).toContain(
      'Start Claude Code in a project folder you can write to.',
    )
    expect(formatSandboxSaveResult({ error: null }, '✓ Sandbox enabled')).toBe(
      '✓ Sandbox enabled',
    )
  })

  test('#672 readDenyRecheck resolves glob starting directory replaced by symlink', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-glob-symlink-'))
    tempDirs.push(base)
    const secretDir = path.join(base, 'secret')
    const grantRoot = path.join(base, 'grant-dir')
    fs.mkdirSync(secretDir)
    fs.mkdirSync(grantRoot)

    recordReadDenyRecheckBaseline({
      trustedDenyRoots: [secretDir],
      forwardedUntrustedGrants: [
        { literal: path.join(grantRoot, '**'), list: 'allowRead' },
        { literal: path.join(grantRoot, '**'), list: 'allowWrite' },
      ],
    })

    // Replace grantRoot with a symlink pointing to secretDir
    fs.rmSync(grantRoot, { recursive: true, force: true })
    fs.symlinkSync(secretDir, grantRoot)

    let cfg = {
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: {
        denyRead: [secretDir],
        allowRead: [path.join(grantRoot, '**')],
        allowWrite: [path.join(grantRoot, '**')],
        denyWrite: [],
      },
    }
    const result = recheckReadDenyAndCredentialMasksBeforeWrap({
      getConfig: () => cfg as never,
      updateConfig: next => {
        cfg = next as typeof cfg
      },
    })
    expect(result.droppedGrants).toBe(2)
    expect(cfg.filesystem.allowRead).toEqual([])
    expect(cfg.filesystem.allowWrite).toEqual([])
  })

  test('#817 SandboxSettings uses "Sandbox commands" option labels', () => {
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../components/sandbox/SandboxSettings.tsx',
      ),
      'utf8',
    )
    expect(src).toContain('Sandbox commands, with auto-allow')
    expect(src).toContain('Sandbox commands, with regular permissions')
    expect(src).not.toContain('Sandbox BashTool')
  })
})
