import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canOpenBackgroundTaskDetail, getActionsForItem } from '../BackgroundTasksDialog.js';

const dialogSrc = readFileSync(join(import.meta.dir, '../BackgroundTasksDialog.tsx'), 'utf8');
const mcpDetailSrc = readFileSync(join(import.meta.dir, '../McpTaskDetailDialog.tsx'), 'utf8');

describe('BackgroundTasksDialog 2.1.289 mcp_task & S4-11 alignment', () => {
  test('mcp_task opens detail and supports view + stop actions when running', () => {
    expect(canOpenBackgroundTaskDetail('mcp_task')).toBe(true);
    expect(
      getActionsForItem({
        id: 'mcp-1',
        type: 'mcp_task',
        label: 'srv/tool',
        status: 'running',
        task: {
          id: 'mcp-1',
          type: 'mcp_task',
          status: 'running',
          description: 'srv/tool',
          serverName: 'srv',
          toolName: 'tool',
          mcpTaskId: 'remote-id-123456789',
          mcpStatus: 'working',
          startTime: 1000,
        } as never,
      }),
    ).toEqual(['view', 'stop']);
  });

  test('wires MCP tasks section, McpTaskDetailDialog, sanitized description, and stopTask shell kill', () => {
    expect(dialogSrc).toContain("key: 'mcp-tasks'");
    expect(dialogSrc).toContain("{'  '}MCP tasks");
    expect(dialogSrc).toContain("case 'mcp_task':");
    expect(dialogSrc).toContain('<McpTaskDetailDialog');
    expect(dialogSrc).toContain("currentSelection?.type === 'mcp_task'");
    expect(dialogSrc).toMatch(/case 'mcp_task':[\s\S]*?label: task\.description/);
    expect(dialogSrc).toContain('isBashTaskGetDeliveryEnabled()');
    expect(dialogSrc).toContain("source: 'user'");

    expect(mcpDetailSrc).toContain('title="MCP task"');
    expect(mcpDetailSrc).toContain('waiting for your answer in the elicitation dialog');
    expect(mcpDetailSrc).toContain('runs on the server; survives exiting this session');
    expect(mcpDetailSrc).toContain('sanitizeMcpTaskText');
    expect(mcpDetailSrc).toContain('sanitizeMcpTaskId');
  });
});
