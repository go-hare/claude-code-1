import type { Command } from '../../commands.js'

/**
 * densable `setup-bedrock` — local-jsx wizard to reconfigure Amazon Bedrock
 * authentication, region, or model pins (2.1.218 #17).
 */
const command = {
  type: 'local-jsx',
  name: 'setup-bedrock',
  description:
    'Reconfigure Amazon Bedrock authentication, region, or model pins',
  immediate: true,
  load: () => import('./setup-bedrock.js'),
} satisfies Command

export default command
