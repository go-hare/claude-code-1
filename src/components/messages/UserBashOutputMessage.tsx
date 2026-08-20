import * as React from 'react';
import BashToolResultMessage from '@claude-code/builtin-tools/tools/BashTool/BashToolResultMessage.js';
import { extractTag } from '../../utils/messages.js';
import { unescapeXmlEntities } from '../../utils/xml.js';

export function UserBashOutputMessage({ content, verbose }: { content: string; verbose?: boolean }): React.ReactNode {
  const rawStdout = extractTag(content, 'bash-stdout') ?? '';
  // Unwrap <persisted-output> if present — keep the inner content (file path +
  // preview) for the user; the wrapper tag itself is model-facing signaling.
  const stdoutInner = extractTag(rawStdout, 'persisted-output') ?? rawStdout;
  // densable oX — display unescape &amp;|&lt;|&gt; (Ua/escapeXml write path)
  const stdout = unescapeXmlEntities(stdoutInner);
  const stderr = unescapeXmlEntities(extractTag(content, 'bash-stderr') ?? '');
  return <BashToolResultMessage content={{ stdout, stderr }} verbose={!!verbose} />;
}
