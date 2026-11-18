import * as React from 'react';
import { useEffect, useState } from 'react';
import { z } from 'zod/v4';
import { Box, Byline, Dialog, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js';
import { getRateLimitTier } from '../utils/auth.js';
import { getGlobalConfig } from '../utils/config.js';
import { formatDuration, formatTokens } from '../utils/format.js';
import { getCanonicalName } from '../utils/model/model.js';
import type { DialogStore } from '../dialog/dialogStore.js';
import { defineDialogSpec, type RequestDialog } from '../dialog/requestDialog.js';
import { Select } from './CustomSelect/index.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';

export const DEFAULT_COLD_RESUME_MIN_PERCENT = 5;
const COLD_RESUME_QUOTA_KIND = 'cold_resume_quota';
const COLD_CACHE_AGE_MS = 5 * 60_000;

export const ColdResumeQuotaConfigSchema = z.object({
  minPercent: z.number().min(1).optional(),
  fiveHourCredits: z.record(z.string(), z.number().positive()),
  creditsPerMillionTokens: z.record(z.string(), z.number().positive()),
  newConversationPointer: z.boolean().optional(),
  servedTier: z.boolean().optional(),
});

export type ColdResumeQuotaConfig = z.infer<typeof ColdResumeQuotaConfigSchema>;

export type ColdResumeQuotaTrigger = 'resume' | 'idle';

export type ColdResumeQuotaAction = 'resume' | 'new_conversation' | 'compact' | 'dismiss' | 'cancelled';

export type ColdResumeQuotaOffer = {
  inactiveSince: number;
  contextTokens: number;
  uncappedContextTokens?: number;
  percentOfFiveHourLimit: number;
  tierSource: 'stored' | 'served';
};

export type ColdResumeQuotaDialogProps = {
  inactiveSince: number;
  contextTokens: number;
  percentOfFiveHourLimit: number;
  trigger: ColdResumeQuotaTrigger;
  focusedAction: 'resume' | 'new_conversation' | 'none';
  offersLookUp: boolean;
  offersSummary: boolean;
  hasUnsentDraft?: boolean;
  onDone: (action: Exclude<ColdResumeQuotaAction, 'cancelled'>) => void;
};

export function ColdResumeQuotaDialog({
  inactiveSince,
  contextTokens,
  percentOfFiveHourLimit,
  trigger,
  focusedAction,
  offersLookUp,
  offersSummary,
  hasUnsentDraft = false,
  onDone,
}: ColdResumeQuotaDialogProps): React.ReactNode {
  const isIdle = trigger === 'idle';
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isIdle) return;
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [isIdle]);

  const elapsed = formatDuration(Math.max(0, nowMs - inactiveSince));
  const formattedTokens = formatTokens(contextTokens);

  const options: Array<{ value: string; label: string; description?: string }> = [
    { value: 'resume', label: 'Resume' },
    {
      value: 'new_conversation',
      label: 'Start a new conversation',
      ...(offersLookUp ? { description: 'Claude can look this one up if you refer to it later' } : {}),
    },
    ...(offersSummary
      ? [
          {
            value: 'compact',
            label: 'Resume from summary',
            description: 'Claude writes a summary now, and you continue from it',
          },
        ]
      : []),
  ];

  return (
    <Dialog
      title="Resume this conversation?"
      color="warning"
      onCancel={() => onDone('dismiss')}
      inputGuide={
        <Byline>
          <KeyboardShortcutHint shortcut="Enter" action="confirm" />
          <ConfigurableShortcutHint
            action="confirm:no"
            context="Confirmation"
            fallback="Esc"
            description={isIdle ? 'dismiss' : 'resume'}
          />
        </Byline>
      }
    >
      <Box flexDirection="column">
        <Text>
          This conversation has been inactive for {elapsed} and is {formattedTokens} tokens long.{' '}
          {percentOfFiveHourLimit >= 100 ? (
            <>
              Resuming it will use <Text bold>all</Text> of your 5-hour usage limit.
            </>
          ) : (
            <>
              Resuming it will use about <Text bold>{percentOfFiveHourLimit}%</Text> of your 5-hour usage limit.
            </>
          )}
        </Text>
        {isIdle && hasUnsentDraft && <Text dimColor>Your unsent message will still be there after you answer.</Text>}
      </Box>
      <Select
        options={options}
        hideIndexes={isIdle}
        defaultFocusValue={focusedAction === 'new_conversation' ? 'new_conversation' : 'resume'}
        onChange={value => onDone(value as Exclude<ColdResumeQuotaAction, 'cancelled'>)}
      />
    </Dialog>
  );
}

export type ColdResumeMessageLike = {
  type: string;
  timestamp?: string;
  message?: unknown;
};

function getMessageModel(msg: ColdResumeMessageLike): string | undefined {
  if (typeof msg.message === 'object' && msg.message !== null && 'model' in msg.message) {
    const m = (msg.message as { model?: unknown }).model;
    return typeof m === 'string' ? m : undefined;
  }
  return undefined;
}

export function evaluateColdResumeQuota(opts: {
  messages: readonly ColdResumeMessageLike[];
  model: string;
  trigger: ColdResumeQuotaTrigger;
  estimateTokens: (msgs: readonly ColdResumeMessageLike[]) => number;
  rateLimitTier?: string | null;
  config?: ColdResumeQuotaConfig | null;
  resumeReturnDismissed?: boolean;
  nowMs?: number;
  cacheTtlMs?: number;
}): ColdResumeQuotaOffer | null {
  const { messages, model, estimateTokens, nowMs = Date.now(), cacheTtlMs = COLD_CACHE_AGE_MS } = opts;

  let config = opts.config;
  if (config === undefined) {
    const raw = getFeatureValue_CACHED_MAY_BE_STALE<unknown>('tengu_amber_tally', {});
    const parsed = ColdResumeQuotaConfigSchema.safeParse(raw);
    config = parsed.success ? parsed.data : null;
  }
  if (!config) return null;

  const dismissed = opts.resumeReturnDismissed ?? Boolean(getGlobalConfig().resumeReturnDismissed);
  if (dismissed) return null;

  const rateLimitTier = opts.rateLimitTier !== undefined ? opts.rateLimitTier : getRateLimitTier();
  if (!rateLimitTier) return null;

  let lastMsg: ColdResumeMessageLike | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.type === 'user' || m.type === 'assistant') {
      lastMsg = m;
      break;
    }
  }
  if (!lastMsg?.timestamp) return null;
  const inactiveSince = Date.parse(lastMsg.timestamp);
  if (Number.isNaN(inactiveSince)) return null;

  const msgModel = getMessageModel(lastMsg);
  const isSameModel = msgModel !== undefined && getCanonicalName(msgModel) === getCanonicalName(model);
  if (nowMs - inactiveSince < cacheTtlMs && isSameModel) {
    return null;
  }

  const fiveHourCredits = config.fiveHourCredits[rateLimitTier];
  const creditsPerMillion = config.creditsPerMillionTokens[getCanonicalName(model)];
  if (typeof fiveHourCredits !== 'number' || typeof creditsPerMillion !== 'number') {
    return null;
  }

  const contextTokens = estimateTokens(messages);
  if (contextTokens <= 0) return null;

  const rawPercent = ((contextTokens / 1_000_000) * creditsPerMillion * 100) / fiveHourCredits;
  const minPercent = config.minPercent ?? DEFAULT_COLD_RESUME_MIN_PERCENT;
  if (rawPercent < minPercent) {
    return null;
  }

  return {
    inactiveSince,
    contextTokens,
    percentOfFiveHourLimit: Math.round(rawPercent),
    tierSource: 'stored',
  };
}

const coldResumeQuotaSpec = defineDialogSpec({
  kind: COLD_RESUME_QUOTA_KIND,
  payload: () =>
    z.object({
      inactiveSince: z.number(),
      contextTokens: z.number(),
      percentOfFiveHourLimit: z.number(),
      trigger: z.enum(['resume', 'idle']),
      focusedAction: z.enum(['resume', 'new_conversation', 'none']),
      offersLookUp: z.boolean(),
      offersSummary: z.boolean(),
      hasUnsentDraft: z.boolean().optional(),
    }),
  result: () => z.enum(['resume', 'new_conversation', 'compact', 'dismiss', 'cancelled']),
  default: 'cancelled',
});

export async function openColdResumeQuotaIfNeeded(opts: {
  requestDialog: RequestDialog;
  dialogStore: DialogStore;
  messages: readonly ColdResumeMessageLike[];
  model: string;
  trigger: ColdResumeQuotaTrigger;
  estimateTokens: (msgs: readonly ColdResumeMessageLike[]) => number;
  startNewConversation: () => void | Promise<void>;
  resumeFromSummary?: () => void | Promise<void>;
  offersLookUp?: boolean;
  hasUnsentDraft?: boolean;
}): Promise<ColdResumeQuotaAction | 'skipped'> {
  const {
    requestDialog,
    dialogStore,
    messages,
    model,
    trigger,
    estimateTokens,
    startNewConversation,
    resumeFromSummary,
    offersLookUp = true,
    hasUnsentDraft,
  } = opts;

  const offer = evaluateColdResumeQuota({
    messages,
    model,
    trigger,
    estimateTokens,
  });
  if (!offer) return 'skipped';

  if (dialogStore.getState().open.some(d => d.kind === COLD_RESUME_QUOTA_KIND)) {
    return 'skipped';
  }

  const offersSummary =
    trigger === 'resume' &&
    resumeFromSummary !== undefined &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_eager_brooks', false) === true;

  const focusedAction =
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_stateful_mitten', false) === true ? 'new_conversation' : 'resume';

  const result = await requestDialog(coldResumeQuotaSpec, {
    inactiveSince: offer.inactiveSince,
    contextTokens: offer.contextTokens,
    percentOfFiveHourLimit: offer.percentOfFiveHourLimit,
    trigger,
    focusedAction,
    offersLookUp,
    offersSummary,
    ...(hasUnsentDraft !== undefined ? { hasUnsentDraft } : {}),
  });

  if (result === 'cancelled') return 'cancelled';

  logEvent('tengu_cold_resume_quota_action', {
    action: result as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    trigger: trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    percentOfFiveHourLimit: offer.percentOfFiveHourLimit,
    contextTokens: offer.contextTokens,
  });

  if (result === 'new_conversation') {
    await startNewConversation();
  } else if (result === 'compact' && offersSummary && resumeFromSummary) {
    await resumeFromSummary();
  }

  return result as ColdResumeQuotaAction;
}
