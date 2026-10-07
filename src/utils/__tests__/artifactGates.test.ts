import { describe, expect, test } from 'bun:test'
import {
  getArtifactSdkDefaultOffReason,
  isArtifactAutoOpenEnabled,
  isArtifactDirectUploadEnabled,
  isArtifactEnvForceEnabled,
  isArtifactSdkDefaultAllowed,
  isArtifactToolDisabled,
  isSdkArtifactDefaultOffEntrypoint,
  planArtifactAutoOpenSkip,
} from '../artifactGates.js'

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
  })
})
