import { PermissionRuleList } from '../../components/permissions/rules/PermissionRuleList.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { createPermissionRetryMessage } from '../../utils/messages.js';
import { getInitialSettings } from '../../utils/settings/settings.js';

export const CLOUD_SESSION_PERMISSIONS_MANAGED_MESSAGE =
  "Your organization manages the permission rules for this session, so permission rules in your own settings files don't apply. To change a rule, contact your admin.";

export const CLOUD_SESSION_PERMISSIONS_MESSAGE =
  "This cloud session has no permissions panel. Its rules come from its settings files: in a session with one repository, ask Claude to edit .claude/settings.json, and commit it to the repository to keep it for later sessions. Auto mode rules can't be set that way: a cloud session doesn't read them from that file or from ~/.claude/settings.json on your machine. For what each session reads, see https://code.claude.com/docs/en/settings#settings-in-cloud-sessions";

/**
 * Official 2.1.319 (#1770): in cloud sessions, explain where the session's
 * permission rules live and how to change them instead of saying unavailable.
 */
export function getCloudSessionPermissionsMessage(opts?: {
  isRemoteSession?: boolean;
  isManagedOnly?: boolean;
}): string | null {
  const isRemote = opts?.isRemoteSession ?? Boolean(process.env.CLAUDE_CODE_REMOTE);
  if (!isRemote) return null;
  const isManagedOnly = opts?.isManagedOnly ?? Boolean(getInitialSettings().allowManagedPermissionRulesOnly);
  return isManagedOnly ? CLOUD_SESSION_PERMISSIONS_MANAGED_MESSAGE : CLOUD_SESSION_PERMISSIONS_MESSAGE;
}

export const call: LocalJSXCommandCall = async (onDone, context) => {
  const cloudMessage = getCloudSessionPermissionsMessage();
  if (cloudMessage !== null) {
    onDone(cloudMessage, { display: 'system' });
    return null;
  }
  return (
    <PermissionRuleList
      onExit={onDone}
      onRetryDenials={commands => {
        context.setMessages(prev => [...prev, createPermissionRetryMessage(commands)]);
      }}
    />
  );
};
