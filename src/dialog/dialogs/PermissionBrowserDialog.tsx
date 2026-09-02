/**
 * densable Hnu — permission_browser DialogHost renderer.
 *
 * Gold 2.1.239: jsu `vM(Cno,Hnu)`. Allow / optional allow-domain
 * (`ConsentRow.node` from Lmy S3) / Deny(esc). Esc/onCancel →
 * `{behavior:"cancelled"}`. URL preview is yO-string (wP) withheld vs
 * full. Wrap PermissionDialog with gold Cm `requestSource` (G2e). Host
 * answer is store.answer; do not dequeue. Do not invent BLS/ULS or dh.
 */
import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { Select } from '../../components/CustomSelect/index.js';
import { PermissionDialog } from '../../components/permissions/PermissionDialog.js';
import type { DialogRendererProps } from '../DialogHost.js';
import {
  APPROVAL_WITHHELD_MARKER,
  type BrowserPermissionChoice,
  type BrowserPermissionPayload,
  type UrlPreview,
  buildChromeDomainAllowRow,
  previewUrlString,
  resolveBrowserPermissionAnswer,
  sanitizeHostDisplay,
  shouldShowChromeDomainAllow,
} from '../permissionBrowser.js';

function previewChromeUrl(chrome: BrowserPermissionPayload['chrome']): UrlPreview | null {
  if (!chrome) return null;
  // gold yO(jDe.url): non-string → Xil/catch withheld. Do not invent Xil.
  return (
    previewUrlString(chrome.url) ?? {
      kind: 'withheld',
      marker: APPROVAL_WITHHELD_MARKER,
    }
  );
}

export function PermissionBrowserDialog({ payload, answer }: DialogRendererProps): React.ReactNode {
  const p = payload as BrowserPermissionPayload;
  const { verbPhrase, chrome } = p;
  const urlPreview = previewChromeUrl(chrome);
  const withheld = urlPreview !== null && urlPreview.kind === 'withheld';
  const row = shouldShowChromeDomainAllow(p) && !withheld ? buildChromeDomainAllowRow(chrome) : null;

  const host = chrome ? sanitizeHostDisplay(chrome.host) : null;
  const title =
    host !== null
      ? `Claude in Chrome wants to ${verbPhrase} on ${host.display}`
      : `Claude in Chrome wants to ${verbPhrase}`;

  const options: Array<{
    label: React.ReactNode;
    value: BrowserPermissionChoice;
  }> = [{ label: 'Allow', value: 'allow' }];
  if (row !== null) {
    options.push({
      label: row.node,
      value: 'allow-domain',
    });
  }
  options.push({
    label: (
      <Text>
        Deny <Text bold>(esc)</Text>
      </Text>
    ),
    value: 'deny',
  });

  const urlNode =
    chrome && urlPreview !== null ? (
      urlPreview.kind === 'withheld' ? (
        <Text dimColor>{urlPreview.marker}</Text>
      ) : (
        <Box flexDirection={urlPreview.needsGutter ? 'column' : 'row'}>
          <Text dimColor>{urlPreview.text}</Text>
        </Box>
      )
    ) : null;

  return (
    <PermissionDialog title={title} requestSource={p.requestSource}>
      <Box flexDirection="column" paddingY={1} gap={1}>
        {urlNode}
        <Select
          options={options}
          onChange={(choice: BrowserPermissionChoice) => {
            answer(resolveBrowserPermissionAnswer(choice, p, row));
          }}
          onCancel={() => {
            answer({ behavior: 'cancelled' });
          }}
        />
      </Box>
    </PermissionDialog>
  );
}
