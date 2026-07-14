import React from 'react';
import type { LocalJSXCommandContext } from '../../commands.js';
import { ExtraUsageDialog } from '../../components/ExtraUsageDialog.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { getSubscriptionType } from '../../utils/auth.js';
import { hasClaudeAiBillingAccess } from '../../utils/billing.js';
import { Login } from '../login/login.js';
import { runExtraUsage } from './extra-usage-core.js';

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode | null> {
  // Official 2.1.207: Team/Enterprise without billing access → admin_requests
  // path (limit_increase). Everyone else gets the inline ExtraUsageDialog.
  const subscriptionType = getSubscriptionType();
  const isTeamOrEnterprise = subscriptionType === 'team' || subscriptionType === 'enterprise';
  if (isTeamOrEnterprise && !hasClaudeAiBillingAccess()) {
    const result = await runExtraUsage();
    if (result.type === 'message') {
      onDone(result.value);
      return null;
    }
    if (result.type === 'browser-opened') {
      onDone(result.opened ? `Opened ${result.url}` : `Open ${result.url} to manage usage credits`);
      return null;
    }
  }

  try {
    return (
      <ExtraUsageDialog
        onDone={msg => {
          onDone(typeof msg === 'string' ? msg : 'Usage credits closed');
        }}
      />
    );
  } catch {
    // fall through to legacy browser/admin path
  }

  const result = await runExtraUsage();

  if (result.type === 'message') {
    onDone(result.value);
    return null;
  }

  if (result.type === 'browser-opened') {
    onDone(result.opened ? `Opened ${result.url}` : `Open ${result.url} to manage usage credits`);
    return null;
  }

  return (
    <Login
      startingMessage={'Starting new login following /usage-credits. Exit with Ctrl-C to use existing account.'}
      onDone={success => {
        context.onChangeAPIKey();
        onDone(success ? 'Login successful' : 'Login interrupted');
      }}
    />
  );
}
