import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { setupTerminal, shouldOfferTerminalSetup } from '../commands/terminalSetup/terminalSetup.js';
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Byline, KeyboardShortcutHint, Link, Newline, Text, useTheme } from '@anthropic/ink';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { isAnthropicAuthEnabled } from '../utils/auth.js';
import { shouldSkipOnboardingPreflight } from '../utils/forceLoginMethod.js';
import { normalizeApiKeyForConfig } from '../utils/authPortable.js';
import { getCustomApiKeyStatus } from '../utils/config.js';
import { env } from '../utils/env.js';
import { isRunningOnHomespace } from '../utils/envUtils.js';
import { PreflightStep } from '../utils/preflightChecks.js';
import { isScreenReaderModeEnabled } from '../utils/screenReaderGate.js';
import type { ThemeSetting } from '../utils/theme.js';
import { ApproveApiKey } from './ApproveApiKey.js';
import { ConfirmSelect } from './ConfirmSelect.js';
import { ConsoleOAuthFlow as RawConsoleOAuthFlow } from './ConsoleOAuthFlow.js';
import { WelcomeV2 } from './LogoV2/WelcomeV2.js';
import { PressEnterToContinue } from './PressEnterToContinue.js';
import { ThemePicker } from './ThemePicker.js';
import { OrderedList } from './ui/OrderedList.js';

const ConsoleOAuthFlow: React.ComponentType<
  React.ComponentProps<typeof RawConsoleOAuthFlow> & { allowContinueWithoutLogin?: boolean }
> = RawConsoleOAuthFlow;

type StepId = 'preflight' | 'theme' | 'oauth' | 'api-key' | 'security' | 'terminal-setup';

interface OnboardingStep {
  id: StepId;
  component: React.ReactNode;
}

type Props = {
  onDone(): void;
};

export function Onboarding({ onDone }: Props): React.ReactNode {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [oauthEnabled] = useState(() => isAnthropicAuthEnabled());
  // densable 2.1.247 l = Ae()||Ie() = Q$()||Z$()
  const [skipAnthropicPreflight] = useState(() => shouldSkipOnboardingPreflight());
  const completedRef = useRef(false);
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    logEvent('tengu_began_setup', {
      oauthEnabled,
    });
  }, [oauthEnabled]);

  function goToNextStep(stepDelta = 1) {
    const nextIndex = currentStepIndex + stepDelta;
    if (nextIndex < steps.length) {
      setCurrentStepIndex(nextIndex);
      for (let i = currentStepIndex + 1; i <= nextIndex; i++) {
        logEvent('tengu_onboarding_step', {
          oauthEnabled,
          stepId: steps[i]?.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
      }
    } else {
      if (completedRef.current) {
        return;
      }
      completedRef.current = true;
      onDone();
    }
  }

  function handleThemeSelection(newTheme: ThemeSetting) {
    setTheme(newTheme);
    goToNextStep();
  }

  const exitState = useExitOnCtrlCDWithKeybindings();

  // Define all onboarding steps
  const themeStep = (
    <Box marginX={1}>
      <ThemePicker
        onThemeSelect={handleThemeSelection}
        showIntroText={true}
        helpText="To change this later, run /theme"
        hideEscToCancel={true}
        skipExitHandling={true} // Skip exit handling as Onboarding already handles it
      />
    </Box>
  );

  const securityStep = (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Security notes:</Text>
      <Box flexDirection="column" width={70}>
        {/**
         * OrderedList misnumbers items when rendering conditionally,
         * so put all items in the if/else
         */}
        <OrderedList>
          <OrderedList.Item>
            <Text>Claude can make mistakes.</Text>
            <Text dimColor wrap="wrap">
              You&apos;re responsible for Claude&apos;s actions and should always
              <Newline />
              review them, especially when running code.
              <Newline />
            </Text>
          </OrderedList.Item>
          <OrderedList.Item>
            <Text>Due to prompt injection risks, only use it with code you trust</Text>
            <Link url="https://code.claude.com/docs/en/security" />
          </OrderedList.Item>
        </OrderedList>
      </Box>
      <PressEnterToContinue />
    </Box>
  );

  // Create the steps array - determine which steps to include based on reAuth and oauthEnabled
  const apiKeyNeedingApproval = useMemo(() => {
    // Add API key step if needed
    // On homespace, ANTHROPIC_API_KEY is preserved in process.env for child
    // processes but ignored by Claude Code itself (see auth.ts).
    if (!process.env.ANTHROPIC_API_KEY || isRunningOnHomespace()) {
      return '';
    }
    const customApiKeyTruncated = normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY);
    if (getCustomApiKeyStatus(customApiKeyTruncated) === 'new') {
      return customApiKeyTruncated;
    }
  }, []);

  function handleApiKeyDone(shouldSkipOAuth: boolean) {
    const shouldSkip = shouldSkipOAuth && steps[currentStepIndex + 1]?.id === 'oauth';
    goToNextStep(shouldSkip ? 2 : 1);
  }

  const steps: OnboardingStep[] = [];
  // densable 247 Yo: if(c&&!l) push preflight before theme
  if (oauthEnabled && !skipAnthropicPreflight) {
    steps.push({
      id: 'preflight',
      component: <PreflightStep onSuccess={goToNextStep} />,
    });
  }
  steps.push({ id: 'theme', component: themeStep });

  if (apiKeyNeedingApproval) {
    steps.push({
      id: 'api-key',
      component: <ApproveApiKey customApiKeyTruncated={apiKeyNeedingApproval} onDone={handleApiKeyDone} />,
    });
  }

  if (oauthEnabled) {
    steps.push({
      id: 'oauth',
      component: (
        <Box flexDirection="column" gap={1} paddingLeft={1}>
          <ConsoleOAuthFlow onDone={goToNextStep} urlOutdent={1} allowContinueWithoutLogin={true} />
        </Box>
      ),
    });
  }

  steps.push({ id: 'security', component: securityStep });

  if (shouldOfferTerminalSetup()) {
    steps.push({
      id: 'terminal-setup',
      component: (
        <Box flexDirection="column" gap={1} paddingLeft={1}>
          <Text bold>Use Claude Code&apos;s terminal setup?</Text>
          <Box flexDirection="column" width={70} gap={1}>
            <Text>
              For the optimal coding experience, enable the recommended settings
              <Newline />
              for your terminal:{' '}
              {env.terminal === 'Apple_Terminal'
                ? isScreenReaderModeEnabled()
                  ? 'Option+Enter for newlines'
                  : 'Option+Enter for newlines and no audible bell'
                : 'Shift+Enter for newlines'}
            </Text>
            <ConfirmSelect
              confirmLabel="Yes, use recommended settings"
              cancelLabel="No, maybe later with /terminal-setup"
              onConfirm={() => {
                // Errors already logged in setupTerminal, just swallow and proceed
                void setupTerminal(theme)
                  .catch(() => {})
                  .finally(goToNextStep);
              }}
              onCancel={goToNextStep}
            />
            <Text dimColor>
              {exitState.pending ? (
                <>Press {exitState.keyName} again to exit</>
              ) : (
                <Byline>
                  <KeyboardShortcutHint shortcut="enter" action="confirm" />
                  <KeyboardShortcutHint shortcut="escape" action="skip" />
                </Byline>
              )}
            </Text>
          </Box>
        </Box>
      ),
    });
  }

  const currentStep = steps[currentStepIndex];

  // Handle Enter on security step and Escape on terminal-setup step
  // Dependencies match what goToNextStep uses internally
  const handleSecurityContinue = useCallback(() => {
    goToNextStep();
  }, [currentStepIndex, steps.length, oauthEnabled, onDone]);

  const handleTerminalSetupSkip = useCallback(() => {
    goToNextStep();
  }, [currentStepIndex, steps.length, oauthEnabled, onDone]);

  useKeybindings(
    {
      'confirm:yes': handleSecurityContinue,
    },
    {
      context: 'Confirmation',
      isActive: currentStep?.id === 'security',
    },
  );

  useKeybindings(
    {
      'confirm:no': handleTerminalSetupSkip,
    },
    {
      context: 'Confirmation',
      isActive: currentStep?.id === 'terminal-setup',
    },
  );

  return (
    <Box flexDirection="column">
      <WelcomeV2 />
      <Box flexDirection="column" marginTop={1}>
        {currentStep?.component}
        {exitState.pending && (
          <Box padding={1}>
            <Text dimColor>Press {exitState.keyName} again to exit</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
