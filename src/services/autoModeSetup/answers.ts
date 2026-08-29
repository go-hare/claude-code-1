/**
 * densable Nrn / kqi — wizard answers → recon scope flags.
 * Gold: gold-function_Nrn_-0.txt · gold-wide-Nrn.txt
 */
export type AutoModeSetupAnswers = {
  posture: 'enterprise' | 'open-source' | 'personal' | 'mixed'
  scope: 'all' | 'project'
  depth: 'both' | 'shell' | 'repos' | 'here'
}

export type AutoModeReconFlags = {
  allProjects: boolean
  shellHistory: boolean
  homeRepos: boolean
}

/** densable kqi */
export const DEFAULT_RECON_FLAGS: Readonly<AutoModeReconFlags> = Object.freeze({
  allProjects: false,
  shellHistory: false,
  homeRepos: false,
})

/** densable Nrn */
export function answersToReconFlags(
  answers: AutoModeSetupAnswers | undefined,
): AutoModeReconFlags {
  if (
    answers === undefined ||
    (answers.scope !== 'all' && answers.scope !== 'project')
  ) {
    return { ...DEFAULT_RECON_FLAGS }
  }
  const allProjects = answers.scope === 'all'
  switch (answers.depth) {
    case 'both':
      return { allProjects, shellHistory: true, homeRepos: true }
    case 'shell':
      return { allProjects, shellHistory: true, homeRepos: false }
    case 'repos':
      return { allProjects, shellHistory: false, homeRepos: true }
    case 'here':
      return { allProjects, shellHistory: false, homeRepos: false }
    default:
      return { ...DEFAULT_RECON_FLAGS }
  }
}
