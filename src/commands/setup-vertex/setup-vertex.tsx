import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from '@anthropic/ink';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { getDefaultVertexRegion } from '../../utils/envUtils.js';
import { applyConfigEnvironmentVariables } from '../../utils/managedEnv.js';
import { getSettingsFilePathForSource, updateSettingsForSource } from '../../utils/settings/settings.js';
import {
  type VertexAuthMethod,
  type VertexVerifyResult,
  type VertexWizardData,
  buildVertexSettingsEnv,
  discoverGcloudProjects,
  expandHomePath,
  verifyVertexWizardCredentials,
} from './vertexVerify.js';

type Step = 'auth' | 'serviceAccount' | 'project' | 'region' | 'verifying' | 'result';

const AUTH_OPTIONS: readonly { id: VertexAuthMethod; label: string }[] = [
  { id: 'adc', label: 'Application Default Credentials (gcloud auth)' },
  { id: 'serviceAccount', label: 'Service account key file' },
  { id: 'environment', label: 'Use credentials already in my environment' },
];

function SetupVertexWizard({ onDone }: { onDone: LocalJSXCommandOnDone }): React.ReactNode {
  const discoveredProjects = useMemo(() => discoverGcloudProjects(), []);
  const [step, setStep] = useState<Step>('auth');
  const [authIdx, setAuthIdx] = useState(0);
  const [authMethod, setAuthMethod] = useState<VertexAuthMethod>('adc');
  const [keyFile, setKeyFile] = useState(process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '');
  const [projectId, setProjectId] = useState(process.env.ANTHROPIC_VERTEX_PROJECT_ID ?? discoveredProjects[0] ?? '');
  const [region, setRegion] = useState(process.env.CLOUD_ML_REGION ?? getDefaultVertexRegion() ?? 'global');
  const [verifyResult, setVerifyResult] = useState<VertexVerifyResult | null>(null);

  useEffect(() => {
    logEvent('tengu_vertex_setup_started', {});
  }, []);

  const cancel = useCallback(() => {
    logEvent('tengu_vertex_setup_cancelled', {});
    onDone('Vertex AI setup cancelled.');
  }, [onDone]);

  const buildData = useCallback((): VertexWizardData => {
    return {
      authMethod,
      projectId: projectId.trim(),
      region: region.trim() || 'global',
      keyFile: authMethod === 'serviceAccount' ? expandHomePath(keyFile) : undefined,
      verifiedIdentity: verifyResult?.status === 'ok' ? verifyResult.identity : undefined,
    };
  }, [authMethod, projectId, region, keyFile, verifyResult]);

  const runVerify = useCallback(async () => {
    setStep('verifying');
    const result = await verifyVertexWizardCredentials(buildData());
    setVerifyResult(result);
    setStep('result');
  }, [buildData]);

  const applySuccess = useCallback(() => {
    const data = buildData();
    const env = buildVertexSettingsEnv(data);
    const { error } = updateSettingsForSource('userSettings', {
      modelType: undefined,
      env: env as unknown as Record<string, string>,
    });
    if (error) {
      onDone(`Failed to save Vertex AI settings: ${error.message}`, { display: 'system' });
      return;
    }
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    applyConfigEnvironmentVariables();
    const settingsPath = getSettingsFilePathForSource('userSettings') ?? '~/.claude/settings.json';
    logEvent('tengu_vertex_setup_complete', {
      auth_method: data.authMethod as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      pinned_models: Boolean(data.pinSonnet || data.pinOpus || data.pinFable || data.pinHaiku),
      verified: Boolean(data.verifiedIdentity),
    });
    const adcHint =
      data.authMethod === 'adc'
        ? ' When your ADC token expires, run `gcloud auth application-default login` — Claude Code picks up refreshed credentials automatically.'
        : '';
    onDone(`Vertex AI configuration saved to ${settingsPath}.${adcHint} Restart Claude Code to apply all changes.`, {
      display: 'system',
    });
  }, [buildData, onDone]);

  useInput((input, key) => {
    if (key.escape) {
      cancel();
      return;
    }

    if (step === 'auth') {
      if (key.upArrow) setAuthIdx(i => (i - 1 + AUTH_OPTIONS.length) % AUTH_OPTIONS.length);
      else if (key.downArrow) setAuthIdx(i => (i + 1) % AUTH_OPTIONS.length);
      else if (key.return) {
        const chosen = AUTH_OPTIONS[authIdx]?.id ?? 'adc';
        setAuthMethod(chosen);
        setStep(chosen === 'serviceAccount' ? 'serviceAccount' : 'project');
      }
      return;
    }

    if (step === 'serviceAccount') {
      if (key.return) {
        setStep('project');
      } else if (key.backspace || key.delete) {
        setKeyFile(v => v.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setKeyFile(v => v + input);
      }
      return;
    }

    if (step === 'project') {
      if (key.return) {
        setStep('region');
      } else if (key.backspace || key.delete) {
        setProjectId(v => v.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setProjectId(v => v + input);
      }
      return;
    }

    if (step === 'region') {
      if (key.return) {
        void runVerify();
      } else if (key.backspace || key.delete) {
        setRegion(v => v.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setRegion(v => v + input);
      }
      return;
    }

    if (step === 'result') {
      if (key.return) {
        if (verifyResult?.status === 'ok') applySuccess();
        else cancel();
      } else if (input === 'r' || input === 'R') {
        void runVerify();
      }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} marginY={1}>
      <Text bold>Set up Google Vertex AI</Text>
      {step === 'auth' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>How do you authenticate to Google Cloud?</Text>
          <Text dimColor>
            Claude Code uses the standard GCP credential chain. Pick the method you already use with gcloud or in your
            deployment.
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {AUTH_OPTIONS.map((opt, idx) => (
              <Text key={opt.id} color={idx === authIdx ? 'suggestion' : undefined}>
                {idx === authIdx ? '❯ ' : '  '}
                {opt.label}
              </Text>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>↑↓ select · Enter confirm · Esc cancel</Text>
          </Box>
        </Box>
      )}
      {step === 'serviceAccount' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Service account key file path</Text>
          <Text dimColor>Download a JSON key from the GCP console under IAM → Service Accounts → Keys → Add key.</Text>
          <Text>
            {'> '}
            {keyFile || '~/keys/my-project-vertex.json'}
            <Text inverse> </Text>
          </Text>
          <Text dimColor>Enter continue · Esc cancel</Text>
        </Box>
      )}
      {step === 'project' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>GCP project ID</Text>
          <Text dimColor>The project where Vertex AI is enabled. Find it with `gcloud config get-value project`.</Text>
          {discoveredProjects.length > 0 && (
            <Text dimColor>Detected gcloud projects: {discoveredProjects.slice(0, 5).join(', ')}</Text>
          )}
          <Text>
            {'> '}
            {projectId}
            <Text inverse> </Text>
          </Text>
          <Text dimColor>Enter continue · Esc cancel</Text>
        </Box>
      )}
      {step === 'region' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Vertex AI region</Text>
          <Text dimColor>
            Use &apos;global&apos;, &apos;us&apos;, or &apos;eu&apos; for a multi-region endpoint (recommended), or a
            specific location like us-east5.
          </Text>
          <Text>
            {'> '}
            {region}
            <Text inverse> </Text>
          </Text>
          <Text dimColor>Enter verify · Esc cancel</Text>
        </Box>
      )}
      {step === 'verifying' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Verifying credentials…</Text>
          <Text dimColor>
            Calling Google Cloud ({projectId} · {region})…
          </Text>
        </Box>
      )}
      {step === 'result' && verifyResult && (
        <Box flexDirection="column" marginTop={1}>
          {verifyResult.status === 'ok' ? (
            <>
              <Text color="success">Credentials OK</Text>
              <Text>Identity: {verifyResult.identity}</Text>
              {verifyResult.note && <Text dimColor>{verifyResult.note}</Text>}
              <Box marginTop={1}>
                <Text dimColor>Enter save · Esc cancel · r retry</Text>
              </Box>
            </>
          ) : (
            <>
              <Text color="error">{verifyResult.error}</Text>
              {verifyResult.command && <Text color="suggestion">{verifyResult.command}</Text>}
              <Box marginTop={1}>
                <Text dimColor>Enter / Esc close · r retry</Text>
              </Box>
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, _args?: string): Promise<React.ReactNode> {
  return <SetupVertexWizard onDone={onDone} />;
}
