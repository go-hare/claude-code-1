/**
 * densable 2.1.224 #1 — setup/doctor (Dqv/Lqv) prompts + argv.
 */
import { describe, expect, test } from 'bun:test'
import {
  DOCTOR_FIRST_MESSAGE,
  DOCTOR_TOOLS,
  SETUP_FIRST_MESSAGE,
  SETUP_TOOLS,
  buildDoctorSystemPrompt,
  buildSetupDoctorChildArgs,
  buildSetupSystemPrompt,
  formatDoctorHelp,
  formatSetupHelp,
} from '../setupDoctor.js'

describe('densable 2.1.224 #1 setup/doctor tools + messages', () => {
  test('Pqv setup tools', () => {
    expect(SETUP_TOOLS).toContain('self_hosted_runner_spawn_local')
    expect(SETUP_TOOLS).toContain('Bash')
    expect(SETUP_TOOLS).not.toContain('self_hosted_runner_requeue_session')
  })

  test('Hqv doctor tools', () => {
    expect(DOCTOR_TOOLS).toContain('self_hosted_runner_requeue_session')
    expect(DOCTOR_TOOLS).toContain('self_hosted_runner_list_sessions')
    expect(DOCTOR_TOOLS).not.toContain('self_hosted_runner_spawn_local')
  })

  test('first messages (Oqv/Mqv)', () => {
    expect(SETUP_FIRST_MESSAGE).toContain('Phase 1')
    expect(DOCTOR_FIRST_MESSAGE).toContain('8 diagnostic categories')
  })
})

describe('densable 2.1.224 #1 setup/doctor prompts', () => {
  test('setup prompt injects origin (t2h)', () => {
    const p = buildSetupSystemPrompt('https://claude.ai')
    expect(p).toContain('https://claude.ai/admin-settings/claude-code')
    expect(p).toContain('self_hosted_runner_spawn_local')
    // densable SEA placeholders — constructed so Biome noTemplateCurlyInString is quiet
    expect(p).not.toContain('${' + 'e}')
  })

  test('doctor prompt injects api base + host (i2h)', () => {
    const p = buildDoctorSystemPrompt('https://api.anthropic.com')
    expect(p).toContain('api.anthropic.com')
    expect(p).toContain('self_hosted_runner_requeue_session')
    expect(p).not.toContain('${' + 'e}')
    expect(p).not.toContain('${' + 't}')
  })
})

describe('densable 2.1.224 #1 setup/doctor child argv', () => {
  test('includes append-system-prompt + tools + default first message', () => {
    const args = buildSetupDoctorChildArgs({
      kind: 'setup',
      argv: [],
      execArgs: [],
    })
    expect(args).toContain(SETUP_FIRST_MESSAGE)
    expect(args).toContain('--append-system-prompt')
    expect(args).toContain('--tools')
    expect(args).toContain(SETUP_TOOLS)
    expect(args).toContain('--permission-mode')
    expect(args).toContain('default')
  })

  test('positional first arg skips default first message', () => {
    const args = buildSetupDoctorChildArgs({
      kind: 'doctor',
      argv: ['quick'],
      execArgs: [],
    })
    expect(args).not.toContain(DOCTOR_FIRST_MESSAGE)
    expect(args).toContain('quick')
    expect(args).toContain(DOCTOR_TOOLS)
  })

  test('help text', () => {
    expect(formatSetupHelp()).toContain('self-hosted-runner setup')
    expect(formatDoctorHelp()).toContain('self-hosted-runner doctor')
  })
})
