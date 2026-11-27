/**
 * Official 2.1.331 `claude plugin init <name>` (alias `new`) handler
 * (`exp_CQn.js` + `qid`).
 *
 * Scaffolds a new plugin at `~/.claude/skills/<name>/` (auto-loads next
 * session as `<name>@skills-dir`).
 */
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { cliError, cliOk } from '../exit.js'

const execFileAsync = promisify(execFile)

export const PLUGIN_MANIFEST_SCHEMA_URL =
  'https://anthropic.com/claude-code/plugin.schema.json'

export const SCAFFOLD_COMPONENTS = [
  'skills',
  'agents',
  'hooks',
  'mcp',
  'lsp',
  'output-style',
  'channel',
] as const

export type ScaffoldComponent = (typeof SCAFFOLD_COMPONENTS)[number]

export type ScaffoldFile = {
  relPath: string
  contents: string
  mode?: number
}

const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

export function validateInitPluginName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return 'Plugin name cannot be empty'
  }
  if (
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    name === '.'
  ) {
    return 'Plugin name cannot contain path separators (/ or \\), ".." sequences, or be "."'
  }
  if (name.startsWith('.') || name === 'node_modules') {
    return `Plugin name cannot be "${name}" or start with "." — those directories are never loaded as plugin adoptions`
  }
  if (!PLUGIN_NAME_PATTERN.test(name)) {
    return 'Plugin name must start with a lowercase letter or digit and contain only lowercase letters, digits, and hyphens'
  }
  return null
}

function renderSkillTemplate(name: string): string {
  return `---
name: ${name}
description: TODO — describe WHEN Claude should use this. Include trigger phrases users
  might say ("do X", "set up Y", "review Z"). Be specific; this string is what Claude
  matches the user's request against.
---

# ${name}

TODO: what this skill does, and the steps Claude should take.
`
}

function renderAgentTemplate(): string {
  return `---
name: example
description: TODO — when should Claude delegate to this subagent?
tools:
  - Read
  - Grep
---

TODO: system prompt for the subagent.
`
}

function renderHooksJson(): string {
  return `${jsonStringify(
    {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command:
                  'bun "${CLAUDE_PLUGIN_ROOT}/hooks-handlers/on-session-start.ts"',
              },
            ],
          },
        ],
      },
    },
    null,
    2,
  )}\n`
}

export function renderHookHandlerTs(): string {
  return `#!/usr/bin/env bun
// SessionStart hook handler. Reads the event from stdin, writes a JSON result
// to stdout. Swap "bun" for "node" or "python3" in hooks/hooks.json if your
// users' environment lacks bun.
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const input = await readStdin()
const event = JSON.parse(input)
process.stdout.write(JSON.stringify({}))
`
}

function renderMcpJson(): string {
  return `${jsonStringify(
    {
      mcpServers: {
        'example-remote': {
          type: 'http',
          url: 'https://example.com/mcp',
        },
        'example-local': {
          command: 'npx',
          args: ['<your-mcp-server-package>'],
        },
      },
    },
    null,
    2,
  )}\n`
}

function renderLspJson(): string {
  return `${jsonStringify(
    {
      example: {
        command: 'example-language-server',
        args: ['--stdio'],
        extensionToLanguage: { '.example': 'example' },
      },
    },
    null,
    2,
  )}\n`
}

function renderOutputStyleTemplate(name: string): string {
  return `---
name: ${name}
description: TODO — one line shown in the Output style picker in /config
force-for-plugin: true
keep-coding-instructions: true
---

TODO: the style prompt. This is appended to Claude's system prompt while the
style is active. With force-for-plugin: true, the style applies automatically
when this plugin is enabled.
`
}

function renderChannelMcpJson(name: string): string {
  return `${jsonStringify(
    {
      mcpServers: {
        [name]: {
          command: 'bun',
          args: [
            'run',
            '--cwd',
            '${CLAUDE_PLUGIN_ROOT}',
            '--shell=bun',
            '--silent',
            'start',
          ],
        },
      },
    },
    null,
    2,
  )}\n`
}

function renderChannelPackageJson(name: string): string {
  return `${jsonStringify(
    {
      name: `claude-channel-${name}`,
      version: '0.1.0',
      type: 'module',
      scripts: { start: 'bun install --no-summary && bun server.ts' },
      dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
    },
    null,
    2,
  )}\n`
}

function renderChannelServerTs(name: string): string {
  return `#!/usr/bin/env bun
/**
 * ${name} channel server — stdio MCP server implementing the channel contract.
 * See https://code.claude.com/docs/en/channels-reference.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const mcp = new Server(
  { name: '${name}', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: { 'claude/channel': {} },
    },
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send a message back to the ${name} channel.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name === 'reply') {
    return { content: [{ type: 'text', text: 'sent' }] }
  }
  return { content: [{ type: 'text', text: 'unknown tool' }], isError: true }
})

await mcp.connect(new StdioServerTransport())
`
}

export function buildPluginScaffoldFiles(opts: {
  name: string
  description?: string
  author?: { name: string; email?: string }
  with?: readonly ScaffoldComponent[]
}): ScaffoldFile[] {
  const { name, description, author } = opts
  const components = opts.with ?? []
  const manifest: Record<string, unknown> = {
    $schema: PLUGIN_MANIFEST_SCHEMA_URL,
    name,
    version: '0.1.0',
    description: description ?? 'TODO: describe what this plugin provides',
    skills: ['./'],
  }
  if (author) {
    manifest.author = author
  }

  const files: ScaffoldFile[] = [
    {
      relPath: join('.claude-plugin', 'plugin.json'),
      contents: '',
    },
    {
      relPath: 'SKILL.md',
      contents: renderSkillTemplate(name),
    },
  ]

  if (components.includes('skills')) {
    files.push({
      relPath: join('skills', 'example', 'SKILL.md'),
      contents: renderSkillTemplate('example'),
    })
  }
  if (components.includes('agents')) {
    files.push({
      relPath: join('agents', 'example.md'),
      contents: renderAgentTemplate(),
    })
  }
  if (components.includes('hooks')) {
    files.push(
      {
        relPath: join('hooks', 'hooks.json'),
        contents: renderHooksJson(),
      },
      {
        relPath: join('hooks-handlers', 'on-session-start.ts'),
        contents: renderHookHandlerTs(),
        mode: 0o755,
      },
    )
  }
  if (components.includes('mcp') && !components.includes('channel')) {
    files.push({
      relPath: '.mcp.json',
      contents: renderMcpJson(),
    })
  }
  if (components.includes('lsp')) {
    files.push({
      relPath: '.lsp.json',
      contents: renderLspJson(),
    })
  }
  if (components.includes('output-style')) {
    files.push({
      relPath: join('output-styles', `${name}.md`),
      contents: renderOutputStyleTemplate(name),
    })
  }
  if (components.includes('channel')) {
    manifest.channels = [{ server: name, displayName: name }]
    files.push(
      {
        relPath: '.mcp.json',
        contents: renderChannelMcpJson(name),
      },
      {
        relPath: 'server.ts',
        contents: renderChannelServerTs(name),
      },
      {
        relPath: 'package.json',
        contents: renderChannelPackageJson(name),
      },
    )
  }

  files[0]!.contents = `${jsonStringify(manifest, null, 2)}\n`
  return files
}

export async function writePluginScaffoldFiles(
  targetDir: string,
  files: readonly ScaffoldFile[],
  options: { force?: boolean } = {},
): Promise<{ ok: true; skipped: string[] } | { ok: false; error: string }> {
  const root = resolve(targetDir)
  if (!options.force) {
    try {
      await mkdir(join(root, '.claude-plugin'))
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EEXIST') {
        return {
          ok: false,
          error: `${join(root, '.claude-plugin')} already exists. Use --force to overwrite.`,
        }
      }
      if (code !== 'ENOENT') throw err
    }
  }

  const skipped: string[] = []
  for (const file of files) {
    const absPath = resolve(root, file.relPath)
    const rel = relative(root, absPath)
    if (rel.startsWith(`..${sep}`) || rel === '..') {
      return {
        ok: false,
        error: `Refusing to write outside ${root}: ${file.relPath}`,
      }
    }
    await mkdir(dirname(absPath), { recursive: true })
    if (options.force) {
      await writeFile(absPath, file.contents, { mode: file.mode })
    } else {
      try {
        await writeFile(absPath, file.contents, {
          flag: 'wx',
          mode: file.mode,
        })
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        skipped.push(file.relPath)
      }
    }
  }
  return { ok: true, skipped }
}

async function readGitConfigValue(key: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', key], {
      timeout: 3000,
    })
    const trimmed = stdout.trim()
    return trimmed.length > 0 ? trimmed : undefined
  } catch {
    return undefined
  }
}

export async function pluginInitHandler(
  name: string,
  options: {
    description?: string
    author?: string
    authorEmail?: string
    with?: string[]
    force?: boolean
    targetBaseDir?: string
  } = {},
): Promise<void> {
  const nameErr = validateInitPluginName(name)
  if (nameErr) {
    return cliError(`Invalid plugin name "${name}": ${nameErr}`)
  }

  const components: ScaffoldComponent[] = []
  for (const comp of options.with ?? []) {
    if ((SCAFFOLD_COMPONENTS as readonly string[]).includes(comp)) {
      components.push(comp as ScaffoldComponent)
    } else {
      return cliError(
        `Unknown --with component "${comp}". Valid: ${SCAFFOLD_COMPONENTS.join(', ')}`,
      )
    }
  }

  const skillsBase = resolve(
    options.targetBaseDir ?? join(getClaudeConfigHomeDir(), 'skills'),
  )
  const targetDir = resolve(skillsBase, name)
  if (relative(skillsBase, targetDir).startsWith('..')) {
    return cliError(`Plugin name "${name}" would write outside ${skillsBase}`)
  }

  const authorName = options.author ?? (await readGitConfigValue('user.name'))
  const authorEmail =
    options.authorEmail ?? (await readGitConfigValue('user.email'))
  if (!authorName && options.authorEmail) {
    process.stderr.write(
      'Warning: --author-email was ignored because no author name was found. Pass --author or set git config user.name.\n',
    )
  }

  const author = authorName
    ? authorEmail
      ? { name: authorName, email: authorEmail }
      : { name: authorName }
    : undefined

  const files = buildPluginScaffoldFiles({
    name,
    description: options.description,
    author,
    with: components,
  })

  try {
    const result = await writePluginScaffoldFiles(targetDir, files, {
      force: options.force,
    })
    if (!result.ok) {
      return cliError(result.error)
    }
    const lines: string[] = []
    for (const skippedPath of result.skipped) {
      lines.push(`  kept existing ${skippedPath} (use --force to overwrite)`)
    }
    const pluginId = `${name}@skills-dir`
    lines.push(`Created plugin "${name}" at ${targetDir}`)
    lines.push(
      `  It will auto-load next session as ${pluginId}. Run /reload-plugins to load it now.`,
    )
    lines.push(
      `  Disable: claude plugin disable ${pluginId}. Remove: delete the directory.`,
    )
    return cliOk(lines.join('\n'))
  } catch (err) {
    return cliError(`Couldn't create the plugin files: ${errorMessage(err)}`)
  }
}
