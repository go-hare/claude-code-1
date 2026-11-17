import * as React from 'react';
import { DIAMOND_FILLED, DIAMOND_OPEN } from '../../constants/figures.js';
import { NO_CONTENT_MESSAGE } from '../../constants/messages.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Ansi, Box, Text, type DOMElement } from '@anthropic/ink';
import { extractTag } from '../../utils/messages.js';
import { getPanesTerminalSize, subscribePanes } from '../../utils/plugins/functionHooksModules.js';
import { unescapeXmlEntities } from '../../utils/xml.js';
import { useUiRenderHost } from '../hooks/useUiRenderHost.js';
import { Markdown } from '../Markdown.js';
import { PluginRenderedTree } from '../PluginRasterPanes.js';
import { TranscriptV2Row } from './TranscriptV2Row.js';

type Props = {
  content: string;
  addMargin?: boolean;
  capProseWidth?: boolean;
  systemLine?: boolean;
  messageId?: string;
  commandRun?: { command?: string; args?: string };
};

/** densable `yR` / `printedTextOf` — XOR stdout/stderr, else no Gp. */
function commandOutputPrinted(content: string): { text: string; isErrored: boolean } | undefined {
  const stdoutRaw = extractTag(content, 'local-command-stdout');
  const stderrRaw = extractTag(content, 'local-command-stderr');
  const stdout = stdoutRaw === null ? '' : unescapeXmlEntities(stdoutRaw);
  const stderr = stderrRaw === null ? '' : unescapeXmlEntities(stderrRaw);
  const hasOut = stdout.trim() !== '' && stdout.trim() !== NO_CONTENT_MESSAGE;
  const hasErr = stderr.trim() !== '';
  if (hasOut === hasErr) return undefined;
  return hasOut ? { text: stdout, isErrored: false } : { text: stderr, isErrored: true };
}

export function UserLocalCommandOutputMessage({
  content,
  addMargin,
  capProseWidth,
  systemLine,
  messageId,
  commandRun,
}: Props): React.ReactNode {
  // densable oC: no commandRun, or yR both/neither, → Fn. Else Gp.
  if (commandRun === undefined || commandOutputPrinted(content) === undefined) {
    return (
      <CommandOutputEngine
        content={content}
        addMargin={addMargin}
        capProseWidth={capProseWidth}
        systemLine={systemLine}
      />
    );
  }
  return (
    <CommandOutputSite
      content={content}
      addMargin={addMargin}
      capProseWidth={capProseWidth}
      systemLine={systemLine}
      messageId={messageId}
      commandRun={commandRun}
    />
  );
}

function renderSystemLineRow(text: string, isErrored: boolean, addMargin: boolean): React.ReactNode {
  const lines = text.split('\n');
  const [first = '', ...rest] = lines;
  return (
    <TranscriptV2Row
      addMargin={addMargin}
      row={{
        tone: isErrored ? 'red' : 'dim',
        text: first,
        ...(rest.length > 0 ? { subLines: rest } : {}),
      }}
    />
  );
}

function CommandOutputEngine({
  content,
  addMargin = false,
  capProseWidth,
  systemLine = false,
  rewrittenText,
  isErrored: isErroredOverride,
}: {
  content: string;
  addMargin?: boolean;
  capProseWidth?: boolean;
  systemLine?: boolean;
  rewrittenText?: string;
  isErrored?: boolean;
}): React.ReactNode {
  const stdoutRaw = extractTag(content, 'local-command-stdout');
  const stderrRaw = extractTag(content, 'local-command-stderr');
  const stdout = stdoutRaw === null ? null : unescapeXmlEntities(stdoutRaw);
  const stderr = stderrRaw === null ? null : unescapeXmlEntities(stderrRaw);
  const stdoutText = stdout?.trim() && stdout.trim() !== NO_CONTENT_MESSAGE ? stdout.trim() : '';
  const stderrText = stderr?.trim() ? stderr.trim() : '';
  const isErrored = isErroredOverride ?? (stderrText !== '' && stdoutText === '');
  const rawText = isErrored ? stderrText : stdoutText;
  const shownText = rewrittenText ?? rawText;
  const resolvedCapProseWidth = capProseWidth;
  if (rewrittenText !== undefined) {
    const trimmedRewritten = shownText.trim();
    if (trimmedRewritten === '' || trimmedRewritten === NO_CONTENT_MESSAGE) {
      return null;
    }
    if (systemLine) {
      return renderSystemLineRow(trimmedRewritten, isErrored, addMargin);
    }
    return (
      <IndentedContent capProseWidth={resolvedCapProseWidth} isError={isErrored}>
        {trimmedRewritten}
      </IndentedContent>
    );
  }
  if (systemLine) {
    const combined = [stdoutText, stderrText].filter(Boolean).join('\n');
    if (!combined) return null;
    return renderSystemLineRow(combined, stderrText !== '', addMargin);
  }
  const lines: React.ReactNode[] = [];
  if (stdoutText) {
    lines.push(
      <IndentedContent key="stdout" capProseWidth={resolvedCapProseWidth}>
        {stdoutText}
      </IndentedContent>,
    );
  }
  if (stderrText) {
    lines.push(
      <IndentedContent key="stderr" isError>
        {stderrText}
      </IndentedContent>,
    );
  }
  if (lines.length === 0) {
    return null;
  }
  return <>{lines}</>;
}

function CommandOutputSite({
  content,
  addMargin = false,
  capProseWidth,
  systemLine = false,
  messageId,
  commandRun,
}: {
  content: string;
  addMargin?: boolean;
  capProseWidth?: boolean;
  systemLine?: boolean;
  messageId?: string;
  commandRun: { command?: string; args?: string };
}): React.ReactNode {
  const printed = commandOutputPrinted(content);
  const { columns, rows } = useTerminalSize();
  const panesViewport = React.useSyncExternalStore(subscribePanes, getPanesTerminalSize, getPanesTerminalSize);
  const viewportColumns = panesViewport?.conversationColumns ?? columns;
  const stdoutRaw = extractTag(content, 'local-command-stdout');
  const stderrRaw = extractTag(content, 'local-command-stderr');
  const stdout = stdoutRaw === null ? null : unescapeXmlEntities(stdoutRaw);
  const stderr = stderrRaw === null ? null : unescapeXmlEntities(stderrRaw);
  const stdoutText = stdout?.trim() && stdout.trim() !== NO_CONTENT_MESSAGE ? stdout.trim() : '';
  const stderrText = stderr?.trim() ? stderr.trim() : '';
  const isErrored = printed?.isErrored ?? (stderrText !== '' && stdoutText === '');
  const untrimmedText = printed?.text ?? (isErrored ? (stderr ?? '') : (stdout ?? ''));
  // densable Gp (@207639514): requestId is messageId; props {command, args, text, isErrored}
  // preserving `args: undefined` when unset.
  const requestId = messageId ?? commandRun.command ?? 'command-output';
  const rendered = useUiRenderHost({
    component: 'CommandOutput',
    requestId,
    props: {
      command: commandRun.command,
      args: commandRun.args,
      text: untrimmedText,
      isErrored,
    },
    viewport: { columns: viewportColumns, rows },
  });
  if (rendered.drawPending) {
    return (
      <Box
        ref={rendered.hostRef as React.Ref<DOMElement>}
        flexDirection="column"
        drawPending
        {...(rendered.minHeight !== undefined && { minHeight: rendered.minHeight })}
      />
    );
  }
  const shownText = typeof rendered.props.text === 'string' ? rendered.props.text : untrimmedText;
  const wrap = (engine: React.ReactNode): React.ReactNode => {
    const inner =
      rendered.pluginTree === undefined ? (
        engine
      ) : (
        <PluginRenderedTree
          node={rendered.pluginTree}
          plugin={rendered.pluginName}
          requestId={requestId}
          component="CommandOutput"
          engine={engine}
        />
      );
    if (inner === null && rendered.minHeight === undefined) {
      return null;
    }
    return (
      <Box
        ref={rendered.hostRef as React.Ref<DOMElement>}
        flexDirection="column"
        {...(rendered.minHeight !== undefined && { minHeight: rendered.minHeight })}
      >
        {inner}
      </Box>
    );
  };
  const resolvedCapProseWidth =
    capProseWidth ?? (commandRun !== undefined ? commandRun.command === 'recap' : undefined);

  if (shownText !== untrimmedText) {
    const trimmedShown = shownText.trim();
    if (trimmedShown === '' || trimmedShown === NO_CONTENT_MESSAGE) {
      return wrap(null);
    }
    if (systemLine) {
      return wrap(renderSystemLineRow(trimmedShown, isErrored, addMargin));
    }
    return wrap(
      <IndentedContent capProseWidth={resolvedCapProseWidth} isError={isErrored}>
        {trimmedShown}
      </IndentedContent>,
    );
  }
  if (systemLine) {
    const combined = [stdoutText, stderrText].filter(Boolean).join('\n');
    return wrap(combined ? renderSystemLineRow(combined, stderrText !== '', addMargin) : null);
  }
  const lines: React.ReactNode[] = [];
  if (stdoutText) {
    lines.push(
      <IndentedContent key="stdout" capProseWidth={resolvedCapProseWidth}>
        {stdoutText}
      </IndentedContent>,
    );
  }
  if (stderrText) {
    // densable $pn(isError:!0) — failed /compact (and other local cmds) render as error
    lines.push(
      <IndentedContent key="stderr" isError>
        {stderrText}
      </IndentedContent>,
    );
  }
  if (lines.length === 0) {
    return wrap(null);
  }
  return wrap(lines);
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
