import type { Command } from '../../types/command.js'

const workflows = {
  type: 'local-jsx',
  name: 'workflows',
  // densable: "Browse dynamic workflow history (running and completed)"
  description: 'Browse dynamic workflow history (running and completed)',
  // 延迟加载面板实现，避免启动时拉入 Ink/React 依赖。
  load: () => import('../../workflow/panel/panelCall.js'),
} satisfies Command

export default workflows
