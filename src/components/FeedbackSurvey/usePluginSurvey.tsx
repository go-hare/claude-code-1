/**
 * densable DBa / Y0f / qvr — plugin feedback survey after a turn ends if the
 * session activity ring (sJ) has a qualifying plugin use.
 *
 * Default GrowthBook probability is 0 (UGo) so this stays dark unless config
 * raises it — matches densable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDynamicConfig } from 'src/hooks/useDynamicConfig.js';
import { isFeedbackSurveyDisabled } from 'src/services/analytics/config.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { isPolicyAllowed } from '../../services/policyLimits/index.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { drainPluginActivity } from '../../utils/plugins/pluginActivity.js';
import {
  DEFAULT_PLUGIN_SURVEY_CONFIG,
  formatPluginSurveyMessage,
  pluginSurveyKeyHash,
  selectPluginSurveySubject,
  type PluginSurveyConfig,
  type PluginSurveySubject,
} from '../../utils/plugins/pluginSurveySubject.js';
import { isFeedbackSurveyEnvDisabled } from '../../utils/residualFinalEnvGates.js';
import { getSettingsForSource } from '../../utils/settings/settings.js';
import { logOTelEvent } from '../../utils/telemetry/events.js';
import { useSurveyState } from './useSurveyState.js';
import type { FeedbackSurveyResponse } from './utils.js';

const HIDE_THANKS_AFTER_MS = 3000;

/** densable SP(): org-policy enabled plugin *names* (entries with @). */
function getOrgPolicyPluginNames(): Set<string> | null {
  const enabled = getSettingsForSource('policySettings')?.enabledPlugins;
  if (!enabled) return null;
  const names = new Set<string>();
  for (const [id, on] of Object.entries(enabled)) {
    if (typeof on !== 'boolean' || !id.includes('@')) continue;
    const name = id.split('@')[0];
    if (name) names.add(name);
  }
  return names.size > 0 ? names : null;
}

export function usePluginSurvey(
  isLoading: boolean,
  hasActivePrompt = false,
  { enabled = true, otherSurveyActive = false }: { enabled?: boolean; otherSurveyActive?: boolean } = {},
): {
  state: 'closed' | 'open' | 'pending' | 'thanks' | 'transcript_prompt' | 'submitting' | 'submitted';
  lastResponse: FeedbackSurveyResponse | null;
  handleSelect: (selected: FeedbackSurveyResponse) => void;
  handleUndo: () => void;
  abandon: () => void;
  subject: PluginSurveySubject | null;
  message: string;
} {
  const gbConfig = useDynamicConfig<Partial<PluginSurveyConfig>>(
    'tengu_plugin_feedback_survey_config',
    DEFAULT_PLUGIN_SURVEY_CONFIG,
  );
  // Memoize so turn-settle effect deps don't churn every render
  const config: PluginSurveyConfig = useMemo(
    () => ({
      probability: gbConfig.probability ?? DEFAULT_PLUGIN_SURVEY_CONFIG.probability,
      minTimeBetweenGlobalMs: gbConfig.minTimeBetweenGlobalMs ?? DEFAULT_PLUGIN_SURVEY_CONFIG.minTimeBetweenGlobalMs,
      minTimeBetweenPerPluginMs:
        gbConfig.minTimeBetweenPerPluginMs ?? DEFAULT_PLUGIN_SURVEY_CONFIG.minTimeBetweenPerPluginMs,
      enabledTriggers: gbConfig.enabledTriggers ?? DEFAULT_PLUGIN_SURVEY_CONFIG.enabledTriggers,
      enabledScopes: gbConfig.enabledScopes ?? DEFAULT_PLUGIN_SURVEY_CONFIG.enabledScopes,
    }),
    [gbConfig],
  );

  const [subject, setSubject] = useState<PluginSurveySubject | null>(null);
  const subjectRef = useRef<PluginSurveySubject | null>(null);
  // densable xBa: watermark for Wwt(since) — only drain activity after this ts
  const sinceTsRef = useRef(Date.now());
  const wasLoadingRef = useRef(isLoading);

  // densable N8b: clear activity ring on mount so pre-survey noise is dropped
  useEffect(() => {
    drainPluginActivity(Number.POSITIVE_INFINITY);
  }, []);

  const onOpen = useCallback((appearanceId: string) => {
    const subj = subjectRef.current;
    if (!subj) return;
    const now = Date.now();
    const key = pluginSurveyKeyHash(subj.name, subj.marketplace);
    saveGlobalConfig(current => ({
      ...current,
      pluginSurveyState: {
        lastShownTime: now,
        perPlugin: {
          ...current.pluginSurveyState?.perPlugin,
          [key]: now,
        },
      },
    }));
    logEvent('tengu_plugin_feedback_survey_event', {
      event_type: 'appeared' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      trigger_type: subj.trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    void logOTelEvent('feedback_survey', {
      event_type: 'appeared',
      appearance_id: appearanceId,
      survey_type: 'plugin',
      trigger_type: subj.trigger,
    });
  }, []);

  const onSelect = useCallback((appearanceId: string, selected: FeedbackSurveyResponse) => {
    const subj = subjectRef.current;
    if (!subj) return;
    logEvent('tengu_plugin_feedback_survey_event', {
      event_type: 'responded' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      response: selected as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      trigger_type: subj.trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    void logOTelEvent('feedback_survey', {
      event_type: 'responded',
      appearance_id: appearanceId,
      response: selected,
      survey_type: 'plugin',
      trigger_type: subj.trigger,
    });
  }, []);

  // densable qvr("abandoned", appearanceId, subject)
  const onAbandon = useCallback((appearanceId: string) => {
    const subj = subjectRef.current;
    if (!subj) return;
    logEvent('tengu_plugin_feedback_survey_event', {
      event_type: 'abandoned' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      trigger_type: subj.trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    void logOTelEvent('feedback_survey', {
      event_type: 'abandoned',
      appearance_id: appearanceId,
      survey_type: 'plugin',
      trigger_type: subj.trigger,
    });
  }, []);

  const { state, lastResponse, open, abandon, handleSelect, handleUndo } = useSurveyState({
    hideThanksAfterMs: HIDE_THANKS_AFTER_MS,
    otherSurveyActive,
    onOpen,
    onSelect,
    onAbandon,
  });

  // densable: fire on loading true → false edge (turn settled)
  useEffect(() => {
    const wasLoading = wasLoadingRef.current;
    wasLoadingRef.current = isLoading;
    if (!wasLoading || isLoading) return;
    if (hasActivePrompt || state !== 'closed') return;
    if (otherSurveyActive) return;
    if (!enabled || config.probability <= 0) return;
    if (isFeedbackSurveyEnvDisabled()) return;
    if (isFeedbackSurveyDisabled()) return;
    if (!isPolicyAllowed('allow_product_feedback')) return;

    const now = Date.now();
    const surveyState = getGlobalConfig().pluginSurveyState;
    if (surveyState?.lastShownTime && now - surveyState.lastShownTime < config.minTimeBetweenGlobalMs) {
      // densable: still drain watermark so ring doesn't accumulate forever
      drainPluginActivity(sinceTsRef.current);
      sinceTsRef.current = now;
      return;
    }

    const drained = drainPluginActivity(sinceTsRef.current);
    sinceTsRef.current = now;
    if (drained.length === 0) return;

    const chosen = selectPluginSurveySubject(
      drained,
      config,
      surveyState?.perPlugin ?? {},
      getOrgPolicyPluginNames(),
      now,
    );
    if (!chosen) return;
    if (Math.random() >= config.probability) return;

    subjectRef.current = chosen;
    setSubject(chosen);
    open();
  }, [isLoading, hasActivePrompt, state, otherSurveyActive, enabled, config, open]);

  return {
    state,
    lastResponse,
    handleSelect,
    handleUndo,
    abandon,
    subject,
    message: formatPluginSurveyMessage(subject),
  };
}
