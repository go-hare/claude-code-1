import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { getIsRemoteMode } from '../bootstrap/state.js';
import type { RequestDialog } from '../dialog/requestDialog.js';
import { ideOnboardingSpec } from '../dialog/specs/jsuKinds.js';
import type { ScopedMcpServerConfig } from '../services/mcp/types.js';
import { getGlobalConfig } from '../utils/config.js';
import { isEnvDefinedFalsy, isEnvTruthy } from '../utils/envUtils.js';
import type { DetectedIDEInfo } from '../utils/ide.js';
import {
  type IDEExtensionInstallationStatus,
  type IdeType,
  cancelCurrentIDESearch,
  initializeIdeIntegration,
  isSupportedTerminal,
} from '../utils/ide.js';

type UseIDEIntegrationProps = {
  autoConnectIdeFlag?: boolean;
  ideToInstallExtension: IdeType | null;
  setDynamicMcpConfig: Dispatch<SetStateAction<Record<string, ScopedMcpServerConfig> | undefined>>;
  requestDialog: RequestDialog;
  setIDEInstallationState: Dispatch<SetStateAction<IDEExtensionInstallationStatus | null>>;
};

/**
 * densable sdu(CHr, {installationStatus}, {queueBehind:!0}).
 * Gates: wa() remote; As() bg session; NHy shown latch; n7n abort cleanup.
 */
export function useIDEIntegration({
  autoConnectIdeFlag,
  ideToInstallExtension,
  setDynamicMcpConfig,
  requestDialog,
  setIDEInstallationState,
}: UseIDEIntegrationProps): void {
  const requestDialogRef = useRef(requestDialog);
  requestDialogRef.current = requestDialog;
  const shownLatchRef = useRef(false);

  useEffect(() => {
    function addIde(ide: DetectedIDEInfo | null) {
      if (!ide) {
        return;
      }

      const globalConfig = getGlobalConfig();
      let autoConnectIdeEnv = isEnvTruthy(process.env.CLAUDE_CODE_AUTO_CONNECT_IDE);
      try {
        const { isAutoConnectIdeEnvEnabled } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js');
        autoConnectIdeEnv = isAutoConnectIdeEnvEnabled();
      } catch {
        // keep raw env fallback
      }
      const autoConnectEnabled =
        (globalConfig.autoConnectIde ||
          autoConnectIdeFlag ||
          isSupportedTerminal() ||
          process.env.CLAUDE_CODE_SSE_PORT ||
          ideToInstallExtension ||
          autoConnectIdeEnv) &&
        !isEnvDefinedFalsy(process.env.CLAUDE_CODE_AUTO_CONNECT_IDE);

      if (!autoConnectEnabled) {
        return;
      }

      setDynamicMcpConfig(prev => {
        if (prev?.ide) {
          return prev;
        }
        return {
          ...prev,
          ide: {
            type: ide.url.startsWith('ws:') ? 'ws-ide' : 'sse-ide',
            url: ide.url,
            ideName: ide.name,
            authToken: ide.authToken,
            ideRunningInWindows: ide.ideRunningInWindows,
            scope: 'dynamic' as const,
          },
        };
      });
    }

    void initializeIdeIntegration(
      addIde,
      ideToInstallExtension,
      status => {
        if (getIsRemoteMode()) return;
        if (process.env.CLAUDE_CODE_SESSION_KIND === 'bg') return;
        if (shownLatchRef.current) return;
        shownLatchRef.current = true;
        const clear = () => {
          shownLatchRef.current = false;
        };
        void requestDialogRef
          .current(ideOnboardingSpec, { installationStatus: status }, { queueBehind: true })
          .then(clear, clear);
      },
      status => setIDEInstallationState(status),
    );

    return () => {
      cancelCurrentIDESearch();
    };
  }, [autoConnectIdeFlag, ideToInstallExtension, setDynamicMcpConfig, setIDEInstallationState]);
}
