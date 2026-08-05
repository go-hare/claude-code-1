import React from 'react';
import { AgentTool } from '@claude-code/builtin-tools/tools/AgentTool/AgentTool.js';
import { isForkSubagentEnabled, isInForkChild } from '@claude-code/builtin-tools/tools/AgentTool/forkSubagent.js';
import { logForDebugging } from '../../utils/debug.js';
import type { LocalJSXCommandOnDone, LocalJSXCommandContext } from '../../types/command.js';

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  // Same gate as AgentTool (compile FEATURE_FORK_SUBAGENT OR portable
  // CLAUDE_CODE_FORK_SUBAGENT / GB tengu_fork_subagent; not coordinator /
  // non-interactive). Do not re-check env alone — dual-gate drift caused
  // /fork to fire while AgentTool stayed on general-purpose.
  if (!isForkSubagentEnabled()) {
    onDone(
      'Fork subagent is not available. Enable with FEATURE_FORK_SUBAGENT=1 or CLAUDE_CODE_FORK_SUBAGENT=1 (interactive session, not coordinator mode).',
      { display: 'system' },
    );
    return null;
  }

  // Recursive fork guard
  if (isInForkChild(context.messages)) {
    onDone('Fork is not available inside a forked worker. Complete your task directly using your tools.', {
      display: 'system',
    });
    return null;
  }

  const directive = args.trim();
  if (!directive) {
    onDone('Usage: /fork <directive>\nExample: /fork Fix the null check in validate.ts', { display: 'system' });
    return null;
  }

  // Find the last assistant message to fork from
  const lastAssistantMessage = [...context.messages].reverse().find(m => m.type === 'assistant') as any; // Type assertion to avoid complex type import

  if (!lastAssistantMessage) {
    onDone('Cannot fork: no assistant response in conversation history.', { display: 'system' });
    return null;
  }

  try {
    // Reuse AgentTool logic for fork path.
    // Omitting subagent_type triggers implicit fork.
    const input = {
      prompt: directive,
      fork: true, // 触发 AgentTool 的 fork 路径：继承父会话上下文 + system prompt + 模型
      run_in_background: true, // fork always runs async
      // description 只显示在底部 selector / BackgroundTasksDialog，保持简短标签
      // 即可；用户输入的 prompt 会作为第一条用户消息呈现在主视图里，这里不要
      // 重复显示。
      description: 'forked from main',
    };

    // Call AgentTool with proper parameters:
    // - input: the agent parameters (no subagent_type => fork path)
    // - toolUseContext: the current context (ToolUseContext)
    // - canUseTool: permission-check function from context
    // - assistantMessage: the last assistant message to fork from
    AgentTool.call(input, context, context.canUseTool!, lastAssistantMessage).catch(error => {
      logForDebugging(`Fork subagent async error: ${error}`, { level: 'error' });
    });

    // Notify user that fork has been started
    onDone(`Forked subagent started with directive: "${directive}"`, { display: 'system' });
    return null;
  } catch (error) {
    // Catches synchronous setup errors only
    logForDebugging(`Fork command setup error: ${error}`, { level: 'error' });
    onDone(`Fork failed: ${error instanceof Error ? error.message : String(error)}`, { display: 'system' });
    return null;
  }
}
