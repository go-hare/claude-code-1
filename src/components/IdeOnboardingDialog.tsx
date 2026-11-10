import figures from 'figures';
import React from 'react';
import { envDynamic } from 'src/utils/envDynamic.js';
import { Box, Dialog, KeyboardShortcutHint, Text, type Theme } from '@anthropic/ink';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import { env } from '../utils/env.js';
import {
  getTerminalIdeType,
  type IDEExtensionInstallationStatus,
  isJetBrainsIde,
  toIDEDisplayName,
} from '../utils/ide.js';

interface Props {
  onDone: () => void;
  installationStatus: IDEExtensionInstallationStatus | null;
}

function DiffStats({ added, removed, bold }: { added: number; removed: number; bold?: boolean }): React.ReactNode {
  if (added === 0 && removed === 0) {
    return null;
  }
  return (
    <Text>
      {added > 0 && (
        <Text color="diffAddedWord" bold={bold}>
          +{added}
        </Text>
      )}
      {added > 0 && removed > 0 && ' '}
      {removed > 0 && (
        <Text color="diffRemovedWord" bold={bold}>
          -{removed}
        </Text>
      )}
    </Text>
  );
}

function BulletItem({ children, color }: { children: React.ReactNode; color?: keyof Theme }): React.ReactNode {
  return (
    <Box flexDirection="row">
      <Box aria-hidden width={2} flexShrink={0}>
        <Text>{figures.bullet}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={color}>{children}</Text>
      </Box>
    </Box>
  );
}

export function IdeOnboardingDialog({ onDone, installationStatus }: Props): React.ReactNode {
  markDialogAsShown();

  // Handle Enter/Escape to dismiss
  useKeybindings(
    {
      'confirm:yes': onDone,
      'confirm:no': onDone,
    },
    { context: 'Confirmation' },
  );

  const ideType = installationStatus?.ideType ?? getTerminalIdeType();
  const isJetBrains = isJetBrainsIde(ideType);

  const ideName = toIDEDisplayName(ideType);
  const installedVersion = installationStatus?.installedVersion;
  const pluginOrExtension = isJetBrains ? 'plugin' : 'extension';
  const mentionShortcut = env.platform === 'darwin' ? 'Cmd+Option+K' : 'Ctrl+Alt+K';

  return (
    <>
      <Dialog
        title={
          <>
            <Text color="claude">✻ </Text>
            <Text>Welcome to Claude Code for {ideName}</Text>
          </>
        }
        subtitle={installedVersion ? `installed ${pluginOrExtension} v${installedVersion}` : undefined}
        color="ide"
        onCancel={onDone}
        hideInputGuide
      >
        <Box flexDirection="column" gap={1}>
          <BulletItem>
            Claude has context of <Text color="suggestion">⧉ open files</Text> and{' '}
            <Text color="suggestion">⧉ selected lines</Text>
          </BulletItem>
          <BulletItem>
            Review Claude Code&apos;s changes <DiffStats added={11} removed={22} /> in the comfort of your IDE
          </BulletItem>
          <BulletItem>
            Cmd+Esc<Text dimColor> for Quick Launch</Text>
          </BulletItem>
          <BulletItem>
            {mentionShortcut}
            <Text dimColor> to reference files or lines in your input</Text>
          </BulletItem>
        </Box>
      </Dialog>
      <Box paddingX={1}>
        <Text dimColor italic>
          Press <KeyboardShortcutHint shortcut="enter" action="continue" />
        </Text>
      </Box>
    </>
  );
}

export function hasIdeOnboardingDialogBeenShown(): boolean {
  const config = getGlobalConfig();
  const terminal = envDynamic.terminal || 'unknown';
  return config.hasIdeOnboardingBeenShown?.[terminal] === true;
}

function markDialogAsShown(): void {
  if (hasIdeOnboardingDialogBeenShown()) {
    return;
  }
  const terminal = envDynamic.terminal || 'unknown';
  saveGlobalConfig(current => ({
    ...current,
    hasIdeOnboardingBeenShown: {
      ...current.hasIdeOnboardingBeenShown,
      [terminal]: true,
    },
  }));
}
