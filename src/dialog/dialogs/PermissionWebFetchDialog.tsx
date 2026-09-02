/**
 * densable csu — permission_webfetch DialogHost renderer.
 *
 * Gold 2.1.239: jsu `vM(Uno,csu)`. Yes / optional domain allow / No(esc).
 * Esc/onCancel → `{behavior:"cancelled"}` (not deny). URL preview is yO-string
 * (wP) withheld vs `url: ${text}`. Wrap PermissionDialog title `"Fetch"` with
 * gold Cm `requestSource`. Host answer is store.answer; do not dequeue.
 * Do not invent dh gutter.
 */
import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { Select } from '../../components/CustomSelect/index.js';
import { PermissionDialog } from '../../components/permissions/PermissionDialog.js';
import { PermissionRuleExplanation } from '../../components/permissions/PermissionRuleExplanation.js';
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js';
import type { DialogRendererProps } from '../DialogHost.js';
import { APPROVAL_WITHHELD_MARKER, previewUrlString, type UrlPreview } from '../permissionBrowser.js';
import {
  buildWebFetchDomainAllowRow,
  type WebFetchPermissionChoice,
  type WebFetchPermissionPayload,
  resolveWebFetchPermissionAnswer,
  shouldShowWebFetchDomainAllow,
} from '../permissionWebFetch.js';

function previewFetchUrl(url: unknown): UrlPreview {
  return (
    previewUrlString(url) ?? {
      kind: 'withheld',
      marker: APPROVAL_WITHHELD_MARKER,
    }
  );
}

function fetchInputFields(input: unknown): { url: unknown; prompt: unknown } {
  if (input !== null && typeof input === 'object') {
    const parsed = input as { url?: unknown; prompt?: unknown };
    return { url: parsed.url, prompt: parsed.prompt };
  }
  return { url: undefined, prompt: undefined };
}

export function PermissionWebFetchDialog({ payload, answer }: DialogRendererProps): React.ReactNode {
  const p = payload as WebFetchPermissionPayload;
  const { url, prompt } = fetchInputFields(p.input);
  const urlPreview = previewFetchUrl(url);
  const withheld = urlPreview.kind === 'withheld';
  const row = shouldShowWebFetchDomainAllow(p) && !withheld ? buildWebFetchDomainAllowRow(p) : null;
  const promptText = typeof prompt === 'string' ? prompt : '';

  const options: Array<{
    label: React.ReactNode;
    value: WebFetchPermissionChoice;
  }> = [{ label: 'Yes', value: 'yes' }];
  if (row !== null) {
    options.push({
      label: (
        <Text>
          Yes, and don&apos;t ask again for <Text bold>{row.display}</Text>
        </Text>
      ),
      value: 'yes-dont-ask-again-domain',
    });
  }
  options.push({
    label: (
      <Text>
        No, and tell Claude what to do differently <Text bold>(esc)</Text>
      </Text>
    ),
    value: 'no',
  });

  const urlNode =
    urlPreview.kind === 'withheld' ? (
      <Text dimColor>{urlPreview.marker}</Text>
    ) : (
      <Box flexDirection={urlPreview.needsGutter ? 'column' : 'row'}>
        <Text>{`url: ${urlPreview.text}`}</Text>
      </Box>
    );

  const promptNode =
    promptText !== '' ? (
      <Box flexDirection={promptText.includes('\n') ? 'column' : 'row'}>
        <Text>{`prompt: ${promptText}`}</Text>
      </Box>
    ) : null;

  return (
    <PermissionDialog title="Fetch" requestSource={p.requestSource}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {urlNode}
        {promptNode}
        <Text dimColor>{typeof p.description === 'string' ? p.description : ''}</Text>
      </Box>
      <Box flexDirection="column">
        <PermissionRuleExplanation permissionResult={p.permissionResult as PermissionDecision} toolType="tool" />
        <Text>Do you want to allow Claude to fetch this content?</Text>
        <Select
          options={options}
          onChange={(choice: WebFetchPermissionChoice) => {
            answer(resolveWebFetchPermissionAnswer(choice, p, row));
          }}
          onCancel={() => {
            answer({ behavior: 'cancelled' });
          }}
        />
      </Box>
    </PermissionDialog>
  );
}
