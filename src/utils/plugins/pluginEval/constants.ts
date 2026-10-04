/**
 * densable 2.1.283 plugin-eval constants (chunk-5b5dkraf).
 */

export const DEFAULT_EVAL_DIR = 'evals'
export const MAX_CONCURRENCY = 8
export const SCHEMA_MAJOR = 1
export const SCHEMA_VERSION_DEFAULT = '1.1'
export const BLANK_PROMPT_TODO = 'TODO: describe what the agent should do'
export const BLANK_CRITERIA_TODO =
  'TODO: describe what a successful response looks like'
export const BARE_PROMPT = `---
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill]
---

${BLANK_PROMPT_TODO}
`
export const BARE_CRITERIA = `---
type: llm
weight: 1
---

${BLANK_CRITERIA_TODO}
`
export const CASE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const CASE_FILE_NAMES = ['case.yaml', 'prompt.md'] as const
export const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.claude',
  'results',
  'mocks',
])
export const COMPONENT_DIR_NAMES = new Set([
  'commands',
  'agents',
  'skills',
  'hooks',
  '.claude-plugin',
  'bin',
])
export const EVAL_ARTIFACTS_DIR = '.eval-artifacts'
export const TRUST_FLAG = '--trust-plugin'
export const DEFAULT_RUNS = 3
export const DEFAULT_THRESHOLD = 1
export const DEFAULT_MOCKS = 'record' as const
export const GIT_CONFIG_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['core.pager', 'cat'],
  ['core.editor', 'true'],
  ['credential.helper', ''],
]
export const OWNERSHIP_REFUSE =
  'is not owned by you, is writable by other users, is a symlink, or could not be fully examined (see --debug)'
export const SHELL_UNCONFINED =
  'A shell tool (Bash or PowerShell) was granted but this machine cannot confine it (no sandbox backend on this platform, or it is not installed), so the run was refused rather than run unconfined — drop the shell grant, or on Linux/macOS install the backend.'
export const EVAL_ENV_KEY = /^EVAL_[A-Za-z0-9_]+$/
/** densable `fbt` @193066570 — abort prefix written by the stand-in. */
export const EVAL_ABORTED_BY_MOCK = 'eval aborted by mock'
/** densable `Hi` @212302665 — agent mock call budget = 4 × max_turns. */
export const EVAL_AGENT_MOCK_BUDGET_PER_TURN = 4
export const NEVER_IN_EVAL = new Set([
  'Monitor',
  'EnterWorktree',
  'ExitWorktree',
])
/** densable `aa`. */
export const EVAL_WALK_MAX_DEPTH = 16
/** densable `pa`. */
export const EVAL_WALK_BUDGET = 100_000
export const GIT_SANDBOX_CONFIG = `[core]
	repositoryformatversion = 0
	bare = false
`
