/**
 * Official 2.1.207: headersHelper is shell-executed; ${user_config.*} must not
 * be substituted into it. Plugin vars + env expansion only.
 */
import { describe, expect, test } from 'bun:test'
import type { PluginError } from 'src/types/plugin.js'
import { resolvePluginMcpEnvironment } from '../mcpPluginIntegration.js'

describe('headersHelper user_config reject (2.1.207)', () => {
  test('rejects headersHelper that embeds user_config when options exist', () => {
    const errors: PluginError[] = []
    const result = resolvePluginMcpEnvironment(
      {
        type: 'http',
        url: 'https://example.com/mcp',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: plugin placeholder syntax under test
        headersHelper: 'echo ${user_config.token}',
      },
      { path: '/plugins/demo', source: 'demo@marketplace' },
      { token: 'secret' },
      errors,
      'demo',
      'remote',
    )

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      type: 'mcp-config-invalid',
      plugin: 'demo',
      serverName: 'remote',
    })
    if (errors[0]?.type === 'mcp-config-invalid') {
      expect(errors[0].validationError).toContain('headersHelper')
      expect(errors[0].validationError).toContain('user_config')
      expect(errors[0].validationError).toContain('shell')
    }
    // Original helper left unchanged when rejected
    if (result.type === 'http') {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: plugin placeholder syntax under test
      expect(result.headersHelper).toBe('echo ${user_config.token}')
    }
  })

  test('substitutes plugin root into headersHelper without user_config', () => {
    const errors: PluginError[] = []
    const result = resolvePluginMcpEnvironment(
      {
        type: 'http',
        url: 'https://example.com/mcp',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: plugin placeholder syntax under test
        headersHelper: '${CLAUDE_PLUGIN_ROOT}/bin/headers.sh',
      },
      { path: '/plugins/demo', source: 'demo@marketplace' },
      undefined,
      errors,
      'demo',
      'remote',
    )

    expect(errors).toHaveLength(0)
    if (result.type === 'http') {
      expect(result.headersHelper).toBe('/plugins/demo/bin/headers.sh')
    }
  })

  test('still substitutes user_config in headers map (not shell)', () => {
    const result = resolvePluginMcpEnvironment(
      {
        type: 'http',
        url: 'https://example.com/mcp',
        headers: {
          // biome-ignore lint/suspicious/noTemplateCurlyInString: plugin placeholder syntax under test
          Authorization: 'Bearer ${user_config.token}',
        },
      },
      { path: '/plugins/demo', source: 'demo@marketplace' },
      { token: 'secret-token' },
    )

    if (result.type === 'http') {
      expect(result.headers?.Authorization).toBe('Bearer secret-token')
    }
  })
})
