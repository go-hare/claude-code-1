export type MainLaunchMode =
  | 'headless'
  | 'continue'
  | 'ssh-remote'
  | 'assistant-chat'
  | 'resume-like'
  | 'interactive'

export function determineMainLaunchMode(options: {
  isNonInteractiveSession: boolean
  continueRequested: boolean
  hasPendingSsh: boolean
  hasPendingAssistantChat: boolean
  hasResumeLikeRequest: boolean
}): MainLaunchMode {
  const {
    isNonInteractiveSession,
    continueRequested,
    hasPendingSsh,
    hasPendingAssistantChat,
    hasResumeLikeRequest,
  } = options

  if (isNonInteractiveSession) {
    return 'headless'
  }
  if (continueRequested) {
    return 'continue'
  }
  if (hasPendingSsh) {
    return 'ssh-remote'
  }
  if (hasPendingAssistantChat) {
    return 'assistant-chat'
  }
  if (hasResumeLikeRequest) {
    return 'resume-like'
  }
  return 'interactive'
}
