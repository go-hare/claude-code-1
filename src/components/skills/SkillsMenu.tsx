import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import {
  type Command,
  type CommandBase,
  type CommandResultDisplay,
  getCommandName,
  type PromptCommand,
} from '../../commands.js';
import { Box, Dialog, FuzzyPicker, Text } from '@anthropic/ink';
import type { Theme } from '@anthropic/ink';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { estimateSkillFrontmatterTokens } from '../../skills/loadSkillsDir.js';
import { formatTokens } from '../../utils/format.js';
import { getSettingSourceName, type SettingSource } from '../../utils/settings/constants.js';
import {
  formatSkillOverrideModeLabel,
  resolveSkillOverrideMode,
  resolveSkillOverrideWriteValue,
  SKILL_OVERRIDE_CYCLE_MODES,
  type SkillOverrideMode,
} from '../../utils/residualFinalEnvGates.js';
import { getSettingsForSource, updateSettingsForSource } from '../../utils/settings/settings.js';
import { plural } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Select } from '../CustomSelect/index.js';
import { filterSkills } from './filterSkills.js';

// Skills are always PromptCommands with CommandBase properties
type SkillCommand = CommandBase & PromptCommand;

type SkillSource = SettingSource | 'plugin' | 'mcp';

const ORDERED_SOURCES: SkillSource[] = [
  'projectSettings',
  'localSettings',
  'userSettings',
  'flagSettings',
  'policySettings',
  'plugin',
  'mcp',
];

type Props = {
  onExit: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  commands: Command[];
};

function getSourceLabel(source: SkillSource): string {
  if (source === 'plugin') return 'plugin';
  if (source === 'mcp') return 'mcp';
  return getSettingSourceName(source);
}

function readMergedSkillOverrides(): Record<string, SkillOverrideMode> {
  const local = (getSettingsForSource('localSettings')?.skillOverrides ?? {}) as Record<string, SkillOverrideMode>;
  const project = (getSettingsForSource('projectSettings')?.skillOverrides ?? {}) as Record<string, SkillOverrideMode>;
  const user = (getSettingsForSource('userSettings')?.skillOverrides ?? {}) as Record<string, SkillOverrideMode>;
  return { ...user, ...project, ...local };
}

export function SkillsMenu({ onExit, commands }: Props): React.ReactNode {
  const [searchQuery, setSearchQuery] = useState('');
  const [overridesEpoch, setOverridesEpoch] = useState(0);
  const [detailSkill, setDetailSkill] = useState<SkillCommand | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  // densable hbr/tZR: `t` toggles token-desc sort (settings:sortByTokens)
  const [sortByTokens, setSortByTokens] = useState(false);

  const mergedOverrides = useMemo(() => {
    void overridesEpoch;
    try {
      return readMergedSkillOverrides();
    } catch {
      return {} as Record<string, SkillOverrideMode>;
    }
  }, [overridesEpoch]);

  // Filter commands for skills and cast to SkillCommand
  const skills = useMemo(() => {
    return commands.filter(
      (cmd): cmd is SkillCommand =>
        cmd.type === 'prompt' &&
        (cmd.loadedFrom === 'skills' ||
          cmd.loadedFrom === 'commands_DEPRECATED' ||
          cmd.loadedFrom === 'plugin' ||
          cmd.loadedFrom === 'mcp' ||
          cmd.loadedFrom === 'bundled'),
    );
  }, [commands]);

  // Apply type-to-filter: build SkillItem-shaped projections and filter
  const filteredSkills = useMemo(() => {
    return filterSkills(
      skills.map(s => ({
        ...s,
        name: getCommandName(s),
        description: s.description ?? '',
      })),
      searchQuery,
    );
  }, [skills, searchQuery]);

  const skillsBySource = useMemo((): Record<SkillSource, SkillCommand[]> => {
    const groups: Record<SkillSource, SkillCommand[]> = {
      policySettings: [],
      userSettings: [],
      projectSettings: [],
      localSettings: [],
      flagSettings: [],
      plugin: [],
      mcp: [],
    };

    for (const skill of filteredSkills) {
      const source = skill.source as SkillSource;
      if (source in groups) {
        groups[source].push(skill);
      }
    }

    for (const group of Object.values(groups)) {
      group.sort((a, b) => getCommandName(a).localeCompare(getCommandName(b)));
    }

    return groups;
  }, [filteredSkills]);

  // Flat ordered list: densable source groups by default; token-desc when sortByTokens.
  const orderedFilteredSkills = useMemo(() => {
    if (sortByTokens) {
      // densable: Map tokens once, sort desc then name asc
      const list = [...filteredSkills];
      const tokens = new Map(list.map(s => [s, estimateSkillFrontmatterTokens(s)] as const));
      return list.sort(
        (a, b) => (tokens.get(b) ?? 0) - (tokens.get(a) ?? 0) || getCommandName(a).localeCompare(getCommandName(b)),
      );
    }
    return ORDERED_SOURCES.flatMap(source => skillsBySource[source]);
  }, [skillsBySource, filteredSkills, sortByTokens]);

  // densable: t only when list mode (not search-focused). Local FuzzyPicker is
  // always type-to-filter — gate on empty query so typing `t` in a filter works.
  useKeybinding(
    'settings:sortByTokens',
    () => {
      setSortByTokens(v => !v);
    },
    {
      context: 'Settings',
      isActive: !detailSkill && orderedFilteredSkills.length > 0 && searchQuery === '',
    },
  );

  const handleCancel = (): void => {
    onExit('Skills dialog dismissed', { display: 'system' });
  };

  const applyOverride = useCallback((skill: SkillCommand, desired: SkillOverrideMode) => {
    const cmdName = getCommandName(skill);
    const unqualifiedName =
      'unqualifiedName' in skill && typeof skill.unqualifiedName === 'string' ? skill.unqualifiedName : undefined;
    let local: Record<string, SkillOverrideMode> = {};
    let project: Record<string, SkillOverrideMode> = {};
    let user: Record<string, SkillOverrideMode> = {};
    try {
      local = (getSettingsForSource('localSettings')?.skillOverrides ?? {}) as Record<string, SkillOverrideMode>;
      project = (getSettingsForSource('projectSettings')?.skillOverrides ?? {}) as Record<string, SkillOverrideMode>;
      user = (getSettingsForSource('userSettings')?.skillOverrides ?? {}) as Record<string, SkillOverrideMode>;
    } catch {
      // settings optional
    }
    const writeValue = resolveSkillOverrideWriteValue(desired, {
      cmdName,
      unqualifiedName,
      localOverrides: local,
      projectOverrides: project,
      userOverrides: user,
    });
    const nextLocal: Record<string, SkillOverrideMode | undefined> = {
      ...local,
    };
    if (writeValue === undefined) {
      nextLocal[cmdName] = undefined;
    } else {
      nextLocal[cmdName] = writeValue;
    }
    const { error } = updateSettingsForSource('localSettings', {
      skillOverrides: nextLocal as Record<string, SkillOverrideMode>,
    });
    if (error) {
      setWriteError(error.message);
      return;
    }
    setWriteError(null);
    setOverridesEpoch(n => n + 1);
    setDetailSkill(null);
  }, []);

  if (detailSkill) {
    const cmdName = getCommandName(detailSkill);
    const current = resolveSkillOverrideMode(
      {
        type: 'prompt',
        source: detailSkill.source,
        name: cmdName,
        unqualifiedName:
          'unqualifiedName' in detailSkill && typeof detailSkill.unqualifiedName === 'string'
            ? detailSkill.unqualifiedName
            : undefined,
      },
      { skillOverrides: mergedOverrides },
    );
    const options = SKILL_OVERRIDE_CYCLE_MODES.map(mode => ({
      label: mode === current ? `${formatSkillOverrideModeLabel(mode)} (current)` : formatSkillOverrideModeLabel(mode),
      value: mode,
    }));
    return (
      <Dialog
        title={cmdName}
        onCancel={() => {
          setDetailSkill(null);
          setWriteError(null);
        }}
      >
        <Box flexDirection="column">
          {detailSkill.description ? <Text dimColor>{detailSkill.description}</Text> : null}
          <Text dimColor>skillOverrides: on / name-only / user-invocable-only / off. Writes to local settings.</Text>
          {writeError ? <Text color={'error' as keyof Theme}>{writeError}</Text> : null}
        </Box>
        <Select options={options} onChange={(value: SkillOverrideMode) => applyOverride(detailSkill, value)} />
        <Text dimColor>Or press Enter on list items to invoke; Esc returns to the skill list.</Text>
      </Dialog>
    );
  }

  if (skills.length === 0) {
    return (
      <Dialog title="Skills" subtitle="No skills found" onCancel={handleCancel} hideInputGuide>
        <Text dimColor>Create skills in .claude/skills/ or ~/.claude/skills/</Text>
        <Text dimColor italic>
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="close" />
        </Text>
      </Dialog>
    );
  }

  const getScopeTag = (source: string): { label: string; color: string } | undefined => {
    switch (source) {
      case 'projectSettings':
      case 'localSettings':
        return { label: 'local', color: 'yellow' };
      case 'userSettings':
        return { label: 'global', color: 'cyan' };
      case 'policySettings':
        return { label: 'managed', color: 'magenta' };
      default:
        return undefined;
    }
  };

  const renderSkillItem = (skill: SkillCommand, isFocused: boolean) => {
    const estimatedTokens = estimateSkillFrontmatterTokens(skill);
    const tokenDisplay = `~${formatTokens(estimatedTokens)}`;
    const pluginName = skill.source === 'plugin' ? skill.pluginInfo?.pluginManifest.name : undefined;
    const scopeTag = getScopeTag(skill.source);
    const mode = resolveSkillOverrideMode(
      {
        type: 'prompt',
        source: skill.source,
        name: getCommandName(skill),
      },
      { skillOverrides: mergedOverrides },
    );
    const overrideBadge =
      mode === 'on' || mode === 'model-invocable' ? null : ` · ${formatSkillOverrideModeLabel(mode)}`;

    return (
      <Box>
        <Text color={isFocused ? ('suggestion' as keyof Theme) : undefined}>{getCommandName(skill)}</Text>
        {scopeTag && <Text color={scopeTag.color as keyof Theme}> [{scopeTag.label}]</Text>}
        <Text dimColor>
          {pluginName ? ` · ${pluginName}` : ''} · {getSourceLabel(skill.source as SkillSource)} · {tokenDisplay} tokens
          {overrideBadge}
        </Text>
      </Box>
    );
  };

  const subtitle =
    searchQuery.trim() === ''
      ? `${skills.length} ${plural(skills.length, 'skill')}${sortByTokens ? ' · sorted by tokens' : ''} · Enter invoke · Tab override · t tokens`
      : `${filteredSkills.length}/${skills.length} ${plural(skills.length, 'skill')}${sortByTokens ? ' · sorted by tokens' : ''}`;

  return (
    <FuzzyPicker
      title="Skills"
      placeholder="Type to filter skills… (Tab: set skillOverrides)"
      items={orderedFilteredSkills}
      getKey={s => `${s.name}-${s.source}`}
      visibleCount={12}
      direction="down"
      onQueryChange={setSearchQuery}
      onSelect={skill => {
        onExit(`/${getCommandName(skill)}`, { display: 'user' });
      }}
      onCancel={handleCancel}
      emptyMessage={q => (q.trim() ? `No skills matching "${q.trim()}"` : 'No skills found')}
      matchLabel={subtitle}
      selectAction="invoke skill"
      // Official denser: skill-detail override path. Tab opens override editor.
      onTab={{
        action: 'set skillOverrides',
        handler: skill => {
          setDetailSkill(skill);
          setWriteError(null);
        },
      }}
      extraHints={
        searchQuery === '' ? (
          <ConfigurableShortcutHint
            action="settings:sortByTokens"
            context="Settings"
            fallback="t"
            description="sort by tokens"
          />
        ) : undefined
      }
      renderItem={(skill, isFocused) => renderSkillItem(skill, isFocused)}
    />
  );
}
