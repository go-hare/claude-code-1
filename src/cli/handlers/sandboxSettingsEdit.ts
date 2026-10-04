/**
 * densable 2.1.283 `runSandboxSettingsEdit` / `h` @205291060.
 */
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import { logEvent } from '../../services/analytics/index.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import {
  addToExcludedCommands,
  isStrictSandboxModeConfigured,
} from '../../utils/sandbox/sandbox-adapter.js'
import { getPlatform } from '../../utils/platform.js'
import { isSettingSourceEnabled } from '../../utils/settings/constants.js'
import { logForDebugging } from '../../utils/debug.js'

const editSchema = lazySchema(() =>
  z
    .object({
      mode: z.enum(['auto-allow', 'regular', 'disabled']).optional(),
      allowUnsandboxedCommands: z.boolean().optional(),
      excludeCommand: z.string().trim().min(1).max(1000).optional(),
    })
    .refine(
      value =>
        value.mode !== undefined ||
        value.allowUnsandboxedCommands !== undefined ||
        value.excludeCommand !== undefined,
      {
        error:
          'Nothing to change: none of mode, allowUnsandboxedCommands or excludeCommand was given.',
      },
    ),
)

export type SandboxSettingsEdit = z.infer<ReturnType<typeof editSchema>>

export type SandboxSettingsEditResult =
  | { ok: true; written: SandboxSettingsEdit }
  | { ok: false; error: string }

function isAutoAllowSupported(): boolean {
  return SandboxManager.isSupportedPlatform()
}

function areUnsandboxedCommandsForbiddenByPolicy(): boolean {
  return SandboxManager.areSandboxSettingsLockedByPolicy()
}

type ApplyResult =
  | { ok: true; written: SandboxSettingsEdit }
  | {
      ok: false
      error: string
      code: string
      failed?: boolean
    }

async function applySandboxSettingsEdit(raw: unknown): Promise<ApplyResult> {
  const parsed = editSchema().safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      code: 'not_an_edit',
      error: issue
        ? `Not a sandbox settings edit (${issue.path.map(String).join('.') || 'edit'}: ${issue.message}).`
        : 'Not a sandbox settings edit.',
    }
  }
  const written = parsed.data
  if (
    !SandboxManager.isSupportedPlatform() ||
    !SandboxManager.isPlatformInEnabledList()
  ) {
    return {
      ok: false,
      code: 'unsupported_platform',
      error: 'Sandboxing is not available on this platform.',
    }
  }
  if (SandboxManager.areSandboxSettingsLockedByPolicy()) {
    return {
      ok: false,
      code: 'locked',
      error:
        'Sandbox settings are set by a higher-priority configuration and cannot be changed here.',
    }
  }
  if (written.mode !== undefined && written.mode !== 'disabled') {
    const deps = SandboxManager.checkDependencies()
    if (deps.errors.length > 0) {
      return {
        ok: false,
        code: 'missing_dependencies',
        error: `The sandbox cannot run until its dependencies are installed: ${deps.errors.join('; ')}`,
      }
    }
  }
  const autoAllowSupported = isAutoAllowSupported()
  if (written.mode === 'auto-allow' && !autoAllowSupported) {
    return {
      ok: false,
      code: 'auto_allow_unavailable',
      error: 'Auto-allow is not available on this platform.',
    }
  }
  if (written.mode === 'disabled' && SandboxManager.isSandboxRequired()) {
    return {
      ok: false,
      code: 'forced_on',
      error: 'Sandboxing is required here and cannot be turned off.',
    }
  }
  if (
    written.allowUnsandboxedCommands !== undefined &&
    areUnsandboxedCommandsForbiddenByPolicy()
  ) {
    return {
      ok: false,
      code: 'fallback_forbidden',
      error:
        'The unsandboxed fallback is set by a higher-priority configuration and cannot be changed here.',
    }
  }
  let settingsSource: 'localSettings' | 'userSettings' = 'localSettings'
  if (written.mode !== undefined) {
    switch (written.mode) {
      case 'auto-allow':
        await SandboxManager.setSandboxSettings({
          enabled: true,
          autoAllowBashIfSandboxed: true,
        })
        break
      case 'regular':
        await SandboxManager.setSandboxSettings({
          enabled: true,
          ...(autoAllowSupported ? { autoAllowBashIfSandboxed: false } : {}),
        })
        break
      case 'disabled':
        await SandboxManager.setSandboxSettings({
          enabled: false,
          ...(autoAllowSupported ? { autoAllowBashIfSandboxed: false } : {}),
        })
        break
    }
  }
  if (written.allowUnsandboxedCommands !== undefined) {
    await SandboxManager.setSandboxSettings({
      allowUnsandboxedCommands: written.allowUnsandboxedCommands,
    })
  }
  if (written.excludeCommand !== undefined) {
    const pattern = written.excludeCommand.replace(/^["']|["']$/g, '').trim()
    if (pattern === '') {
      return {
        ok: false,
        code: 'empty_pattern',
        error: 'The command pattern is empty.',
      }
    }
    // densable yOt @180702411
    if (
      isStrictSandboxModeConfigured() &&
      !isSettingSourceEnabled('userSettings')
    ) {
      logForDebugging('sandbox_exclude_command user_settings_disabled', {
        level: 'warn',
      })
      return {
        ok: false,
        code: 'user_settings_disabled',
        error: 'userSettings is disabled; the exclude cannot be stored.',
      }
    }
    settingsSource =
      (isStrictSandboxModeConfigured() || getPlatform() === 'windows') &&
      isSettingSourceEnabled('userSettings')
        ? 'userSettings'
        : 'localSettings'
    addToExcludedCommands(pattern, undefined, settingsSource)
    logEvent('sandbox_exclude_command', {})
  }
  SandboxManager.refreshConfig()
  const modeLanded =
    written.mode === undefined ||
    (written.mode === 'disabled'
      ? !SandboxManager.isSandboxEnabledInSettings()
      : SandboxManager.isSandboxEnabledInSettings() &&
        (written.mode === 'auto-allow') ===
          SandboxManager.isAutoAllowBashIfSandboxedEnabled())
  const fallbackLanded =
    written.allowUnsandboxedCommands === undefined ||
    SandboxManager.areUnsandboxedCommandsAllowed() ===
      written.allowUnsandboxedCommands
  const excludeLanded =
    written.excludeCommand === undefined ||
    SandboxManager.getExcludedCommands().includes(
      written.excludeCommand.replace(/^["']|["']$/g, '').trim(),
    )
  if (!(modeLanded && fallbackLanded && excludeLanded)) {
    return {
      ok: false,
      failed: true,
      code: 'write_not_landed',
      error:
        "The settings file could not be updated. Check that the project's .claude/settings.local.json can be written.",
    }
  }
  return { ok: true, written }
}

export async function runSandboxSettingsEdit(
  raw: unknown,
): Promise<SandboxSettingsEditResult> {
  const result = await applySandboxSettingsEdit(raw)
  if (!result.ok) {
    logEvent('sandbox_set_settings', {})
    return { ok: false, error: result.error }
  }
  return result
}
