import React from 'react';
import { Settings } from '../../components/Settings/Settings.js';
import type { ToolUseContext } from '../../Tool.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';

const DEFAULT_CLAUDE_WEB_ORIGIN = 'https://claude.ai';

/**
 * Official 2.1.319 `lfs` (#1803): cloud session fallback message linking to
 * Settings → Usage on claude.ai when plan limits can't be shown.
 */
export function getCloudSessionUsageFallbackMessage(opts?: {
  isRemoteSession?: boolean;
  ingressUrl?: string;
}): string | null {
  const isRemote = opts?.isRemoteSession ?? Boolean(process.env.CLAUDE_CODE_REMOTE);
  if (!isRemote) return null;
  const rawIngress = opts?.ingressUrl ?? process.env.SESSION_INGRESS_URL;
  let origin = DEFAULT_CLAUDE_WEB_ORIGIN;
  if (rawIngress) {
    try {
      const parsed = new URL(rawIngress);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        origin = parsed.origin;
      }
    } catch {
      origin = DEFAULT_CLAUDE_WEB_ORIGIN;
    }
  }
  return `Plan usage isn't shown in this chat. To see it, open Settings → Usage on claude.ai: ${origin}/settings/usage`;
}

/**
 * /usage — unified command replacing /cost and /stats (v2.1.289 upstream alignment).
 *
 * Routing:
 *   - /stats → Settings panel → Stats tab
 *   - /usage or /cost → Settings panel → Usage tab (or cloud fallback link #1803)
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
  _args: string,
  invokedName?: string,
): Promise<React.ReactNode> {
  const defaultTab = invokedName === 'stats' ? 'Stats' : 'Usage';
  if (defaultTab === 'Usage') {
    const cloudFallback = getCloudSessionUsageFallbackMessage();
    if (cloudFallback !== null) {
      onDone(cloudFallback, { display: 'system' });
      return null;
    }
  }
  return <Settings onClose={onDone} context={context} defaultTab={defaultTab} openedForCost={invokedName === 'cost'} />;
}
