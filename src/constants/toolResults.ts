/**
 * Tool-result path constants.
 *
 * This module is deliberately dependency-free and holds a single constant.
 * `TOOL_RESULTS_SUBDIR` used to live in `src/utils/toolResultStorage.ts`,
 * which sits inside a 12-hop import cycle:
 *
 *   toolResultStorage → analytics/metadata → model/model → modelCost →
 *   fastMode → extraUsage → model/fableCreditsLabel → fableConsent →
 *   messageQueueManager → messages → AgentTool/builtInAgents →
 *   AgentTool/built-in/webFetchAgent → back to toolResultStorage
 *
 * `webFetchAgent.ts` reads the constant in a module-level template literal,
 * so whenever `toolResultStorage.ts` was the entry point the cycle ran
 * `webFetchAgent`'s body first and threw
 * `ReferenceError: Cannot access 'TOOL_RESULTS_SUBDIR' before initialization`.
 *
 * Keeping the value in a leaf fixes that for good: a module with no imports
 * is fully initialized before any cycle participant starts executing, so the
 * binding is never in its temporal dead zone. **Do not add imports here.**
 */

/** Subdirectory name for tool results within a session. */
export const TOOL_RESULTS_SUBDIR = 'tool-results'
