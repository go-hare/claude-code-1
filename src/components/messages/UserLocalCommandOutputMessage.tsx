import * as React from 'react';
import { DIAMOND_FILLED, DIAMOND_OPEN } from '../../constants/figures.js';
import { NO_CONTENT_MESSAGE } from '../../constants/messages.js';
import { Ansi, Box, Text } from '@anthropic/ink';
import { extractTag } from '../../utils/messages.js';
import { unescapeXmlEntities } from '../../utils/xml.js';
import { Markdown } from '../Markdown.js';

type Props = {
  content: string;
  capProseWidth?: boolean;
  commandRun?: { command?: string };
};

export function UserLocalCommandOutputMessage({ content, capProseWidth, commandRun }: Props): React.ReactNode {
  // densable oX — unescape &amp;|&lt;|&gt; before UI (write path may escapeXml/EHe)
  const stdoutRaw = extractTag(content, 'local-command-stdout');
  const stderrRaw = extractTag(content, 'local-command-stderr');
  const stdout = stdoutRaw === null ? null : unescapeXmlEntities(stdoutRaw);
  const stderr = stderrRaw === null ? null : unescapeXmlEntities(stderrRaw);
  const resolvedCapProseWidth =
    capProseWidth ?? (commandRun !== undefined ? commandRun.command === 'recap' : undefined);

  const lines: React.ReactNode[] = [];
  if (stdout?.trim() && stdout.trim() !== NO_CONTENT_MESSAGE) {
    lines.push(
      <IndentedContent key="stdout" capProseWidth={resolvedCapProseWidth}>
        {stdout.trim()}
      </IndentedContent>,
    );
  }
  if (stderr?.trim()) {
    // densable $pn(isError:!0) — failed /compact (and other local cmds) render as error
    lines.push(
      <IndentedContent key="stderr" isError>
        {stderr.trim()}
      </IndentedContent>,
    );
  }
  if (lines.length === 0) {
    return null;
  }
  return lines;
}

function hasAnsiEscapes(text: string): boolean {
  return text.includes('\x1b[');
}

function IndentedContent({
  children,
  isError = false,
  capProseWidth,
}: {
  children: string;
  isError?: boolean;
  capProseWidth?: boolean;
}): React.ReactNode {
  if (children.startsWith(`${DIAMOND_OPEN} `) || children.startsWith(`${DIAMOND_FILLED} `)) {
    return <CloudLaunchContent>{children}</CloudLaunchContent>;
  }
  // densable oa always stripPromptTags:!1 (<Markdown>{children}</Markdown>).
  // Pre-rendered /context grids are ANSI (renderToAnsiString) — marked.lexer
  // would eat CSI and the replay would collapse to the command breadcrumb.
  // Paint via <Ansi> when CSI is present.
  const body = isError ? (
    <Text color="error" wrap="wrap">
      {children}
    </Text>
  ) : hasAnsiEscapes(children) ? (
    <Ansi wrap="wrap">{children}</Ansi>
  ) : (
    <Markdown stripPromptTags={false} capProseWidth={capProseWidth}>
      {children}
    </Markdown>
  );
  return (
    <Box flexDirection="row">
      <Text aria-hidden dimColor>
        {'  ⎿  '}
      </Text>
      <Box flexDirection="column" flexGrow={1}>
        {body}
      </Box>
    </Box>
  );
}

function CloudLaunchContent({ children }: { children: string }): React.ReactNode {
  const diamond = children[0]!;
  const nl = children.indexOf('\n');
  const header = nl === -1 ? children.slice(2) : children.slice(2, nl);
  const rest = nl === -1 ? '' : children.slice(nl + 1).trim();
  const sep = header.indexOf(' · ');
  const label = sep === -1 ? header : header.slice(0, sep);
  const suffix = sep === -1 ? '' : header.slice(sep);
  return (
    <Box flexDirection="column">
      <Text>
        <Text aria-hidden color="background">
          {diamond}{' '}
        </Text>
        <Text bold>{label}</Text>
        {suffix && <Text dimColor>{suffix}</Text>}
      </Text>
      {rest && (
        <Box flexDirection="row">
          <Text aria-hidden dimColor>
            {'  ⎿  '}
          </Text>
          <Text dimColor>{rest}</Text>
        </Box>
      )}
    </Box>
  );
}
