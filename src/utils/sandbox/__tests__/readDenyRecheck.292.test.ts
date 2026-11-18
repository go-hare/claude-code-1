import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'
import {
  recheckReadDenyAndCredentialMasksBeforeWrap,
  recordReadDenyRecheckBaseline,
  resetReadDenyRecheckState,
} from '../readDenyRecheck.js'

let tempRoot: string

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'cc-201-recheck-'))
  resetReadDenyRecheckState()
})

afterEach(() => {
  resetReadDenyRecheckState()
  rmSync(tempRoot, { recursive: true, force: true })
})

describe('v2.1.292 #201 mid-session sandbox read-deny re-check', () => {
  test('drops project grants and clears credential mask injectHosts when a trusted read-deny path appears or re-points mid-session', () => {
    const writableDir = join(tempRoot, 'writable')
    const secretDir = join(tempRoot, 'secret-target')
    const managedLink = join(writableDir, 'managed-link')
    const projectGrantInside = join(secretDir, 'subdir')
    const credFile = join(secretDir, 'token.json')

    mkdirSync(writableDir, { recursive: true })
    mkdirSync(projectGrantInside, { recursive: true })
    writeFileSync(credFile, '{}')

    // At config build time, managedLink does not exist yet.
    recordReadDenyRecheckBaseline({
      trustedDenyRoots: [managedLink],
      forwardedUntrustedGrants: [
        { literal: projectGrantInside, list: 'allowRead' },
        { literal: projectGrantInside, list: 'allowWrite' },
      ],
    })

    let activeConfig = {
      network: { allowedDomains: ['api.example.com'], deniedDomains: [] },
      filesystem: {
        denyRead: [managedLink],
        allowRead: [projectGrantInside, '/unrelated/read'],
        allowWrite: [writableDir, projectGrantInside],
        denyWrite: [],
      },
      credentials: {
        files: [
          {
            path: credFile,
            mode: 'mask',
            injectHosts: ['api.example.com'],
          },
        ],
      },
    } as unknown as SandboxRuntimeConfig

    // Before symlink appears: no-op
    const before = recheckReadDenyAndCredentialMasksBeforeWrap({
      getConfig: () => activeConfig,
      updateConfig: cfg => {
        activeConfig = cfg
      },
    })
    expect(before).toEqual({
      movedCount: 0,
      droppedGrants: 0,
      narrowedMasks: 0,
    })

    // Mid-session: symlink inside writableDir points to secretDir!
    symlinkSync(secretDir, managedLink)

    const after = recheckReadDenyAndCredentialMasksBeforeWrap({
      getConfig: () => activeConfig,
      updateConfig: cfg => {
        activeConfig = cfg
      },
    })
    expect(after.movedCount).toBeGreaterThan(0)
    expect(after.droppedGrants).toBe(2)
    expect(after.narrowedMasks).toBe(1)

    expect(activeConfig.filesystem.allowRead).toEqual(['/unrelated/read'])
    expect(activeConfig.filesystem.allowWrite).toEqual([writableDir])
    const files = (
      activeConfig as unknown as {
        credentials: {
          files: Array<{ path: string; mode: string; injectHosts?: string[] }>
        }
      }
    ).credentials.files
    expect(files[0]).toEqual({
      path: credFile,
      mode: 'mask',
      injectHosts: [],
    })
  })
})
