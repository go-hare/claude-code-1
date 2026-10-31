import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getArtifactSdkDefaultOffReason,
  isArtifactAutoOpenEnabled,
  isArtifactDirectUploadEnabled,
  isArtifactEnvForceEnabled,
  isArtifactLhtEnabled,
  isArtifactSdkDefaultAllowed,
  isArtifactToolDisabled,
  isSdkArtifactDefaultOffEntrypoint,
  planArtifactAutoOpenSkip,
} from '../artifactGates.js'

const SRC = join(import.meta.dir, '../artifactGates.ts')

describe('artifactGates', () => {
  test('disable wins', () => {
    const env = {
      CLAUDE_CODE_DISABLE_ARTIFACT: '1',
      CLAUDE_CODE_ARTIFACT_AUTO_OPEN: '1',
      CLAUDE_CODE_ARTIFACT_DIRECT_UPLOAD: '1',
      CLAUDE_CODE_ARTIFACT: '1',
    }
    expect(isArtifactToolDisabled(env)).toBe(true)
    expect(isArtifactAutoOpenEnabled(env)).toBe(false)
    expect(isArtifactDirectUploadEnabled(env)).toBe(false)
    expect(isArtifactEnvForceEnabled(env)).toBe(false)
  })

  test('settings disableArtifact densable', () => {
    expect(isArtifactToolDisabled({}, true)).toBe(true)
    expect(isArtifactToolDisabled({}, false)).toBe(false)
  })

  test('Lht isolated env only applies env arm', () => {
    expect(isArtifactLhtEnabled({})).toBe(true)
    expect(isArtifactLhtEnabled({ CLAUDE_CODE_DISABLE_ARTIFACT: '1' })).toBe(
      false,
    )
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('artifactPolicyEnableCounts')
    expect(src).toContain('projectSettingsAliasesUserSettings')
    expect(src).toContain('artifactPolicyAdminTiers')
    expect(src).toContain('artifactLocalSettingsAsr')
    expect(src).toContain('artifactPolicyOu')
    expect(src).toContain('artifactPolicyMee')
    expect(src).toContain('artifactWeeLocalSettingsPath')
    expect(src).toContain('findCanonicalGitRoot')
    expect(src).toContain('collectMachineLocalManagedSettings')
  })

  test('auto open defaults ON (207 ou polarity)', () => {
    // Unset → open
    expect(isArtifactAutoOpenEnabled({})).toBe(true)
    // Explicit on still open
    expect(
      isArtifactAutoOpenEnabled({ CLAUDE_CODE_ARTIFACT_AUTO_OPEN: '1' }),
    ).toBe(true)
    // Explicit falsy → skip
    expect(
      isArtifactAutoOpenEnabled({ CLAUDE_CODE_ARTIFACT_AUTO_OPEN: '0' }),
    ).toBe(false)
    expect(
      isArtifactAutoOpenEnabled({ CLAUDE_CODE_ARTIFACT_AUTO_OPEN: 'false' }),
    ).toBe(false)
    expect(
      isArtifactAutoOpenEnabled({ CLAUDE_CODE_ARTIFACT_AUTO_OPEN: 'off' }),
    ).toBe(false)
  })

  test('planArtifactAutoOpenSkip chain order matches 207', () => {
    expect(planArtifactAutoOpenSkip({ redeployShared: true })).toBe(
      'auto_open_skipped_redeploy',
    )
    expect(planArtifactAutoOpenSkip({ isBackground: true })).toBe(
      'auto_open_skipped_bg',
    )
    expect(planArtifactAutoOpenSkip({ isTeammate: true })).toBe(
      'auto_open_skipped_teammate',
    )
    expect(planArtifactAutoOpenSkip({ isRemote: true })).toBe(
      'auto_open_skipped_remote',
    )
    expect(planArtifactAutoOpenSkip({ pane: 'desktop_pane' })).toBe(
      'auto_open_skipped_desktop',
    )
    expect(planArtifactAutoOpenSkip({ pane: 'epitaxy_pane' })).toBe(
      'auto_open_skipped_vscode',
    )
    expect(
      planArtifactAutoOpenSkip({
        env: { CLAUDE_CODE_ARTIFACT_AUTO_OPEN: '0' },
      }),
    ).toBe('auto_open_skipped_env')
    expect(planArtifactAutoOpenSkip({})).toBeNull()
  })

  test('force enable densable', () => {
    expect(isArtifactEnvForceEnabled({ CLAUDE_CODE_ARTIFACT: '1' })).toBe(true)
    expect(isArtifactEnvForceEnabled({})).toBe(false)
  })

  test('direct upload env || GB || remote entrypoint', () => {
    expect(isArtifactDirectUploadEnabled({})).toBe(false)
    expect(
      isArtifactDirectUploadEnabled({
        CLAUDE_CODE_ARTIFACT_DIRECT_UPLOAD: '1',
      }),
    ).toBe(true)
    expect(isArtifactDirectUploadEnabled({ gbValue: true })).toBe(true)
    expect(
      isArtifactDirectUploadEnabled({
        env: { CLAUDE_CODE_ENTRYPOINT: 'remote' },
      }),
    ).toBe(true)
    expect(
      isArtifactDirectUploadEnabled({
        env: { CLAUDE_CODE_ENTRYPOINT: 'remote_cowork' },
      }),
    ).toBe(true)
    expect(
      isArtifactDirectUploadEnabled({
        env: { CLAUDE_CODE_ENTRYPOINT: 'cli' },
      }),
    ).toBe(false)
    expect(
      isArtifactDirectUploadEnabled({
        env: { CLAUDE_CODE_DISABLE_ARTIFACT: '1' },
        gbValue: true,
      }),
    ).toBe(false)
  })

  test('densable D()/I7n sdk_default_off + CHILD_ARTIFACT bypass', () => {
    expect(isSdkArtifactDefaultOffEntrypoint({})).toBe(false)
    expect(
      isSdkArtifactDefaultOffEntrypoint({ CLAUDE_CODE_ENTRYPOINT: 'cli' }),
    ).toBe(false)
    expect(
      isSdkArtifactDefaultOffEntrypoint({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' }),
    ).toBe(true)
    expect(
      isSdkArtifactDefaultOffEntrypoint({
        CLAUDE_CODE_ENTRYPOINT: 'claude-code-github-action',
      }),
    ).toBe(true)
    expect(
      isSdkArtifactDefaultOffEntrypoint({ CLAUDE_CODE_ENTRYPOINT: 'mcp' }),
    ).toBe(true)

    expect(
      getArtifactSdkDefaultOffReason({ CLAUDE_CODE_ENTRYPOINT: 'sdk-py' }),
    ).toBe('sdk_default_off')
    expect(
      isArtifactSdkDefaultAllowed({ CLAUDE_CODE_ENTRYPOINT: 'sdk-py' }),
    ).toBe(false)

    // CLAUDE_CODE_ARTIFACT bypass
    expect(
      getArtifactSdkDefaultOffReason({
        CLAUDE_CODE_ENTRYPOINT: 'sdk-cli',
        CLAUDE_CODE_ARTIFACT: '1',
      }),
    ).toBeNull()
    // CHILD_ARTIFACT bypass (sdk_default_off only — not general ASe ON)
    expect(
      getArtifactSdkDefaultOffReason({
        CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
        CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT: '1',
      }),
    ).toBeNull()
    // Outside I7n, stamp is ignored by D arm
    expect(
      getArtifactSdkDefaultOffReason({
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT: '1',
      }),
    ).toBeNull()
    expect(isArtifactSdkDefaultAllowed({ CLAUDE_CODE_ENTRYPOINT: 'cli' })).toBe(
      true,
    )

    // densable Ss(ARTIFACT) before CHILD — defined-falsy withholds as
    // artifact_env_off even when BRIDGE_CHILD_ARTIFACT is stamped.
    expect(
      getArtifactSdkDefaultOffReason({
        CLAUDE_CODE_ENTRYPOINT: 'sdk-cli',
        CLAUDE_CODE_ARTIFACT: '0',
        CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT: '1',
      }),
    ).toBe('artifact_env_off')
    expect(
      isArtifactSdkDefaultAllowed({
        CLAUDE_CODE_ENTRYPOINT: 'sdk-cli',
        CLAUDE_CODE_ARTIFACT: '0',
        CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT: '1',
      }),
    ).toBe(false)
    expect(
      getArtifactSdkDefaultOffReason({
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        CLAUDE_CODE_ARTIFACT: 'false',
      }),
    ).toBe('artifact_env_off')

    // densable He/Tt before CHILD — see artifactGates.289.test.ts
    expect(
      getArtifactSdkDefaultOffReason({
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT: '1',
        CLAUDE_CODE_ARTIFACT: '1',
      }),
    ).toBe('third_party_provider')
    expect(
      getArtifactSdkDefaultOffReason({
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT: '1',
      }),
    ).toBe('essential_traffic_only')
  })
})
