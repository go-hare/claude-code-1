/**
 * densable g8t — `/design-login` is a local-jsx flow that always hands
 * `onManualCode` to the OAuth runner. Without that callback a remote
 * session refuses and tells the user to run this same command.
 */
import { Box, Text, useInput } from '@anthropic/ink';
import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { isDesignLoginAvailable, isDesignLoginRemote, runDesignOAuthFlow } from '../../cli/handlers/designOauth.js';

const PASTE_PROMPT = 'Paste code here if prompted > ';

const AUTHORIZED = 'Design-system access authorized. /design-sync can now reach your claude.ai/design projects.';

export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  return <DesignLogin onDone={onDone} />;
}

function DesignLogin(props: { onDone: LocalJSXCommandOnDone }): React.ReactNode {
  const { onDone } = props;
  const [url, setUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const submitCode = useRef<((code: string, state: string) => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const finished = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  function finish(message: string): void {
    if (finished.current) return;
    finished.current = true;
    onDoneRef.current(message);
  }

  useEffect(() => {
    if (!isDesignLoginAvailable()) {
      finish('Claude Design sync is not available in this session.');
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    let alive = true;
    void runDesignOAuthFlow(ac.signal, {
      skipBrowserOpen: isDesignLoginRemote(),
      onAuthUrl: automatic => {
        if (alive) setUrl(automatic);
      },
      onManualCode: set => {
        submitCode.current = set;
      },
    }).then(result => {
      if (!alive) return;
      finish(result.ok ? AUTHORIZED : result.reason === 'interrupted' ? 'Design login cancelled.' : result.message);
    });
    return () => {
      alive = false;
      ac.abort();
    };
  }, []);

  useInput((input, key) => {
    if (finished.current) return;
    if (key.escape || (key.ctrl && (input === 'c' || input === 'd'))) {
      abortRef.current?.abort();
      finish('Design login cancelled.');
      return;
    }
    if (key.return) {
      const raw = draft.trim();
      const hash = raw.indexOf('#');
      if (hash <= 0 || !submitCode.current) return;
      const code = raw.slice(0, hash);
      const state = raw.slice(hash + 1);
      if (!code || !state) return;
      submitCode.current(code, state);
      setDraft('');
      return;
    }
    if (key.backspace || key.delete) {
      setDraft(value => value.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setDraft(value => value + input);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>Starting design login…</Text>
      {url !== null ? <Text>{url}</Text> : null}
      <Text>
        {PASTE_PROMPT}
        {draft}
      </Text>
    </Box>
  );
}
