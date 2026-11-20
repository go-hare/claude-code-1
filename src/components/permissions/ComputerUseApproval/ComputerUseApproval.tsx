import { getSentinelCategory } from '@ant/computer-use-mcp/sentinelApps';
import type {
  CuAppPermTier,
  CuPermissionRequest,
  CuPermissionResponse,
  ResolvedAppRequest,
} from '@ant/computer-use-mcp/types';
import { DEFAULT_GRANT_FLAGS } from '@ant/computer-use-mcp/types';
import figures from 'figures';
import * as React from 'react';
import { useMemo, useState } from 'react';
import { Box, Dialog, Text, useModalOrTerminalSize, useTerminalSize } from '@anthropic/ink';
import { CONFIRM_SELECT_ARM_MS, confirmSelectRefused } from '../../ConfirmSelect.js';
import { execFileNoThrow } from '../../../utils/execFileNoThrow.js';
import { plural } from '../../../utils/stringUtils.js';
import type { OptionWithDescription } from '../../CustomSelect/select.js';
import { Select } from '../../CustomSelect/select.js';

type ComputerUseApprovalProps = {
  request: CuPermissionRequest;
  onDone: (response: CuPermissionResponse) => void;
};

const DENY_ALL_RESPONSE: CuPermissionResponse = {
  granted: [],
  denied: [],
  flags: DEFAULT_GRANT_FLAGS,
};

/**
 * Two-panel dispatcher. When `request.tccState` is present, macOS permissions
 * (Accessibility / Screen Recording) are missing and the app list is
 * irrelevant — show a TCC panel that opens System Settings. Otherwise show the
 * app allowlist + grant-flags panel.
 */
export function ComputerUseApproval({ request, onDone }: ComputerUseApprovalProps): React.ReactNode {
  return request.tccState ? (
    <ComputerUseTccPanel tccState={request.tccState} onDone={() => onDone(DENY_ALL_RESPONSE)} />
  ) : (
    <ComputerUseAppListPanel request={request} onDone={onDone} />
  );
}

// ── TCC panel ─────────────────────────────────────────────────────────────

type TccOption = 'open_accessibility' | 'open_screen_recording' | 'retry';

function ComputerUseTccPanel({
  tccState,
  onDone,
}: {
  tccState: NonNullable<CuPermissionRequest['tccState']>;
  onDone: () => void;
}): React.ReactNode {
  const options = useMemo<OptionWithDescription<TccOption>[]>(() => {
    const opts: OptionWithDescription<TccOption>[] = [];
    if (!tccState.accessibility) {
      opts.push({
        label: 'Open System Settings → Accessibility',
        value: 'open_accessibility',
      });
    }
    if (!tccState.screenRecording) {
      opts.push({
        label: 'Open System Settings → Screen Recording',
        value: 'open_screen_recording',
      });
    }
    opts.push({ label: 'Try again', value: 'retry' });
    return opts;
  }, [tccState.accessibility, tccState.screenRecording]);

  function onChange(value: TccOption): void {
    switch (value) {
      case 'open_accessibility':
        void execFileNoThrow(
          'open',
          ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'],
          { useCwd: false },
        );
        return;
      case 'open_screen_recording':
        void execFileNoThrow(
          'open',
          ['x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'],
          { useCwd: false },
        );
        return;
      case 'retry':
        // Resolve with deny-all — the model re-calls request_access, which
        // re-checks TCC and renders the app list if now granted.
        onDone();
        return;
    }
  }

  return (
    <Dialog title="Computer Use needs macOS permissions" onCancel={onDone}>
      <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
        <Box flexDirection="column">
          <Text>
            Accessibility: {tccState.accessibility ? `${figures.tick} granted` : `${figures.cross} not granted`}
          </Text>
          <Text>
            Screen Recording: {tccState.screenRecording ? `${figures.tick} granted` : `${figures.cross} not granted`}
          </Text>
        </Box>
        <Text dimColor>
          Grant the missing permissions in System Settings, then select &quot;Try again&quot;. macOS may require you to
          restart Claude Code after granting Screen Recording.
        </Text>
        {/* Official 2.1.326 #315: disable printable keybindings so stray letters cannot navigate/select TCC actions. */}
        <Select options={options} disablePrintableKeybindings onChange={onChange} onCancel={onDone} />
      </Box>
    </Dialog>
  );
}

// ── App allowlist panel ───────────────────────────────────────────────────

type AppListOption = 'allow_all' | 'deny';

/** Official 2.1.328 (#657, SEA `OCt`): plainer sentinel warnings. */
export const COMPUTER_USE_SENTINEL_WARNING: Record<NonNullable<ReturnType<typeof getSentinelCategory>>, string> = {
  shell: 'Can run commands on your computer',
  filesystem: 'Can open, change, or delete any file, and run apps and scripts',
  system_settings: 'Can change system settings',
};

/** Official 2.1.328 (#657, SEA `NCt`): per-app access level labels. */
export const COMPUTER_USE_TIER_LABEL: Record<CuAppPermTier, string> = {
  read: 'view only',
  click: 'click only',
  full: 'full access',
};

/** Official 2.1.328 (#657, SEA `LCt`): plainer flag labels. */
export const COMPUTER_USE_FLAG_LABEL: Record<keyof typeof DEFAULT_GRANT_FLAGS, string> = {
  clipboardRead: 'Read your clipboard',
  clipboardWrite: 'Write to your clipboard',
  systemKeyCombos: 'Use system shortcuts (⌘Q, ⌘Tab, and similar)',
};

/** Official 2.1.328 (#657, SEA `FCt`): deduplicate requested apps by bundleId/name, keeping highest-priority entry. */
export function deduplicateComputerUseApps(apps: readonly ResolvedAppRequest[]): ResolvedAppRequest[] {
  const rank = (app: ResolvedAppRequest): number => {
    if (!app.resolved) return 0;
    const sentinel = getSentinelCategory(app.resolved.bundleId) ? 1 : 0;
    return 4 + (app.alreadyGranted ? 0 : 2) + sentinel;
  };
  const byKey = new Map<string, ResolvedAppRequest>();
  for (const app of apps) {
    const key = app.resolved?.bundleId ?? app.requestedName;
    const prev = byKey.get(key);
    if (!prev || rank(app) > rank(prev)) {
      byKey.set(key, app);
    }
  }
  return [...byKey.values()];
}

/** Official 2.1.328 (`BCt`): row cost for an app entry (2 for ungranted sentinel warnings, 1 otherwise). */
function computerUseAppRowCost(app: ResolvedAppRequest): number {
  return app.resolved && !app.alreadyGranted && getSentinelCategory(app.resolved.bundleId) ? 2 : 1;
}

/**
 * Official 2.1.328 (`pDe`): pack visible apps within `rowBudget`, prioritizing
 * 2-row sentinel apps ahead of 1-row apps (`rowCosts[b] - rowCosts[a] || a - b`)
 * and reserving 1 row for the overflow warning when any apps are omitted.
 */
export function selectVisibleComputerUseApps(
  dedupedApps: readonly ResolvedAppRequest[],
  rowBudget: number,
): { visibleApps: ResolvedAppRequest[]; hiddenCount: number } {
  const rowCosts = dedupedApps.map(computerUseAppRowCost);
  const totalRows = rowCosts.reduce((sum, cost) => sum + cost, 0);
  if (totalRows <= rowBudget) {
    return { visibleApps: [...dedupedApps], hiddenCount: 0 };
  }
  const maxContentRows = Math.max(0, rowBudget - 1);
  const sortedIndices = dedupedApps.map((_, i) => i).sort((a, b) => rowCosts[b]! - rowCosts[a]! || a - b);
  const keptIndices = new Set<number>();
  let usedRows = 0;
  for (const idx of sortedIndices) {
    const cost = rowCosts[idx]!;
    if (usedRows + cost > maxContentRows) {
      continue;
    }
    keptIndices.add(idx);
    usedRows += cost;
  }
  const visibleApps = dedupedApps.filter((_, idx) => keptIndices.has(idx));
  return { visibleApps, hiddenCount: dedupedApps.length - keptIndices.size };
}

function ComputerUseAppListPanel({ request, onDone }: ComputerUseApprovalProps): React.ReactNode {
  const dedupedApps = useMemo(() => deduplicateComputerUseApps(request.apps), [request.apps]);
  const [openedAt] = useState(() => Date.now());
  const isInputRefused = () => confirmSelectRefused(openedAt, CONFIRM_SELECT_ARM_MS, Date.now());
  const terminal = useTerminalSize();
  const { rows: availableRows } = useModalOrTerminalSize(terminal);

  type FlagKey = keyof typeof DEFAULT_GRANT_FLAGS;
  const ALL_FLAG_KEYS: FlagKey[] = ['clipboardRead', 'clipboardWrite', 'systemKeyCombos'];
  const requestedFlagKeys = useMemo(
    (): FlagKey[] => ALL_FLAG_KEYS.filter(k => request.requestedFlags[k]),
    [request.requestedFlags],
  );

  // Reserve rows for dialog chrome, reason/flags/warnings, and Select options so
  // large app lists never push the Allow/Deny Select off-screen.
  const reservedRows =
    12 + (request.reason ? 2 : 0) + (requestedFlagKeys.length > 0 ? requestedFlagKeys.length + 2 : 0);
  const appRowBudget = Math.max(1, availableRows - reservedRows);
  const { visibleApps, hiddenCount: overflowAppCount } = useMemo(
    () => selectVisibleComputerUseApps(dedupedApps, appRowBudget),
    [dedupedApps, appRowBudget],
  );

  // Official 2.1.328 (`pDe`): pre-check ONLY visible resolved, not-yet-granted apps
  // so hidden/unshown apps are never included in the grant.
  const [checked] = useState<ReadonlySet<string>>(
    () => new Set(visibleApps.flatMap(a => (a.resolved && !a.alreadyGranted ? [a.resolved.bundleId] : []))),
  );

  const visibleCheckedCount = useMemo(
    () => visibleApps.reduce((count, a) => count + (a.resolved && checked.has(a.resolved.bundleId) ? 1 : 0), 0),
    [visibleApps, checked],
  );

  const options = useMemo<OptionWithDescription<AppListOption>[]>(
    () => [
      {
        label: (
          <Text>
            Deny, and tell Claude what to do differently <Text bold>(esc)</Text>
          </Text>
        ),
        value: 'deny',
      },
      {
        label: `Allow for this session (${visibleCheckedCount} ${plural(visibleCheckedCount, 'app')})`,
        value: 'allow_all',
      },
    ],
    [visibleCheckedCount],
  );

  function respond(allow: boolean): void {
    if (allow && isInputRefused()) {
      return;
    }
    if (!allow) {
      onDone(DENY_ALL_RESPONSE);
      return;
    }
    const now = Date.now();
    const visibleSet = new Set(visibleApps);
    const granted = visibleApps.flatMap(a =>
      a.resolved && checked.has(a.resolved.bundleId)
        ? [
            {
              bundleId: a.resolved.bundleId,
              displayName: a.resolved.displayName,
              grantedAt: now,
              tier: a.proposedTier,
            },
          ]
        : [],
    );
    const denied = dedupedApps.flatMap<CuPermissionResponse['denied'][number]>(a => {
      if (!a.resolved) {
        return [{ bundleId: a.requestedName, reason: 'not_installed' }];
      }
      if (checked.has(a.resolved.bundleId) || !visibleSet.has(a) || a.alreadyGranted) {
        return [];
      }
      return [{ bundleId: a.resolved.bundleId, reason: 'user_denied' }];
    });
    // Grant all requested flags on allow — per-flag toggles are a follow-up.
    const flags = {
      ...DEFAULT_GRANT_FLAGS,
      ...Object.fromEntries(requestedFlagKeys.map(k => [k, true] as const)),
    };
    onDone({ granted, denied, flags });
  }

  const checkedTiers = useMemo(
    () =>
      visibleApps.flatMap(a =>
        a.resolved && checked.has(a.resolved.bundleId)
          ? [{ tier: a.proposedTier ?? 'full', warned: Boolean(getSentinelCategory(a.resolved.bundleId)) }]
          : [],
      ),
    [visibleApps, checked],
  );
  const hasUnwarnedFullAccess = checkedTiers.some(t => t.tier === 'full' && !t.warned);
  const hasUnwarnedClickOnly = checkedTiers.some(t => t.tier === 'click' && !t.warned);

  const singleAppName = dedupedApps.length === 1 ? (dedupedApps[0]?.resolved?.displayName ?? '') : '';
  const dialogTitle = singleAppName
    ? `Claude wants to use ${singleAppName}`
    : dedupedApps.length > 0
      ? 'Claude wants to use these apps'
      : 'Claude wants these permissions';

  return (
    <Dialog title={dialogTitle} onCancel={() => respond(false)}>
      <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
        {request.reason ? <Text dimColor>{request.reason}</Text> : null}

        <Box flexDirection="column">
          {visibleApps.map(a => {
            const resolved = a.resolved;
            if (!resolved) {
              return (
                <Text key={a.requestedName} dimColor>
                  {'  '}
                  {figures.circle} {a.requestedName} <Text dimColor>(not installed)</Text>
                </Text>
              );
            }
            if (a.alreadyGranted) {
              return (
                <Text key={resolved.bundleId} dimColor>
                  {'  '}
                  {figures.tick} {resolved.displayName} <Text dimColor>(already allowed)</Text>
                </Text>
              );
            }
            const sentinel = getSentinelCategory(resolved.bundleId);
            const isChecked = checked.has(resolved.bundleId);
            const tierLabel = COMPUTER_USE_TIER_LABEL[a.proposedTier ?? 'full'];
            return (
              <Box key={resolved.bundleId} flexDirection="column">
                <Text>
                  {'  '}
                  {isChecked ? figures.circleFilled : figures.circle} {resolved.displayName}{' '}
                  <Text dimColor>({tierLabel})</Text>
                </Text>
                {sentinel ? (
                  <Text bold>
                    {'    '}
                    {figures.warning} {COMPUTER_USE_SENTINEL_WARNING[sentinel]}
                  </Text>
                ) : null}
              </Box>
            );
          })}
          {overflowAppCount > 0 ? (
            <Text bold>
              {'  '}… +{overflowAppCount} more {overflowAppCount === 1 ? 'app' : 'apps'} not shown, and not included in
              this grant.
            </Text>
          ) : null}
        </Box>

        {requestedFlagKeys.length > 0 ? (
          <Box flexDirection="column">
            {dedupedApps.length > 0 ? <Text dimColor>Also requested:</Text> : null}
            {requestedFlagKeys.map(flag => (
              <Text key={flag} dimColor>
                {'  '}· {COMPUTER_USE_FLAG_LABEL[flag]}
              </Text>
            ))}
          </Box>
        ) : null}

        {(request.willHide && request.willHide.length > 0) || hasUnwarnedFullAccess || hasUnwarnedClickOnly ? (
          <Box flexDirection="column">
            {request.willHide && request.willHide.length > 0 ? (
              <Text dimColor>
                {request.willHide.length} other {plural(request.willHide.length, 'app')} will be hidden while Claude
                works.
              </Text>
            ) : null}
            {hasUnwarnedFullAccess ? (
              <Text dimColor>
                With full access, Claude can change or delete files on your computer without asking first.
              </Text>
            ) : null}
            {hasUnwarnedClickOnly ? (
              <Text dimColor>With click only, Claude can click buttons that run code.</Text>
            ) : null}
          </Box>
        ) : null}

        <Select
          hideIndexes={true}
          defaultFocusValue="deny"
          declineValue="deny"
          disablePrintableKeybindings
          refuseInput={isInputRefused}
          options={options}
          onChange={v => respond(v === 'allow_all')}
          onCancel={() => respond(false)}
        />
      </Box>
    </Dialog>
  );
}
