import figures from 'figures';
import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
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
  // Dead code elimination: parameter named themeColor to avoid "teammate" string in external builds
  themeColor?: keyof Theme;
};

/**
 * Renders the prompt character (❯).
 * Teammate color overrides the default color when set.
 */
function PromptChar({ isLoading, themeColor }: PromptCharProps): React.ReactNode {
  // densable Kx idle: `e(n,{dimColor:!0,children:be})` — no USER_TYPE subtle, not isLoading-gated.
  // Agent/teammate: color only. Loading dim stays on the colored pointer.
  if (themeColor) {
    return (
      <Text color={themeColor} dimColor={isLoading}>
        {figures.pointer}&nbsp;
      </Text>
    );
  }
  return <Text dimColor>{figures.pointer}&nbsp;</Text>;
}

export function PromptInputModeIndicator({
  mode,
  isLoading,
  viewingAgentName,
  viewingAgentColor,
}: Props): React.ReactNode {
  const teammateColor = getTeammateThemeColor();

  // Convert viewed teammate's color to theme color
  // Falls back to PromptChar idle dimColor (gold Kx).
  const viewedTeammateThemeColor = viewingAgentColor ? AGENT_COLOR_TO_THEME_COLOR[viewingAgentColor] : undefined;

  return (
    <Box alignItems="flex-start" alignSelf="flex-start" flexWrap="nowrap" justifyContent="flex-start">
      {viewingAgentName ? (
        // Use teammate's color on the standard prompt character, matching established style
        <PromptChar isLoading={isLoading} themeColor={viewedTeammateThemeColor} />
      ) : mode === 'bash' ? (
        <Text color="bashBorder">!&nbsp;</Text>
      ) : (
        <PromptChar isLoading={isLoading} themeColor={isAgentSwarmsEnabled() ? teammateColor : undefined} />
      )}
    </Box>
  );
}
