import type { Command } from '../../commands.js'
import { validateAllowedProvider } from '../../utils/auth.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

/**
 * Official 2.1.331 `Qio` — `/setup-vertex` wizard to configure Google Vertex AI
 * authentication, project, region, or pinned models.
 */
const setupVertex = {
  type: 'local-jsx',
  name: 'setup-vertex',
  description:
    'Change Google Vertex AI authentication, project, region, or pinned models',
  isEnabled: () => validateAllowedProvider('vertex').valid,
  get isHidden(): boolean {
    return !isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
  },
  load: () => import('./setup-vertex.js'),
} satisfies Command

export default setupVertex
