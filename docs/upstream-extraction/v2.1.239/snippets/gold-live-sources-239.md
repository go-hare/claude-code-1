# Live Documentation Sources\r
\r
This file contains WebFetch URLs for fetching current information from platform.claude.com and Agent SDK repositories. Use these when users need the latest data that may have changed since the cached content was last updated.\r
\r
## When to Use WebFetch\r
\r
- User explicitly asks for "latest" or "current" information\r
- Cached data seems incorrect\r
- User asks about features not covered in cached content\r
- User needs specific API details or examples\r
\r
## Claude API Documentation URLs\r
\r
### Models & Pricing\r
\r
| Topic           | URL                                                                          | Extraction Prompt                                                               |\r
| --------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |\r
| Models Overview | \`https://platform.claude.com/docs/en/about-claude/models/overview.md\`        | "Extract current model IDs, context windows, and pricing for all Claude models" |\r
| Migration Guide | \`https://platform.claude.com/docs/en/about-claude/models/migration-guide.md\` | "Extract breaking changes, deprecated parameters, and per-model migration steps when moving to a newer Claude model" |\r
| Introducing Claude Fable 5 | \`https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5.md\` | "Extract capabilities, API changes, and availability stages for Claude Fable 5 and Claude Mythos 5" |\r
| Pricing         | \`https://platform.claude.com/docs/en/pricing.md\`                             | "Extract current pricing per million tokens for input and output"               |\r
\r
### Core Features\r
\r
| Topic             | URL                                                                          | Extraction Prompt                                                                      |\r
| ----------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |\r
| Extended Thinking | \`https://platform.claude.com/docs/en/build-with-claude/extended-thinking.md\` | "Extract extended thinking parameters, budget_tokens requirements, and usage examples" |\r
| Adaptive Thinking | \`https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking.md\` | "Extract adaptive thinking setup, effort levels, and {{OPUS_NAME}} usage examples"         |\r
| Effort Parameter  | \`https://platform.claude.com/docs/en/build-with-claude/effort.md\`            | "Extract effort levels, cost-quality tradeoffs, and interaction with thinking"        |\r
| Tool Use          | \`https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview.md\`  | "Extract tool definition schema, tool_choice options, and handling tool results"       |\r
| Streaming         | \`https://platform.claude.com/docs/en/build-with-claude/streaming.md\`         | "Extract streaming event types, SDK examples, and best practices"                      |\r
| Prompt Caching    | \`https://platform.claude.com/docs/en/build-with-claude/prompt-caching.md\`    | "Extract cache_control usage, pricing benefits, and implementation examples"           |\r
\r
### Media & Files\r
\r
| Topic       | URL                                                                    | Extraction Prompt                                                 |\r
| ----------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |\r
| Vision      | \`https://platform.claude.com/docs/en/build-with-claude/vision.md\`      | "Extract supported image formats, size limits, and code examples" |\r
| PDF Support | \`https://platform.claude.com/docs/en/build-with-claude/pdf-support.md\` | "Extract PDF handling capabilities, limits, and examples"         |\r
\r
### API Operations\r
\r
| Topic            | URL                                                                         | Extraction Prompt                                                                                       |\r
| ---------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |\r
| Batch Processing | \`https://platform.claude.com/docs/en/build-with-claude/batch-processing.md\` | "Extract batch API endpoints, request format, and polling for results"                                  |\r
| Files API        | \`https://platform.claude.com/docs/en/build-with-claude/files.md\`            | "Extract file upload, download, and referencing in messages, including supported types and beta header" |\r
| Token Counting   | \`https://platform.claude.com/docs/en/build-with-claude/token-counting.md\`   | "Extract token counting API usage and examples"                                                         |\r
| Rate Limits      | \`https://platform.claude.com/docs/en/api/rate-limits.md\`                    | "Extract current rate limits by tier and model"                                                         |\r
| Errors           | \`https://platform.claude.com/docs/en/api/errors.md\`                         | "Extract HTTP error codes, meanings, and retry guidance"                                                |\r
| Amazon Bedrock   | \`https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock.md\` | "Extract the AnthropicBedrockMantle client per language, \`anthropic.\`-prefixed model IDs, auth paths, feature availability, and regions" |\r
| Claude Platform on AWS | \`https://platform.claude.com/docs/en/build-with-claude/claude-platform-on-aws.md\` | "Extract the AnthropicAWS client per language, SigV4 auth, credential precedence, short-term API keys, workspace_id, and region requirements" |\r
| Claude Platform on AWS \u2014 IAM actions | \`https://platform.claude.com/docs/en/api/claude-platform-on-aws-iam-actions.md\` | "Extract the IAM action names, resource ARNs, and policy examples required for each API capability" |\r
\r
### Tools\r
\r
| Topic          | URL                                                                                    | Extraction Prompt                                                                        |\r
| -------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |\r
| Code Execution | \`https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool.md\` | "Extract code execution tool setup, file upload, container reuse, and response handling" |\r
| Computer Use   | \`https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use.md\`        | "Extract computer use tool setup, capabilities, and implementation examples"             |\r
| Bash Tool      | \`https://platform.claude.com/docs/en/agents-and-tools/tool-use/bash-tool.md\`           | "Extract bash tool schema, reference implementation, and security considerations"        |\r
| Text Editor    | \`https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool.md\`    | "Extract text editor tool commands, schema, and reference implementation"                |\r
| Memory Tool    | \`https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool.md\`         | "Extract memory tool commands, directory structure, and implementation patterns"         |\r
| Tool Search    | \`https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool.md\`    | "Extract tool search setup, when to use, and cache interaction"                          |\r
| Programmatic Tool Calling | \`https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling.md\` | "Extract PTC setup, script execution model, and tool invocation from code"    |\r
| Skills         | \`https://platform.claude.com/docs/en/agents-and-tools/skills.md\`                       | "Extract skill folder structure, SKILL.md format, and loading behavior"                  |\r
\r
### Advanced Features\r
\r
| Topic              | URL                                                                           | Extraction Prompt                                   |\r
| ------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------- |\r
| Structured Outputs | \`https://platform.claude.com/docs/en/build-with-claude/structured-outputs.md\` | "Extract output_config.format usage and schema enforcement"                           |\r
| Compaction         | \`https://platform.claude.com/docs/en/build-with-claude/compaction.md\`         | "Extract compaction setup, trigger config, and streaming with compaction"             |\r
| Context Editing    | \`https://platform.claude.com/docs/en/build-with-claude/context-editing.md\`    | "Extract context editing thresholds, what gets cleared, and configuration"            |\r
| Citations          | \`https://platform.claude.com/docs/en/build-with-claude/citations.md\`          | "Extract citation format and implementation"        |\r
| Context Windows    | \`https://platform.claude.com/docs/en/build-with-claude/context-windows.md\`    | "Extract context window sizes and token management" |\r
\r
### Managed Agents\r
\r
Use these when a managed-agents binding, behavior, or wire-level detail isn't covered in the cached \`shared/managed-agents-*.md\` concept files or in \`{lang}/managed-agents/README.md\`.\r
\r
| Topic                 | URL                                                                              | Extraction Prompt                                                                               |\r
| --------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |\r
| Overview              | \`https://platform.claude.com/docs/en/managed-agents/overview.md\`                 | "Extract the high-level architecture and how agents/sessions/environments/vaults fit together" |\r
| Quickstart            | \`https://platform.claude.com/docs/en/managed-agents/quickstart.md\`               | "Extract the minimal end-to-end agent \u2192 environment \u2192 session \u2192 stream code path"              |\r
| Agent Setup           | \`https://platform.claude.com/docs/en/managed-agents/agent-setup.md\`              | "Extract agent create/update/list-versions/archive lifecycle and parameters"                   |\r
| Define Outcomes       | \`https://platform.claude.com/docs/en/managed-agents/define-outcomes.md\`          | "Extract outcome definitions, evaluation hooks, and success criteria configuration"             |\r
| Sessions              | \`https://platform.claude.com/docs/en/managed-agents/sessions.md\`                 | "Extract session lifecycle, status transitions, idle/terminated semantics, and resume rules"    |\r
| Environments          | \`https://platform.claude.com/docs/en/managed-agents/environments.md\`             | "Extract environment config (cloud/networking), management endpoints, and reuse model"          |\r
| Self-Hosted Sandboxes | \`https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes.md\`    | "Extract config:{type:self_hosted}, ANTHROPIC_ENVIRONMENT_KEY, EnvironmentWorker.run/handle_item, environments.work.poller(drain), beta_agent_toolset, ant beta:worker poll/run, webhook-driven wake, memory stores (ANTHROPIC_WORK_SECRET, memory_sync_interval/memory_sync_deletes)" |\r
| Self-Hosted Sandboxes \u2014 Security | \`https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes-security.md\` | "Extract what the customer owns (hardening, egress, key custody, trust boundaries) vs what Anthropic cannot do" |\r
| Events and Streaming  | \`https://platform.claude.com/docs/en/managed-agents/events-and-streaming.md\`     | "Extract event stream types, stream-first ordering, reconnect/dedupe, and steering patterns"    |\r
| Tools                 | \`https://platform.claude.com/docs/en/managed-agents/tools.md\`                    | "Extract built-in toolset, custom tool definitions, and tool result wire format"                |\r
| Files                 | \`https://platform.claude.com/docs/en/managed-agents/files.md\`                    | "Extract file upload, mount paths, session resources, and listing/downloading session outputs"  |\r
| Permission Policies   | \`https://platform.claude.com/docs/en/managed-agents/permission-policies.md\`      | "Extract permission policy types (allow/deny/confirm) and per-tool config"                     |\r
| Multi-Agent           | \`https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration.md\` | "Extract multi-agent composition patterns, sub-agent invocation, and result handoff"            |\r
| Observability         | \`https://platform.claude.com/docs/en/managed-agents/observability.md\`            | "Extract logging, tracing, and usage telemetry exposed by managed agents"                       |\r
| Webhooks              | \`https://platform.claude.com/docs/en/managed-agents/webhooks.md\`                 | "Extract webhook endpoint registration, HMAC signature verification, supported event types, and delivery semantics" |\r
| GitHub                | \`https://platform.claude.com/docs/en/managed-agents/github.md\`                   | "Extract github_repository resource shape, multi-repo mounting, and token rotation"             |\r
| MCP Connector         | \`https://platform.claude.com/docs/en/managed-agents/mcp-connector.md\`            | "Extract MCP server declaration on agents and vault-based credential injection at session"     |\r
| Vaults                | \`https://platform.claude.com/docs/en/managed-agents/vaults.md\`                   | "Extract vault create, credential add/rotate, OAuth refresh shape, and archive"                 |\r
| Skills                | \`https://platform.claude.com/docs/en/managed-agents/skills.md\`                   | "Extract skill packaging and loading model for managed agents"                                  |\r
| Memory                | \`https://platform.claude.com/docs/en/managed-agents/memory.md\`                   | "Extract memory resource shape, scoping, and lifecycle"                                         |\r
| Onboarding            | \`https://platform.claude.com/docs/en/managed-agents/onboarding.md\`               | "Extract first-run setup, prerequisites, and account/region requirements"                      |\r
| Cloud Containers      | \`https://platform.claude.com/docs/en/managed-agents/cloud-containers.md\`         | "Extract cloud container runtime, image config, and network/storage knobs"                     |\r
| Migration             | \`https://platform.claude.com/docs/en/managed-agents/migration.md\`                | "Extract migration paths from earlier APIs/preview shapes to GA managed agents"                 |\r
\r
### Anthropic CLI\r
\r
The \`ant\` CLI provides terminal access to the Claude API. Every API resource is exposed as a subcommand. It is the recommended way to create agents and environments from version-controlled YAML (\`ant beta:agents create < agent.yaml\` \u2014 see \`shared/anthropic-cli.md\`), and also exposes sessions and every other API resource for scripting and interactive inspection.\r
\r
| Topic         | URL                                                     | Extraction Prompt                                                                                  |\r
| ------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |\r
| Anthropic CLI | \`https://platform.claude.com/docs/en/api/sdks/cli.md\`   | "Extract CLI install, authentication, command structure, and the beta:agents/environments/sessions commands" |\r
| Authentication overview | \`https://platform.claude.com/docs/en/manage-claude/authentication.md\` | "Extract the credential options (API keys, interactive OAuth login, Workload Identity Federation) and when to use each" |\r
| WIF reference | \`https://platform.claude.com/docs/en/manage-claude/wif-reference.md\`  | "Extract credential precedence order, the profile configuration file schema, and the configuration directory layout" |\r
\r
---\r
\r
## Claude API SDK Repositories\r
\r
WebFetch these when a binding (class, method, namespace, field) isn't covered in the cached \`{lang}/\` skill files or in the managed-agents docs above. The SDKs include beta managed-agents support for \`/v1/agents\`, \`/v1/sessions\`, \`/v1/environments\`, and related resources \u2014 search the repo for \`BetaManagedAgents\`, \`beta.agents\`, \`beta.sessions\`, or the equivalent namespace for that language.\r
\r
| SDK        | URL                                                      | Extraction Prompt                                                                                                       |\r
| ---------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |\r
| Python     | \`https://github.com/anthropics/anthropic-sdk-python\`     | "Extract beta managed-agents namespaces, classes, and method signatures (\`client.beta.agents\`, \`client.beta.sessions\`)" |\r
| TypeScript | \`https://github.com/anthropics/anthropic-sdk-typescript\` | "Extract beta managed-agents namespaces, classes, and method signatures (\`client.beta.agents\`, \`client.beta.sessions\`)" |\r
| Java       | \`https://github.com/anthropics/anthropic-sdk-java\`  