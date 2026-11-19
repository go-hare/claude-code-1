import React, { useContext } from 'react';
import { AccessibilityContext, Box, Link, Text, useTheme } from '@anthropic/ink';
import { getAntAuthFallbackNotice } from '../../commands/login/getAuthStatus.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { resolveAutoCompactWindow } from '../../utils/autoCompactWindow.js';
import { env } from '../../utils/env.js';
import { formatTokens } from '../../utils/format.js';
import { recognizePrintModel } from '../../utils/model/printSetModel.js';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';

export const MODEL_CONFIG_DOCS_URL = 'https://code.claude.com/docs/en/model-config';
export const MODEL_CONFIG_WINDOW_DOCS_URL = `${MODEL_CONFIG_DOCS_URL}#correct-the-window-for-a-gateway-or-custom-model-id`;

export type UnrecognizedModelNotice = {
  model: string;
  window: number;
  suggestion?: string;
};

/**
 * Official wSr / yC — build a short single-line startup warning for an
 * unrecognized model ID, or null if recognized / suppressed.
 */
export function buildUnrecognizedModelNotice(model: string): UnrecognizedModelNotice | null {
  if (!model) return null;
  const resolved = resolveAutoCompactWindow(model);
  if (resolved.source !== 'unknown-model') {
    return null;
  }
  const recognition = recognizePrintModel(model);
  const suggestion = !recognition.recognized ? recognition.suggestion : undefined;
  return {
    model,
    window: resolved.window,
    ...(suggestion !== undefined && { suggestion }),
  };
}

export function UnrecognizedModelWarningLine({ notice }: { notice: UnrecognizedModelNotice }): React.ReactNode {
  return (
    <Text color="warning">
      {`Model "${notice.model}" isn't recognized`}
      {notice.suggestion === undefined ? (
        <Text dimColor>
          {' · context assumed to be '}
          {formatTokens(notice.window)}
          {' tokens · update Claude Code, or see '}
          <Link url={MODEL_CONFIG_WINDOW_DOCS_URL} fallback={MODEL_CONFIG_DOCS_URL}>
            the docs
          </Link>
        </Text>
      ) : (
        <Text dimColor>{` · did you mean "${notice.suggestion}"?`}</Text>
      )}
    </Text>
  );
}

const WELCOME_V2_WIDTH = 58;
const WELCOME_V2_MIN_ROWS = 30;
const DOTTED_DIVIDER = '..........................................................';

export function WelcomeV2({
  unknownModelNotice = null,
  antAuthNotice,
}: {
  unknownModelNotice?: UnrecognizedModelNotice | null;
  antAuthNotice?: ReturnType<typeof getAntAuthFallbackNotice>;
} = {}): React.ReactNode {
  const [theme] = useTheme();
  const srContext = useContext(AccessibilityContext);
  const screenReader = srContext || isScreenReaderModeEnabled();
  const { rows } = useTerminalSize();
  const welcomeMessage = 'Welcome to Claude Code';
  const resolvedAntAuthNotice =
    antAuthNotice !== undefined ? antAuthNotice : process.env.DEMO_VERSION ? null : getAntAuthFallbackNotice();

  const banner = (() => {
    if (screenReader || rows < WELCOME_V2_MIN_ROWS) {
      return (
        <Text>
          <Text color="claude">{welcomeMessage} </Text>
          <Text dimColor>v{MACRO.VERSION}</Text>
        </Text>
      );
    }

    if (env.terminal === 'Apple_Terminal') {
      return <AppleTerminalWelcomeV2 theme={theme} welcomeMessage={welcomeMessage} />;
    }

    if (['light', 'light-daltonized', 'light-ansi'].includes(theme)) {
      return (
        <Box width={WELCOME_V2_WIDTH}>
          <Box flexDirection="column">
            <Text>
              <Text color="claude">{welcomeMessage} </Text>
              <Text dimColor>v{MACRO.VERSION} </Text>
            </Text>
            <Text>{DOTTED_DIVIDER}</Text>
            <Text>{'                                                          '}</Text>
            <Text>{'                                                          '}</Text>
            <Text>{'                                                          '}</Text>
            <Text>{'            ░░░░░░                                        '}</Text>
            <Text>{'    ░░░   ░░░░░░░░░░                                      '}</Text>
            <Text>{'   ░░░░░░░░░░░░░░░░░░░                                    '}</Text>
            <Text>{'                                                          '}</Text>
            <Text>
              <Text dimColor>{'                           ░░░░'}</Text>
              <Text>{'                     ██    '}</Text>
            </Text>
            <Text>
              <Text dimColor>{'                         ░░░░░░░░░░'}</Text>
              <Text>{'               ██▒▒██  '}</Text>
            </Text>
            <Text>{'                                            ▒▒      ██   ▒'}</Text>
            <Text>
              {'      '}
              <Text color="clawd_body"> █████████ </Text>
              {'                         ▒▒░░▒▒      ▒ ▒▒'}
            </Text>
            <Text>
              {'      '}
              <Text color="clawd_body" backgroundColor="clawd_background">
                ██▄█████▄██
              </Text>
              {'                           ▒▒         ▒▒ '}
            </Text>
            <Text>
              {'      '}
              <Text color="clawd_body"> █████████ </Text>
              {'                          ░          ▒   '}
            </Text>
            <Text>
              {'.......'}
              <Text color="clawd_body">{'█ █   █ █'}</Text>
              {'..........................░..........▒....'}
            </Text>
          </Box>
        </Box>
      );
    }

    return (
      <Box width={WELCOME_V2_WIDTH}>
        <Box flexDirection="column">
          <Text>
            <Text color="claude">{welcomeMessage} </Text>
            <Text dimColor>v{MACRO.VERSION} </Text>
          </Text>
          <Text>{DOTTED_DIVIDER}</Text>
          <Text>{'                                                          '}</Text>
          <Text>{'     *                                       █████▓▓░     '}</Text>
          <Text>{'                                 *         ███▓░     ░░   '}</Text>
          <Text>{'            ░░░░░░                        ███▓░           '}</Text>
          <Text>{'    ░░░   ░░░░░░░░░░                      ███▓░           '}</Text>
          <Text>
            <Text>{'   ░░░░░░░░░░░░░░░░░░░    '}</Text>
            <Text bold>*</Text>
            <Text>{'                ██▓░░      ▓   '}</Text>
          </Text>
          <Text>{'                                             ░▓▓███▓▓░    '}</Text>
          <Text dimColor>{' *                                 ░░░░                   '}</Text>
          <Text dimColor>{'                                 ░░░░░░░░                 '}</Text>
          <Text dimColor>{'                               ░░░░░░░░░░░░░░░░           '}</Text>
          <Text>
            {'      '}
            <Text color="clawd_body"> █████████ </Text>
            {'                                       '}
            <Text dimColor>*</Text>
            <Text> </Text>
          </Text>
          <Text>
            {'      '}
            <Text color="clawd_body">██▄█████▄██</Text>
            <Text>{'                        '}</Text>
            <Text bold>*</Text>
            <Text>{'                '}</Text>
          </Text>
          <Text>
            {'      '}
            <Text color="clawd_body"> █████████ </Text>
            {'     *                                   '}
          </Text>
          <Text>
            {'.......'}
            <Text color="clawd_body">{'█ █   █ █'}</Text>
            {'..........................................'}
          </Text>
        </Box>
      </Box>
    );
  })();

  if (unknownModelNotice === null && resolvedAntAuthNotice === null) {
    return banner;
  }

  return (
    <Box flexDirection="column">
      {banner}
      {unknownModelNotice !== null && <UnrecognizedModelWarningLine notice={unknownModelNotice} />}
      {resolvedAntAuthNotice?.reason === 'login_ended' && <Text color="warning">⚠ {resolvedAntAuthNotice.text}</Text>}
      {resolvedAntAuthNotice?.reason === 'no_login' && <Text dimColor>{resolvedAntAuthNotice.text}</Text>}
    </Box>
  );
}

type AppleTerminalWelcomeV2Props = {
  theme: string;
  welcomeMessage: string;
};

function AppleTerminalWelcomeV2({ theme, welcomeMessage }: AppleTerminalWelcomeV2Props): React.ReactNode {
  const isLightTheme = ['light', 'light-daltonized', 'light-ansi'].includes(theme);

  if (isLightTheme) {
    return (
      <Box width={WELCOME_V2_WIDTH}>
        <Box flexDirection="column">
          <Text>
            <Text color="claude">{welcomeMessage} </Text>
            <Text dimColor>v{MACRO.VERSION} </Text>
          </Text>
          <Text>{DOTTED_DIVIDER}</Text>
          <Text>{'                                                          '}</Text>
          <Text>{'                                                          '}</Text>
          <Text>{'                                                          '}</Text>
          <Text>{'            ░░░░░░                                        '}</Text>
          <Text>{'    ░░░   ░░░░░░░░░░                                      '}</Text>
          <Text>{'   ░░░░░░░░░░░░░░░░░░░                                    '}</Text>
          <Text>{'                                                          '}</Text>
          <Text>
            <Text dimColor>{'                           ░░░░'}</Text>
            <Text>{'                     ██    '}</Text>
          </Text>
          <Text>
            <Text dimColor>{'                         ░░░░░░░░░░'}</Text>
            <Text>{'               ██▒▒██  '}</Text>
          </Text>
          <Text>{'                                            ▒▒      ██   ▒'}</Text>
          <Text>{'                                          ▒▒░░▒▒      ▒ ▒▒'}</Text>
          <Text>
            {'      '}
            <Text color="clawd_body">▗</Text>
            <Text color="clawd_background" backgroundColor="clawd_body">
              {' '}
              ▗{'     '}▖{' '}
            </Text>
            <Text color="clawd_body">▖</Text>
            {'                           ▒▒         ▒▒ '}
          </Text>
          <Text>
            {'       '}
            <Text backgroundColor="clawd_body">{' '.repeat(9)}</Text>
            {'                           ░          ▒   '}
          </Text>
          <Text>
            {'.......'}
            <Text backgroundColor="clawd_body"> </Text>
            <Text> </Text>
            <Text backgroundColor="clawd_body"> </Text>
            <Text>{'   '}</Text>
            <Text backgroundColor="clawd_body"> </Text>
            <Text> </Text>
            <Text backgroundColor="clawd_body"> </Text>
            {'..........................░..........▒....'}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box width={WELCOME_V2_WIDTH}>
      <Box flexDirection="column">
        <Text>
          <Text color="claude">{welcomeMessage} </Text>
          <Text dimColor>v{MACRO.VERSION} </Text>
        </Text>
        <Text>{DOTTED_DIVIDER}</Text>
        <Text>{'                                                          '}</Text>
        <Text>{'     *                                       █████▓▓░     '}</Text>
        <Text>{'                                 *         ███▓░     ░░   '}</Text>
        <Text>{'            ░░░░░░                        ███▓░           '}</Text>
        <Text>{'    ░░░   ░░░░░░░░░░                      ███▓░           '}</Text>
        <Text>
          <Text>{'   ░░░░░░░░░░░░░░░░░░░    '}</Text>
          <Text bold>*</Text>
          <Text>{'                ██▓░░      ▓   '}</Text>
        </Text>
        <Text>{'                                             ░▓▓███▓▓░    '}</Text>
        <Text dimColor>{' *                                 ░░░░                   '}</Text>
        <Text dimColor>{'                                 ░░░░░░░░                 '}</Text>
        <Text dimColor>{'                               ░░░░░░░░░░░░░░░░           '}</Text>
        <Text>
          {'                                                      '}
          <Text dimColor>*</Text>
          <Text>{'   '}</Text>
        </Text>
        <Text>
          {'      '}
          <Text color="clawd_body">▗</Text>
          <Text color="clawd_background" backgroundColor="clawd_body">
            {' '}
            ▗{'     '}▖{' '}
          </Text>
          <Text color="clawd_body">▖</Text>
          <Text>{'                       '}</Text>
          <Text bold>*</Text>
          <Text>{'                 '}</Text>
        </Text>
        <Text>
          {'       '}
          <Text backgroundColor="clawd_body">{' '.repeat(9)}</Text>
          {'      *                                   '}
        </Text>
        <Text>
          {'.......'}
          <Text backgroundColor="clawd_body"> </Text>
          <Text> </Text>
          <Text backgroundColor="clawd_body"> </Text>
          <Text>{'   '}</Text>
          <Text backgroundColor="clawd_body"> </Text>
          <Text> </Text>
          <Text backgroundColor="clawd_body"> </Text>
          {'..........................................'}
        </Text>
      </Box>
    </Box>
  );
}
