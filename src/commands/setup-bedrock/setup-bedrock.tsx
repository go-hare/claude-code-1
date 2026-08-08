/**
 * densable setup-bedrock wizard shell — multi-step local-jsx.
 * Verification core is densable rZs/iEp/Fzy in setupBedrockVerify.ts.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text, useInput } from '@anthropic/ink';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import {
  type BedrockAuthMethod,
  type BedrockVerifyResult,
  type BedrockWizardData,
  verifyBedrockWizardCredentials,
} from '../../utils/bedrock/setupBedrockVerify.js';
import { applyConfigEnvironmentVariables } from '../../utils/managedEnv.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';

type Step = 'auth' | 'region' | 'profile' | 'accessKey' | 'bearer' | 'verifying' | 'result';

const AUTH_OPTIONS: { id: BedrockAuthMethod; label: string }[] = [
  { id: 'profile', label: 'AWS profile (SSO or named profile)' },
  { id: 'bearer', label: 'Bedrock API key (bearer token)' },
  { id: 'accessKey', label: 'Access key + secret' },
  { id: 'environment', label: 'Use credentials already in my environment' },
];

function defaultRegion(): string {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || process.env.CLOUD_ML_REGION || 'us-east-1';
}

function SetupBedrockWizard({ onDone }: { onDone: LocalJSXCommandOnDone }): React.ReactNode {
  const [step, setStep] = useState<Step>('auth');
  const [authIdx, setAuthIdx] = useState(0);
  const [region, setRegion] = useState(defaultRegion);
  const [profile, setProfile] = useState(process.env.AWS_PROFILE ?? 'default');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [bearerToken, setBearerToken] = useState(process.env.AWS_BEARER_TOKEN_BEDROCK ?? '');
  const [fieldFocus, setFieldFocus] = useState(0);
  const [verifyResult, setVerifyResult] = useState<BedrockVerifyResult | null>(null);
  const [authMethod, setAuthMethod] = useState<BedrockAuthMethod>('profile');

  useEffect(() => {
    logEvent('tengu_bedrock_setup_started', {
      source: 'setup-bedrock' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    logEvent('tengu_oauth_bedrock_wizard_launched', {
      source: 'bedrock_wizard' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
  }, []);

  const cancel = useCallback(() => {
    logEvent('tengu_bedrock_setup_cancelled', {});
    onDone('Bedrock setup cancelled.');
  }, [onDone]);

  const buildData = useCallback((): BedrockWizardData => {
    return {
      authMethod,
      region: region.trim(),
      awsProfile: profile.trim(),
      accessKeyId: accessKeyId.trim(),
      secretAccessKey: secretAccessKey.trim(),
      sessionToken: sessionToken.trim() || undefined,
      bearerToken: bearerToken.trim(),
    };
  }, [authMethod, region, profile, accessKeyId, secretAccessKey, sessionToken, bearerToken]);

  const runVerify = useCallback(async () => {
    setStep('verifying');
    const data = buildData();
    const result = await verifyBedrockWizardCredentials(data);
    setVerifyResult(result);
    setStep('result');
  }, [buildData]);

  const applySuccess = useCallback(() => {
    const data = buildData();
    const env: Record<string, string | undefined> = {
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_REGION: data.region,
      // Clear other provider flags so applyConfigEnvironmentVariables is clean
      CLAUDE_CODE_USE_VERTEX: undefined,
      CLAUDE_CODE_USE_FOUNDRY: undefined,
      CLAUDE_CODE_USE_OPENAI: undefined,
      CLAUDE_CODE_USE_GEMINI: undefined,
      CLAUDE_CODE_USE_GROK: undefined,
    };
    if (data.authMethod === 'profile' && data.awsProfile) {
      env.AWS_PROFILE = data.awsProfile;
      env.AWS_BEARER_TOKEN_BEDROCK = undefined;
    }
    if (data.authMethod === 'bearer' && data.bearerToken) {
      env.AWS_BEARER_TOKEN_BEDROCK = data.bearerToken;
    }
    if (data.authMethod === 'accessKey') {
      env.AWS_ACCESS_KEY_ID = data.accessKeyId;
      env.AWS_SECRET_ACCESS_KEY = data.secretAccessKey;
      if (data.sessionToken) env.AWS_SESSION_TOKEN = data.sessionToken;
    }
    // Bedrock is env-driven (like /provider bedrock) — modelType enum has no
    // 'bedrock'; clear third-party pins so env CLAUDE_CODE_USE_BEDROCK wins.
    updateSettingsForSource('userSettings', {
      modelType: undefined,
      env: env as unknown as Record<string, string>,
    });
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    delete process.env.CLAUDE_CODE_USE_FOUNDRY;
    delete process.env.CLAUDE_CODE_USE_OPENAI;
    delete process.env.CLAUDE_CODE_USE_GEMINI;
    delete process.env.CLAUDE_CODE_USE_GROK;
    // Apply into process.env for this session
    process.env.CLAUDE_CODE_USE_BEDROCK = '1';
    process.env.AWS_REGION = data.region;
    if (data.authMethod === 'profile' && data.awsProfile) {
      process.env.AWS_PROFILE = data.awsProfile;
    }
    if (data.authMethod === 'bearer' && data.bearerToken) {
      process.env.AWS_BEARER_TOKEN_BEDROCK = data.bearerToken;
    }
    if (data.authMethod === 'accessKey') {
      if (data.accessKeyId) process.env.AWS_ACCESS_KEY_ID = data.accessKeyId;
      if (data.secretAccessKey) process.env.AWS_SECRET_ACCESS_KEY = data.secretAccessKey;
      if (data.sessionToken) process.env.AWS_SESSION_TOKEN = data.sessionToken;
    }
    applyConfigEnvironmentVariables();
    logEvent('tengu_bedrock_setup_complete', {
      authMethod: data.authMethod as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    const identity = verifyResult?.status === 'ok' ? verifyResult.identity : data.region;
    onDone(`Bedrock configured (${data.authMethod}, ${data.region}) — ${identity}`);
  }, [buildData, onDone, verifyResult]);

  useInput((input, key) => {
    if (key.escape) {
      cancel();
      return;
    }
    if (step === 'auth') {
      if (key.upArrow) setAuthIdx(i => Math.max(0, i - 1));
      else if (key.downArrow) setAuthIdx(i => Math.min(AUTH_OPTIONS.length - 1, i + 1));
      else if (key.return) {
        const method = AUTH_OPTIONS[authIdx]!.id;
        setAuthMethod(method);
        setStep('region');
      }
      return;
    }
    if (step === 'region') {
      if (key.return) {
        if (authMethod === 'profile') setStep('profile');
        else if (authMethod === 'accessKey') setStep('accessKey');
        else if (authMethod === 'bearer') setStep('bearer');
        else void runVerify();
      } else if (key.backspace || key.delete) {
        setRegion(r => r.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setRegion(r => r + input);
      }
      return;
    }
    if (step === 'profile') {
      if (key.return) void runVerify();
      else if (key.backspace || key.delete) setProfile(p => p.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setProfile(p => p + input);
      return;
    }
    if (step === 'bearer') {
      if (key.return) void runVerify();
      else if (key.backspace || key.delete) setBearerToken(t => t.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setBearerToken(t => t + input);
      return;
    }
    if (step === 'accessKey') {
      if (key.tab) {
        setFieldFocus(f => (f + 1) % 3);
        return;
      }
      if (key.return) {
        if (fieldFocus < 2) setFieldFocus(f => f + 1);
        else void runVerify();
        return;
      }
      const append = (s: string) => {
        if (fieldFocus === 0) setAccessKeyId(v => v + s);
        else if (fieldFocus === 1) setSecretAccessKey(v => v + s);
        else setSessionToken(v => v + s);
      };
      const back = () => {
        if (fieldFocus === 0) setAccessKeyId(v => v.slice(0, -1));
        else if (fieldFocus === 1) setSecretAccessKey(v => v.slice(0, -1));
        else setSessionToken(v => v.slice(0, -1));
      };
      if (key.backspace || key.delete) back();
      else if (input && !key.ctrl && !key.meta) append(input);
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
      <Text bold>Amazon Bedrock setup</Text>
      {step === 'auth' && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>How do you want to authenticate?</Text>
          {AUTH_OPTIONS.map((opt, i) => (
            <Text key={opt.id} color={i === authIdx ? 'suggestion' : undefined}>
              {i === authIdx ? '❯ ' : '  '}
              {opt.label}
            </Text>
          ))}
          <Box marginTop={1}>
            <Text dimColor>↑↓ select · Enter confirm · Esc cancel</Text>
          </Box>
        </Box>
      )}
      {step === 'region' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>AWS region</Text>
          <Text>
            {'> '}
            {region}
            <Text inverse> </Text>
          </Text>
          <Text dimColor>Enter to continue · Esc cancel</Text>
        </Box>
      )}
      {step === 'profile' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>AWS profile name</Text>
          <Text>
            {'> '}
            {profile}
            <Text inverse> </Text>
          </Text>
          <Text dimColor>Enter to verify · Esc cancel</Text>
        </Box>
      )}
      {step === 'bearer' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Bedrock API key (bearer token)</Text>
          <Text>
            {'> '}
            {bearerToken ? '•'.repeat(Math.min(bearerToken.length, 24)) : ''}
            <Text inverse> </Text>
          </Text>
          <Text dimColor>Enter to verify · Esc cancel</Text>
        </Box>
      )}
      {step === 'accessKey' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Access key credentials (Tab to switch fields)</Text>
          <Text color={fieldFocus === 0 ? 'suggestion' : undefined}>
            Access key ID: {accessKeyId}
            {fieldFocus === 0 ? '█' : ''}
          </Text>
          <Text color={fieldFocus === 1 ? 'suggestion' : undefined}>
            Secret: {secretAccessKey ? '•'.repeat(Math.min(secretAccessKey.length, 16)) : ''}
            {fieldFocus === 1 ? '█' : ''}
          </Text>
          <Text color={fieldFocus === 2 ? 'suggestion' : undefined}>
            Session token (optional): {sessionToken ? '•'.repeat(Math.min(sessionToken.length, 12)) : ''}
            {fieldFocus === 2 ? '█' : ''}
          </Text>
          <Text dimColor>Enter verify · Esc cancel</Text>
        </Box>
      )}
      {step === 'verifying' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Verifying credentials…</Text>
          <Text dimColor>STS GetCallerIdentity + Bedrock ListInferenceProfiles (region {region})</Text>
        </Box>
      )}
      {step === 'result' && verifyResult && (
        <Box flexDirection="column" marginTop={1}>
          {verifyResult.status === 'ok' ? (
            <>
              <Text color="success">Credentials OK</Text>
              <Text>Identity: {verifyResult.identity}</Text>
              {verifyResult.note && <Text dimColor>{verifyResult.note}</Text>}
              {verifyResult.profiles.length > 0 && (
                <Text dimColor>
                  Anthropic profiles: {verifyResult.profiles.slice(0, 5).join(', ')}
                  {verifyResult.profiles.length > 5 ? ` (+${verifyResult.profiles.length - 5})` : ''}
                </Text>
              )}
              <Box marginTop={1}>
                <Text dimColor>Enter to save · Esc cancel · r retry</Text>
              </Box>
            </>
          ) : (
            <>
              <Text color="error">{verifyResult.error}</Text>
              {verifyResult.command && <Text color="suggestion">{verifyResult.command}</Text>}
              <Box marginTop={1}>
                <Text dimColor>Enter / Esc to close · r retry</Text>
              </Box>
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, _args?: string): Promise<React.ReactNode> {
  return <SetupBedrockWizard onDone={onDone} />;
}
