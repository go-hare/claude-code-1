import { logForDebugging } from './debug.js'
import { isTelemetryDisabledInEnv } from './privacyLevel.js'

/**
 * Environment variables that control inference routing: which provider to use,
 * which endpoint to hit, and which model IDs to send.
 *
 * When CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST is truthy in the spawn env, these
 * are stripped from settings-sourced env so the host's routing config isn't
 * overridden by a user's ~/.claude/settings.json — e.g. a Bedrock setup for
 * terminal CLI that would break a host that only supports first-party auth.
 *
 * @[MODEL LAUNCH]: New models usually don't need changes here —
 * VERTEX_REGION_CLAUDE_* is prefix-matched. New providers or new routing
 * config vars (endpoint, project, region, auth) do.
 *
 * Note: OpenAI provider uses OPENAI_* env vars (OPENAI_API_KEY, OPENAI_BASE_URL,
 * OPENAI_MODEL, OPENAI_AUTH_MODE, OPENAI_DEFAULT_*_MODEL, OPENAI_SMALL_FAST_MODEL) which are all
 * provider-managed to keep routing config isolated from Anthropic settings.
 */
const PROVIDER_MANAGED_ENV_VARS = new Set([
  // The flag itself — settings can't unset it once the host set it
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  // Provider selection
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_EFFORT_LEVEL',
  // Endpoint config (base URLs, project/resource identifiers)
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'GEMINI_BASE_URL',
  // Region routing (per-model VERTEX_REGION_CLAUDE_* handled by prefix below)
  'CLOUD_ML_REGION',
  // Auth
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
  'GEMINI_API_KEY',
  // Model defaults — often set to provider-specific ID formats
  'ANTHROPIC_MODEL',
  // densable 2.1.236 QEn / vv_ — session-start default (not a pin like ANTHROPIC_MODEL)
  'ANTHROPIC_DEFAULT_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  // OpenAI provider specific
  'OPENAI_AUTH_MODE',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_DEFAULT_HAIKU_MODEL',
  'OPENAI_DEFAULT_HAIKU_MODEL_DESCRIPTION',
  'OPENAI_DEFAULT_HAIKU_MODEL_NAME',
  'OPENAI_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'OPENAI_DEFAULT_OPUS_MODEL',
  'OPENAI_DEFAULT_OPUS_MODEL_DESCRIPTION',
  'OPENAI_DEFAULT_OPUS_MODEL_NAME',
  'OPENAI_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'OPENAI_DEFAULT_SONNET_MODEL',
  'OPENAI_DEFAULT_SONNET_MODEL_DESCRIPTION',
  'OPENAI_DEFAULT_SONNET_MODEL_NAME',
  'OPENAI_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'OPENAI_SMALL_FAST_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL_FORCE',
  'CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL',
  'CLAUDE_CODE_DISABLE_FEATURE_FLAGS',
  'DISABLE_GROWTHBOOK',
  'GEMINI_MODEL',
  'GEMINI_SMALL_FAST_MODEL',
  // Gemini provider specific - separate from Anthropic/OpenAI
  'GEMINI_DEFAULT_HAIKU_MODEL',
  'GEMINI_DEFAULT_HAIKU_MODEL_DESCRIPTION',
  'GEMINI_DEFAULT_HAIKU_MODEL_NAME',
  'GEMINI_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'GEMINI_DEFAULT_OPUS_MODEL',
  'GEMINI_DEFAULT_OPUS_MODEL_DESCRIPTION',
  'GEMINI_DEFAULT_OPUS_MODEL_NAME',
  'GEMINI_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'GEMINI_DEFAULT_SONNET_MODEL',
  'GEMINI_DEFAULT_SONNET_MODEL_DESCRIPTION',
  'GEMINI_DEFAULT_SONNET_MODEL_NAME',
  'GEMINI_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
])

const PROVIDER_MANAGED_ENV_PREFIXES = [
  // Per-model Vertex region overrides — scales with model releases, so
  // prefix-matched to avoid drift on each launch.
  'VERTEX_REGION_CLAUDE_',
]

export function isProviderManagedEnvVar(key: string): boolean {
  const upper = key.toUpperCase()
  return (
    PROVIDER_MANAGED_ENV_VARS.has(upper) ||
    PROVIDER_MANAGED_ENV_PREFIXES.some(p => upper.startsWith(p))
  )
}

/**
 * densable LGm / KVt — transport / TLS / OAuth-scope vars that host-managed
 * sessions must not take from settings.env (repo or user). Applying these from
 * project settings under CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST breaks Desktop /
 * host-injected TLS and credential flows (2.1.212 #19).
 */
export const HOST_TRANSPORT_SENSITIVE_ENV_VARS = new Set([
  'CLAUDE_CODE_CLIENT_CERT',
  'CLAUDE_CODE_CLIENT_KEY',
  'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
  'NODE_EXTRA_CA_CERTS',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'CLAUDE_CODE_OAUTH_SCOPES',
  // Official 2.1.300 (#809) L7r / H7r / H / HDe / git config:
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  'CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE',
  'HTTPLIB2_CA_CERTS',
  'AWS_CA_BUNDLE',
  'DENO_CERT',
  'CARGO_HTTP_CAINFO',
  'PIP_CERT',
  'GIT_SSL_CAINFO',
  'GRPC_DEFAULT_SSL_ROOTS_FILE_PATH',
  'NIX_SSL_CERT_FILE',
  'HEX_CACERTS_PATH',
  'UV_NATIVE_TLS',
  'DENO_TLS_CA_STORE',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG',
])

const GIT_SSL_OR_PROXY_RE = /^GIT_(?:SSL|PROXY)_/i
const GIT_CONFIG_KV_RE = /^GIT_CONFIG_(KEY|VALUE)_\d+$/i

/** densable KVt(key) + official lqo / V7e (#809) */
export function isHostTransportSensitiveEnvVar(key: string): boolean {
  return (
    HOST_TRANSPORT_SENSITIVE_ENV_VARS.has(key.toUpperCase()) ||
    GIT_SSL_OR_PROXY_RE.test(key) ||
    GIT_CONFIG_KV_RE.test(key)
  )
}

/**
 * densable PGm / LLn — proxy vars also stripped under managedByHostFlag (#809).
 */
export const HOST_PROXY_ENV_VARS = new Set([
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'CLAUDE_CODE_PROXY_RESOLVES_HOSTS',
  'CLAUDE_CODE_HTTP_PROXY',
  'CLAUDE_CODE_HTTPS_PROXY',
  'NPM_CONFIG_PROXY',
  'NPM_CONFIG_HTTP_PROXY',
  'NPM_CONFIG_HTTPS_PROXY',
])

/** densable LLn(key) */
export function isHostProxyEnvVar(key: string): boolean {
  return HOST_PROXY_ENV_VARS.has(key.toUpperCase())
}

/**
 * Official 2.1.319 `p` + `V7r` (#1808): transport env vars that settings files
 * cannot set where the host/policy manages the network (coworkCloud / policyTransportEnv).
 * Includes CLAUDE_CODE_PROXY_RESOLVES_HOSTS.
 */
export const POLICY_TRANSPORT_ENV_VARS = new Set([
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'ALL_PROXY',
  'NPM_CONFIG_HTTPS_PROXY',
  'NPM_CONFIG_HTTP_PROXY',
  'NPM_CONFIG_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'CLAUDE_CODE_CERT_STORE',
  'CLAUDE_CODE_DISABLE_LOOPED_CROSS_CERT_DROP',
  'CLAUDE_CODE_DISABLE_SELF_NAMED_CERT_DROP',
  'CLAUDE_CODE_CLIENT_CERT',
  'CLAUDE_CODE_CLIENT_KEY',
  'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'CLAUDE_CODE_PROXY_RESOLVES_HOSTS',
  'CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER',
  'CLAUDE_CODE_PROXY_AUTH_HELPER_TTL_MS',
  'API_FORCE_IDLE_TIMEOUT',
  'ANTHROPIC_UNIX_SOCKET',
  'CLAUDE_CODE_DISABLE_HTTPS_AGENT_KEEPING',
  'NODE_OPTIONS',
])

/** Official 2.1.319 `Udi(key)` (#1808): blocked under coworkCloud. */
export function isCoworkCloudBlockedEnvVar(key: string): boolean {
  return (
    isHostProxyEnvVar(key) ||
    isHostTransportSensitiveEnvVar(key) ||
    POLICY_TRANSPORT_ENV_VARS.has(key.toUpperCase())
  )
}

/** Official 2.1.319 `V7r` predicate (#1808): blocked under policyTransportEnv. */
export function isPolicyTransportEnvVar(key: string): boolean {
  return POLICY_TRANSPORT_ENV_VARS.has(key.toUpperCase())
}

/**
 * densable S3l — shell-helper settings that can execute arbitrary shell code.
 * Extracted by hFt / extractDangerousSettings for the managed-settings dialog.
 */
export const DANGEROUS_SHELL_SETTINGS = [
  'apiKeyHelper',
  'awsAuthRefresh',
  'awsCredentialExport',
  'fileSuggestion',
  'gcpAuthRefresh',
  'otelHeadersHelper',
  'processWrapper',
  'proxyAuthHelper',
  'statusLine',
  'subagentStatusLine',
] as const

/**
 * densable MEh — privacy env allowlist safe ONLY when value is truthy (Jt/isEnvTruthy).
 * Falsy values (e.g. DISABLE_TELEMETRY=0) remain dangerous surface.
 */
export const SAFE_WHEN_TRUTHY_ENV_VARS = new Set([
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'DISABLE_ERROR_REPORTING',
  'DISABLE_TELEMETRY',
  'DO_NOT_TRACK',
])

/**
 * densable LEh (+ fork provider extras) — unconditional SAFE env allowlist.
 * Benign feature/cost/model/UI/timeout toggles skip settings-approval (2.1.218 #32).
 *
 * IMPORTANT: Source of truth for always-safe env. Combined with
 * SAFE_WHEN_TRUTHY_ENV_VARS via isSafeManagedEnv (densable B7t).
 *
 * Dangerous env vars (NOT in this list / not truthy-MEh):
 *
 * === REDIRECT TO ATTACKER-CONTROLLED SERVER ===
 * - ANTHROPIC_BASE_URL, ANTHROPIC_BEDROCK_BASE_URL, ANTHROPIC_FOUNDRY_BASE_URL, ANTHROPIC_VERTEX_BASE_URL
 * - HTTP_PROXY, HTTPS_PROXY, NO_PROXY, http_proxy, https_proxy, no_proxy
 * - OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
 *
 * === TRUST ATTACKER-CONTROLLED SERVER ===
 * - NODE_TLS_REJECT_UNAUTHORIZED
 * - NODE_EXTRA_CA_CERTS
 *
 * === SWITCH TO ATTACKER-CONTROLLED PROJECT ===
 * - ANTHROPIC_FOUNDRY_RESOURCE
 * - ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN
 * - AWS_BEARER_TOKEN_BEDROCK
 */
export const SAFE_ENV_VARS = new Set([
  // --- densable LEh (180 keys) ---
  // densable 2.1.224 #4 — prefer cross-region inference profile prefix over AWS_REGION-derived
  'ANTHROPIC_BEDROCK_REGION_PREFIX',
  'ANTHROPIC_BEDROCK_SERVICE_TIER',
  // ANTHROPIC_CUSTOM_HEADERS is not always-safe. zNe allows it only when Tn
  // is false (see isSafeManagedEnv / customHeadersRequireApproval).
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_NAME',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_SUPPORTED_CAPABILITIES',
  // densable 2.1.236 kv_/SAFE — session-start default (unlike ANTHROPIC_MODEL pin)
  'ANTHROPIC_DEFAULT_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  'AWS_REGION',
  'BASH_DEFAULT_TIMEOUT_MS',
  'BASH_MAX_OUTPUT_LENGTH',
  'BASH_MAX_TIMEOUT_MS',
  'CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
  'CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS',
  'CLAUDE_CODE_BRIDGE_CHILD_AUTO_DEFAULT',
  'CLAUDE_CODE_DISABLE_TERMINAL_TITLE',
  'CLAUDE_CODE_ENABLE_AUTO_MODE',
  'CLAUDE_CODE_ENABLE_DESIGN_SYNC',
  'CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL',
  'CLAUDE_CODE_ENABLE_TELEMETRY',
  'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
  'CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
  'CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH',
  'CLAUDE_CODE_SKIP_ANTHROPIC_GOOGLE_CLOUD_AUTH',
  'CLAUDE_CODE_SKIP_MANTLE_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL_FORCE',
  'CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_POWERSHELL_TOOL',
  'CLAUDE_CODE_USE_VERTEX',
  'DISABLE_AUTOUPDATER',
  'DISABLE_BUG_COMMAND',
  'DISABLE_COST_WARNINGS',
  'CLAUDE_CODE_SEND_FEEDBACK',
  'DISABLE_FEEDBACK_COMMAND',
  'DISABLE_GROWTHBOOK',
  'DISABLE_INSTALLATION_CHECKS',
  'DISABLE_UPDATES',
  'ENABLE_TOOL_SEARCH',
  'MAX_MCP_OUTPUT_TOKENS',
  'MAX_THINKING_TOKENS',
  'MCP_CONNECT_TIMEOUT_MS',
  'MCP_PROTOCOL_NEGOTIATION',
  'MCP_TIMEOUT',
  'MCP_TOOL_TIMEOUT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_PROTOCOL',
  'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_PROTOCOL',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
  'OTEL_LOG_ASSISTANT_RESPONSES',
  'OTEL_LOG_TOOL_CONTENT',
  'OTEL_LOG_TOOL_DETAILS',
  'OTEL_LOG_USER_PROMPTS',
  'OTEL_LOGS_EXPORT_INTERVAL',
  'OTEL_LOGS_EXPORTER',
  'OTEL_METRIC_EXPORT_INTERVAL',
  'OTEL_METRICS_EXPORTER',
  'OTEL_METRICS_INCLUDE_ACCOUNT_UUID',
  'OTEL_METRICS_INCLUDE_ENTRYPOINT',
  'OTEL_METRICS_INCLUDE_REPOSITORY',
  'OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES',
  'OTEL_METRICS_INCLUDE_SESSION_ID',
  'OTEL_METRICS_INCLUDE_VERSION',
  'OTEL_RESOURCE_ATTRIBUTES',
  // Official 2.1.326 (#9): opt-in host.name / host.id OTel resource attributes (off by default)
  'OTEL_RESOURCE_INCLUDE_HOST',
  'OTEL_TRACES_EXPORTER',
  'USE_BUILTIN_RIPGREP',
  'VERTEX_REGION_CLAUDE_3_5_HAIKU',
  'VERTEX_REGION_CLAUDE_3_5_SONNET',
  'VERTEX_REGION_CLAUDE_3_7_SONNET',
  'VERTEX_REGION_CLAUDE_4_0_OPUS',
  'VERTEX_REGION_CLAUDE_4_0_SONNET',
  'VERTEX_REGION_CLAUDE_4_1_OPUS',
  'VERTEX_REGION_CLAUDE_4_5_OPUS',
  'VERTEX_REGION_CLAUDE_4_6_OPUS',
  'VERTEX_REGION_CLAUDE_4_7_OPUS',
  'VERTEX_REGION_CLAUDE_4_8_OPUS',
  'VERTEX_REGION_CLAUDE_FABLE_5',
  'VERTEX_REGION_CLAUDE_4_5_SONNET',
  'VERTEX_REGION_CLAUDE_4_6_SONNET',
  'VERTEX_REGION_CLAUDE_5_SONNET',
  'VERTEX_REGION_CLAUDE_HAIKU_4_5',
  'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
  'DISABLE_AUTO_COMPACT',
  'DISABLE_COMPACT',
  'CLAUDE_CODE_ALWAYS_ENABLE_EFFORT',
  'CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING',
  'CLAUDE_CODE_WISE_COMET',
  'CLAUDE_CODE_DISABLE_FAST_MODE',
  'CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP',
  'CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK',
  'CLAUDE_CODE_DISABLE_THINKING',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'DISABLE_INTERLEAVED_THINKING',
  'DISABLE_PROMPT_CACHING',
  'DISABLE_PROMPT_CACHING_FABLE',
  'DISABLE_PROMPT_CACHING_HAIKU',
  'DISABLE_PROMPT_CACHING_MYTHOS',
  'DISABLE_PROMPT_CACHING_OPUS',
  'DISABLE_PROMPT_CACHING_SONNET',
  'ENABLE_PROMPT_CACHING_1H',
  'ENABLE_PROMPT_CACHING_1H_BEDROCK',
  'FALLBACK_FOR_ALL_PRIMARY_MODELS',
  'FORCE_PROMPT_CACHING_5M',
  'CLAUDE_AUTO_BACKGROUND_TASKS',
  'CLAUDE_CODE_DISABLE_ADVISOR_TOOL',
  'CLAUDE_CODE_DISABLE_AGENT_VIEW',
  'CLAUDE_CODE_DISABLE_ARTIFACT',
  'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS',
  'CLAUDE_CODE_DISABLE_BUNDLED_SKILLS',
  'CLAUDE_CODE_DISABLE_CRON',
  'CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS',
  'CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY',
  'CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING',
  'CLAUDE_CODE_DISABLE_WORKFLOWS',
  'CLAUDE_CODE_ENABLE_AWAY_SUMMARY',
  'CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING',
  'CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION',
  'CLAUDE_CODE_ENABLE_TASKS',
  // densable 2.1.233 — force-on TodoWrite/Task* when model floor would disable
  'CLAUDE_CODE_ENABLE_TODO_TOOLS',
  'CLAUDE_CODE_PLAN_MODE_REQUIRED',
  'DISABLE_DOCTOR_COMMAND',
  'DISABLE_EXTRA_USAGE_COMMAND',
  'DISABLE_INSTALL_GITHUB_APP_COMMAND',
  'DISABLE_LOGIN_COMMAND',
  'DISABLE_LOGOUT_COMMAND',
  'DISABLE_UPGRADE_COMMAND',
  'CLAUDE_CODE_ACCESSIBILITY',
  'CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN',
  'CLAUDE_CODE_DISABLE_MOUSE',
  'CLAUDE_CODE_DISABLE_MOUSE_CLICKS',
  'CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL',
  'CLAUDE_CODE_FORCE_STRIKETHROUGH',
  'CLAUDE_CODE_HIDE_CWD',
  'CLAUDE_CODE_NATIVE_CURSOR',
  'CLAUDE_CODE_NO_FLICKER',
  'CLAUDE_CODE_SCROLL_SPEED',
  'CLAUDE_CODE_SYNTAX_HIGHLIGHT',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_GLOB_TIMEOUT_SECONDS',
  'CLAUDE_CODE_MAX_RETRIES',
  'CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION',
  'CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY',
  'CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION',
  'CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS',
  'CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT',
  // densable 2.1.233 — WebFetch URL cache TTL (ms); default 900000
  'CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS',
  // densable 2.1.233 — Linux Bash tool cgroup memory.max
  'CLAUDE_CODE_TOOL_MEMORY_LIMIT',
  'CLAUDE_STREAM_IDLE_TIMEOUT_MS',
  'MAX_STRUCTURED_OUTPUT_RETRIES',
  'MCP_REMOTE_SERVER_CONNECTION_BATCH_SIZE',
  'MCP_SERVER_CONNECTION_BATCH_SIZE',
  'SLASH_COMMAND_TOOL_CHAR_BUDGET',
  'TASK_MAX_OUTPUT_LENGTH',
  // densable 2.1.248 #42 — LEh set @179035200 (quoted STREAM 1/0)
  'MCP_CONNECTION_NONBLOCKING',
  'CLAUDE_ENABLE_BYTE_WATCHDOG',
  'CLAUDE_ENABLE_BYTE_WATCHDOG_BEDROCK',
  'CLAUDE_ENABLE_STREAM_WATCHDOG',
  // --- fork / local extras (not in densable LEh; keep for provider compatibility) ---
  'API_FORCE_IDLE_TIMEOUT',
  'CLAUDE_CODE_PROCESS_WRAPPER',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_OPENAI',
  'ENABLE_SEARCH_EXTRA_TOOLS',
  'GEMINI_API_KEY',
  'GEMINI_BASE_URL',
  'GEMINI_MODEL',
  'GEMINI_SMALL_FAST_MODEL',
  'GEMINI_DEFAULT_HAIKU_MODEL',
  'GEMINI_DEFAULT_HAIKU_MODEL_DESCRIPTION',
  'GEMINI_DEFAULT_HAIKU_MODEL_NAME',
  'GEMINI_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'GEMINI_DEFAULT_OPUS_MODEL',
  'GEMINI_DEFAULT_OPUS_MODEL_DESCRIPTION',
  'GEMINI_DEFAULT_OPUS_MODEL_NAME',
  'GEMINI_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'GEMINI_DEFAULT_SONNET_MODEL',
  'GEMINI_DEFAULT_SONNET_MODEL_DESCRIPTION',
  'GEMINI_DEFAULT_SONNET_MODEL_NAME',
  'GEMINI_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'GROK_API_KEY',
  'GROK_BASE_URL',
  'GROK_DEFAULT_HAIKU_MODEL',
  'GROK_DEFAULT_OPUS_MODEL',
  'GROK_DEFAULT_SONNET_MODEL',
  'GROK_MODEL',
  'GROK_MODEL_MAP',
  'OPENAI_API_KEY',
  'OPENAI_AUTH_MODE',
  'OPENAI_BASE_URL',
  'OPENAI_DEFAULT_HAIKU_MODEL',
  'OPENAI_DEFAULT_HAIKU_MODEL_DESCRIPTION',
  'OPENAI_DEFAULT_HAIKU_MODEL_NAME',
  'OPENAI_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'OPENAI_DEFAULT_OPUS_MODEL',
  'OPENAI_DEFAULT_OPUS_MODEL_DESCRIPTION',
  'OPENAI_DEFAULT_OPUS_MODEL_NAME',
  'OPENAI_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'OPENAI_DEFAULT_SONNET_MODEL',
  'OPENAI_DEFAULT_SONNET_MODEL_DESCRIPTION',
  'OPENAI_DEFAULT_SONNET_MODEL_NAME',
  'OPENAI_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'OPENAI_ENABLE_THINKING',
  'OPENAI_MAX_TOKENS',
  'OPENAI_MODEL',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'OPENAI_SMALL_FAST_MODEL',
  'OTEL_EXPORTER_OTLP_METRICS_CLIENT_CERTIFICATE',
  'OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY',
  'XAI_API_KEY',
])

/**
 * densable Rn — HTTP header-name token grammar.
 */
export const HEADER_NAME_TOKEN_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/**
 * densable Cn — header-name fragments that make ANTHROPIC_CUSTOM_HEADERS
 * sensitive. `authorization` matches `auth`. `host` matches `host`.
 */
const SENSITIVE_CUSTOM_HEADER_NAME_RE =
  /auth|key|token|cookie|secret|credential|session|signature|passw|jwt|assertion|cert|oidc|org|tenant|account|project|workspace|user|email|identity|principal|consumer|client|host|url|base|target|upstream|endpoint|proxy|forward|route|fallback|override|apigw|x-goog-|l5d-|bypass|guardrail|amz|x-ms-|azureml|extra-parameters|envoy|helicone|litellm|cf-aig|cf-access|beta|version/

/** densable Ke — HTTP OWS (space / tab) for $Kt trim. */
function isHeaderValueOws(code: number): boolean {
  return code === 0x20 || code === 0x09
}

/** densable je — first CR/LF in a header value slice. */
function findHeaderValueLineBreak(value: string): number {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 0x0a || code === 0x0d) return i
  }
  return -1
}

export type HeaderValueReject =
  | { kind: 'line_break'; index: number }
  | { kind: 'nul'; index: number }
  | { kind: 'non_ascii'; index: number; codePoint: number }

/**
 * densable $Kt — reject header values with a line break, NUL, or non-ASCII.
 */
export function inspectCustomHeaderValue(
  value: string,
): HeaderValueReject | null {
  let start = 0
  let end = value.length
  while (start < end && isHeaderValueOws(value.charCodeAt(start))) start++
  while (end > start && isHeaderValueOws(value.charCodeAt(end - 1))) end--
  const lineBreak = findHeaderValueLineBreak(value.slice(start, end))
  if (lineBreak !== -1) {
    return { kind: 'line_break', index: start + lineBreak }
  }
  for (let i = start; i < end; i++) {
    const code = value.charCodeAt(i)
    if (code === 0) return { kind: 'nul', index: i }
    if (code > 255) {
      return {
        kind: 'non_ascii',
        index: i,
        codePoint: value.codePointAt(i) ?? code,
      }
    }
  }
  return null
}

/**
 * densable Tn — true when a custom-header block needs approval.
 * Bare CR is sensitive. A line with no colon is not.
 * Gold: !Rn.test(name) || $Kt(value) !== null || Cn.test(name.toLowerCase()).
 */
export function customHeadersRequireApproval(block: string): boolean {
  if (/\r(?!\n)/.test(block)) return true
  return block.split(/\n|\r\n/).some(line => {
    const colon = line.indexOf(':')
    if (colon === -1) return false
    const name = line.slice(0, colon).trim()
    return (
      !HEADER_NAME_TOKEN_RE.test(name) ||
      inspectCustomHeaderValue(line.slice(colon + 1)) !== null ||
      SENSITIVE_CUSTOM_HEADER_NAME_RE.test(name.toLowerCase())
    )
  })
}

/**
 * densable B7t / zNe — env key is safe (skips approval) when it is in LEh
 * (SAFE_ENV_VARS), or in MEh and truthy, or ANTHROPIC_CUSTOM_HEADERS whose
 * block is not sensitive (`!Tn`).
 */
export function isSafeManagedEnv(key: string, value: string): boolean {
  const upper = key.toUpperCase()
  if (SAFE_ENV_VARS.has(upper)) return true
  if (SAFE_WHEN_TRUTHY_ENV_VARS.has(upper)) {
    const normalized = value.toLowerCase().trim()
    return ['1', 'true', 'yes', 'on'].includes(normalized)
  }
  if (upper === 'ANTHROPIC_CUSTOM_HEADERS') {
    return !customHeadersRequireApproval(value)
  }
  return false
}

/**
 * SEA `ZFo` (2.1.325) — env vars that project-scoped settings
 * (`projectSettings`, `localSettings`) must NOT set, because they control
 * security boundaries, attachments, Chrome/CFC, dialog timeouts, host paths,
 * or process execution.
 */
export const PROJECT_SCOPE_BLOCKED_ENV_VARS = new Set([
  'CLAUDE_CODE_AUTOMOUNT_ROOTS',
  'CLAUDE_CODE_YOU_SHOULD_KNOW_AUTO_SEND',
  'CLAUDE_CODE_CUSTOM_OAUTH_URL',
  'CLAUDE_CODE_DISABLE_SUBAGENT_HANDBACK',
  'CLAUDE_CODE_SYNC_SKILLS',
  'CLAUDE_CODE_SYNC_PLUGINS',
  'CLAUDE_CODE_SYNC_REUSE_WITHIN_MS',
  'CLAUDE_CODE_TRANSCRIPT_LOCAL_GC',
  'CLAUDE_CODE_CCR_SURFACE',
  'CLAUDE_CODE_INCREMENTAL_REQUEST_BODY',
  'CLAUDE_CODE_GZIP_REQUEST_BODY_BLOCKS',
  'CLAUDE_CODE_NORMALIZE_PREFIX_CACHE',
  'CLAUDE_CODE_NORMALIZE_PREFIX_CACHE_VERIFY',
  'CLAUDE_CODE_SKIP_PLUGIN_LOCAL_MCP_SERVERS',
  'CLAUDE_CODE_SKIP_PLUGIN_MCP_BUNDLES',
  'CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS_EXCEPT',
  'CLAUDE_CODE_PLUGIN_REMOTE_MCP_REACHABLE_HOSTS_HINT',
  'CLAUDE_CODE_RELAUNCH_PROACTIVITY_BASELINE',
  'CLAUDE_CODE_RELAUNCH_PROACTIVITY_DECIDED',
  'CLAUDE_CODE_RELAUNCH_PROACTIVITY_EVER_ON',
  'CLAUDE_CODE_RELAUNCH_PROACTIVITY_LEVEL',
  'CLAUDE_CODE_DISABLE_PROACTIVITY',
  'CLAUDE_CODE_DISABLE_ATTACHMENTS',
  'CLAUDE_CODE_TETHER_LIVE',
  'CLAUDE_CODE_PROGRAM_USE_CASE_ID',
  'CLAUDE_CODE_PROGRAM_USE_CASE_STAMPED',
  'CLAUDE_CODE_BRIDGE_CHILD_AUTO_DEFAULT',
  'CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT',
  'CLAUDE_CODE_BRIDGE_CHILD_MACHINE_SETTINGS',
  'CLAUDE_CODE_BRIDGE_CHILD_PROJECTS_ENTRYPOINT',
  'CLAUDE_CODE_BRIDGE_CHILD_CLI_ENTRYPOINT',
  'CLAUDE_CODE_BRIDGE_CHILD_START_DIR',
  'CLAUDE_CODE_MCP_APPS_HOST',
  'CLAUDE_CODE_MCP_APPS_NO_TOOL_ROUTE',
  'CLAUDE_CODE_NOTIFICATIONS_HOST',
  'CLAUDE_CODE_COORDINATOR_MODE',
  'CLAUDE_CODE_COORDINATOR_EXTRA_TOOLS',
  'CLAUDE_CODE_UPFRONT_TOOLS',
  'CLAUDE_CODE_HOST_PROMPT_SUPERSEDES_RECORD',
  'CLAUDE_CODE_REMOTE_TOOLS_PIN_STORED_LOGIN',
  'CLAUDE_CODE_REMOTE_TOOLS_HOST_ALLOWS_UNATTENDED',
  'CLAUDE_CODE_REMOTE_TOOLS_HOST_IDLE_RELEASE_MINUTES',
  'CLAUDE_CODE_SDK_MCP_TOOL_IDLE_TIMEOUT',
  'CLAUDE_CODE_3P_PROBE_WROTE_SONNET_DEFAULT',
  'CLAUDE_CODE_3P_PROBE_WROTE_OPUS_DEFAULT',
  'CLAUDE_CODE_3P_PROBE_WROTE_HAIKU_DEFAULT',
  'CLAUDE_CODE_3P_SEEDED_SONNET_DEFAULT',
  'CLAUDE_CODE_3P_SEEDED_OPUS_DEFAULT',
  'CLAUDE_CODE_SANDBOXED',
  'CLAUDE_CODE_ATTRIBUTION_STATUS_TIMEOUT_MS',
  'CLAUDE_CODE_TOOL_USE_ID',
  'CLAUDE_CODE_DISABLE_ATTRIBUTION_CROSS_REPO',
  'CLAUDE_CODE_DISABLE_WEB_FETCH',
  'CLAUDE_CODE_DISABLE_RESPONSE_COMPARISON',
  'CLAUDE_CODE_DISABLE_MCP_TASKS',
  'CLAUDE_CODE_DISABLE_AGENT_PROGRESS_SUMMARIES',
  'CLAUDE_CODE_DISABLE_ULTRATHINK',
  'CLAUDE_CODE_DISABLE_FILE_MENTIONS',
  'CCR_SESSION_PROFILE',
  'CLAUDE_CODE_OVERLOADED_RETRY_BASE_DELAY_MS',
  'CLAUDE_CODE_OVERLOADED_RETRY_MAX_DELAY_MS',
  'CLAUDE_CODE_OVERLOADED_RETRY_MAX_WAIT_MS',
  'CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS',
  'CLAUDE_CODE_MCP_STARTUP_WAIT_MS',
  'CLAUDE_CODE_MCP_CONNECTOR_PREWAIT_MS',
  'CLAUDE_CODE_MCP_PREWAIT_SERVERS',
  'CLAUDE_CODE_MCP_PREWAIT_SERVERS_MS',
  'CLAUDE_CODE_SORTED_OTTER',
  'CLAUDE_CODE_SKILL_PROPOSALS',
  'CLAUDE_CODE_PLUGIN_CACHE_DIR',
  'CLAUDE_CODE_PLUGIN_SEED_DIR',
  'CLAUDE_CODE_PLUGIN_MCPB_DIR',
  'CLAUDE_CODE_PLUGIN_DIRS',
  'CLAUDE_CODE_PLUGIN_DIR_WATCH',
  'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS',
  'CLAUDE_CODE_PLUGIN_ATTRIBUTION',
  'CLAUDE_CODE_SKILL_ATTRIBUTION',
  'CLAUDE_CODE_MODEL_CATALOG_URL',
  'CLAUDE_CODE_MODEL_CATALOG',
  'CLAUDE_CODE_CLIENT_DATA_URL',
  'CLAUDE_CODE_ALLOW_OTHER_MODELS',
  'CLAUDE_CODE_REMOVE_PROMPT_STRINGS',
  'CLAUDE_CODE_SUBSCRIPTION_TYPE',
  'CLAUDE_CODE_RATE_LIMIT_TIER',
  'CLAUDE_CODE_SANDBOX_LEAVE_DENIES_TO_SRT_WIN',
  'CLAUDE_CODE_SANDBOX_LEAVE_PARENT_FOLDERS_ALONE',
  'CLAUDE_CODE_NANKEEN_KESTREL',
  'CLAUDE_CODE_DISABLE_DANGEROUS_RM_TIMEOUT',
  'CLAUDE_CODE_DISABLE_SUBSTITUTION_RM_PROMPT',
  'CLAUDE_CODE_DISABLE_INLINE_SHELL_RM_PROMPT',
  'CLAUDE_CODE_STRICT_INLINE_SHELL_RM_PROMPT',
  'CLAUDE_CODE_IGNORE_PERSISTED_TRUST',
  'CLAUDE_CODE_DISABLE_MOUNTED_DRIVE_RM_PROMPT',
  'CLAUDE_CODE_DISABLE_EXPORTED_VARIABLE_PROMPT',
  'CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS',
  'CLAUDE_CODE_DISABLE_POWERSHELL_CMD_RM_DENY',
  'CLAUDE_CODE_DISABLE_ULTRAREVIEW_TRUST_CHECK',
  'CLAUDE_CODE_FEDERATION_CACHE_DIR',
  'ANTHROPIC_CONFIG_DIR',
  'XDG_CONFIG_HOME',
  'HOME',
  'APPDATA',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'PROGRAMDATA',
  'ALLUSERSPROFILE',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'SYSTEMDRIVE',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'LOCALAPPDATA',
  'PATHEXT',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432',
  'PSMODULEPATH',
  'HOMESHARE',
  'ONEDRIVE',
  'ONEDRIVECONSUMER',
  'ONEDRIVECOMMERCIAL',
  'CDPATH',
  'PWD',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'CLAUDE_CODE_SAFE_MODE',
  'CLAUDE_CODE_SIMPLE',
  'CLAUDE_CODE_HARBOR_KITE',
  'CLAUDE_CODE_HARBOR_KITE_CLOUD',
  'CLAUDE_CODE_HARBOR_KITE_PACING_OFF',
  'CLAUDE_CODE_SILENT_TURN_REMINDER',
  'CLAUDE_CODE_SILENT_TURN_REMINDER_TURNS',
  'CLAUDE_CODE_SILENT_TURN_REMINDER_SECONDS',
  'CLAUDE_CODE_SILENT_TURN_REMINDER_TEXT',
  'CLAUDE_CODE_MODEL_CAPABILITIES',
  'CLAUDE_CODE_ARTIFACT_ROOM',
  'CLAUDE_CODE_BASH_EDIT_DIFF',
  'CLAUDE_CODE_FORWARD_USER_INTENT',
  'CLAUDE_CODE_WHIMSICAL_ELEPHANT',
  'CLAUDE_CODE_CRYPTIC_HORIZON',
  'CLAUDE_CODE_PARSED_WILLOW',
  'CLAUDE_CODE_DAPPER_CUPCAKE',
  'CLAUDE_CODE_DEEP_TWILIGHT',
  'CLAUDE_CODE_ARTIFACT_PRESENCE',
  'CLAUDE_CODE_ARTIFACT_OPEN_ACTION',
  'CLAUDE_CODE_ARTIFACT_REPL',
  'CLAUDE_CODE_RESUME_CACHE_WARM',
  'CLAUDE_CODE_ARTIFACT_PREVIEW_EMULATOR',
  'USER_TYPE',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_DISABLE_ADMIN_ENV_UNION',
  'CLAUDE_CODE_MANAGED_SETTINGS_PATH',
  'CLAUDE_CODE_TOASTY_THIMBLE',
  'CLAUDE_CODE_GENTLE_PARASOL',
  'CLAUDE_CODE_STREAMED_BUMBLEBEE_TEXT',
  'CLAUDE_CODE_CURRIED_TRINKET',
  'CLAUDE_CODE_LEGACY_BUNDLE',
  'CCR_ENABLE_BUNDLE',
  'CCR_FORCE_BUNDLE',
  'GITHUB_ACTIONS',
  'RUNNER_ENVIRONMENT',
  'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB',
  'ENABLE_BETA_TRACING_DETAILED',
  'BETA_TRACING_ENDPOINT',
  'OTEL_LOG_RAW_API_BODIES',
  'CLAUDE_PTY_RECORD',
  'CLAUDE_CODE_DEBUG_LOGS_DIR',
  'CLAUDE_CODE_DIAGNOSTICS_FILE',
  'CLAUDE_CODE_PERFETTO_TRACE',
  'CLAUDE_CODE_FRAME_TIMING_LOG',
  'CLAUDE_CODE_REMOTE_MEMORY_DIR',
  'CLAUDE_COWORK_MEMORY_PATH_OVERRIDE',
  'AUTOMODE_DECISION_LOG',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_SECURESTORAGE_CONFIG_DIR',
  'CLAUDE_CODE_TMPDIR',
  'CLAUDE_TMPDIR',
  'TMPDIR',
  'TMP',
  'TEMP',
  'XDG_RUNTIME_DIR',
  'TERMUX_VERSION',
  'CLAUDE_JOB_DIR',
  'CLAUDE_CODE_DISABLE_BG_STABLE_PATH',
  'CLAUDE_CODE_NATIVE_APP_BUNDLE',
  'CLAUDE_CODE_REMOTE_TOOLS_FORWARD',
  'CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS',
  'CLAUDE_AFK_TIMEOUT_MS',
  'CLAUDE_AFK_COUNTDOWN_MS',
  'CLAUDE_AX_SCREEN_READER',
  'INK_SCREEN_READER',
  'CLAUDE_CHROME_CLASSIFIER_FLOOR',
  'CLAUDE_CHROME_PERMISSION_MODE',
  'CLAUDE_CODE_ENABLE_CFC',
  'CLAUDE_CODE_EXPERIMENTAL_CODE_MODE',
  'CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL',
])

export const PROJECT_SCOPE_BLOCKED_ENV_PREFIXES = ['CLAUDE_AX_'] as const

const PROJECT_SCOPE_TRUTHY_ALLOWED = new Set([
  'API_FORCE_IDLE_TIMEOUT',
  'CLAUDE_CODE_DISABLE_AGENT_PROGRESS_SUMMARIES',
  'CLAUDE_CODE_DISABLE_MCP_TASKS',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_DISABLE_RESPONSE_COMPARISON',
  'CLAUDE_CODE_DISABLE_ULTRATHINK',
  'CLAUDE_CODE_DISABLE_WEB_FETCH',
  'DISABLE_ERROR_REPORTING',
  'DISABLE_TELEMETRY',
  'DO_NOT_TRACK',
])

function isTruthyString(val: unknown): boolean {
  if (typeof val === 'boolean') return val
  if (typeof val !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(val.toLowerCase().trim())
}

function isFalsyString(val: unknown): boolean {
  if (typeof val === 'boolean') return !val
  if (typeof val !== 'string') return false
  return ['0', 'false', 'no', 'off'].includes(val.toLowerCase().trim())
}

/**
 * SEA `e1o(key)` + `Q(...)` exceptions (`jdi`, `V1o`/`ge`): returns true when
 * `key` with `value` must be stripped from `projectSettings`/`localSettings`.
 */
export function isProjectScopeBlockedEnvVar(
  key: string,
  value: unknown,
): boolean {
  const upper = key.toUpperCase()
  if (upper === 'DISABLE_COMPACT') {
    return !isTruthyString(value)
  }
  const blocked =
    PROJECT_SCOPE_BLOCKED_ENV_VARS.has(upper) ||
    PROJECT_SCOPE_BLOCKED_ENV_PREFIXES.some(p => upper.startsWith(p))
  if (!blocked) return false
  if (PROJECT_SCOPE_TRUTHY_ALLOWED.has(key) && isTruthyString(value)) {
    return false
  }
  switch (upper) {
    case 'CLAUDE_CHROME_CLASSIFIER_FLOOR':
      return !isTruthyString(value)
    case 'CLAUDE_CHROME_PERMISSION_MODE':
      return value !== 'ask'
    case 'CLAUDE_CODE_ENABLE_CFC':
    case 'CLAUDE_CODE_EXPERIMENTAL_CODE_MODE':
    case 'ENABLE_BETA_TRACING_DETAILED':
    case 'OTEL_LOG_RAW_API_BODIES':
      return !isFalsyString(value)
    case 'CLAUDE_CODE_MODEL_CATALOG':
      return String(value).trim().toLowerCase() !== 'off'
    default:
      return true
  }
}

/**
 * Official 2.1.327 `Be` / `xe` / `oe` (#530):
 * Flag- and plugin-delivery env vars ignored from repo `.claude/settings*.json`
 * in Anthropic-hosted cloud sessions (`CLAUDE_CODE_REMOTE=1` non-BYOC).
 */
export const CLOUD_SESSION_REPO_BLOCKED_FLAG_ENV_VARS = new Set([
  'CLAUDE_CODE_DISABLE_FEATURE_FLAGS',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'DISABLE_GROWTHBOOK',
])

export const CLOUD_SESSION_REPO_BLOCKED_PLUGIN_ENV_VARS = new Set([
  'CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS',
  'CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS',
  'CLAUDE_CODE_SYNC_PLUGIN_INSTALL',
  'CLAUDE_CODE_SYNC_PLUGINS_DOWNLOAD_STALL_MS',
  'CLAUDE_CODE_SYNC_PLUGINS_INSTALL_TIMEOUT_MS',
  'CLAUDE_CODE_SYNC_PLUGINS_MCP_TIMEOUT_MS',
  'CLAUDE_CODE_SYNC_PLUGIN_INSTALL_TIMEOUT_MS',
  'CLAUDE_CODE_SYNC_SKILLS_INSTALL_TIMEOUT_MS',
  'CLAUDE_CODE_SYNC_SKILLS_WAIT_TIMEOUT_MS',
])

export const CLOUD_SESSION_REPO_BLOCKED_ENV_VARS = new Set([
  ...CLOUD_SESSION_REPO_BLOCKED_FLAG_ENV_VARS,
  ...CLOUD_SESSION_REPO_BLOCKED_PLUGIN_ENV_VARS,
])

/**
 * Official 2.1.327 `mkr` (#530): telemetry-disabling env vars that a repo in an
 * Anthropic-hosted cloud session can use to turn telemetry OFF, but never back ON.
 * `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is downgraded to `DISABLE_TELEMETRY=1`.
 */
export const CLOUD_SESSION_REPO_TELEMETRY_ENV_VARS = new Set([
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'DISABLE_TELEMETRY',
  'DO_NOT_TRACK',
])

/**
 * Official 2.1.327 `Fve()` (#530): true when running in an Anthropic-hosted
 * cloud session (remote container, excluding self-hosted BYOC runners).
 */
export function isAnthropicHostedCloudSession(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const remote = env.CLAUDE_CODE_REMOTE
  const isRemote =
    remote === '1' ||
    remote?.toLowerCase().trim() === 'true' ||
    remote?.toLowerCase().trim() === 'yes' ||
    remote?.toLowerCase().trim() === 'on'
  if (!isRemote) return false
  if (env.CLAUDE_CODE_ENVIRONMENT_KIND === 'byoc') return false
  if (env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE === 'self_hosted') return false
  return true
}

function isRepoReEnablingTelemetry(key: string, value: unknown): boolean {
  const upper = key.toUpperCase()
  if (!CLOUD_SESSION_REPO_TELEMETRY_ENV_VARS.has(upper)) return false
  const strVal =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : undefined
  return !isTelemetryDisabledInEnv({ [upper]: strVal })
}

const cloudRepoStripWarnedKeys = new Set<string>()

export function clearCloudSessionRepoStripWarnsForTests(): void {
  cloudRepoStripWarnedKeys.clear()
}

/**
 * SEA `Q(env, source)` + Official 2.1.327 `Je` (#530):
 * Strips `PROJECT_SCOPE_BLOCKED_ENV_VARS` when `source` is `'projectSettings'`
 * or `'localSettings'`. In Anthropic-hosted cloud sessions, also ignores repo
 * flag/plugin delivery env vars and downgrades repo
 * `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` to at most `DISABLE_TELEMETRY=1`.
 */
export function stripProjectScopeBlockedEnv(
  env: Record<string, string> | undefined,
  source: string,
  opts?: {
    cloudSession?: boolean
    warnedKeys?: Set<string>
  },
): Record<string, string> {
  if (!env) return {}
  if (source !== 'projectSettings' && source !== 'localSettings') {
    return env
  }
  const inCloudSession =
    opts?.cloudSession !== undefined
      ? opts.cloudSession
      : isAnthropicHostedCloudSession()
  const warned = opts?.warnedKeys ?? cloudRepoStripWarnedKeys
  let stripped: Record<string, string> | undefined
  let shouldDisableTelemetry = false

  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase()
    const val = env[key]
    if (
      inCloudSession &&
      (CLOUD_SESSION_REPO_BLOCKED_ENV_VARS.has(upper) ||
        isRepoReEnablingTelemetry(key, val))
    ) {
      stripped ??= { ...env }
      delete stripped[key]
      const isTelemetryVar = CLOUD_SESSION_REPO_TELEMETRY_ENV_VARS.has(upper)
      const reEnabling = isRepoReEnablingTelemetry(key, val)
      if (isTelemetryVar && !reEnabling) {
        shouldDisableTelemetry = true
      }
      if (!warned.has(key)) {
        warned.add(key)
        const fileLabel =
          source === 'localSettings'
            ? '.claude/settings.local.json'
            : '.claude/settings.json'
        logForDebugging(
          reEnabling
            ? `${key} in ${fileLabel} is ignored: in an Anthropic-hosted cloud session, a repository's settings can turn telemetry off but not back on.`
            : `${key} in ${fileLabel} is ignored${isTelemetryVar ? ', apart from turning telemetry off' : ''}: in an Anthropic-hosted cloud session, a repository's settings can't set it, because it can keep feature flags or required plugins and skills out of the session. Set it in the cloud environment's variables instead.`,
          { level: 'warn' },
        )
      }
      continue
    }
    if (!isProjectScopeBlockedEnvVar(key, val)) continue
    stripped ??= { ...env }
    delete stripped[key]
  }
  if (stripped && shouldDisableTelemetry) {
    stripped.DISABLE_TELEMETRY ||= '1'
  }
  return stripped ?? env
}
