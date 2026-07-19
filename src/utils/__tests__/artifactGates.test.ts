import { describe, expect, test } from 'bun:test'
import {
  isArtifactAutoOpenEnabled,
  isArtifactDirectUploadEnabled,
  isArtifactEnvForceEnabled,
  isArtifactToolDisabled,
  isCobaltPlinthAdminSurfaceEnabled,
  isCobaltPlinthEnabled,
  isCobaltPlinthFernEnabled,
  isCobaltPlinthPutguardEnabled,
  isFramePublishContextEnabled,
  isSaffronAnchorEnabled,
  isSlateLanternEnabled,
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

  test('cobalt_plinth* pure gates densable Jso/c7n/L9u', () => {
    expect(isCobaltPlinthEnabled({ gbValue: true })).toBe(true)
    expect(isCobaltPlinthEnabled({ gbValue: false })).toBe(false)
    expect(isCobaltPlinthFernEnabled({ gbValue: true })).toBe(true)
    expect(isSaffronAnchorEnabled({ gbValue: true })).toBe(true)
    expect(isSlateLanternEnabled({ gbValue: false })).toBe(false)
    expect(isFramePublishContextEnabled({ gbValue: true })).toBe(true)
    // putguard default true when unset
    expect(isCobaltPlinthPutguardEnabled({})).toBe(true)
    expect(isCobaltPlinthPutguardEnabled({ gbValue: false })).toBe(false)
    expect(
      isCobaltPlinthAdminSurfaceEnabled({
        plinthGb: true,
        adminAllowed: true,
      }),
    ).toBe(true)
    expect(
      isCobaltPlinthAdminSurfaceEnabled({
        plinthGb: true,
        adminAllowed: false,
      }),
    ).toBe(false)
    expect(
      isCobaltPlinthAdminSurfaceEnabled({
        plinthGb: false,
        adminAllowed: true,
      }),
    ).toBe(false)
  })
})
