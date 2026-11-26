import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text } from '@anthropic/ink';
import { SelectMulti } from '../../components/CustomSelect/SelectMulti.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { logEvent } from '../../services/analytics/index.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { errorMessage } from '../../utils/errors.js';
import {
  type ImportableItem,
  type SourceScan,
  getAutoImportHoldReason,
  isAutoImportSafe,
  sanitizeDisplayText,
  scanForeignAgentConfigs,
  writeImportFallbackSkill,
} from './scanner.js';

const FALLBACK_SKILL_OPTION = '__fallback_skill__';

function pluralize(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

type FlatItem = {
  item: ImportableItem;
  source: string;
};

function ImportPicker({
  scans,
  scanWarnings,
  dryRun,
  autoConfirm,
  onFinish,
}: {
  scans: readonly SourceScan[];
  scanWarnings: readonly string[];
  dryRun: boolean;
  autoConfirm: boolean;
  onFinish: (summary: string) => void;
}): React.ReactNode {
  const flatItems = useMemo<FlatItem[]>(
    () => scans.flatMap(scan => scan.result.items.map(item => ({ item, source: scan.displayName }))),
    [scans],
  );
  const unmappable = useMemo(() => scans.flatMap(scan => scan.result.unmappable), [scans]);
  const defaultSelectedIds = useMemo(
    () => flatItems.filter(entry => isAutoImportSafe(entry.item)).map(entry => entry.item.id),
    [flatItems],
  );

  const [step, setStep] = useState<'items' | 'unmapped' | 'done'>('items');
  const [selectedIds, setSelectedIds] = useState<string[]>(defaultSelectedIds);

  const runApply = useCallback(
    async (chosenIds: readonly string[], generateFallback: boolean) => {
      setStep('done');
      const chosenSet = new Set(chosenIds);
      const resultLines: string[] = [];
      const reviewWarnings = new Set<string>();
      let imported = 0;

      for (const entry of flatItems) {
        if (!chosenSet.has(entry.item.id)) continue;
        try {
          const applied = await entry.item.apply({ dryRun });
          if (typeof applied === 'string') {
            resultLines.push(`  ✓ ${sanitizeDisplayText(applied)}`);
            if (entry.item.warning) {
              reviewWarnings.add(sanitizeDisplayText(entry.item.warning));
            }
            imported++;
          } else {
            resultLines.push(`  - skipped ${sanitizeDisplayText(applied.skipped)}`);
          }
        } catch (err) {
          resultLines.push(`  ✗ ${sanitizeDisplayText(entry.item.label)}: ${sanitizeDisplayText(errorMessage(err))}`);
        }
      }

      let wroteFallback = false;
      if (generateFallback) {
        try {
          const applied = await writeImportFallbackSkill(
            scans.map(s => ({
              sourceId: s.sourceId,
              displayName: s.displayName,
              unmappable: s.result.unmappable,
            })),
            { dryRun },
          );
          if (typeof applied === 'string') {
            resultLines.push(`  ✓ ${sanitizeDisplayText(applied)}`);
            wroteFallback = true;
          } else {
            resultLines.push(`  - skipped ${sanitizeDisplayText(applied.skipped)}`);
          }
        } catch (err) {
          resultLines.push(`  ✗ fallback skill: ${sanitizeDisplayText(errorMessage(err))}`);
        }
      }

      logEvent('tengu_import_apply', {
        imported,
        dry_run: dryRun ? 1 : 0,
      });

      const header = dryRun
        ? `Dry run — would import ${imported} ${pluralize(imported, 'item')}:`
        : `Imported ${imported} ${pluralize(imported, 'item')}:`;

      const footer: string[] = [];
      for (const warning of scanWarnings) {
        footer.push(`  ⚠ ${warning}`);
      }
      if (reviewWarnings.size > 0) {
        footer.push('', 'Review these:');
        for (const w of reviewWarnings) {
          footer.push(`  ⚠ ${w}`);
        }
      }
      if (wroteFallback && !dryRun) {
        footer.push('', 'Run /import-to-claude-code to finish the unmapped items interactively.');
      } else if (unmappable.length > 0 && !generateFallback) {
        footer.push(
          '',
          `${unmappable.length} unmapped ${pluralize(unmappable.length, 'item')} were skipped (re-run /import to generate the helper skill).`,
        );
      }
      if (autoConfirm) {
        const heldWarned = flatItems.filter(e => getAutoImportHoldReason(e.item) === 'warned').length;
        const heldProject = flatItems.filter(e => getAutoImportHoldReason(e.item) === 'project').length;
        if (heldWarned > 0) {
          footer.push(
            `  ⚠ ${heldWarned} warning-flagged ${pluralize(heldWarned, 'item')} held back — re-run without --yes to review.`,
          );
        }
        if (heldProject > 0) {
          footer.push(
            `  ⚠ ${heldProject} project-level ${pluralize(heldProject, 'item')} held back — re-run without --yes to review.`,
          );
        }
      }

      onFinish([header, ...resultLines, ...footer].join('\n'));
    },
    [flatItems, dryRun, scans, scanWarnings, unmappable.length, autoConfirm, onFinish],
  );

  useEffect(() => {
    if (autoConfirm) {
      void runApply(defaultSelectedIds, unmappable.length > 0);
    }
  }, [autoConfirm, defaultSelectedIds, unmappable.length, runApply]);

  const cancel = useCallback(() => {
    onFinish('Import cancelled.');
  }, [onFinish]);

  if (step === 'done' || autoConfirm) {
    return null;
  }

  const sourceList = scans.map(s => s.displayName).join(', ');

  if (step === 'unmapped') {
    const subtitle = `${unmappable.length} ${pluralize(unmappable.length, 'item')} from ${sourceList} couldn't be imported automatically`;
    return (
      <Dialog title="Import to Claude Code" subtitle={subtitle} onCancel={cancel}>
        <Box flexDirection="column" paddingLeft={1}>
          {unmappable.map((u, idx) => (
            <Text key={`${u.scope}-${u.label}-${idx}`} dimColor>
              - {sanitizeDisplayText(u.label)}: {u.reason}
            </Text>
          ))}
        </Box>
        <SelectMulti
          options={[
            {
              label: 'Generate /import-to-claude-code skill to finish these interactively',
              value: FALLBACK_SKILL_OPTION,
            },
          ]}
          defaultValue={[FALLBACK_SKILL_OPTION]}
          onChange={values => {
            void runApply(selectedIds, values.includes(FALLBACK_SKILL_OPTION));
          }}
          onCancel={cancel}
        />
      </Dialog>
    );
  }

  const scopeLabel = { user: 'global', project: 'local' } as const;
  const options = flatItems.map(({ item, source }) => ({
    label: `[${source}] ${sanitizeDisplayText(item.label)} (${scopeLabel[item.scope]})${item.warning ? ' ⚠' : ''}`,
    ...(item.description ? { description: sanitizeDisplayText(item.description) } : {}),
    value: item.id,
  }));

  return (
    <Dialog
      title="Import to Claude Code"
      subtitle={`Found ${flatItems.length} importable ${pluralize(flatItems.length, 'item')} from ${sourceList}.`}
      onCancel={cancel}
    >
      <Text>What do you want to import?</Text>
      <SelectMulti
        options={options}
        defaultValue={defaultSelectedIds}
        visibleOptionCount={Math.min(options.length, 10)}
        onChange={chosen => {
          if (unmappable.length === 0) {
            void runApply(chosen, false);
          } else {
            setSelectedIds(chosen);
            setStep('unmapped');
          }
        }}
        onCancel={cancel}
      />
    </Dialog>
  );
}

/**
 * Official 2.1.331 `Do` (`chunk-fgmf1wbq.js`) — interactive `/import` handler.
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const tokens = (args ?? '').split(/\s+/).filter(Boolean);
  const dryRun = tokens.includes('--dry-run');
  const autoConfirm = tokens.some(t => t === '--yes' || t.startsWith('--yes='));
  const from = tokens.find(t => !t.startsWith('-'));

  const { scans, error, warnings } = await scanForeignAgentConfigs({ from });
  if (error || scans.length === 0) {
    onDone(error ?? 'No importable agent config found.', { display: 'system' });
    return null;
  }

  if (scans.every(s => s.result.items.length === 0)) {
    const allUnmappable = scans.flatMap(s => s.result.unmappable);
    const userUnmappable = allUnmappable.filter(u => u.scope === 'user');
    const projectUnmappableCount = allUnmappable.length - userUnmappable.length;
    onDone(
      [
        'Detected agent config, but found nothing importable.',
        ...(warnings ?? []),
        ...userUnmappable.map(u => `  - ${sanitizeDisplayText(u.label)}: ${u.reason}`),
        ...(projectUnmappableCount > 0
          ? [
              `  - ${projectUnmappableCount} ${pluralize(projectUnmappableCount, 'item')} from project config (review the project's .codex/.gemini/.cursor folder directly)`,
            ]
          : []),
      ].join('\n'),
      { display: 'system' },
    );
    return null;
  }

  return (
    <ImportPicker
      scans={scans}
      scanWarnings={warnings ?? []}
      dryRun={dryRun}
      autoConfirm={autoConfirm}
      onFinish={summary => onDone(summary, { display: 'system' })}
    />
  );
}
