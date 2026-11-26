import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import React, { useRef } from 'react';
import { Box, Text } from '@anthropic/ink';
import { Select } from '../../components/CustomSelect/select.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js';

export type CloudPluginsConsentChoice = 'accepted' | 'declined' | 'not_now';
export type StoredCloudPluginsConsent = 'accepted' | 'declined' | 'unset';

export function getCloudPluginsConsentPath(configDir: string = getClaudeConfigHomeDir()): string {
  return join(configDir, 'cloud-plugins-consent.json');
}

export function readCloudPluginsConsent(configDir: string = getClaudeConfigHomeDir()): StoredCloudPluginsConsent {
  try {
    const filePath = getCloudPluginsConsentPath(configDir);
    if (!existsSync(filePath)) return 'unset';
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { consent?: unknown };
    if (parsed.consent === 'accepted' || parsed.consent === 'declined') {
      return parsed.consent;
    }
    return 'unset';
  } catch {
    return 'unset';
  }
}

export function writeCloudPluginsConsent(
  choice: 'accepted' | 'declined',
  configDir: string = getClaudeConfigHomeDir(),
): boolean {
  try {
    const filePath = getCloudPluginsConsentPath(configDir);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      `${JSON.stringify({ consent: choice, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Official 2.1.331 `K` (`decideCloudPlugins`) in `chunk-6ptpykcd.js`.
 */
export async function decideCloudPlugins(
  choice: CloudPluginsConsentChoice,
  opts?: {
    configDir?: string;
    hasSetAsideSessions?: boolean;
  },
): Promise<string> {
  const configDir = opts?.configDir ?? getClaudeConfigHomeDir();
  const previous = readCloudPluginsConsent(configDir);
  logEvent('tengu_cloud_plugins_consent', {
    choice: choice as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    previous: previous as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });

  const currentDesc =
    previous === 'accepted'
      ? 'cloud sessions from this machine use your enabled plugins'
      : previous === 'declined'
        ? 'your plugins stay on this machine'
        : 'cloud sessions from this machine keep loading only the repository’s and your organization’s plugins';

  if (choice === 'not_now') {
    if (previous === 'accepted' && opts?.hasSetAsideSessions) {
      return 'Nothing decided for the session attached here, which does not go by the saved answer: answer Yes or No in /cloud-plugins when you want to choose for it. Other cloud sessions from this machine use your enabled plugins.';
    }
    return previous === 'unset'
      ? `Nothing decided: ${currentDesc}. Run /cloud-plugins when you want to choose.`
      : `Left as it was: ${currentDesc}.`;
  }

  const saved = writeCloudPluginsConsent(choice, configDir);
  if (!saved) {
    return `Couldn’t save that: ${getCloudPluginsConsentPath(configDir)} could not be written, so nothing changed — ${currentDesc}. Check that the folder is writable, then run /cloud-plugins again.`;
  }

  const savedDesc =
    choice === 'accepted'
      ? 'cloud sessions from this machine use your enabled plugins — the ones attached from this terminal now, new ones from the start'
      : previous === 'accepted'
        ? 'your plugins stay on this machine from now on — nothing more is sent from this terminal, and a session already using them keeps them only until it restarts'
        : 'your plugins stay on this machine; cloud sessions load only the repository’s and your organization’s plugins';

  return `Saved: ${savedDesc}. Run /cloud-plugins again to change it.`;
}

function CloudPluginsDialog({
  consentLocation,
  onSelect,
}: {
  consentLocation: string;
  onSelect: (choice: CloudPluginsConsentChoice) => void;
}): React.ReactNode {
  const decidedRef = useRef(false);
  const handleSelect = (choice: CloudPluginsConsentChoice) => {
    if (decidedRef.current) return;
    decidedRef.current = true;
    onSelect(choice);
  };

  return (
    <Dialog
      title="Use your enabled plugins in cloud sessions you run from this machine?"
      onCancel={() => handleSelect('not_now')}
    >
      <Box flexDirection="column" gap={1}>
        <Text>
          A cloud session normally loads only the repository&apos;s and your organization&apos;s plugins. If you say
          yes, each cloud session you start or attach to from this machine is also told which plugins you have turned on
          or off here for its folder — their names, and the address of any marketplace they come from on GitHub, in a
          git repository or at a URL — and installs the enabled ones itself. Saying yes sends nothing else: no plugin
          files, no other settings, no credentials, no local paths.
        </Text>
        <Box flexDirection="column">
          <Text dimColor>
            Yes and No are saved for this machine; run /cloud-plugins again to change your answer. Not now decides
            nothing. The answer is kept in:
          </Text>
          <Text dimColor>{consentLocation}</Text>
        </Box>
        <Select<CloudPluginsConsentChoice>
          declineValue="not_now"
          defaultFocusValue="not_now"
          options={[
            { label: 'Yes, use my enabled plugins in cloud sessions', value: 'accepted' },
            { label: 'No, keep them on this machine only', value: 'declined' },
            { label: 'Not now', value: 'not_now' },
          ]}
          onChange={handleSelect}
          onCancel={() => handleSelect('not_now')}
        />
      </Box>
    </Dialog>
  );
}

/**
 * Official 2.1.331 `chunk-6ptpykcd.js` — `/cloud-plugins` interactive dialog.
 */
export async function call(onDone: LocalJSXCommandOnDone, _context: LocalJSXCommandContext): Promise<React.ReactNode> {
  return (
    <CloudPluginsDialog
      consentLocation={getCloudPluginsConsentPath()}
      onSelect={choice => {
        void decideCloudPlugins(choice).then(msg => onDone(msg));
      }}
    />
  );
}
