import * as React from 'react';
import { useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  AccessibilityContext,
  Box,
  Byline,
  clamp,
  Dialog,
  type DOMElement,
  type KeyboardEvent,
  KeyboardShortcutHint,
  PANE_PADDING_X_INLINE,
  type PasteEvent,
  StatusIcon,
  Text,
  useModalOrTerminalSize,
  useTerminalFocus,
  useTerminalSize,
  wrapAnsi,
} from '@anthropic/ink';
import {
  clearCommandMemoizationCaches,
  type Command,
  type CommandBase,
  type CommandResultDisplay,
  getCommandName,
  type PromptCommand,
} from '../../commands.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useSearchInput } from '../../hooks/useSearchInput.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { roughTokenCountEstimation } from '../../services/tokenEstimation.js';
import {
  CLAUDE_AI_SYNC_LABEL,
  normalizeCommandNameKey,
  stripControlCharsForDisplay,
} from '../../skills/syncedSkillsHarden.js';
import { useAppState } from '../../state/AppState.js';
import { uniq } from '../../utils/array.js';
import { getDisplayPath } from '../../utils/file.js';
import { formatNumber } from '../../utils/format.js';
import { SKILL_OVERRIDE_CYCLE_MODES, type SkillOverrideMode } from '../../utils/residualFinalEnvGates.js';
import { isSafeModeEnabled, safeModeDisableHint } from '../../utils/safeMode.js';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import { getSettingSourceName, isSettingSourceEnabled, type SettingSource } from '../../utils/settings/constants.js';
import { getSettingsForSource, updateSettingsForSource } from '../../utils/settings/settings.js';
import { countCharInString, plural } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { EmptyState } from '../EmptyState.js';
import { ItemList } from '../ItemList.js';
import { SearchBox } from '../SearchBox.js';

// Skills are always PromptCommands with CommandBase properties
type SkillCommand = CommandBase & PromptCommand;

type SkillLockInfo = {
  value: SkillOverrideMode;
  source: 'policy' | 'flag' | 'reserved-name' | 'author' | 'plugin';
};

type SkillOverrideStateSnapshot = {
  localOverrides: Record<string, SkillOverrideMode | undefined>;
  lowerTier: Map<string, SkillOverrideMode>;
  locked: Map<SkillCommand, SkillLockInfo>;
};

const OVERRIDE_PRECEDENCE: Record<SkillOverrideMode, number> = {
  on: 0,
  'model-invocable': 0,
  'name-only': 1,
  'user-invocable-only': 2,
  off: 3,
};

const LOCK_SETTING_SOURCES = ['policySettings', 'flagSettings'] as const;

function isSkillDialogCommand(cmd: Command): cmd is SkillCommand {
  return (
    cmd.type === 'prompt' &&
    (cmd.loadedFrom === 'skills' ||
      cmd.loadedFrom === 'syncedSkills' ||
      cmd.loadedFrom === 'commands_DEPRECATED' ||
      cmd.loadedFrom === 'plugin' ||
      cmd.loadedFrom === 'mcp')
  );
}

function isValidSettingsOverrideKey(name: string): boolean {
  return name !== '__proto__';
}

function getOwnOverride(
  record: Readonly<Record<string, SkillOverrideMode | undefined>> | undefined,
  key: string | undefined,
): SkillOverrideMode | undefined {
  if (record == null || key == null) return undefined;
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function getSkillBareOverrideKey(skill: SkillCommand): string | undefined {
  const n = skill.unqualifiedName;
  if (n == null) return undefined;
  if (skill.loadedFrom !== 'syncedSkills') return n;
  return (skill as { bareNameReserved?: boolean }).bareNameReserved ? undefined : n;
}

function getSyncedSkillClaimedBareName(cmd: Command): string | undefined {
  return cmd.type === 'prompt' &&
    cmd.loadedFrom === 'syncedSkills' &&
    cmd.unqualifiedName != null &&
    (cmd.aliases?.includes(cmd.unqualifiedName) ?? false)
    ? cmd.unqualifiedName
    : undefined;
}

function getSyncedSkillValidBareName(cmd: Command): string | undefined {
  const bare = getSyncedSkillClaimedBareName(cmd);
  return bare !== undefined && !/[^a-zA-Z0-9.:\-_]/.test(bare) ? bare : undefined;
}

function getSkillDisplayName(skill: SkillCommand): string {
  const bare = getSyncedSkillValidBareName(skill);
  return bare !== undefined && getCommandName(skill) === bare ? bare : skill.name;
}

function getSkillSourceLabel(source: SkillCommand['source'], loadedFrom?: SkillCommand['loadedFrom']): string {
  if (loadedFrom === 'syncedSkills') return CLAUDE_AI_SYNC_LABEL;
  switch (source) {
    case 'mcp':
    case 'plugin':
      return source;
    case 'memoryStore':
      return 'memory store';
    case 'bundled':
    case 'builtin':
      return 'built-in';
    default:
      return getSettingSourceName(source);
  }
}

function estimateSkillTokens(skill: Command, bytesPerToken?: number): number {
  const frontmatterText = [skill.name, skill.description, skill.whenToUse].filter(Boolean).join(' ');
  return roughTokenCountEstimation(frontmatterText, bytesPerToken);
}

function sortAndFilterSkillCommands(
  commands: Command[],
  { sortByTokens = false }: { sortByTokens?: boolean } = {},
): SkillCommand[] {
  const list = commands.filter(isSkillDialogCommand);
  if (sortByTokens) {
    const tokensBySkill = new Map(list.map(s => [s, estimateSkillTokens(s)]));
    return list.sort(
      (a, b) =>
        (tokensBySkill.get(b) ?? 0) - (tokensBySkill.get(a) ?? 0) ||
        getSkillDisplayName(a).localeCompare(getSkillDisplayName(b)),
    );
  }
  return list.sort(
    (a, b) =>
      getSkillSourceLabel(a.source, a.loadedFrom).localeCompare(getSkillSourceLabel(b.source, b.loadedFrom)) ||
      getSkillDisplayName(a).localeCompare(getSkillDisplayName(b)),
  );
}

type ShadowedSyncedSkillEntry = {
  bare: string;
  sentence: string;
  held: boolean;
  userCanFree: boolean;
  renameNeedsNameLine: boolean;
};

function formatBareSkillList(entries: ShadowedSyncedSkillEntry[]): string {
  const names = entries.map(item => `/${item.bare}`);
  if (names.length === 1) return names[0]!;
  if (names.length <= 4) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

function getCommandCategory(cmd: Command): string {
  if (cmd.type !== 'prompt') return 'builtin';
  if (cmd.loadedFrom === 'syncedSkills') return 'synced';
  switch (cmd.source) {
    case 'builtin':
      return 'builtin';
    case 'bundled':
      return 'bundled';
    case 'mcp':
    case 'memoryStore':
      return 'remote';
    case 'plugin':
      return 'plugin';
    case 'userSettings':
      return 'user';
    case 'projectSettings':
    case 'localSettings':
      return 'project';
    case 'policySettings':
      return 'managed';
    case 'flagSettings':
      return 'flag';
  }
}

function formatSyncedSkillShadowNotice(skills: SkillCommand[], allCommands: Command[]): string | undefined {
  const nonSynced = allCommands.filter(c => c.loadedFrom !== 'syncedSkills');
  const entries: ShadowedSyncedSkillEntry[] = [];
  for (const skill of skills) {
    const unqualifiedName = skill.unqualifiedName;
    if (
      skill.loadedFrom !== 'syncedSkills' ||
      unqualifiedName === undefined ||
      getSyncedSkillClaimedBareName(skill) !== undefined
    ) {
      continue;
    }
    const bare = stripControlCharsForDisplay(unqualifiedName);
    const exactMatch = nonSynced.find(
      c =>
        c.name === unqualifiedName ||
        getCommandName(c) === unqualifiedName ||
        (c.aliases?.includes(unqualifiedName) ?? false),
    );
    const normKey = normalizeCommandNameKey(unqualifiedName);
    const candidateNames = (u: Command) => [u.name, getCommandName(u), ...(u.aliases ?? [])];
    const matchNorm = (u: Command) => candidateNames(u).find(n => normalizeCommandNameKey(n) === normKey);
    const holder = exactMatch ?? nonSynced.find(u => matchNorm(u) !== undefined);
    if (!holder) {
      entries.push({
        bare,
        sentence: `Your claude.ai skill can't use /${bare} in this session.`,
        held: false,
        userCanFree: false,
        renameNeedsNameLine: false,
      });
      continue;
    }
    const promptHolder = holder.type === 'prompt' ? holder : undefined;
    const artifactNoun =
      promptHolder?.skillRoot !== undefined ? 'skill' : `command file ${stripControlCharsForDisplay(holder.name)}.md`;
    let holderDesc: string;
    let remedy = '';
    let renameNeedsNameLine = false;
    if (holder.kind === 'workflow') {
      holderDesc = 'a workflow';
    } else if (holder.loadedFrom === 'plugin') {
      holderDesc = 'a command from a plugin';
    } else {
      switch (getCommandCategory(holder)) {
        case 'user': {
          const rootHint =
            promptHolder?.skillRoot !== undefined
              ? ` in ${stripControlCharsForDisplay(getDisplayPath(promptHolder.skillRoot))}`
              : '';
          holderDesc = `your own ${artifactNoun}${rootHint}`;
          renameNeedsNameLine = holder.loadedFrom === 'skills';
          remedy = renameNeedsNameLine
            ? ' Rename it (folder and SKILL.md name) or delete it to use the claude.ai one.'
            : ' Rename or delete it to use the claude.ai one.';
          break;
        }
        case 'project':
          holderDesc = `this project's ${artifactNoun}`;
          break;
        case 'managed':
          holderDesc = `a ${artifactNoun} your organization manages`;
          break;
        case 'plugin':
          holderDesc = 'a command from a plugin';
          break;
        case 'remote':
          holderDesc =
            holder.loadedFrom === 'mcp'
              ? 'a skill from an MCP server'
              : holder.isMcp
                ? 'a prompt from an MCP server'
                : 'another command';
          break;
        case 'builtin':
        case 'bundled':
          holderDesc = 'a built-in Claude Code command';
          break;
        default:
          holderDesc = 'another command';
      }
    }
    const collisionSlash = `/${stripControlCharsForDisplay(matchNorm(holder) ?? holder.name)}`;
    const sentence =
      exactMatch !== undefined
        ? `/${bare} runs ${holderDesc}${remedy ? `.${remedy}` : ', not your claude.ai skill.'}`
        : `/${bare} is too close to ${collisionSlash}, ${holderDesc}${remedy ? `.${remedy}` : ", so your claude.ai skill can't use it."}`;
    entries.push({
      bare,
      sentence,
      held: true,
      userCanFree: remedy !== '',
      renameNeedsNameLine,
    });
  }
  if (entries.length === 0) return undefined;
  if (entries.length === 1) return entries[0]!.sentence;
  const statusPhrase = entries.every(a => a.held)
    ? 'are taken by other commands'
    : 'are taken by other commands or unavailable in this session';
  const prefix = `${formatBareSkillList(entries)} ${statusPhrase}, so they don't run your claude.ai skills.`;
  const freeable = entries.filter(a => a.userCanFree);
  if (freeable.length === 0) return prefix;
  const verb = freeable.some(a => a.renameNeedsNameLine) ? 'Rename (folder and SKILL.md name)' : 'Rename';
  const pronoun = freeable.length === 1 ? 'one' : 'ones';
  return `${prefix} ${verb} or delete your own ${formatBareSkillList(freeable)} to use the claude.ai ${pronoun}.`;
}

function getSkillAliasKeys(skill: SkillCommand): string[] {
  return [...(skill.aliases ?? []), ...(skill.unqualifiedName != null ? [skill.unqualifiedName] : [])];
}

function pickStrictestOverride(
  overrides: Readonly<Record<string, SkillOverrideMode | undefined>> | undefined,
  keys: readonly string[],
): SkillOverrideMode | undefined {
  let best: SkillOverrideMode | undefined;
  for (const k of keys) {
    const val = getOwnOverride(overrides, k);
    if (val !== undefined && (best === undefined || OVERRIDE_PRECEDENCE[val] > OVERRIDE_PRECEDENCE[best])) {
      best = val;
    }
  }
  return best;
}

function resolvePolicyOrFlagLock(
  skill: SkillCommand,
): { value: SkillOverrideMode; source: 'policySettings' | 'flagSettings' } | undefined {
  if (skill.source === 'plugin') return undefined;
  const aliasKeys = getSkillAliasKeys(skill);
  for (const source of LOCK_SETTING_SOURCES) {
    let overrides: Readonly<Record<string, SkillOverrideMode | undefined>> | undefined;
    try {
      overrides = getSettingsForSource(source)?.skillOverrides as
        | Readonly<Record<string, SkillOverrideMode | undefined>>
        | undefined;
    } catch {
      overrides = undefined;
    }
    const match = getOwnOverride(overrides, skill.name) ?? pickStrictestOverride(overrides, aliasKeys);
    if (match !== undefined) {
      return { value: match, source };
    }
  }
  return undefined;
}

function resolveSkillLock(skill: SkillCommand): SkillLockInfo | undefined {
  const policyOrFlag = resolvePolicyOrFlagLock(skill);
  if (policyOrFlag) {
    return {
      value: policyOrFlag.value,
      source: policyOrFlag.source === 'policySettings' ? 'policy' : 'flag',
    };
  }
  if (!isValidSettingsOverrideKey(skill.name)) {
    return {
      value: skill.disableModelInvocation ? 'user-invocable-only' : 'on',
      source: 'reserved-name',
    };
  }
  if (skill.disableModelInvocation) {
    return { value: 'user-invocable-only', source: 'author' };
  }
  if (skill.source === 'plugin') {
    return { value: 'on', source: 'plugin' };
  }
  return undefined;
}

function resolveLowerTierOverride(
  skill: SkillCommand,
  { skipLocalBareKey = false }: { skipLocalBareKey?: boolean } = {},
): SkillOverrideMode | undefined {
  const readForSource = (source: SettingSource) => {
    try {
      return isSettingSourceEnabled(source)
        ? (getSettingsForSource(source)?.skillOverrides as
            | Readonly<Record<string, SkillOverrideMode | undefined>>
            | undefined)
        : undefined;
    } catch {
      return undefined;
    }
  };
  const fromProjectOrUser = (key: string) =>
    getOwnOverride(readForSource('projectSettings'), key) ?? getOwnOverride(readForSource('userSettings'), key);
  const bareKey = getSkillBareOverrideKey(skill);
  let localOverrides: Readonly<Record<string, SkillOverrideMode | undefined>> | undefined;
  try {
    localOverrides = getSettingsForSource('localSettings')?.skillOverrides as
      | Readonly<Record<string, SkillOverrideMode | undefined>>
      | undefined;
  } catch {
    localOverrides = undefined;
  }
  const localBare = skipLocalBareKey ? undefined : getOwnOverride(localOverrides, bareKey);
  return fromProjectOrUser(skill.name) ?? (bareKey != null ? (localBare ?? fromProjectOrUser(bareKey)) : undefined);
}

function readLocalSkillOverridesSnapshot(): Record<string, SkillOverrideMode | undefined> {
  let raw: Readonly<Record<string, SkillOverrideMode | undefined>> | undefined;
  try {
    raw = getSettingsForSource('localSettings')?.skillOverrides as
      | Readonly<Record<string, SkillOverrideMode | undefined>>
      | undefined;
  } catch {
    raw = undefined;
  }
  return Object.assign(Object.create(null) as Record<string, SkillOverrideMode | undefined>, raw);
}

function buildSkillOverrideBaseline(
  skills: SkillCommand[],
  localOverrides = readLocalSkillOverridesSnapshot(),
): SkillOverrideStateSnapshot {
  const lowerTier = new Map<string, SkillOverrideMode>();
  const locked = new Map<SkillCommand, SkillLockInfo>();
  for (const skill of skills) {
    const lower = resolveLowerTierOverride(skill);
    if (lower) lowerTier.set(skill.name, lower);
    const lock = resolveSkillLock(skill);
    if (lock) locked.set(skill, lock);
  }
  return { localOverrides, lowerTier, locked };
}

function buildInitialSkillOverridesMap(
  skills: SkillCommand[],
  baseline: SkillOverrideStateSnapshot,
): Record<string, SkillOverrideMode> {
  const map = Object.create(null) as Record<string, SkillOverrideMode>;
  for (const skill of skills) {
    if (Object.hasOwn(map, skill.name)) continue;
    map[skill.name] =
      baseline.locked.get(skill)?.value ??
      getOwnOverride(baseline.localOverrides, skill.name) ??
      baseline.lowerTier.get(skill.name) ??
      'on';
  }
  return map;
}

function diffSkillOverrides(
  skills: SkillCommand[],
  current: Record<string, SkillOverrideMode>,
  baseline: SkillOverrideStateSnapshot,
): {
  diff: Record<string, SkillOverrideMode | undefined>;
  writes: number;
  effectiveChanged: number;
} {
  const { localOverrides, lowerTier, locked } = baseline;
  const lockedNames = new Set(Array.from(locked.keys(), s => s.name));
  const seen = new Set(lockedNames);
  const diff = Object.create(null) as Record<string, SkillOverrideMode | undefined>;
  let writes = 0;
  let effectiveChanged = 0;
  for (const skill of skills) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    const desired = getOwnOverride(current, skill.name) ?? 'on';
    const inherited = lowerTier.get(skill.name) ?? 'on';
    const previousEffective = getOwnOverride(localOverrides, skill.name) ?? inherited;
    const syncedBareKey = skill.loadedFrom === 'syncedSkills' ? getSkillBareOverrideKey(skill) : undefined;
    if (
      syncedBareKey != null &&
      getOwnOverride(localOverrides, syncedBareKey) !== undefined &&
      desired !== previousEffective
    ) {
      const lowerWithoutLocalBare = resolveLowerTierOverride(skill, { skipLocalBareKey: true }) ?? 'on';
      const writeVal = desired === lowerWithoutLocalBare ? undefined : desired;
      if (writeVal !== getOwnOverride(localOverrides, skill.name)) {
        diff[skill.name] = writeVal;
      }
      diff[syncedBareKey] = undefined;
      writes++;
      effectiveChanged++;
      continue;
    }
    if (skill.loadedFrom === 'syncedSkills' && desired === previousEffective) continue;
    const writeVal = desired === inherited ? undefined : desired;
    if (writeVal !== getOwnOverride(localOverrides, skill.name)) {
      diff[skill.name] = writeVal;
      writes++;
    }
    if (desired !== previousEffective) {
      effectiveChanged++;
    }
  }
  return { diff, writes, effectiveChanged };
}

function formatLockLabel(lock: SkillLockInfo | undefined): string {
  if (!lock) return '';
  return lock.source === 'reserved-name' ? 'reserved name' : `locked by ${lock.source}`;
}

export function RemoteSkillsMenu({
  onExit,
}: {
  onExit: (result?: string, options?: { display?: CommandResultDisplay }) => void;
}): React.ReactNode {
  const remoteSkills = useAppState(s => (s as { workerInventory?: { skills?: string[] } }).workerInventory?.skills);
  const isScreenReader = useContext(AccessibilityContext) || isScreenReaderModeEnabled();
  const handleCancel = useCallback(() => onExit('Skills dialog dismissed', { display: 'system' }), [onExit]);
  const subtitle =
    remoteSkills && remoteSkills.length > 0
      ? `${remoteSkills.length} ${plural(remoteSkills.length, 'skill')} loaded in the cloud session`
      : undefined;
  const inputGuide = (
    <Byline>
      {remoteSkills && remoteSkills.length > 0 && !isScreenReader && (
        <KeyboardShortcutHint shortcut="↑/↓" action="navigate" />
      )}
      <KeyboardShortcutHint shortcut="esc" action="close" />
    </Byline>
  );
  const body =
    remoteSkills === undefined ? (
      <EmptyState hint="It reports them at the start of each turn; /reload-skills re-scans its skill folders">
        The cloud session hasn&apos;t reported which skills it loaded
      </EmptyState>
    ) : remoteSkills.length === 0 ? (
      <EmptyState hint="Skills come from the repo's .claude/skills and the plugins the session loaded">
        No skills loaded in the cloud session
      </EmptyState>
    ) : isScreenReader ? (
      <Box flexDirection="column">
        {remoteSkills.map(name => (
          <Text key={name}>/{stripControlCharsForDisplay(name)}</Text>
        ))}
      </Box>
    ) : (
      <ItemList
        options={remoteSkills.map(name => ({
          label: `/${stripControlCharsForDisplay(name)}`,
          value: name,
        }))}
      />
    );
  return (
    <Dialog title="Skills" subtitle={subtitle} onCancel={handleCancel} color="suggestion" inputGuide={inputGuide}>
      {body}
      <Box>
        <Text dimColor wrap="wrap-trim">
          Read-only here: the cloud session sends skill names only, and per-skill toggles are this machine&apos;s
          setting — /skills in a local session changes those; /reload-skills re-scans the session&apos;s skill folders.
        </Text>
      </Box>
    </Dialog>
  );
}

type Props = {
  onExit: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  commands: Command[];
  bytesPerToken?: number;
};

export function SkillsMenu({ onExit, commands, bytesPerToken }: Props): React.ReactNode {
  const [sortByTokens, setSortByTokens] = useState(false);
  const skills = useMemo(() => sortAndFilterSkillCommands(commands, { sortByTokens }), [commands, sortByTokens]);
  const shadowNotice = useMemo(() => formatSyncedSkillShadowNotice(skills, commands), [skills, commands]);
  const [initialLocalOverrides] = useState(() => readLocalSkillOverridesSnapshot());
  const baseline = useMemo(
    () => buildSkillOverrideBaseline(skills, initialLocalOverrides),
    [skills, initialLocalOverrides],
  );
  const { locked } = baseline;

  const [overrides, setOverrides] = useState(() => buildInitialSkillOverridesMap(skills, baseline));
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  const focusedSkillRef = useRef<SkillCommand | undefined>(skills[0]);
  const isTerminalFocused = useTerminalFocus();
  const containerRef = useRef<DOMElement | null>(null);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const isSearchModeRef = useRef(false);
  isSearchModeRef.current = isSearchMode;

  const { query, setQuery, cursorOffset } = useSearchInput({
    isActive: isSearchMode,
    onExit: () => {
      setIsSearchMode(false);
    },
    passthroughCtrlKeys: ['c', 'd'],
  });
  const queryRef = useRef(query);
  queryRef.current = query;

  useExitOnCtrlCDWithKeybindings();

  const filteredSkills = useMemo(() => {
    if (!query) return skills;
    const q = query.toLowerCase();
    return skills.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        getSkillDisplayName(s).toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        getSkillSourceLabel(s.source, s.loadedFrom).toLowerCase().includes(q),
    );
  }, [skills, query]);

  const isScreenReader = useContext(AccessibilityContext) || isScreenReaderModeEnabled();
  const { rows, columns } = useModalOrTerminalSize(useTerminalSize());
  const shadowNoticeRows =
    shadowNotice === undefined
      ? 0
      : 2 +
        countCharInString(
          wrapAnsi(shadowNotice, Math.max(1, columns - 2 * PANE_PADDING_X_INLINE), { hard: true, trim: true }),
          '\n',
        );
  const visibleCount = clamp(rows - 13 - shadowNoticeRows, 4, filteredSkills.length);

  const cycleFocusedSkill = useCallback(() => {
    const current = focusedSkillRef.current;
    if (!current || !filteredSkills.includes(current)) return;
    if (locked.has(current)) return;
    setOverrides(prev => {
      const mode = prev[current.name] ?? 'on';
      const modes = SKILL_OVERRIDE_CYCLE_MODES as readonly SkillOverrideMode[];
      const next = modes[(modes.indexOf(mode) + 1) % modes.length]!;
      return Object.assign(Object.create(null) as Record<string, SkillOverrideMode>, prev, {
        [current.name]: next,
      });
    });
  }, [filteredSkills, locked]);

  const closingRef = useRef(false);
  const saveAndClose = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const { diff, writes, effectiveChanged } = diffSkillOverrides(skills, overridesRef.current, baseline);
    if (writes > 0) {
      const { error } = updateSettingsForSource('localSettings', {
        skillOverrides: diff as Record<string, SkillOverrideMode>,
      });
      if (error) {
        onExit(`Failed to save skill overrides: ${error.message}`, { display: 'system' });
        return;
      }
      clearCommandMemoizationCaches();
    }
    onExit(
      effectiveChanged > 0 ? `Updated ${effectiveChanged} skill ${plural(effectiveChanged, 'override')}` : 'No changes',
      {
        display: 'system',
      },
    );
  }, [skills, baseline, onExit]);

  const escShortcut = useShortcutDisplay('confirm:no', 'Settings', 'esc');
  const sortShortcut = useShortcutDisplay('settings:sortByTokens', 'Settings', 't');

  useKeybindings(
    {
      'select:accept': () => {
        if (isSearchModeRef.current) return false;
        cycleFocusedSkill();
      },
      'settings:sortByTokens': () => {
        if (isSearchModeRef.current) return false;
        setSortByTokens(prev => !prev);
      },
    },
    { context: 'Settings', isActive: filteredSkills.length > 0 },
  );

  useKeybindings(
    {
      'confirm:no': () => {
        if (isSearchModeRef.current) return false;
        void saveAndClose();
      },
    },
    { context: 'Settings' },
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.defaultPrevented || isSearchModeRef.current) return;
      if (e.name === 'tab') {
        e.preventDefault();
        return;
      }
      if (e.ctrl || e.meta) return;
      if (e.name === 'backspace') {
        if (queryRef.current) {
          e.preventDefault();
          setIsSearchMode(true);
          setQuery(queryRef.current.slice(0, -1));
        }
        return;
      }
      if (e.key === sortShortcut) {
        e.preventDefault();
        setSortByTokens(prev => !prev);
        return;
      }
      if (e.name.length > 1 && e.name !== 'number') return;
      if (e.key.length >= 1 && e.key !== ' ') {
        e.preventDefault();
        setIsSearchMode(true);
        const next = e.key.startsWith('/') ? e.key.slice(1) : e.key;
        setQuery(queryRef.current + next);
      }
    },
    [setQuery, sortShortcut],
  );

  const handlePaste = useCallback(
    (e: PasteEvent) => {
      if (e.defaultPrevented) return;
      const firstLine = e.text.split(/\r\n|\r|\n/, 2)[0] ?? '';
      if (firstLine.length === 0) return;
      e.preventDefault();
      setIsSearchMode(true);
      const next = !isSearchModeRef.current && firstLine.startsWith('/') ? firstLine.slice(1) : firstLine;
      setQuery(queryRef.current + next);
    },
    [setQuery],
  );

  const handleCancel = useCallback((): void => {
    onExit('Skills dialog dismissed', { display: 'system' });
  }, [onExit]);

  if (skills.length === 0) {
    return (
      <Dialog
        title="Skills"
        onCancel={handleCancel}
        inputGuide={
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="close" />
        }
      >
        <EmptyState
          hint={
            isSafeModeEnabled()
              ? `Custom skills are disabled in safe mode — ${safeModeDisableHint()} to load them`
              : 'Create skills in .claude/skills/ or ~/.claude/skills/'
          }
        >
          No skills found
        </EmptyState>
      </Dialog>
    );
  }

  const reservedSkillNames = uniq(skills.map(s => s.name).filter(name => !isValidSettingsOverrideKey(name)));
  const countLabel = query
    ? `${filteredSkills.length}/${skills.length} ${plural(skills.length, 'skill')}`
    : `${skills.length} ${plural(skills.length, 'skill')}`;
  const actionHint = isSearchMode
    ? 'type to filter · ↓/enter to select · esc to clear'
    : filteredSkills.length === 0
      ? `/ to search, ${escShortcut} to close`
      : `enter/space to cycle, / to search, ${sortShortcut} to sort, ${escShortcut} to close`;
  const subtitle = `${countLabel}${sortByTokens ? ' · sorted by tokens' : ''} · ${actionHint}`;

  return (
    <Dialog title="Skills" subtitle={subtitle} onCancel={handleCancel} isCancelActive={false} hideInputGuide>
      <Box
        ref={containerRef}
        flexDirection="column"
        tabIndex={0}
        autoFocus
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
      >
        <SearchBox
          query={query}
          isFocused={isSearchMode}
          isTerminalFocused={isTerminalFocused}
          cursorOffset={cursorOffset}
          placeholder="Search skills…"
        />
        {filteredSkills.length === 0 ? (
          <Box marginTop={1}>
            <EmptyState>{`No skills match "${query}"`}</EmptyState>
          </Box>
        ) : (
          // wrap={true} overflowHint="count" (replaces 247 <FuzzyPicker onSelect={skill => )
          <ItemList
            key={sortByTokens ? 'tok' : 'name'}
            visibleOptionCount={visibleCount}
            isDisabled={isSearchMode}
            onFocus={idx => {
              focusedSkillRef.current = filteredSkills[idx];
            }}
            onSelect={idx => {
              focusedSkillRef.current = filteredSkills[idx];
              cycleFocusedSkill();
            }}
            options={filteredSkills.map(skill => {
              const lock = locked.get(skill);
              const mode = (lock?.value ?? overrides[skill.name] ?? 'on') as
                | 'on'
                | 'name-only'
                | 'user-invocable-only'
                | 'off';
              const modeWord = mode === 'name-only' ? 'name-only' : mode === 'user-invocable-only' ? 'user-only' : '';
              const lockedLabel = formatLockLabel(lock);
              const sourceLabel = getSkillSourceLabel(skill.source, skill.loadedFrom);
              const tokens = estimateSkillTokens(skill, bytesPerToken);
              const meta = [lockedLabel, isScreenReader ? '' : modeWord, sourceLabel, `${formatNumber(tokens)} tok`];
              return {
                value: `${skill.name}-${skill.source}`,
                label: getSkillDisplayName(skill),
                icon: (
                  <StatusIcon
                    status={mode === 'off' ? 'off' : 'on'}
                    aria-label={
                      mode === 'name-only' ? 'name only:' : mode === 'user-invocable-only' ? 'user only:' : undefined
                    }
                  />
                ),
                meta,
                facts: meta,
              };
            })}
          />
        )}
        {skills.some(s => s.source === 'plugin') && (
          <Box marginTop={1}>
            <Text dimColor>Plugin skills are managed via /plugin</Text>
          </Box>
        )}
        {shadowNotice !== undefined && (
          <Box marginTop={1}>
            <Text dimColor>{shadowNotice}</Text>
          </Box>
        )}
        {reservedSkillNames.length > 0 && (
          <Box marginTop={1}>
            <Text dimColor>
              {`Settings can't store an entry named ${reservedSkillNames.join(' or ')}, so a skill with that name can't be changed here. Rename its folder or command file to configure it.`}
            </Text>
          </Box>
        )}
        {isSafeModeEnabled() && (
          <Box marginTop={1}>
            <Text dimColor>Custom skills are disabled in safe mode — {`${safeModeDisableHint()} to load them`}</Text>
          </Box>
        )}
      </Box>
    </Dialog>
  );
}
