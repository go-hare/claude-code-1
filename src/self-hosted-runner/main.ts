/**
 * densable 2.1.224 `claude self-hosted-runner` CLI router.
 *
 * densable dispatch (cli fast-path, no feature gate):
 *   orchestrator | setup | doctor | code-sign | decode-token | (root runner)
 */
import { selfHostedRunnerCodeSignMain } from './codeSign.js'
import { selfHostedRunnerDecodeTokenMain } from './decodeToken.js'
import { selfHostedRunnerOrchestratorMain } from './orchestrator.js'
import { selfHostedRunnerMain } from './rootRunner.js'
import {
  selfHostedRunnerDoctorMain,
  selfHostedRunnerSetupMain,
} from './setupDoctor.js'

export async function selfHostedRunnerCliMain(args: string[]): Promise<void> {
  const sub = args[0]
  if (sub === 'decode-token') {
    await selfHostedRunnerDecodeTokenMain(args.slice(1))
    return
  }
  if (sub === 'code-sign') {
    await selfHostedRunnerCodeSignMain(args.slice(1))
    return
  }
  if (sub === 'orchestrator') {
    await selfHostedRunnerOrchestratorMain(args.slice(1))
    return
  }
  if (sub === 'setup') {
    await selfHostedRunnerSetupMain(args.slice(1))
    return
  }
  if (sub === 'doctor') {
    await selfHostedRunnerDoctorMain(args.slice(1))
    return
  }
  // densable root: selfHostedRunnerMain(args)
  await selfHostedRunnerMain(args)
}
