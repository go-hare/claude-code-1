import { readdir } from 'fs/promises'
import { logEvent } from '../../services/analytics/index.js'
import { getCwd } from '../../utils/cwd.js'
import { isClaudeApiSkillDisabled } from '../../utils/residualMoreEnvGates.js'
import { registerBundledSkill } from '../bundledSkills.js'

// claudeApiContent.js bundles .md strings. Lazy-load inside
// getPromptForCommand / files() so they only enter memory when /claude-api is invoked.
type SkillContent = typeof import('./claudeApiContent.js')

type DetectedLanguage =
  | 'python'
  | 'typescript'
  | 'java'
  | 'go'
  | 'ruby'
  | 'csharp'
  | 'php'
  | 'curl'

const LANGUAGE_INDICATORS: Record<DetectedLanguage, string[]> = {
  python: ['.py', 'requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'],
  typescript: ['.ts', '.tsx', 'tsconfig.json', 'package.json'],
  java: ['.java', 'pom.xml', 'build.gradle'],
  go: ['.go', 'go.mod'],
  ruby: ['.rb', 'Gemfile'],
  csharp: ['.cs', '.csproj'],
  php: ['.php', 'composer.json'],
  curl: [],
}

/**
 * densable V5m / Wkg — skill description (TRIGGER/SKIP join).
 * Keep trigger description eval-pinned shape; do not invent prompt-audit into
 * the trigger line (densable TODO leaves that eval-pinned).
 */
const CLAUDE_API_SKILL_DESCRIPTION = [
  'Reference for the Claude API / Anthropic SDK — model ids, pricing, params, streaming, tool use, MCP, agents, caching, token counting, model migration.',
  'TRIGGER — read BEFORE opening the target file; don\'t skip because it "looks like a one-liner" — whenever: the prompt names Claude/Anthropic in any form (Claude, Anthropic, Fable, Opus, Sonnet, Haiku, `anthropic`, `@anthropic-ai`, `claude-*`, `us.anthropic.*`, `[1m]`); the user asks about an LLM (pricing/model choice/limits/caching) — never answer from memory; OR the task is LLM-shaped with provider unstated (agent/MCP/tool-definition/multi-agent/RAG/LLM-judge/computer-use; generate/summarize/extract/classify/rewrite/converse over NL; debugging refusals/cutoffs/streaming/tool-calls/tokens).',
  "SKIP only when another provider is being worked on (overrides all triggers): OpenAI/GPT/Gemini/Llama/Mistral/Cohere/Ollama named in the query; OR `grep -rE 'openai|langchain_openai|google.generativeai|genai|mistralai|cohere|ollama'` over the project hits (run this grep FIRST if no provider named — don't Read the file).",
].join('\n')

/** Gold menuDescription on ad()/Oy0. */
const CLAUDE_API_MENU_DESCRIPTION =
  'Build and debug apps that use the Claude API'

async function detectLanguage(): Promise<DetectedLanguage | null> {
  const cwd = getCwd()
  let entries: string[]
  try {
    entries = await readdir(cwd)
  } catch {
    return null
  }

  for (const [lang, indicators] of Object.entries(LANGUAGE_INDICATORS) as [
    DetectedLanguage,
    string[],
  ][]) {
    if (indicators.length === 0) continue
    for (const indicator of indicators) {
      if (indicator.startsWith('.')) {
        if (entries.some(e => e.endsWith(indicator))) return lang
      } else {
        if (entries.includes(indicator)) return lang
      }
    }
  }
  return null
}

export function processSkillMarkdown(
  md: string,
  modelVars: Record<string, string>,
): string {
  // Strip HTML comments. Loop to handle nested comments.
  let out = md
  let prev
  do {
    prev = out
    out = out.replace(/<!--[\s\S]*?-->\n?/g, '')
  } while (out !== prev)

  out = out.replace(
    /\{\{(\w+)\}\}/g,
    (match, key: string) => modelVars[key] ?? match,
  )
  return out
}

/**
 * densable Hy0 — process every SKILL_FILES entry before extract-to-disk.
 */
export function processSkillFiles(
  content: SkillContent,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, md] of Object.entries(content.SKILL_FILES)) {
    out[path] = processSkillMarkdown(md, content.SKILL_MODEL_VARS)
  }
  return out
}

/**
 * densable gPl / wRc — first bare word of args if it is a known subcommand.
 */
export function matchSubcommand(
  args: string,
  subcommands: readonly string[] = [
    'migrate',
    'managed-agents-onboard',
    'prompt-audit',
  ],
): string {
  const first = args.trim().toLowerCase().split(/\s+/)[0] ?? ''
  return subcommands.find(s => s === first) ?? 'none'
}

/**
 * densable Dy0 — SKILL.md stays intact (Reading Guide on-demand).
 * Extract success (`extracted`) inlines only `{lang}/claude-api/README.md`.
 * Extract failure inlines `shared/live-sources.md` only.
 */
export function buildClaudeApiPrompt(
  lang: DetectedLanguage | null,
  args: string,
  content: SkillContent,
  extracted: boolean,
): string {
  const parts: string[] = [
    processSkillMarkdown(
      content.SKILL_PROMPT,
      content.SKILL_MODEL_VARS,
    ).trimEnd(),
  ]

  if (!extracted) {
    parts.push(`## Reference Files Unavailable

This skill's reference files could not be written to disk for this session, so the \`{lang}/…\`, \`shared/…\`, and \`curl/…\` files cited above cannot be Read. Do not guess their contents — WebFetch the matching URL from \`shared/live-sources.md\`, included below, whenever the Reading Guide points at one of those files. If a cited \`shared/…\` file has no matching URL below (skill-authored guides such as \`shared/prompt-audit.md\`, \`shared/agent-design.md\`, \`shared/platform-availability.md\`), state that the reference is unavailable this session and proceed best-effort from this document.

<doc path="shared/live-sources.md">
${processSkillMarkdown(content.SKILL_FILES['shared/live-sources.md'] ?? '', content.SKILL_MODEL_VARS).trim()}
</doc>`)
  }

  if (lang) {
    const readmePath = `${lang}/claude-api/README.md`
    const readme = content.SKILL_FILES[readmePath]
    if (readme) {
      const onDemandHint = extracted
        ? ' Read the other referenced files from the base directory on demand. That directory is session-scoped — after resuming a session, or if a Read under it ever fails, re-invoke this skill to re-extract.'
        : ''
      parts.push(`## Detected Language: ${lang}

\`${readmePath}\` is included below since every task starts there.${onDemandHint}

<doc path="${readmePath}">
${processSkillMarkdown(readme, content.SKILL_MODEL_VARS).trim()}
</doc>`)
    }
  } else if (matchSubcommand(args) !== 'prompt-audit') {
    parts.push(
      extracted
        ? 'No project language was auto-detected. Ask the user which language they are using (see Language Detection above), then Read the matching `{lang}/claude-api/README.md` (or `curl/examples.md` for cURL/raw HTTP or an unsupported language) from the base directory before anything else.'
        : 'No project language was auto-detected. Ask the user which language they are using (see Language Detection above) before writing code.',
    )
  }

  if (args) {
    parts.push(`## User Request\n\n${args}`)
  }

  return parts.join('\n\n')
}

/**
 * densable Oy0 / registerClaudeApiSkill.
 * `files` is a lazy Hy0 map so Kwd extracts on first invoke; prompt is SKILL.md
 * plus at most one language README (or live-sources on extract fail).
 */
export function registerClaudeApiSkill({
  disabled = isClaudeApiSkillDisabled(),
}: {
  disabled?: boolean
} = {}): void {
  registerBundledSkill({
    name: 'claude-api',
    description: CLAUDE_API_SKILL_DESCRIPTION,
    // Gold menuDescription; Command has no separate field — surface via whenToUse.
    whenToUse: CLAUDE_API_MENU_DESCRIPTION,
    allowedTools: ['Read', 'Grep', 'Glob', 'WebFetch'],
    userInvocable: true,
    isEnabled: () => !disabled,
    files: () =>
      import('./claudeApiContent.js').then(content =>
        processSkillFiles(content),
      ),
    async getPromptForCommand(args, _context, extractedDir) {
      const [lang, content] = await Promise.all([
        detectLanguage(),
        import('./claudeApiContent.js'),
      ])
      logEvent(
        'tengu_claude_api_skill_loaded' as never,
        {
          detected_lang: (lang ?? 'none') as never,
          subcommand: matchSubcommand(args) as never,
          has_args: args.trim().length > 0,
        } as never,
      )
      return [
        {
          type: 'text',
          text: buildClaudeApiPrompt(
            lang,
            args,
            content,
            typeof extractedDir === 'string',
          ),
        },
      ]
    },
  })
}
