import React from 'react';
import type { LocalJSXCommandCall, LocalJSXCommandOnDone } from '../../types/command.js';
import {
  addCredential,
  archiveCredential,
  archiveVault,
  createVault,
  getVault,
  listCredentials,
  listVaults,
  type Credential,
  type Vault,
} from './vaultsApi.js';
import { VaultView } from './VaultView.js';
import { parseVaultArgs } from './parseArgs.js';
import { launchCommand } from '../_shared/launchCommand.js';

const USAGE =
  'Usage: /vault list | create NAME | get ID | archive ID | add-credential VAULT_ID KEY VALUE | archive-credential VAULT_ID CRED_ID';

type VaultViewProps = React.ComponentProps<typeof VaultView>;

function formatVaultRow(vault: Vault): string {
  const status = vault.archived_at ? 'archived' : 'active';
  const created = vault.created_at ? ` · created ${new Date(vault.created_at).toLocaleString()}` : '';
  return `- ${vault.vault_id} · ${vault.name} · ${status}${created}`;
}

function formatVaultDetail(vault: Vault): string {
  const lines = [
    `ID: ${vault.vault_id}`,
    `Name: ${vault.name}`,
    `Status: ${vault.archived_at ? 'archived' : 'active'}`,
  ];
  if (vault.created_at) lines.push(`Created: ${new Date(vault.created_at).toLocaleString()}`);
  if (vault.archived_at) lines.push(`Archived: ${new Date(vault.archived_at).toLocaleString()}`);
  return lines.join('\n');
}

function formatCredentialRow(cred: Credential): string {
  const parts = [cred.credential_id];
  if (cred.kind) parts.push(cred.kind);
  if (cred.archived_at) parts.push('archived');
  // SECURITY: credential value is never echoed
  parts.push('Value: ***mask***');
  return `- ${parts.join(' · ')}`;
}

async function dispatchVault(
  parsed: ReturnType<typeof parseVaultArgs>,
  onDone: LocalJSXCommandOnDone,
): Promise<VaultViewProps | null> {
  if (parsed.action === 'list') {
    const vaults = await listVaults();
    onDone(
      vaults.length === 0
        ? 'No vaults found. Use /vault create <name> to create one.'
        : `${vaults.length} vault(s).\n${vaults.map(formatVaultRow).join('\n')}`,
      { display: 'system' },
    );
    return { mode: 'list', vaults };
  }

  if (parsed.action === 'create') {
    const { name } = parsed;
    const vault = await createVault(name);
    onDone(`Vault created: ${vault.vault_id}\nName: ${vault.name}`, { display: 'system' });
    return { mode: 'created', vault };
  }

  if (parsed.action === 'get') {
    const { id } = parsed;
    const vault = await getVault(id);
    onDone(`Vault fetched: ${vault.vault_id}\n${formatVaultDetail(vault)}`, { display: 'system' });
    return { mode: 'detail', vault };
  }

  if (parsed.action === 'archive') {
    const { id } = parsed;
    const vault = await archiveVault(id);
    const archivedAt = vault.archived_at ? `\nArchived at: ${new Date(vault.archived_at).toLocaleString()}` : '';
    onDone(`Vault archived: ${vault.vault_id}${archivedAt}`, { display: 'system' });
    return { mode: 'archived', vault };
  }

  if (parsed.action === 'add-credential') {
    const { vaultId, key, secret } = parsed;
    const cred = await addCredential(vaultId, key, secret);
    // SECURITY: credential value is NOT echoed in onDone message
    onDone(
      `Credential added: ${cred.credential_id}\nVault: ${vaultId}${cred.kind ? `\nKind: ${cred.kind}` : ''}\nValue: ***mask***`,
      { display: 'system' },
    );
    return { mode: 'credential-added', vaultId, credentialId: cred.credential_id };
  }

  if (parsed.action === 'archive-credential') {
    const { vaultId, credentialId } = parsed;
    await archiveCredential(vaultId, credentialId);
    onDone(`Credential ${credentialId} archived (vault: ${vaultId}).`, { display: 'system' });
    return { mode: 'credential-archived', vaultId, credentialId };
  }

  // Fallback: list vaults for any unrecognised action (matches original behaviour)
  const vaults = await listVaults();
  onDone(
    vaults.length === 0
      ? 'No vaults found. Use /vault create <name> to create one.'
      : `${vaults.length} vault(s).\n${vaults.map(formatVaultRow).join('\n')}`,
    { display: 'system' },
  );
  return { mode: 'list', vaults };
}

export const callVault: LocalJSXCommandCall = launchCommand<ReturnType<typeof parseVaultArgs>, VaultViewProps>({
  commandName: 'vault',
  parseArgs: (raw: string) => {
    const result = parseVaultArgs(raw);
    if (result.action === 'invalid') {
      return { action: 'invalid' as const, reason: `${USAGE}\n${result.reason}` };
    }
    return result;
  },
  dispatch: dispatchVault,
  View: VaultView,
  errorView: (msg: string) => React.createElement(VaultView, { mode: 'error', message: msg }),
});

export const callVaultListCredentials = async (
  onDone: (msg: string, opts: { display: string }) => void,
  vaultId: string,
): Promise<React.ReactNode> => {
  try {
    const credentials = await listCredentials(vaultId);
    onDone(
      credentials.length === 0
        ? `No credentials in vault ${vaultId}.`
        : `${credentials.length} credential(s) in vault ${vaultId}.\n${credentials.map(formatCredentialRow).join('\n')}`,
      { display: 'system' },
    );
    return React.createElement(VaultView, {
      mode: 'credential-list',
      vaultId,
      credentials,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    onDone(`Failed to list credentials: ${msg}`, { display: 'system' });
    return React.createElement(VaultView, { mode: 'error', message: msg });
  }
};
