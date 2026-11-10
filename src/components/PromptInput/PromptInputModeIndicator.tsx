import figures from 'figures';
import * as React from 'react';
import { useContext } from 'react';
import { AccessibilityContext, Box, Text } from '@anthropic/ink';
import {
  AGENT_COLOR_TO_THEME_COLOR,
  AGENT_COLORS,
  type AgentColorName,
} from '@claude-code/builtin-tools/tools/AgentTool/agentColorManager.js';
import type { PromptInputMode } from 'src/types/textInputTypes.js';
import { getTeammateColor } from 'src/utils/teammate.js';
import type { Theme } from 'src/utils/theme.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';

type Props = {
  mode: PromptInputMode;
  isLoading: boolean;
  viewingAgentName?: string;
  viewingAgentColor?: AgentColorName;
};

/**
 * Gets the theme color key for the teammate's assigned color.
 * Returns undefined if not a teammate or if the color is invalid.
 */
function getTeammateThemeColor(): keyof Theme | undefined {
  if (!isAgentSwarmsEnabled()) {
    return undefined;
  }
  const colorName = getTeammateColor();
  if (!colorName) {
    return undefined;
  }
  if (AGENT_COLORS.includes(colorName as AgentColorName)) {
    return AGENT_COLOR_TO_THEME_COLOR[colorName as AgentColorName];
  }
  return undefined;
}

type PromptCharProps = {
  isLoading: boolean;
  isScreenReader: boolean;
  // Dead code elimination: parameter named themeColor to avoid "teammate" string in external builds
  themeColor?: keyof Theme;
};

/**
 * Renders the prompt character (❯, or $ in screen-reader mode).
 * Teammate color overrides the default color when set.
 */
function PromptChar({ isLoading, isScreenReader, themeColor }: PromptCharProps): React.ReactNode {
  const color = themeColor ?? undefined;
  const pointer = isScreenReader ? <>$&nbsp;</> : <>{figures.pointer}&nbsp;</>;
  return (
    <Text color={color} dimColor={isLoading}>
      {pointer}
    </Text>
  );
}

export function PromptInputModeIndicator({
  mode,
  isLoading,
  viewingAgentName,
  viewingAgentColor,
}: Props): React.ReactNode {
  const isScreenReader = useContext(AccessibilityContext);
  const teammateColor = getTeammateThemeColor();
  const viewedTeammateThemeColor = viewingAgentColor ? AGENT_COLOR_TO_THEME_COLOR[viewingAgentColor] : undefined;
  const ariaHidden = !isScreenReader || (!viewingAgentName && mode === 'bash');

  return (
    <Box
      aria-hidden={ariaHidden}
      alignItems="flex-start"
      alignSelf="flex-start"
      flexWrap="nowrap"
      justifyContent="flex-start"
    >
      {viewingAgentName ? (
        <PromptChar isLoading={isLoading} isScreenReader={isScreenReader} themeColor={viewedTeammateThemeColor} />
      ) : mode === 'bash' ? (
        <Text color="bashBorder" dimColor={isLoading}>
          !&nbsp;
        </Text>
      ) : (
        <PromptChar
          isLoading={isLoading}
          isScreenReader={isScreenReader}
          themeColor={isAgentSwarmsEnabled() ? teammateColor : undefined}
        />
      )}
    </Box>
  );
}
