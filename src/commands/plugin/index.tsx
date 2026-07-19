import type { Command } from '../../commands.js';

const plugin = {
  type: 'local-jsx',
  name: 'plugin',
  aliases: ['plugins', 'marketplace'],
  description: 'Manage Claude Code plugins',
  immediate: true,
  // densable fOy: getArgumentCompletions → command-arg typeahead after space
  getArgumentCompletions: (argsSoFar, partial) =>
    import('./argumentCompletions.js').then(m => m.getPluginArgumentCompletions(argsSoFar, partial)),
  load: () => import('./plugin.js'),
} satisfies Command;

export default plugin;
