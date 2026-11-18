import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import reloadSkills from 'src/commands/reloadSkills.js'
import { isVerifyOrReviewSkillName } from 'src/skills/loadSkillsDir.js'
import { buildInheritedCliArgParts } from 'src/utils/swarm/spawnUtils.js'
import { extractCcrSiteAnswerErrorType } from '../WebFetchTool/WebFetchTool.js'
import {
  diagnoseDiskFullOnCommandFailure,
  TempDirVolumeFullError,
} from '../BashTool/utils.js'

describe('Wave 2 Tools/Skills/Swarm alignment', () => {
  test('#896 design-sync SKILL.md includes December 14, 2026 sunset notice', () => {
    const content = readFileSync(
      join(process.cwd(), 'src/skills/bundled/design-sync/SKILL.md'),
      'utf8',
    )
    expect(content).toContain('December 14, 2026')
    expect(content).toContain('Claude Design now lives in Claude')
  })

  test('#1016 /reload-skills reports diff without claiming full skill list re-send', async () => {
    const mod = await reloadSkills.load()
    const res = await mod.call()
    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.value).toMatch(/^Reloaded skills: \d+ skills? available \(/)
      expect(res.value).not.toContain('full skill list')
    }
  })

  test('#1092 extractCcrSiteAnswerErrorType normalizes target 4xx and robots_disallowed errors', () => {
    const target404 = new Error(
      `${JSON.stringify({ error_type: 'url_not_found', source: 'target', message: '404' })} [web-fetch-ccr-proxy]`,
    )
    expect(extractCcrSiteAnswerErrorType(target404)).toBe('url_not_found')

    const robots = new Error(
      `${JSON.stringify({ error_type: 'ROBOTS_DISALLOWED', source: 'target', message: 'blocked' })} [web-fetch-ccr-proxy]`,
    )
    expect(extractCcrSiteAnswerErrorType(robots)).toBe('robots_disallowed')

    const proxyErr = new Error(
      `${JSON.stringify({ error_type: 'rate_limit_exceeded', source: 'proxy', message: 'limit' })} [web-fetch-ccr-proxy]`,
    )
    expect(extractCcrSiteAnswerErrorType(proxyErr)).toBeUndefined()
  })

  test('#1138 buildInheritedCliArgParts forwards --disallowed-tools and --tools', () => {
    const args = buildInheritedCliArgParts({
      disallowedTools: ['Bash(rm *)', 'WebFetch'],
      tools: ['Read', 'Edit'],
    })
    expect(args).toContain('--disallowed-tools')
    expect(args).toContain('Bash(rm *)')
    expect(args).toContain('WebFetch')
    expect(args).toContain('--tools')
    expect(args).toContain('Read')
    expect(args).toContain('Edit')
  })

  test('#1145 isVerifyOrReviewSkillName matches verify and code-review only', () => {
    expect(isVerifyOrReviewSkillName('verify')).toBe(true)
    expect(isVerifyOrReviewSkillName('code-review')).toBe(true)
    expect(isVerifyOrReviewSkillName('commit')).toBe(false)
  })

  test('#1163 TempDirVolumeFullError and diagnoseDiskFullOnCommandFailure', async () => {
    const err = new TempDirVolumeFullError('/tmp/claude-1000', '/tmp', 'ENOSPC')
    expect(err.name).toBe('TempDirVolumeFullError')
    expect(err.code).toBe('ENOSPC')
    expect(err.message).toContain('CLAUDE_CODE_TMPDIR')
    expect(err.shortMessage).toBe(
      'claude temp dir not created: volume full (ENOSPC/EDQUOT)',
    )

    // Healthy local volume with non-empty stdout returns null
    const res = await diagnoseDiskFullOnCommandFailure(
      join(process.cwd(), 'package.json'),
      false,
      '/tmp',
    )
    expect(res).toBeNull()
  })
})
