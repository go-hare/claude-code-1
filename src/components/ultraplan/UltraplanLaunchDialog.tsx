import * as React from 'react';
import { Box, Dialog, Link, Text } from '@anthropic/ink';
import { checkGate_CACHED_OR_BLOCKING } from 'src/services/analytics/growthbook.js';
import { getPromptIdentifier, getDialogConfig, type PromptIdentifier } from 'src/utils/ultraplan/prompt.js';
import { CCR_TERMS_URL } from '../../commands/ultraplan.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import { checkGithubAppPreflight } from '../../utils/background/remote/preconditions.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { getCwd } from '../../utils/cwd.js';
import { detectCurrentRepositoryWithHost } from '../../utils/detectRepository.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { findGitRoot } from '../../utils/git.js';
import { Select } from '../CustomSelect/select.js';

type ChoiceValue = 'run' | 'cancel';

const EMPTY_PROMPT_FALLBACK = '(nothing printable)';

export type UltraplanRepositorySourceProbe = {
  cloneViable: boolean;
  bundleSeedEnabled: boolean;
};

const DEFAULT_SOURCE_PROBE: UltraplanRepositorySourceProbe = {
  cloneViable: false,
  bundleSeedEnabled: true,
};

async function probeUltraplanRepositorySource(): Promise<UltraplanRepositorySourceProbe> {
  const [repo, gateEnabled] = await Promise.all([
    detectCurrentRepositoryWithHost(),
    checkGate_CACHED_OR_BLOCKING('tengu_ccr_bundle_seed_enabled'),
  ]);
  const bundleSeedEnabled =
    findGitRoot(getCwd()) !== null && (isEnvTruthy(process.env.CCR_ENABLE_BUNDLE) || gateEnabled);
  if (!bundleSeedEnabled) {
    return { cloneViable: false, bundleSeedEnabled };
  }
  return {
    cloneViable:
      repo !== null &&
      !repo.owner.includes('/') &&
      (repo.host !== 'github.com' || (await checkGithubAppPreflight(repo.owner, repo.name)).appInstalled),
    bundleSeedEnabled,
  };
}

export function formatRepositorySourceNotice(probe: UltraplanRepositorySourceProbe): string | null {
  if (!probe.bundleSeedEnabled) return null;
  return probe.cloneViable
    ? 'This will try to clone your git remote and fall back to uploading this repository.'
    : 'This will upload your repository to a cloud session.';
}

interface UltraplanLaunchDialogProps {
  prompt?: string;
  deliveredByRelay?: boolean;
  showTerms?: boolean;
  onChoice: (
    choice: ChoiceValue,
    opts: {
      disconnectedBridge: boolean;
      promptIdentifier: PromptIdentifier;
    },
  ) => void;
}

function dispatchShowTermsLink() {
  return !getGlobalConfig().hasSeenUltraplanTerms;
}

function dispatchPromptIdentifier() {
  return getPromptIdentifier();
}

export function UltraplanLaunchDialog({
  prompt: promptProp,
  deliveredByRelay = false,
  showTerms: showTermsProp,
  onChoice,
}: UltraplanLaunchDialogProps): React.ReactNode {
  useRegisterOverlay('ultraplan-launch');
  const [defaultShowTerms] = React.useState(dispatchShowTermsLink);
  const showTermsLink = showTermsProp ?? defaultShowTerms;
  const [promptIdentifier] = React.useState(dispatchPromptIdentifier);
  const [sourceProbe, setSourceProbe] = React.useState<UltraplanRepositorySourceProbe>(DEFAULT_SOURCE_PROBE);

  React.useEffect(() => {
    if (!showTermsLink) return;
    let cancelled = false;
    void probeUltraplanRepositorySource()
      .catch(() => DEFAULT_SOURCE_PROBE)
      .then(result => {
        if (!cancelled) {
          setSourceProbe(result);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [showTermsLink]);

  const sourceNotice = showTermsLink ? formatRepositorySourceNotice(sourceProbe) : null;

  const dialogConfig = React.useMemo(() => {
    return getDialogConfig(promptIdentifier);
  }, [promptIdentifier]);

  const pendingBlurb = useAppState(state => state.ultraplanLaunchPending?.blurb);
  const isBridgeEnabled = useAppState(state => state.replBridgeEnabled);
  const setAppState = useSetAppState();

  const cleanedPrompt = React.useMemo(() => {
    const raw = promptProp ?? pendingBlurb ?? '';
    return raw.replace(/[\r\n\t]+/g, ' ').trim();
  }, [promptProp, pendingBlurb]);

  const handleChoice = React.useCallback(
    (value: ChoiceValue) => {
      const disconnectedBridge = value === 'run' && isBridgeEnabled;

      if (disconnectedBridge) {
        setAppState(prev => {
          if (!prev.replBridgeEnabled) {
            return prev;
          }
          return {
            ...prev,
            replBridgeEnabled: false,
            replBridgeExplicit: false,
            replBridgeOutboundOnly: false,
          };
        });
      }

      if (value !== 'cancel' && showTermsLink) {
        saveGlobalConfig(prev => (prev.hasSeenUltraplanTerms ? prev : { ...prev, hasSeenUltraplanTerms: true }));
      }

      onChoice(value, { disconnectedBridge, promptIdentifier });
    },
    [onChoice, isBridgeEnabled, setAppState, showTermsLink, promptIdentifier],
  );

  const handleCancel = React.useCallback(() => {
    handleChoice('cancel');
  }, [handleChoice]);

  const runDescription = isBridgeEnabled
    ? 'Disable remote control and launch in a cloud session'
    : 'launch in a cloud session';

  const options = [
    {
      label: showTermsLink ? 'Yes' : 'Run ultraplan',
      value: 'run' as const,
      description: runDescription,
    },
    { label: showTermsLink ? 'No' : 'Not now', value: 'cancel' as const },
  ];

  const promptPrefix = deliveredByRelay ? 'Prompt (sent from a connected channel): ' : 'Prompt: ';
  const promptPreview = cleanedPrompt === '' ? EMPTY_PROMPT_FALLBACK : cleanedPrompt;

  return (
    <Dialog title="Run ultraplan in the cloud?" subtitle={dialogConfig.timeEstimate} onCancel={handleCancel}>
      <Box flexDirection="column" gap={1}>
        <Text wrap="truncate-end">
          <Text dimColor>{promptPrefix}</Text>
          {promptPreview}
        </Text>

        {showTermsLink ? (
          <>
            <Text dimColor>{dialogConfig.dialogBody}</Text>
            <Box flexDirection="column">
              {sourceNotice && <Text dimColor>{sourceNotice}</Text>}
              <Text dimColor>
                More information: <Link url={CCR_TERMS_URL}>{CCR_TERMS_URL}</Link>
              </Text>
            </Box>
            <Text>Proceed?</Text>
          </>
        ) : (
          <>
            <Box flexDirection="column">
              <Text dimColor>{dialogConfig.dialogBody}</Text>
              {isBridgeEnabled && <Text dimColor>This will disable Remote Control for this session.</Text>}
            </Box>
            {!isBridgeEnabled && <Text dimColor>{dialogConfig.dialogPipeline}</Text>}
          </>
        )}

        <Select options={options} onChange={handleChoice} />
      </Box>
    </Dialog>
  );
}

export default UltraplanLaunchDialog;
