/**
 * densable 2.1.225 NXv / $Xv — workspace trust gate for `claude agents`.
 *
 * Gold:
 *   NXv/agentsTrustDecision:
 *     CI | IS_DEMO | CLAUBBIT → "skip"
 *     checkHasTrustDialogAccepted() && !DTt() → "trusted"
 *     else → "ask"
 *   $Xv/ensureAgentsWorkspaceTrust(root, decision):
 *     skip: if !CLAUBBIT && trusted → setSessionTrustAccepted + prime policy
 *     trusted: setSessionTrustAccepted + prime
 *     ask: render TrustDialog, then setSessionTrustAccepted + clearPluginCache + resetGrowthBook
 *
 * DTt recovered (partial local map):
 *   CLAUDE_CODE_SANDBOXED | sessionTrust | bg | home | (remote) → false
 *   else gated project/local allow/additionalDirectories → true
 * Full abn/Ypt/yde gates not fully mirrored — when trust is accepted and no
 * project/local allow surface is present, DTt is false (trusted path).
 */

import { homedir } from 'os';
import React from 'react';
import type { Root } from '@anthropic/ink';
import { setSessionTrustAccepted, getSessionTrustAccepted } from '../bootstrap/state.js';
import { checkHasTrustDialogAccepted } from '../utils/config.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { isSandboxedSession } from '../utils/sessionRoleEnv.js';
import { isBgSession } from '../utils/concurrentSessions.js';
import { getCwd } from '../utils/cwd.js';
import { getSettingsForSource } from '../utils/settings/settings.js';
import { getEnabledSettingSources } from '../utils/settings/constants.js';
import { showSetupDialog } from '../interactiveHelpers.js';
import { resetGrowthBook, initializeGrowthBook } from '../services/analytics/growthbook.js';
import { clearPluginCache } from '../utils/plugins/pluginLoader.js';
import { logError } from '../utils/log.js';

export type AgentsTrustDecision = 'skip' | 'trusted' | 'ask';

/**
 * densable y9d — source has allow rules or additionalDirectories.
 */
function sourceHasTrustSensitivePermissions(source: 'projectSettings' | 'localSettings'): boolean {
  if (!getEnabledSettingSources().includes(source)) return false;
  const settings = getSettingsForSource(source);
  if (!settings) return false;
  const allow = settings.permissions?.allow;
  if (Array.isArray(allow) && allow.length > 0) return true;
  const dirs = settings.permissions?.additionalDirectories;
  return Array.isArray(dirs) && dirs.length > 0;
}

/**
 * densable DTt — when true, even a prior hasTrustDialogAccepted is not enough
 * (project/local allow surface still needs interactive trust).
 *
 * Early-outs (return false = do not force re-ask):
 * sandboxed, session trust already accepted this process, bg session, home dir.
 * densable FB() remote early-out left as no-op (no local FB identity recovered).
 */
export function agentsWorkspaceTrustNeedsReask(): boolean {
  if (isSandboxedSession()) return false;
  if (getSessionTrustAccepted()) return false;
  if (isBgSession()) return false;
  try {
    if (homedir() === getCwd()) return false;
  } catch {
    // getCwd can throw if cwd vanished — fall through to settings check
  }
  // densable abn gates default to checking project/local when present.
  // Without Ypt/yde, treat presence of allow surface as needing re-ask.
  return sourceHasTrustSensitivePermissions('projectSettings') || sourceHasTrustSensitivePermissions('localSettings');
}

/** densable NXv */
export function agentsTrustDecision(): AgentsTrustDecision {
  if (isEnvTruthy(process.env.CI) || isEnvTruthy(process.env.IS_DEMO) || isEnvTruthy(process.env.CLAUBBIT)) {
    return 'skip';
  }
  // densable: rp() && !DTt() → trusted
  return checkHasTrustDialogAccepted() && !agentsWorkspaceTrustNeedsReask() ? 'trusted' : 'ask';
}

async function primeAfterTrust(): Promise<void> {
  // densable primePlanSlugCollisions + capturePolicySnapshot — optional best-effort.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const policy = require('../utils/permissions/policyLimits.js') as {
      capturePolicySnapshot?: () => void;
    };
    policy.capturePolicySnapshot?.();
  } catch {
    // optional
  }
}

/**
 * densable $Xv — ensure workspace trust before FleetView.
 * `root` must support render/unmount (Ink Root).
 */
export async function ensureAgentsWorkspaceTrust(
  root: Root,
  decision: AgentsTrustDecision = agentsTrustDecision(),
): Promise<void> {
  switch (decision) {
    case 'skip': {
      if (!isEnvTruthy(process.env.CLAUBBIT) && checkHasTrustDialogAccepted()) {
        setSessionTrustAccepted(true);
        await primeAfterTrust();
      }
      return;
    }
    case 'trusted': {
      setSessionTrustAccepted(true);
      await primeAfterTrust();
      return;
    }
    case 'ask': {
      const { TrustDialog } = await import('../components/TrustDialog/TrustDialog.js');
      // densable: getCommands(cwd).catch(()=>[]) — empty commands ok for TrustDialog
      let commands: Parameters<typeof TrustDialog>[0]['commands'] = [];
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getCommands } = require('../commands.js') as typeof import('../commands.js');
        commands = (await getCommands(getCwd()).catch(() => [])) as typeof commands;
      } catch {
        commands = [];
      }
      await showSetupDialog(root, done => (
        // TrustDialog onDone accepts void
        <TrustDialog commands={commands} onDone={() => done()} />
      ));
      setSessionTrustAccepted(true);
      clearPluginCache('post-trust: re-discover project @skills-dir plugins');
      resetGrowthBook({ preservePendingExposures: true });
      void initializeGrowthBook().catch(err => logError(err));
      await primeAfterTrust();
      return;
    }
  }
}
