import React from 'react';
import { logEvent } from 'src/services/analytics/index.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- enter to continue
import { Box, Dialog, Link, Newline, Text, useInput } from '@anthropic/ink';
import { isChromeExtensionInstalled } from '../utils/claudeInChrome/setup.js';
import { saveGlobalConfig } from '../utils/config.js';

const CHROME_EXTENSION_URL = 'https://claude.ai/chrome';
const CHROME_PERMISSIONS_URL = 'https://clau.de/chrome/permissions';

type Props = {
  onDone(): void;
};

export function ClaudeInChromeOnboarding({ onDone }: Props): React.ReactNode {
  const [isExtensionInstalled, setIsExtensionInstalled] = React.useState(false);

  React.useEffect(() => {
    logEvent('tengu_claude_in_chrome_onboarding_shown', {});
    void isChromeExtensionInstalled().then(setIsExtensionInstalled);
    saveGlobalConfig(current => {
      return { ...current, hasCompletedClaudeInChromeOnboarding: true };
    });
  }, []);

  // Handle Enter to continue
  useInput((_input, key) => {
    if (key.return) {
      onDone();
    }
  });

  return (
    <Dialog title="Claude in Chrome" onCancel={onDone} color="chromeYellow">
      <Box flexDirection="column" gap={1}>
        <Text>
          Claude can use Chrome through its extension: open sites, fill forms, take screenshots, record GIFs, and read
          console logs and network requests.
          {!isExtensionInstalled && (
            <>
              <Newline />
              <Newline />
              Requires the Chrome extension. Get started at <Link url={CHROME_EXTENSION_URL} />
            </>
          )}
        </Text>

        <Text dimColor>
          Claude Code asks before Claude browses, clicks, or types on a site, unless your permission mode or a rule in
          /permissions answers for you. Sites you approved in the extension don&apos;t carry over.
          {isExtensionInstalled && (
            <>
              {' '}
              (<Link url={CHROME_PERMISSIONS_URL} />)
            </>
          )}
        </Text>
        <Text dimColor>
          For more info, use{' '}
          <Text bold color="chromeYellow">
            /chrome
          </Text>{' '}
          or visit <Link url="https://code.claude.com/docs/en/chrome" />
        </Text>
      </Box>
    </Dialog>
  );
}
