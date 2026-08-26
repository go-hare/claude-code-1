// Content for the claude-api bundled skill.
// Each .md file is inlined as a string at build time via Bun's text loader.
// densable 2.1.221 layout: language dirs use `{lang}/claude-api/*` + shared/*.

import csharpClaudeApi from './claude-api/csharp/claude-api/README.md' with {
  type: 'text',
}
import curlExamples from './claude-api/curl/examples.md' with { type: 'text' }
import goClaudeApi from './claude-api/go/claude-api/README.md' with {
  type: 'text',
}
import javaClaudeApi from './claude-api/java/claude-api/README.md' with {
  type: 'text',
}
import phpClaudeApi from './claude-api/php/claude-api/README.md' with {
  type: 'text',
}
import pythonClaudeApiBatches from './claude-api/python/claude-api/batches.md' with {
  type: 'text',
}
import pythonClaudeApiFilesApi from './claude-api/python/claude-api/files-api.md' with {
  type: 'text',
}
import pythonClaudeApiReadme from './claude-api/python/claude-api/README.md' with {
  type: 'text',
}
import pythonClaudeApiSdkUpgrade from './claude-api/python/claude-api/sdk-upgrade.md' with {
  type: 'text',
}
import pythonClaudeApiStreaming from './claude-api/python/claude-api/streaming.md' with {
  type: 'text',
}
import pythonClaudeApiToolUse from './claude-api/python/claude-api/tool-use.md' with {
  type: 'text',
}
import rubyClaudeApi from './claude-api/ruby/claude-api/README.md' with {
  type: 'text',
}
import skillPrompt from './claude-api/SKILL.md' with { type: 'text' }
import sharedAgentDesign from './claude-api/shared/agent-design.md' with {
  type: 'text',
}
import sharedErrorCodes from './claude-api/shared/error-codes.md' with {
  type: 'text',
}
import sharedLiveSources from './claude-api/shared/live-sources.md' with {
  type: 'text',
}
import sharedManagedAgentsSelfHosted from './claude-api/shared/managed-agents-self-hosted-sandboxes.md' with {
  type: 'text',
}
import sharedManagedAgentsTools from './claude-api/shared/managed-agents-tools.md' with {
  type: 'text',
}
import sharedModelMigration from './claude-api/shared/model-migration.md' with {
  type: 'text',
}
import sharedModels from './claude-api/shared/models.md' with { type: 'text' }
import sharedPromptAudit from './claude-api/shared/prompt-audit.md' with {
  type: 'text',
}
import sharedPromptCaching from './claude-api/shared/prompt-caching.md' with {
  type: 'text',
}
import sharedTokenCounting from './claude-api/shared/token-counting.md' with {
  type: 'text',
}
import sharedToolUseConcepts from './claude-api/shared/tool-use-concepts.md' with {
  type: 'text',
}
import typescriptClaudeApiBatches from './claude-api/typescript/claude-api/batches.md' with {
  type: 'text',
}
import typescriptClaudeApiFilesApi from './claude-api/typescript/claude-api/files-api.md' with {
  type: 'text',
}
import typescriptClaudeApiReadme from './claude-api/typescript/claude-api/README.md' with {
  type: 'text',
}
import typescriptClaudeApiStreaming from './claude-api/typescript/claude-api/streaming.md' with {
  type: 'text',
}
import typescriptClaudeApiToolUse from './claude-api/typescript/claude-api/tool-use.md' with {
  type: 'text',
}

// @[MODEL LAUNCH]: Update the model IDs/names below. These are substituted into {{VAR}}
// placeholders in the .md files at runtime before the skill prompt is sent.
// After updating these constants, manually update the two files that still hardcode models:
//   - claude-api/SKILL.md (Current Models pricing table)
//   - claude-api/shared/models.md (full model catalog with legacy versions and alias mappings)
// densable 2.1.219 #23 — default Opus 5 + migration path from Opus 4.8; Sonnet 5 current.
export const SKILL_MODEL_VARS = {
  OPUS_ID: 'claude-opus-5',
  OPUS_NAME: 'Claude Opus 5',
  PREV_OPUS_ID: 'claude-opus-4-8',
  PREV_OPUS_NAME: 'Claude Opus 4.8',
  SONNET_ID: 'claude-sonnet-5',
  SONNET_NAME: 'Claude Sonnet 5',
  // densable also aliases SONNET_NEXT_* to the current Sonnet 5 id/name.
  SONNET_NEXT_ID: 'claude-sonnet-5',
  SONNET_NEXT_NAME: 'Claude Sonnet 5',
  HAIKU_ID: 'claude-haiku-4-5',
  HAIKU_NAME: 'Claude Haiku 4.5',
  // Previous Sonnet ID — used in "do not append date suffixes" example in SKILL.md.
  PREV_SONNET_ID: 'claude-sonnet-4-6',
} satisfies Record<string, string>

export const SKILL_PROMPT: string = skillPrompt

/**
 * densable X5T — bare subcommands recognized by matchSubcommand.
 * `prompt-audit` is non-interactive (221 #4).
 */
export const CLAUDE_API_SUBCOMMANDS = [
  'migrate',
  'managed-agents-onboard',
  'prompt-audit',
  'upgrade',
] as const

export type ClaudeApiSubcommand =
  | (typeof CLAUDE_API_SUBCOMMANDS)[number]
  | 'none'

export const SKILL_FILES: Record<string, string> = {
  'csharp/claude-api/README.md': csharpClaudeApi,
  'curl/examples.md': curlExamples,
  'go/claude-api/README.md': goClaudeApi,
  'java/claude-api/README.md': javaClaudeApi,
  'php/claude-api/README.md': phpClaudeApi,
  'python/claude-api/README.md': pythonClaudeApiReadme,
  'python/claude-api/sdk-upgrade.md': pythonClaudeApiSdkUpgrade,
  'python/claude-api/batches.md': pythonClaudeApiBatches,
  'python/claude-api/files-api.md': pythonClaudeApiFilesApi,
  'python/claude-api/streaming.md': pythonClaudeApiStreaming,
  'python/claude-api/tool-use.md': pythonClaudeApiToolUse,
  'ruby/claude-api/README.md': rubyClaudeApi,
  'shared/agent-design.md': sharedAgentDesign,
  'shared/error-codes.md': sharedErrorCodes,
  'shared/live-sources.md': sharedLiveSources,
  'shared/managed-agents-self-hosted-sandboxes.md':
    sharedManagedAgentsSelfHosted,
  'shared/managed-agents-tools.md': sharedManagedAgentsTools,
  'shared/model-migration.md': sharedModelMigration,
  'shared/models.md': sharedModels,
  'shared/prompt-audit.md': sharedPromptAudit,
  'shared/prompt-caching.md': sharedPromptCaching,
  'shared/token-counting.md': sharedTokenCounting,
  'shared/tool-use-concepts.md': sharedToolUseConcepts,
  'typescript/claude-api/README.md': typescriptClaudeApiReadme,
  'typescript/claude-api/batches.md': typescriptClaudeApiBatches,
  'typescript/claude-api/files-api.md': typescriptClaudeApiFilesApi,
  'typescript/claude-api/streaming.md': typescriptClaudeApiStreaming,
  'typescript/claude-api/tool-use.md': typescriptClaudeApiToolUse,
}
