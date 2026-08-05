import * as React from 'react';
import { useEffect, useRef } from 'react';
import { Text } from '@anthropic/ink';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { isCoordinatorMode } from '../../coordinator/coordinatorMode.js';
import { getSessionId, isSessionPersistenceDisabled } from '../../bootstrap/state.js';
import {
  getCurrentSessionAgentColor,
  getCurrentSessionAiTitle,
  getCurrentSessionTitle,
} from '../../utils/sessionStorage.js';
import { isAutoMemoryEnabled } from '../../memdir/paths.js';
import { logForDebugging } from '../../utils/debug.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import type { BackgroundSeed } from '../../cli/bg/helpers.js';
import {
  deriveForkSessionSeed,
  formatForkSessionToast,
  getForkSessionPreflightError,
  isForkRestrictedLaunch,
  spawnBackgroundSessionFork,
} from '../../utils/spawnBackgroundSessionFork.js';

/**
 * densable 2.1.212 `/fork` — nZ_ → L2p → D$t({ keepParent: true }).
 *
 * densable nZ_ only preflights + M9e seed, then returns L2p.
 * densable L2p live-reads effort/mode/dirs/rules via qe() selectors at spawn time.
 */

type ForkingPaneProps = {
  onDone: LocalJSXCommandOnDone;
  prompt: string;
  seed: BackgroundSeed;
  messages: LocalJSXCommandContext['messages'];
  /** Live app-state reader — densable L2p qe() selectors. */
  getAppState?: LocalJSXCommandContext['getAppState'];
  memoryToggledOff?: boolean;
  /** densable settings.worktree.bgIsolation === "none" → editsIn this-tree. */
  bgIsolationNone?: boolean;
  forkBoundaryAt?: string;
  lastMessageUuid?: string | null;
};

type LiveForkLaunch = {
  permissionMode?: string;
  effortValue?: string | number;
  additionalWorkingDirectories?: string[];
  sessionPermissionRules?: { allow: string[]; deny: string[] };
};

/**
 * densable L2p live selectors (qe) — read mode/effort/dirs/rules at spawn,
 * not at nZ_ preflight (mode can change mid-Forking…).
 */
function readLiveForkLaunch(getAppState?: LocalJSXCommandContext['getAppState']): LiveForkLaunch {
  const out: LiveForkLaunch = {};
  try {
    const app = getAppState?.();
    const tpc = app?.toolPermissionContext;
    if (tpc && typeof tpc === 'object') {
      if (typeof (tpc as { mode?: unknown }).mode === 'string') {
        out.permissionMode = (tpc as { mode: string }).mode;
      }
      const addDirs = (tpc as { additionalWorkingDirectories?: unknown }).additionalWorkingDirectories;
      if (addDirs instanceof Map) {
        out.additionalWorkingDirectories = Array.from(addDirs.keys()).filter((k): k is string => typeof k === 'string');
      } else if (Array.isArray(addDirs)) {
        out.additionalWorkingDirectories = addDirs.filter((d): d is string => typeof d === 'string');
      } else if (addDirs && typeof addDirs === 'object') {
        out.additionalWorkingDirectories = Object.keys(addDirs as Record<string, unknown>);
      }
      const allow = (tpc as { alwaysAllowRules?: { session?: string[] } }).alwaysAllowRules?.session ?? [];
      const deny = (tpc as { alwaysDenyRules?: { session?: string[] } }).alwaysDenyRules?.session ?? [];
      if (allow.length > 0 || deny.length > 0) {
        out.sessionPermissionRules = { allow: [...allow], deny: [...deny] };
      }
    }
    if (app && typeof (app as { effortValue?: unknown }).effortValue !== 'undefined') {
      out.effortValue = (app as { effortValue?: string | number }).effortValue;
    }
  } catch {
    /* optional */
  }
  return out;
}

/**
 * densable L2p — dim `Forking…` while D$t keepParent runs once.
 * Live-reads permission mode / effort / dirs / rules at spawn (qe selectors).
 */
function ForkingPane({
  onDone,
  prompt,
  seed,
  messages,
  getAppState,
  memoryToggledOff,
  bgIsolationNone,
  forkBoundaryAt,
  lastMessageUuid,
}: ForkingPaneProps): React.ReactNode {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      // densable L2p: qe(effort), qe(mode), qe(dirs), qe(allow), qe(deny) at spawn
      const live = readLiveForkLaunch(getAppState);
      try {
        const result = await spawnBackgroundSessionFork({
          prompt,
          source: 'fork_session',
          seed,
          permissionMode: live.permissionMode,
          effortValue: live.effortValue,
          additionalWorkingDirectories: live.additionalWorkingDirectories,
          sessionPermissionRules: live.sessionPermissionRules,
          memoryToggledOff,
          bgIsolationNone,
          forkBoundaryAt,
          lastMessageUuid,
        });

        if (!result.ok) {
          logEvent('tengu_feature_sad', {
            feature_name: 'repl_session_fork' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            error_code: (result.reason ?? 'spawn_failed') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          });
          onDone(result.error, { display: 'system' });
          return;
        }

        logEvent('tengu_feature_use', {
          feature_name: 'repl_session_fork' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
        logEvent('tengu_session_fork', {
          had_prompt: prompt.length > 0,
          message_count: messages.length,
          had_worktree: result.hadWorktree,
          relocated: result.relocatedTo !== undefined,
        });

        // densable toast uses live permission mode (lFt) for inheritance note
        onDone(
          formatForkSessionToast({
            name: result.name,
            short: result.short,
            hadPrompt: result.hadPrompt,
            editsIn: result.editsIn,
            relocatedTo: result.relocatedTo,
            permissionMode: live.permissionMode,
          }),
          { display: 'system' },
        );
      } catch (error) {
        logForDebugging(`Fork command error: ${error}`, { level: 'error' });
        logEvent('tengu_feature_sad', {
          feature_name: 'repl_session_fork' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          error_code: 'unexpected_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
        onDone(
          `Couldn't fork — ${error instanceof Error ? error.message : String(error)}. This session is unaffected; try again.`,
          { display: 'system' },
        );
      }
    })();
  }, [onDone, prompt, seed, messages, getAppState, memoryToggledOff, bgIsolationNone, forkBoundaryAt, lastMessageUuid]);

  // densable: jsx(h, { dimColor: true, children: "Forking…" })
  return <Text dimColor>Forking…</Text>;
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const prompt = args.trim();

  // densable nZ_: coordinator / persistence / restricted launch / M9e seed
  // densable M9e: name = _v(wt()) ?? v$e(wt()); color = DLt()
  let sessionTitle: string | null = null;
  let sessionAiTitle: string | null = null;
  let agentColor: string | undefined;
  try {
    sessionTitle = getCurrentSessionTitle(getSessionId()) ?? null;
  } catch {
    sessionTitle = null;
  }
  try {
    // densable v$e
    sessionAiTitle = getCurrentSessionAiTitle(getSessionId()) ?? null;
  } catch {
    sessionAiTitle = null;
  }
  try {
    agentColor = getCurrentSessionAgentColor();
  } catch {
    agentColor = undefined;
  }
  const seed = deriveForkSessionSeed(context.messages as any, prompt, {
    sessionTitle,
    sessionAiTitle,
    agentColor,
  });

  const preflight = getForkSessionPreflightError({
    isCoordinator: isCoordinatorMode(),
    persistenceDisabled: isSessionPersistenceDisabled(),
    restrictedLaunch: isForkRestrictedLaunch(),
    seed,
  });
  if (preflight) {
    logEvent('tengu_feature_sad', {
      feature_name: 'repl_session_fork' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code: (preflight.includes('persistence')
        ? 'persistence_off'
        : preflight.includes('launch flags')
          ? 'restricted_launch'
          : preflight.includes('coordinator')
            ? 'coordinator_mode'
            : 'nothing_to_fork') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    onDone(preflight, { display: 'system' });
    return null;
  }

  // densable nZ_ does NOT snapshot mode/effort — L2p live-reads. Only sticky
  // settings + memory that D$t needs but L2p doesn't qe().
  let memoryToggledOff: boolean | undefined;
  let bgIsolationNone: boolean | undefined;
  try {
    // densable: settings.worktree.bgIsolation === "none" → editsIn this-tree
    const { getSettings_DEPRECATED } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/settings/settings.js') as typeof import('../../utils/settings/settings.js');
    const s = getSettings_DEPRECATED?.() as { worktree?: { bgIsolation?: string } } | undefined;
    if (s?.worktree?.bgIsolation === 'none') {
      bgIsolationNone = true;
    }
  } catch {
    /* settings optional */
  }
  try {
    // densable nZ_/D$t: memoryToggledOff: _U()||void 0
    memoryToggledOff = !isAutoMemoryEnabled() ? true : undefined;
  } catch {
    /* optional */
  }

  const last = [...context.messages].reverse().find(m => m.type === 'user' || m.type === 'assistant') as
    | { uuid?: string; timestamp?: string }
    | undefined;

  // densable nZ_ returns L2p pane (not null) after preflight —
  // only onDone/prompt/seed/messages; L2p live-reads the rest.
  return (
    <ForkingPane
      onDone={onDone}
      prompt={prompt}
      seed={seed!}
      messages={context.messages}
      getAppState={context.getAppState}
      memoryToggledOff={memoryToggledOff}
      bgIsolationNone={bgIsolationNone}
      forkBoundaryAt={typeof last?.timestamp === 'string' ? last.timestamp : undefined}
      lastMessageUuid={typeof last?.uuid === 'string' ? last.uuid : null}
    />
  );
}
