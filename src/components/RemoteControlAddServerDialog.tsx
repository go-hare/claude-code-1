/**
 * densable 2.1.218 multi-env "New Remote Control server" + trust gate.
 *
 * densable form fields (SEA ~240786520):
 *   {type:"text", key:"dir", label:"Directory", placeholder:cwd, required:!0, hint}
 *   {type:"text", key:"name", label:"Name", hint: shown-in-picker | auto-generated}
 *   {type:"select", key:"spawnMode", label:"Spawn mode", options:[same-dir, worktree]}
 * onSubmit: if !EUe(dir) → Trust this directory? (Omt on Yes) → qpn
 * dir change auto-fills name from basename when name still auto-derived.
 */

import { basename, resolve } from 'path';
import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Box, Text } from '@anthropic/ink';
import { Select } from './CustomSelect/select.js';
import type { OptionWithDescription } from './CustomSelect/select.js';
import { PermissionDialog } from './permissions/PermissionDialog.js';
import { useRegisterOverlay } from '../context/overlayContext.js';
import {
  formatRcAddServerTrustBody,
  formatSpawnRepoTrustNote,
  RC_ADD_SERVER_TRUST_CANCEL,
  RC_ADD_SERVER_TRUST_CONFIRM,
  RC_ADD_SERVER_TRUST_TITLE,
  resolveTrustRootNote,
} from './TrustDialog/trustDialogCopy.js';
import { acceptTrustForDirectory, isDirectoryTrusted } from '../commands/cd/cdCommand.js';
import { findCanonicalGitRootUncached, findGitRootUncached } from '../utils/git.js';
import { addRemoteControlServer, type RemoteControlServerEntry } from '../bridge/remoteControlServers.js';
import { getOriginalCwd } from '../bootstrap/state.js';
import TextInput from './TextInput.js';

type Phase = 'form' | 'edit-dir' | 'edit-name' | 'trust';

type Props = {
  onDone: (result: 'added' | 'updated' | 'cancelled') => void;
  /** Pre-fill directory (default: original cwd). */
  initialDir?: string;
};

export function RemoteControlAddServerDialog({ onDone, initialDir }: Props): React.ReactNode {
  useRegisterOverlay('remote-control-add-server');

  const defaultDir = initialDir ?? getOriginalCwd();
  const [dirText, setDirText] = useState(defaultDir);
  // densable: name starts as basename; tracks whether user overrode auto name
  const [name, setName] = useState(() => basename(defaultDir));
  const [nameUserEdited, setNameUserEdited] = useState(false);
  const [spawnMode, setSpawnMode] = useState<'same-dir' | 'worktree'>('same-dir');
  const [phase, setPhase] = useState<Phase>('form');
  const [pendingDir, setPendingDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editCursor, setEditCursor] = useState(0);

  const resolvedDir = useMemo(() => resolve(dirText.trim() || defaultDir), [dirText, defaultDir]);

  const dirHint = useMemo(() => {
    try {
      if (isDirectoryTrusted(resolvedDir)) {
        return 'Available on claude.ai/code and the Claude mobile app.';
      }
    } catch {
      // trust probe may throw in tests
    }
    return `${resolvedDir} is not yet trusted \u2014 you'll be asked to trust it on submit.`;
  }, [resolvedDir]);

  const nameHint = nameUserEdited
    ? 'Shown in the claude.ai session picker.'
    : 'Auto-generated from the directory name.';

  const trustBody = useMemo(() => {
    const path = pendingDir ?? resolvedDir;
    // densable I8e/rHo — uncached; sticky negative LRU must not omit repo note (#23)
    const { trustRoot, showRepoRootNote } = resolveTrustRootNote(
      path,
      findCanonicalGitRootUncached,
      findGitRootUncached,
    );
    const note = showRepoRootNote ? formatSpawnRepoTrustNote(trustRoot) : '';
    return formatRcAddServerTrustBody(path, note);
  }, [pendingDir, resolvedDir]);

  const updateDir = useCallback(
    (nextDir: string) => {
      setDirText(nextDir);
      // densable: when name not user-edited, keep in sync with basename(dir)
      if (!nameUserEdited) {
        const resolved = resolve(nextDir.trim() || defaultDir);
        setName(basename(resolved));
      }
    },
    [nameUserEdited, defaultDir],
  );

  const commitAdd = useCallback(
    (targetDir: string) => {
      try {
        const entry: RemoteControlServerEntry = {
          dir: targetDir,
          name: name.trim() || basename(targetDir),
          spawnMode,
        };
        const result = addRemoteControlServer(entry);
        onDone(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('form');
      }
    },
    [name, spawnMode, onDone],
  );

  const trySubmit = useCallback(() => {
    setError(null);
    const target = resolve(dirText.trim() || defaultDir);
    let trusted = false;
    try {
      trusted = isDirectoryTrusted(target);
    } catch {
      trusted = false;
    }
    if (!trusted) {
      setPendingDir(target);
      setPhase('trust');
      return;
    }
    commitAdd(target);
  }, [dirText, defaultDir, commitAdd]);

  const onTrustYes = useCallback(() => {
    const target = pendingDir ?? resolvedDir;
    // densable Omt(dir) then qpn
    acceptTrustForDirectory(target);
    commitAdd(target);
  }, [pendingDir, resolvedDir, commitAdd]);

  const onTrustNo = useCallback(() => {
    setPendingDir(null);
    setPhase('form');
  }, []);

  if (phase === 'trust') {
    // densable ba: cancelFirst:!0, focus:"cancel" — No first, safer default
    const trustOptions: OptionWithDescription<'yes' | 'no'>[] = [
      {
        label: RC_ADD_SERVER_TRUST_CANCEL,
        description: 'Go back without trusting or adding.',
        value: 'no',
      },
      {
        label: RC_ADD_SERVER_TRUST_CONFIRM,
        description: 'Trust this directory and add the Remote Control server.',
        value: 'yes',
      },
    ];
    return (
      <PermissionDialog title={RC_ADD_SERVER_TRUST_TITLE} subtitle={trustBody}>
        <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
          <Box>
            <Select
              options={trustOptions}
              defaultValue={'no'}
              onChange={v => {
                if (v === 'yes') onTrustYes();
                else onTrustNo();
              }}
              onCancel={onTrustNo}
            />
          </Box>
        </Box>
      </PermissionDialog>
    );
  }

  if (phase === 'edit-dir' || phase === 'edit-name') {
    const label = phase === 'edit-dir' ? 'Directory' : 'Name';
    const hint = phase === 'edit-dir' ? dirHint : nameHint;
    return (
      <PermissionDialog title="New Remote Control server">
        <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
          <Text>Make a directory available on claude.ai/code and the Claude mobile app</Text>
          <Box>
            <Text bold>{label}: </Text>
            <TextInput
              value={editValue}
              onChange={setEditValue}
              onSubmit={v => {
                if (phase === 'edit-dir') {
                  updateDir(v.trim() || defaultDir);
                } else {
                  const trimmed = v.trim();
                  if (trimmed) {
                    setName(trimmed);
                    setNameUserEdited(true);
                  } else {
                    // empty → fall back to auto basename
                    setName(basename(resolvedDir));
                    setNameUserEdited(false);
                  }
                }
                setPhase('form');
              }}
              cursorOffset={editCursor}
              onChangeCursorOffset={setEditCursor}
              columns={60}
              focus={true}
              showCursor={true}
              placeholder={phase === 'edit-dir' ? defaultDir : basename(resolvedDir)}
              onExit={() => setPhase('form')}
            />
          </Box>
          <Text dimColor>{hint}</Text>
          <Text dimColor>Enter to save · Esc to cancel</Text>
        </Box>
      </PermissionDialog>
    );
  }

  type FormChoice = 'same-dir' | 'worktree' | 'submit' | 'cancel' | 'edit-dir' | 'edit-name';
  const formOptions: OptionWithDescription<FormChoice>[] = [
    {
      label: `Directory: ${resolvedDir}`,
      description: `${dirHint} · Enter to edit path`,
      value: 'edit-dir',
    },
    {
      label: `Name: ${name.trim() || basename(resolvedDir)}`,
      description: `${nameHint} · Enter to edit name`,
      value: 'edit-name',
    },
    {
      label: `Spawn mode: same-dir${spawnMode === 'same-dir' ? ' \u2713' : ''}`,
      description: 'Sessions share the current directory (default)',
      value: 'same-dir',
    },
    {
      label: `Spawn mode: worktree${spawnMode === 'worktree' ? ' \u2713' : ''}`,
      description: 'Each session gets an isolated git worktree',
      value: 'worktree',
    },
    {
      label: 'Add server',
      description: 'Register this directory for Remote Control multi-env.',
      value: 'submit',
    },
    {
      label: 'Cancel',
      description: 'Do not add a Remote Control server.',
      value: 'cancel',
    },
  ];

  return (
    <PermissionDialog title="New Remote Control server">
      <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
        <Text>Make a directory available on claude.ai/code and the Claude mobile app</Text>
        {error && <Text color="error">{error}</Text>}
        <Select
          options={formOptions}
          onChange={v => {
            if (v === 'same-dir' || v === 'worktree') {
              setSpawnMode(v);
              return;
            }
            if (v === 'edit-dir') {
              setEditValue(dirText);
              setEditCursor(dirText.length);
              setPhase('edit-dir');
              return;
            }
            if (v === 'edit-name') {
              setEditValue(name);
              setEditCursor(name.length);
              setPhase('edit-name');
              return;
            }
            if (v === 'submit') trySubmit();
            else onDone('cancelled');
          }}
          onCancel={() => onDone('cancelled')}
        />
      </Box>
    </PermissionDialog>
  );
}
