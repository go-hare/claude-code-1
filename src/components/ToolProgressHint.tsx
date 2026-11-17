import * as React from 'react';
import { Box, type DOMElement, Text } from '@anthropic/ink';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useUiRenderHost } from './hooks/useUiRenderHost.js';
import { PluginRenderedTree } from './PluginRasterPanes.js';

/** densable `b` / PILL_INDENT_COLUMNS. */
export const PILL_INDENT_COLUMNS = 5;

type Props = {
  toolUseId: string;
  hint: string;
};

/**
 * densable `S` / ToolProgressHint (@208315100) — ui.render ToolProgress host.
 * Engine: empty hint draws nothing; otherwise dim hint at pill indent.
 */
export function ToolProgressHint({ toolUseId, hint }: Props): React.ReactElement | null {
  const { columns, rows } = useTerminalSize();
  const rendered = useUiRenderHost({
    component: 'ToolProgress',
    requestId: toolUseId,
    props: {
      tool_use_id: toolUseId,
      kind: 'background_hint',
      hint,
    },
    viewport: { columns, rows },
  });
  const shownHint = typeof rendered.props.hint === 'string' ? rendered.props.hint : hint;
  const engine =
    shownHint === '' ? null : (
      <Box
        ref={rendered.pluginTree === undefined ? (rendered.hostRef as React.Ref<DOMElement>) : undefined}
        paddingLeft={PILL_INDENT_COLUMNS}
        minHeight={rendered.minHeight}
      >
        <Text dimColor>{shownHint}</Text>
      </Box>
    );
  if (rendered.pluginTree !== undefined) {
    return (
      <Box ref={rendered.hostRef as React.Ref<DOMElement>} flexDirection="column" minHeight={rendered.minHeight}>
        <PluginRenderedTree
          node={rendered.pluginTree}
          plugin={rendered.pluginName}
          requestId={toolUseId}
          component="ToolProgress"
          engine={engine}
        />
      </Box>
    );
  }
  if (rendered.drawPending) {
    return (
      <Box
        ref={rendered.hostRef as React.Ref<DOMElement>}
        flexDirection="column"
        drawPending
        minHeight={rendered.minHeight}
      />
    );
  }
  return engine;
}
