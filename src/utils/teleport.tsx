import axios from 'axios';
import chalk from 'chalk';
import { randomUUID } from 'crypto';
import React from 'react';
import { getIsNonInteractiveSession, getOriginalCwd, getSessionId } from 'src/bootstrap/state.js';
import { checkGate_CACHED_OR_BLOCKING } from 'src/services/analytics/growthbook.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { isPolicyAllowed } from 'src/services/policyLimits/index.js';
import { z } from 'zod/v4';
import { getTeleportErrors, TeleportError, type TeleportLocalErrorType } from '../components/TeleportError.js';
import { getOauthConfig } from '../constants/oauth.js';
import { getTrustedDeviceToken } from '../bridge/trustedDevice.js';
import { toCompatSessionId, toInfraSessionId } from '../bridge/sessionIdCompat.js';
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js';
import type { Root } from '@anthropic/ink';
import { KeybindingSetup } from '../keybindings/KeybindingProviderSetup.js';
import { queryHaiku } from '../services/api/claude.js';
import { getSessionLogsViaOAuth, getTeleportEvents } from '../services/api/sessionIngress.js';
import { getOrganizationUUID } from '../services/oauth/client.js';
import { AppStateProvider } from '../state/AppState.js';
import type { Message, SystemMessage } from '../types/message.js';
import type { PermissionMode } from '../types/permissions.js';
import { getInitialAdvisorSetting } from './advisor.js';
import { checkAndRefreshOAuthTokenIfNeeded, getClaudeAIOAuthTokens } from './auth.js';
import { checkGithubAppPreflight } from './background/remote/preconditions.js';
import { getCurrentProjectConfig, getGlobalConfig, saveCurrentProjectConfig, saveGlobalConfig } from './config.js';
import { deserializeMessages, type TeleportRemoteResponse } from './conversationRecovery.js';
import { getCwd } from './cwd.js';
import { logForDebugging } from './debug.js';
import { detectCurrentRepositoryWithHost, parseGitHubRepository, parseGitRemote } from './detectRepository.js';
import { isEnvTruthy } from './envUtils.js';
import { errorMessage, isAbortError, TeleportOperationError, toError } from './errors.js';
import { execFileNoThrow, execFileNoThrowWithCwd } from './execFileNoThrow.js';
import { getSessionBriefTranscript, isFocusViewActive } from './focusView.js';
import { truncateToWidth } from './format.js';
import { findGitRoot, getDefaultBranch, getIsClean, gitExe } from './git.js';
import { safeParseJSON } from './json.js';
import { logError } from './log.js';
import { createSystemMessage, createUserMessage } from './messages.js';
import { getMainLoopModel } from './model/model.js';
import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from './model/providers.js';
import { isTranscriptMessage } from './sessionStorage.js';
import { getInitialSettings } from './settings/settings.js';
import { sleep } from './sleep.js';
import { jsonStringify } from './slowOperations.js';
import { asSystemPrompt } from './systemPromptType.js';
import {
  fetchSession,
  type GitRepositoryOutcome,
  type GitSource,
  getAccessTokenWithCcrFallback,
  getBranchFromSession,
  getOAuthHeaders,
  isTransientNetworkError,
  type SessionResource,
} from './teleport/api.js';
import { createDefaultCloudEnvironment, fetchEnvironments } from './teleport/environments.js';
import { createAndUploadGitBundle } from './teleport/gitBundle.js';
import { isTrustedPoolEnvironment, resolveDefaultPoolEnvironment } from './teleport/pool.js';

export type TeleportResult = {
  messages: Message[];
  branchName: string;
};

export type TeleportProgressStep = 'validating' | 'fetching_logs' | 'fetching_branch' | 'checking_out' | 'done';

export type TeleportProgressCallback = (step: TeleportProgressStep) => void;

/**
 * Creates a system message to inform about teleport session resume
 * @returns SystemMessage indicating session was resumed from another machine
 */
function createTeleportResumeSystemMessage(branchError: Error | null): SystemMessage {
  if (branchError === null) {
    return createSystemMessage('Session resumed', 'suggestion');
  }
  const formattedError =
    branchError instanceof TeleportOperationError ? branchError.formattedMessage : branchError.message;
  return createSystemMessage(`Session resumed without branch: ${formattedError}`, 'warning');
}

/**
 * Creates a user message to inform the model about teleport session resume
 * @returns User message indicating session was resumed from another machine
 */
function createTeleportResumeUserMessage() {
  return createUserMessage({
    content: `This session is being continued from another machine. Application state may have changed. The updated working directory is ${getOriginalCwd()}`,
    isMeta: true,
  });
}

type TeleportToRemoteResponse = {
  id: string;
  title: string;
};

type TeleportCreateEvent = {
  type: 'event';
  data: Record<string, unknown>;
};

/**
 * densable eHu — initial CreateSession events:
 * 1. set_permission_mode when permissionMode set
 * 2. apply_flag_settings viewMode:focus when interactive + focus active (X7t)
 * 3. apply_flag_settings advisorModel when advisor setting present (bro)
 * 4. initial user message when non-empty string (or non-empty content array)
 */
function buildTeleportCreateEvents(opts: {
  initialMessage: string | null | undefined;
  initialMessageUuid?: string;
  permissionMode?: PermissionMode;
  ultraplan?: boolean;
}): TeleportCreateEvent[] {
  const events: TeleportCreateEvent[] = [];
  if (opts.permissionMode) {
    events.push({
      type: 'event',
      data: {
        type: 'control_request',
        request_id: `set-mode-${randomUUID()}`,
        request: {
          subtype: 'set_permission_mode',
          mode: opts.permissionMode,
          ultraplan: opts.ultraplan,
        },
      },
    });
  }
  // densable: if (!dn() && X7t()) — interactive + focus
  if (!getIsNonInteractiveSession()) {
    const settings = getInitialSettings();
    if (isFocusViewActive(settings.viewMode, getSessionBriefTranscript() ?? settings.briefTranscript)) {
      events.push({
        type: 'event',
        data: {
          type: 'control_request',
          request_id: `apply-flag-settings-${randomUUID()}`,
          request: {
            subtype: 'apply_flag_settings',
            settings: { viewMode: 'focus' },
          },
        },
      });
    }
  }
  const advisorModel = getInitialAdvisorSetting();
  if (advisorModel) {
    events.push({
      type: 'event',
      data: {
        type: 'control_request',
        request_id: `apply-flag-settings-${randomUUID()}`,
        request: {
          subtype: 'apply_flag_settings',
          settings: { advisorModel },
        },
      },
    });
  }
  const msg = opts.initialMessage;
  const hasInitial = typeof msg === 'string' ? msg.length > 0 : Array.isArray(msg) && (msg as unknown[]).length > 0;
  if (hasInitial) {
    events.push({
      type: 'event',
      data: {
        uuid: opts.initialMessageUuid ?? randomUUID(),
        session_id: '',
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: msg,
        },
      },
    });
  }
  return events;
}

/**
 * densable ZCu — post-create client observability + config flags:
 *   O("tengu_ccr_session_link", ...)
 *   if (project && !kp().hasUsedRemoteSession) i0(hasUsedRemoteSession:true)
 *   if (global && !At().hasRemoteEnvironment) cr(hasRemoteEnvironment:true)
 * Explicit ultrareview path: project:false, global:false (analytics only).
 * Non-explicit: project = gitSource && sourceReason!=="github_preflight_failed";
 *               global = seedBundleFileId === null
 */
function recordCcrSessionLink(
  sessionId: string,
  source: string | undefined,
  flags: { project: boolean; global: boolean },
  opts: { endpoint: string; grouped: boolean },
): void {
  logEvent('tengu_ccr_session_link', {
    ccr_session_id: sessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    source: (source ?? '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    create_endpoint: opts.endpoint as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    grouped: opts.grouped,
  });
  if (flags.project && !getCurrentProjectConfig().hasUsedRemoteSession) {
    saveCurrentProjectConfig(o => (o.hasUsedRemoteSession ? o : { ...o, hasUsedRemoteSession: true }));
  }
  if (flags.global && !getGlobalConfig().hasRemoteEnvironment) {
    saveGlobalConfig(o => (o.hasRemoteEnvironment ? o : { ...o, hasRemoteEnvironment: true }));
  }
}

/** densable FCu — sessionGroupingId is only valid when not githubPr-bound. */
function isSessionGroupingEligible(opts: { githubPr?: unknown }): boolean {
  return opts.githubPr == null;
}

/** densable Yes — project/sessionGrouping create-fail copy from server error. */
function sessionGroupingCreateFailMessage(
  groupingId: string,
  err: { type?: string; resource_type?: string; reason?: string } | undefined,
): string | undefined {
  if (err?.type === 'not_found_error' && err.resource_type === 'session_grouping') {
    return `Project not found: ${groupingId}. Check the id — a Project you don't have access to looks the same as one that doesn't exist.`;
  }
  switch (err?.reason) {
    case 'public_grouping_hosted_only':
      return `${groupingId} is a public Project, and public Projects run on Anthropic-hosted infrastructure only. Pick an Anthropic-managed cloud environment, or use a private Project.`;
    case 'feature_disabled':
      return 'Projects are not available for your organization.';
    default:
      return undefined;
  }
}

/** densable _8("allow_remote_sessions","Cloud sessions","are") deny copy. */
function remoteSessionsPolicyDenyMessage(): string | null {
  if (isPolicyAllowed('allow_remote_sessions')) return null;
  return "Cloud sessions are disabled by your organization's policy. Contact your organization admin to enable them.";
}

const SESSION_TITLE_AND_BRANCH_PROMPT = `You are coming up with a succinct title and git branch name for a coding session based on the provided description. The title should be clear, concise, and accurately reflect the content of the coding task.
You should keep it short and simple, ideally no more than 6 words. Avoid using jargon or overly technical terms unless absolutely necessary. The title should be easy to understand for anyone reading it.
Use sentence case for the title (capitalize only the first word and proper nouns), not Title Case.

The branch name should be clear, concise, and accurately reflect the content of the coding task.
You should keep it short and simple, ideally no more than 4 words. The branch should always start with "claude/" and should be all lower case, with words separated by dashes.

Return a JSON object with "title" and "branch" fields.

Example 1: {"title": "Fix login button not working on mobile", "branch": "claude/fix-mobile-login-button"}
Example 2: {"title": "Update README with installation instructions", "branch": "claude/update-readme"}
Example 3: {"title": "Improve performance of data processing script", "branch": "claude/improve-data-processing"}

Here is the session description:
<description>{description}</description>
Please generate a title and branch name for this session.`;

type TitleAndBranch = {
  title: string;
  branchName: string;
};

/**
 * Generates a title and branch name for a coding session using Claude Haiku
 * @param description The description/prompt for the session
 * @returns Promise<TitleAndBranch> The generated title and branch name
 */
async function generateTitleAndBranch(description: string, signal: AbortSignal): Promise<TitleAndBranch> {
  const fallbackTitle = truncateToWidth(description, 75);
  const fallbackBranch = 'claude/task';

  try {
    const userPrompt = SESSION_TITLE_AND_BRANCH_PROMPT.replace('{description}', description);

    const response = await queryHaiku({
      systemPrompt: asSystemPrompt([]),
      userPrompt,
      outputFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            branch: { type: 'string' },
          },
          required: ['title', 'branch'],
          additionalProperties: false,
        },
      },
      signal,
      options: {
        querySource: 'teleport_generate_title',
        agents: [],
        isNonInteractiveSession: false,
        hasAppendSystemPrompt: false,
        mcpTools: [],
      },
    });

    // Extract text from the response
    const firstBlock = response.message!.content?.[0] as { type?: string; text?: string } | undefined;
    if (firstBlock?.type !== 'text') {
      return { title: fallbackTitle, branchName: fallbackBranch };
    }

    const parsed = safeParseJSON(firstBlock.text!.trim());
    const parseResult = z.object({ title: z.string(), branch: z.string() }).safeParse(parsed);
    if (parseResult.success) {
      return {
        title: parseResult.data.title || fallbackTitle,
        branchName: parseResult.data.branch || fallbackBranch,
      };
    }

    return { title: fallbackTitle, branchName: fallbackBranch };
  } catch (error) {
    logError(new Error(`Error generating title and branch: ${error}`));
    return { title: fallbackTitle, branchName: fallbackBranch };
  }
}

/**
 * Validates that the git working directory is clean (ignoring untracked files)
 * Untracked files are ignored because they won't be lost during branch switching
 */
export async function validateGitState(): Promise<void> {
  const isClean = await getIsClean({ ignoreUntracked: true });
  if (!isClean) {
    logEvent('tengu_teleport_error_git_not_clean', {});
    const error = new TeleportOperationError(
      'Git working directory is not clean. Please commit or stash your changes before using --teleport.',
      chalk.red(
        'Error: Git working directory is not clean. Please commit or stash your changes before using --teleport.\n',
      ),
    );
    throw error;
  }
}

/**
 * Fetches a specific branch from remote origin
 * @param branch The branch to fetch. If not specified, fetches all branches.
 */
async function fetchFromOrigin(branch?: string): Promise<void> {
  const fetchArgs = branch ? ['fetch', 'origin', `${branch}:${branch}`] : ['fetch', 'origin'];

  const { code: fetchCode, stderr: fetchStderr } = await execFileNoThrow(gitExe(), fetchArgs);
  if (fetchCode !== 0) {
    // If fetching a specific branch fails, it might not exist locally yet
    // Try fetching just the ref without mapping to local branch
    if (branch && fetchStderr.includes('refspec')) {
      logForDebugging(`Specific branch fetch failed, trying to fetch ref: ${branch}`);
      const { code: refFetchCode, stderr: refFetchStderr } = await execFileNoThrow(gitExe(), [
        'fetch',
        'origin',
        branch,
      ]);
      if (refFetchCode !== 0) {
        logError(new Error(`Failed to fetch from remote origin: ${refFetchStderr}`));
      }
    } else {
      logError(new Error(`Failed to fetch from remote origin: ${fetchStderr}`));
    }
  }
}

/**
 * Ensures that the current branch has an upstream set
 * If not, sets it to origin/<branchName> if that remote branch exists
 */
async function ensureUpstreamIsSet(branchName: string): Promise<void> {
  // Check if upstream is already set
  const { code: upstreamCheckCode } = await execFileNoThrow(gitExe(), [
    'rev-parse',
    '--abbrev-ref',
    `${branchName}@{upstream}`,
  ]);

  if (upstreamCheckCode === 0) {
    // Upstream is already set
    logForDebugging(`Branch '${branchName}' already has upstream set`);
    return;
  }

  // Check if origin/<branchName> exists
  const { code: remoteCheckCode } = await execFileNoThrow(gitExe(), ['rev-parse', '--verify', `origin/${branchName}`]);

  if (remoteCheckCode === 0) {
    // Remote branch exists, set upstream
    logForDebugging(`Setting upstream for '${branchName}' to 'origin/${branchName}'`);
    const { code: setUpstreamCode, stderr: setUpstreamStderr } = await execFileNoThrow(gitExe(), [
      'branch',
      '--set-upstream-to',
      `origin/${branchName}`,
      branchName,
    ]);

    if (setUpstreamCode !== 0) {
      logForDebugging(`Failed to set upstream for '${branchName}': ${setUpstreamStderr}`);
      // Don't throw, just log - this is not critical
    } else {
      logForDebugging(`Successfully set upstream for '${branchName}'`);
    }
  } else {
    logForDebugging(`Remote branch 'origin/${branchName}' does not exist, skipping upstream setup`);
  }
}

/**
 * Checks out a specific branch
 */
async function checkoutBranch(branchName: string): Promise<void> {
  // First try to checkout the branch as-is (might be local)
  let { code: checkoutCode, stderr: checkoutStderr } = await execFileNoThrow(gitExe(), ['checkout', branchName]);

  // If that fails, try to checkout from origin
  if (checkoutCode !== 0) {
    logForDebugging(`Local checkout failed, trying to checkout from origin: ${checkoutStderr}`);

    // Try to checkout the remote branch and create a local tracking branch
    const result = await execFileNoThrow(gitExe(), ['checkout', '-b', branchName, '--track', `origin/${branchName}`]);

    checkoutCode = result.code;
    checkoutStderr = result.stderr;

    // If that also fails, try without -b in case the branch exists but isn't checked out
    if (checkoutCode !== 0) {
      logForDebugging(`Remote checkout with -b failed, trying without -b: ${checkoutStderr}`);
      const finalResult = await execFileNoThrow(gitExe(), ['checkout', '--track', `origin/${branchName}`]);
      checkoutCode = finalResult.code;
      checkoutStderr = finalResult.stderr;
    }
  }

  if (checkoutCode !== 0) {
    logEvent('tengu_teleport_error_branch_checkout_failed', {});
    throw new TeleportOperationError(
      `Failed to checkout branch '${branchName}': ${checkoutStderr}`,
      chalk.red(`Failed to checkout branch '${branchName}'\n`),
    );
  }

  // After successful checkout, ensure upstream is set
  await ensureUpstreamIsSet(branchName);
}

/**
 * Gets the current branch name
 */
async function getCurrentBranch(): Promise<string> {
  const { stdout: currentBranch } = await execFileNoThrow(gitExe(), ['branch', '--show-current']);
  return currentBranch.trim();
}

/**
 * Processes messages for teleport resume, removing incomplete tool_use blocks
 * and adding teleport notice messages
 * @param messages The conversation messages
 * @param error Optional error from branch checkout
 * @returns Processed messages ready for resume
 */
export function processMessagesForTeleportResume(messages: Message[], error: Error | null): Message[] {
  // Shared logic with resume for handling interruped session transcripts
  const deserializedMessages = deserializeMessages(messages);

  // Add user message about teleport resume (visible to model)
  const messagesWithTeleportNotice = [
    ...deserializedMessages,
    createTeleportResumeUserMessage(),
    createTeleportResumeSystemMessage(error),
  ];

  return messagesWithTeleportNotice;
}

/**
 * Checks out the specified branch for a teleported session
 * @param branch Optional branch to checkout
 * @returns The current branch name and any error that occurred
 */
export async function checkOutTeleportedSessionBranch(
  branch?: string,
): Promise<{ branchName: string; branchError: Error | null }> {
  try {
    const currentBranch = await getCurrentBranch();
    logForDebugging(`Current branch before teleport: '${currentBranch}'`);

    if (branch) {
      logForDebugging(`Switching to branch '${branch}'...`);
      await fetchFromOrigin(branch);
      await checkoutBranch(branch);
      const newBranch = await getCurrentBranch();
      logForDebugging(`Branch after checkout: '${newBranch}'`);
    } else {
      logForDebugging('No branch specified, staying on current branch');
    }

    const branchName = await getCurrentBranch();
    return { branchName, branchError: null };
  } catch (error) {
    const branchName = await getCurrentBranch();
    const branchError = toError(error);
    return { branchName, branchError };
  }
}

/**
 * Result of repository validation for teleport
 */
export type RepoValidationResult = {
  status: 'match' | 'mismatch' | 'not_in_repo' | 'no_repo_required' | 'error';
  sessionRepo?: string;
  currentRepo?: string | null;
  /** Host of the session repo (e.g. "github.com" or "ghe.corp.com") — for display only */
  sessionHost?: string;
  /** Host of the current repo (e.g. "github.com" or "ghe.corp.com") — for display only */
  currentHost?: string;
  errorMessage?: string;
};

/**
 * Validates that the current repository matches the session's repository.
 * Returns a result object instead of throwing, allowing the caller to handle mismatches.
 *
 * @param sessionData The session resource to validate against
 * @returns Validation result with status and repo information
 */
export async function validateSessionRepository(sessionData: SessionResource): Promise<RepoValidationResult> {
  const currentParsed = await detectCurrentRepositoryWithHost();
  const currentRepo = currentParsed ? `${currentParsed.owner}/${currentParsed.name}` : null;

  const gitSource = sessionData.session_context.sources.find(
    (source): source is GitSource => source.type === 'git_repository',
  );

  if (!gitSource?.url) {
    // Session has no repo requirement
    logForDebugging(
      currentRepo
        ? 'Session has no associated repository, proceeding without validation'
        : 'Session has no repo requirement and not in git directory, proceeding',
    );
    return { status: 'no_repo_required' };
  }

  const sessionParsed = parseGitRemote(gitSource.url);
  const sessionRepo = sessionParsed
    ? `${sessionParsed.owner}/${sessionParsed.name}`
    : parseGitHubRepository(gitSource.url);
  if (!sessionRepo) {
    return { status: 'no_repo_required' };
  }

  logForDebugging(`Session is for repository: ${sessionRepo}, current repo: ${currentRepo ?? 'none'}`);

  if (!currentRepo) {
    // Not in a git repo, but session requires one
    return {
      status: 'not_in_repo',
      sessionRepo,
      sessionHost: sessionParsed?.host,
      currentRepo: null,
    };
  }

  // Compare both owner/repo and host to avoid cross-instance mismatches.
  // Strip ports before comparing hosts — SSH remotes omit the port while
  // HTTPS remotes may include a non-standard port (e.g. ghe.corp.com:8443),
  // which would cause a false mismatch.
  const stripPort = (host: string): string => host.replace(/:\d+$/, '');
  const repoMatch = currentRepo.toLowerCase() === sessionRepo.toLowerCase();
  const hostMatch =
    !currentParsed ||
    !sessionParsed ||
    stripPort(currentParsed.host.toLowerCase()) === stripPort(sessionParsed.host.toLowerCase());

  if (repoMatch && hostMatch) {
    return {
      status: 'match',
      sessionRepo,
      currentRepo,
    };
  }

  // Repo mismatch — keep sessionRepo/currentRepo as plain "owner/repo" so
  // downstream consumers (e.g. getKnownPathsForRepo) can use them as lookup keys.
  // Include host information in separate fields for display purposes.
  return {
    status: 'mismatch',
    sessionRepo,
    currentRepo,
    sessionHost: sessionParsed?.host,
    currentHost: currentParsed?.host,
  };
}

/**
 * Handles teleporting from a code session ID.
 * Fetches session logs and validates repo.
 * @param sessionId The session ID to resume
 * @param onProgress Optional callback for progress updates
 * @returns The raw session log and branch name
 */
export async function teleportResumeCodeSession(
  sessionId: string,
  onProgress?: TeleportProgressCallback,
): Promise<TeleportRemoteResponse> {
  if (!isPolicyAllowed('allow_remote_sessions')) {
    throw new Error("Remote sessions are disabled by your organization's policy.");
  }

  logForDebugging(`Resuming code session ID: ${sessionId}`);

  try {
    const accessToken = getClaudeAIOAuthTokens()?.accessToken;
    if (!accessToken) {
      logEvent('tengu_teleport_resume_error', {
        error_type: 'no_access_token' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
      throw new Error(
        'Claude Code web sessions require authentication with a Claude.ai account. API key authentication is not sufficient. Please run /login to authenticate, or check your authentication status with /status.',
      );
    }

    // Get organization UUID
    const orgUUID = await getOrganizationUUID();
    if (!orgUUID) {
      logEvent('tengu_teleport_resume_error', {
        error_type: 'no_org_uuid' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
      throw new Error('Unable to get organization UUID for constructing session URL');
    }

    // Fetch and validate repository matches before resuming
    onProgress?.('validating');
    const sessionData = await fetchSession(sessionId);
    const repoValidation = await validateSessionRepository(sessionData);

    switch (repoValidation.status) {
      case 'match':
      case 'no_repo_required':
        // Proceed with teleport
        break;
      case 'not_in_repo': {
        logEvent('tengu_teleport_error_repo_not_in_git_dir_sessions_api', {
          sessionId: sessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
        // Include host for GHE users so they know which instance the repo is on
        const notInRepoDisplay =
          repoValidation.sessionHost && repoValidation.sessionHost.toLowerCase() !== 'github.com'
            ? `${repoValidation.sessionHost}/${repoValidation.sessionRepo}`
            : repoValidation.sessionRepo;
        throw new TeleportOperationError(
          `You must run claude --teleport ${sessionId} from a checkout of ${notInRepoDisplay}.`,
          chalk.red(
            `You must run claude --teleport ${sessionId} from a checkout of ${chalk.bold(notInRepoDisplay)}.\n`,
          ),
        );
      }
      case 'mismatch': {
        logEvent('tengu_teleport_error_repo_mismatch_sessions_api', {
          sessionId: sessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
        // Only include host prefix when hosts actually differ to disambiguate
        // cross-instance mismatches; for same-host mismatches the host is noise.
        const hostsDiffer =
          repoValidation.sessionHost &&
          repoValidation.currentHost &&
          repoValidation.sessionHost.replace(/:\d+$/, '').toLowerCase() !==
            repoValidation.currentHost.replace(/:\d+$/, '').toLowerCase();
        const sessionDisplay = hostsDiffer
          ? `${repoValidation.sessionHost}/${repoValidation.sessionRepo}`
          : repoValidation.sessionRepo;
        const currentDisplay = hostsDiffer
          ? `${repoValidation.currentHost}/${repoValidation.currentRepo}`
          : repoValidation.currentRepo;
        throw new TeleportOperationError(
          `You must run claude --teleport ${sessionId} from a checkout of ${sessionDisplay}.\nThis repo is ${currentDisplay}.`,
          chalk.red(
            `You must run claude --teleport ${sessionId} from a checkout of ${chalk.bold(sessionDisplay)}.\nThis repo is ${chalk.bold(currentDisplay)}.\n`,
          ),
        );
      }
      case 'error':
        throw new TeleportOperationError(
          repoValidation.errorMessage || 'Failed to validate session repository',
          chalk.red(`Error: ${repoValidation.errorMessage || 'Failed to validate session repository'}\n`),
        );
      default: {
        const _exhaustive: never = repoValidation.status;
        throw new Error(`Unhandled repo validation status: ${_exhaustive}`);
      }
    }

    return await teleportFromSessionsAPI(sessionId, orgUUID, accessToken, onProgress, sessionData);
  } catch (error) {
    if (error instanceof TeleportOperationError) {
      throw error;
    }

    const err = toError(error);
    logError(err);
    logEvent('tengu_teleport_resume_error', {
      error_type: 'resume_session_id_catch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });

    throw new TeleportOperationError(err.message, chalk.red(`Error: ${err.message}\n`));
  }
}

/**
 * Helper function to handle teleport prerequisites (authentication and git state)
 * Shows TeleportError dialog rendered into the existing root if needed
 */
async function handleTeleportPrerequisites(root: Root, errorsToIgnore?: Set<TeleportLocalErrorType>): Promise<void> {
  const errors = await getTeleportErrors();
  if (errors.size > 0) {
    // Log teleport errors detected
    logEvent('tengu_teleport_errors_detected', {
      error_types: Array.from(errors).join(',') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errors_ignored: Array.from(errorsToIgnore || []).join(
        ',',
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });

    // Show TeleportError dialog for user interaction
    await new Promise<void>(resolve => {
      root.render(
        <AppStateProvider>
          <KeybindingSetup>
            <TeleportError
              errorsToIgnore={errorsToIgnore}
              onComplete={() => {
                // Log when errors are resolved
                logEvent('tengu_teleport_errors_resolved', {
                  error_types: Array.from(errors).join(
                    ',',
                  ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
                void resolve();
              }}
            />
          </KeybindingSetup>
        </AppStateProvider>,
      );
    });
  }
}

/**
 * Creates a remote Claude.ai session with error handling and UI feedback.
 * Shows prerequisite error dialog in the existing root if needed.
 * @param root The existing Ink root to render dialogs into
 * @param description The description/prompt for the new session (null for no initial prompt)
 * @param signal AbortSignal for cancellation
 * @param branchName Optional branch name for the remote session to use
 * @returns Promise<TeleportToRemoteResponse | null> The created session or null if creation fails
 */
export async function teleportToRemoteWithErrorHandling(
  root: Root,
  description: string | null,
  signal: AbortSignal,
  branchName?: string,
): Promise<TeleportToRemoteResponse | null> {
  const errorsToIgnore = new Set<TeleportLocalErrorType>(['needsGitStash']);
  await handleTeleportPrerequisites(root, errorsToIgnore);
  return teleportToRemote({
    initialMessage: description,
    signal,
    branchName,
    onBundleFail: msg => process.stderr.write(`\n${msg}\n`),
  });
}

/**
 * Fetches session data from the session ingress API (/v1/session_ingress/)
 * Uses session logs instead of SDK events to get the correct message structure
 * @param sessionId The session ID to fetch
 * @param orgUUID The organization UUID
 * @param accessToken The OAuth access token
 * @param onProgress Optional callback for progress updates
 * @param sessionData Optional session data (used to extract branch info)
 * @returns TeleportRemoteResponse with session logs as Message[]
 */
export async function teleportFromSessionsAPI(
  sessionId: string,
  orgUUID: string,
  accessToken: string,
  onProgress?: TeleportProgressCallback,
  sessionData?: SessionResource,
): Promise<TeleportRemoteResponse> {
  const startTime = Date.now();

  try {
    // Fetch session logs via session ingress
    logForDebugging(`[teleport] Starting fetch for session: ${sessionId}`);
    onProgress?.('fetching_logs');

    const logsStartTime = Date.now();
    // Try CCR v2 first (GetTeleportEvents — server dispatches Spanner/
    // threadstore). Fall back to session-ingress if it returns null
    // (endpoint not yet deployed, or transient error). Once session-ingress
    // is gone, the fallback becomes a no-op — getSessionLogsViaOAuth will
    // return null too and we fail with "Failed to fetch session logs".
    let logs = await getTeleportEvents(sessionId, accessToken, orgUUID);
    if (logs === null) {
      logForDebugging('[teleport] v2 endpoint returned null, trying session-ingress');
      logs = await getSessionLogsViaOAuth(sessionId, accessToken, orgUUID);
    }
    logForDebugging(`[teleport] Session logs fetched in ${Date.now() - logsStartTime}ms`);

    if (logs === null) {
      throw new Error('Failed to fetch session logs');
    }

    // Filter to get only transcript messages, excluding sidechain messages
    const filterStartTime = Date.now();
    const messages = logs.filter(entry => isTranscriptMessage(entry) && !entry.isSidechain) as Message[];
    logForDebugging(
      `[teleport] Filtered ${logs.length} entries to ${messages.length} messages in ${Date.now() - filterStartTime}ms`,
    );

    // Extract branch info from session data
    onProgress?.('fetching_branch');
    const branch = sessionData ? getBranchFromSession(sessionData) : undefined;
    if (branch) {
      logForDebugging(`[teleport] Found branch: ${branch}`);
    }

    logForDebugging(`[teleport] Total teleportFromSessionsAPI time: ${Date.now() - startTime}ms`);

    return {
      log: messages,
      branch,
    };
  } catch (error) {
    const err = toError(error);

    // Handle 404 specifically
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      logEvent('tengu_teleport_error_session_not_found_404', {
        sessionId: sessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
      throw new TeleportOperationError(
        `${sessionId} not found.`,
        `${sessionId} not found.\n${chalk.dim('Run /status in Claude Code to check your account.')}`,
      );
    }

    logError(err);

    throw new Error(`Failed to fetch session from Sessions API: ${err.message}`);
  }
}

/**
 * Response type for polling remote session events (uses SDK events format)
 */
export type PollRemoteSessionResponse = {
  newEvents: SDKMessage[];
  lastEventId: string | null;
  branch?: string;
  sessionStatus?: 'idle' | 'running' | 'requires_action' | 'archived';
  /** densable OTe: set when session metadata GET fails (branch/status omitted). */
  metadataFetchError?: string;
};

/**
 * densable OTe pollRemoteSessionEvents.
 * GET /v1/code/sessions/{id}/events with sort_order=asc + cursor (sequence_num).
 * Unwraps event.payload; first-party only; OAuth headers only (no beta/org).
 * Pass previous lastEventId as afterId. skipMetadata skips branch/status GET.
 */
export async function pollRemoteSessionEvents(
  sessionId: string,
  afterId: string | null = null,
  opts?: { skipMetadata?: boolean },
): Promise<PollRemoteSessionResponse> {
  // densable: if (!ou()) throw
  if (getAPIProvider() !== 'firstParty') {
    throw new Error('Cloud sessions are only available on the first-party Anthropic API provider.');
  }
  await checkAndRefreshOAuthTokenIfNeeded();
  // densable o9t — keychain or CLAUDE_CODE_REMOTE fallback
  const accessToken = getAccessTokenWithCcrFallback();
  if (!accessToken) {
    throw new Error('No access token for polling');
  }

  const headers = getOAuthHeaders(accessToken);
  const eventsUrl = `${getOauthConfig().BASE_API_URL}/v1/code/sessions/${sessionId}/events`;

  type CodeEventRow = {
    sequence_num?: number | string;
    payload?: unknown;
  };
  type EventsResponse = {
    data: CodeEventRow[];
    next_cursor?: string | null;
  };

  // Cap is a safety valve against stuck cursors; steady-state is 0–1 pages.
  const MAX_EVENT_PAGES = 50;
  const sdkMessages: SDKMessage[] = [];
  let cursor = afterId;
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const eventsResponse = await axios.get(eventsUrl, {
      headers,
      params: {
        sort_order: 'asc',
        ...(cursor ? { cursor } : {}),
      },
      timeout: 30000,
    });

    if (eventsResponse.status !== 200) {
      throw new Error(`Failed to fetch session events: ${eventsResponse.statusText}`);
    }

    const eventsData: EventsResponse = eventsResponse.data;
    if (!eventsData?.data || !Array.isArray(eventsData.data)) {
      throw new Error('Invalid events response');
    }

    for (const row of eventsData.data) {
      // densable: advance cursor from sequence_num when present
      if (row?.sequence_num !== undefined) {
        cursor = String(row.sequence_num);
      }
      const payload = row?.payload;
      if (payload && typeof payload === 'object' && 'type' in payload) {
        const ev = payload as { type: string; session_id?: unknown };
        if (ev.type === 'env_manager_log' || ev.type === 'control_response') {
          continue;
        }
        if ('session_id' in ev) {
          sdkMessages.push(payload as SDKMessage);
        }
      }
    }

    // densable: break when !next_cursor (not has_more/last_id)
    if (!eventsData.next_cursor) break;
  }

  if (opts?.skipMetadata) {
    return { newEvents: sdkMessages, lastEventId: cursor };
  }

  // Fetch session metadata (branch, status) — densable l3e with accessToken
  let branch: string | undefined;
  let sessionStatus: PollRemoteSessionResponse['sessionStatus'];
  let metadataFetchError: string | undefined;
  try {
    const sessionData = await fetchSession(sessionId, { accessToken });
    branch = getBranchFromSession(sessionData);
    sessionStatus = sessionData.session_status as PollRemoteSessionResponse['sessionStatus'];
  } catch (e) {
    metadataFetchError = errorMessage(e);
    logForDebugging(`teleport: failed to fetch session ${sessionId} metadata: ${e}`, { level: 'warn' });
  }

  return {
    newEvents: sdkMessages,
    lastEventId: cursor,
    branch,
    sessionStatus,
    metadataFetchError,
  };
}

/**
 * Creates a remote Claude.ai session using the Sessions API.
 *
 * Two source modes:
 * - GitHub (default): backend clones from the repo's origin URL. Requires a
 *   GitHub remote + CCR-side GitHub connection. 43% of CLI sessions have an
 *   origin remote; far fewer pass the full precondition chain.
 * - Bundle (CCR_FORCE_BUNDLE=1): CLI creates `git bundle --all`, uploads via Files
 *   API, passes file_id as seed_bundle_file_id on the session context. CCR
 *   downloads it and clones from the bundle. No GitHub dependency — works for
 *   local-only repos. Reach: 54% of CLI sessions (anything with .git/).
 *   Backend: anthropic#303856.
 */

/**
 * densable fLn(cwd) / default-branch for a possibly non-process CWD.
 * When cwd is process CWD, reuse cached getDefaultBranch(); otherwise query git
 * at that path (origin/HEAD symbolic-ref → remote show origin).
 */
async function getDefaultBranchAt(cwd: string): Promise<string | null> {
  if (cwd === getCwd()) {
    try {
      return await getDefaultBranch();
    } catch {
      return null;
    }
  }
  // symbolic-ref refs/remotes/origin/HEAD → refs/remotes/origin/<branch>
  const sym = await execFileNoThrowWithCwd(gitExe(), ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], {
    cwd,
    preserveOutputOnError: false,
  });
  if (sym.code === 0) {
    const m = sym.stdout.trim().match(/refs\/remotes\/origin\/(.+)$/);
    if (m?.[1]) return m[1];
  }
  const show = await execFileNoThrowWithCwd(gitExe(), ['remote', 'show', 'origin'], {
    cwd,
    preserveOutputOnError: false,
  });
  if (show.code === 0) {
    const m = show.stdout.match(/HEAD branch:\s*(\S+)/);
    if (m?.[1] && m[1] !== '(unknown)') return m[1];
  }
  return null;
}

export async function teleportToRemote(options: {
  initialMessage: string | null;
  /** densable eHu initialMessageUuid — stable uuid for the seed user event. */
  initialMessageUuid?: string;
  branchName?: string;
  title?: string;
  /**
   * The description of the session. This is used to generate the title and
   * session branch name (unless they are explicitly provided).
   */
  description?: string;
  model?: string;
  permissionMode?: PermissionMode;
  ultraplan?: boolean;
  signal: AbortSignal;
  useDefaultEnvironment?: boolean;
  /**
   * Explicit environment_id (e.g. the code_review synthetic env). Bypasses
   * fetchEnvironments; the usual repo-detection → git source still runs so
   * the container gets the repo checked out (orchestrator reads --repo-dir
   * from pwd, it doesn't clone).
   */
  environmentId?: string;
  /**
   * Per-session env vars merged into session_context.environment_variables.
   * Write-only at the API layer (stripped from Get/List responses). When
   * environmentId is set, CLAUDE_CODE_OAUTH_TOKEN is auto-injected from the
   * caller's accessToken so the container's hook can hit inference (the
   * server only passes through what the caller sends; bughunter.go mints
   * its own, user sessions don't get one automatically).
   */
  environmentVariables?: Record<string, string>;
  /**
   * When set with environmentId, creates and uploads a git bundle of the
   * local working tree (createAndUploadGitBundle handles the stash-create
   * for uncommitted changes) and passes it as seed_bundle_file_id. Backend
   * clones from the bundle instead of GitHub — container gets the caller's
   * exact local state. Needs .git/ only, not a GitHub remote.
   */
  useBundle?: boolean;
  /**
   * densable Qre `bundleBaseRef` → Jes `{baseRef}`. Ultrareview branch mode
   * passes the merge-base SHA so squashed seed commits can parent on base
   * tree (and no_changes when trees match). Only used with useBundle.
   */
  bundleBaseRef?: string;
  /**
   * densable Qre `bundleForceScope` → Jes `{forceScope}`. Ultrareview
   * no_merge_base empty-tree fallback sets `"squashed"` so the seed bundle
   * skips --all/HEAD tiers (full history would be the entire repo).
   */
  bundleForceScope?: 'all' | 'head' | 'squashed';
  /**
   * densable Qre top-level CreateSession `tags` (e.g. ultrareview →
   * `["ultrareview"]`). Pass-through; not interpreted client-side.
   */
  tags?: string[];
  /**
   * Called with a user-facing message when the bundle path is attempted but
   * fails. The wrapper stderr.writes it (pre-REPL). Remote-agent callers
   * capture it to include in their throw (in-REPL, Ink-rendered).
   * densable explicit-env: only invoked when failReason !== "too_large"
   * (too_large returns null silently so callers can use short copy).
   * densable second arg is fail kind (`"bundle"` / `"env_create"`).
   */
  onBundleFail?: (message: string, kind?: string) => void;

  /**
   * densable Qre create-fail: (message, reason, meta?).
   * reason e.g. create_request_failed / malformed_response / no_access_token.
   */
  onCreateFail?: (
    message: string,
    reason?: string,
    meta?: {
      status?: number;
      serverType?: string;
      serverReason?: string;
      endpoint?: string;
      preflightTransient?: boolean;
    },
  ) => void;
  /**
   * When true, disables the git-bundle fallback entirely. Use for flows like
   * autofix where CCR must push to GitHub — a bundle can't do that.
   */
  skipBundle?: boolean;
  /**
   * When set, reuses this branch as the outcome branch instead of generating
   * a new claude/ branch. Sets allow_unrestricted_git_push on the source and
   * reuse_outcome_branches on the session context so the remote pushes to the
   * caller's branch directly.
   */
  reuseOutcomeBranch?: string;
  /**
   * GitHub PR to attach to the session context. Backend uses this to
   * identify the PR associated with this session.
   */
  githubPr?: { owner: string; repo: string; number: number };
  /**
   * Identifies which command/flow originated this teleport. CCR backend
   * uses this for routing/observability. Known values: 'autofix_pr',
   * 'ultrareview', 'ultraplan'. Pass-through field — not interpreted
   * client-side; if backend doesn't recognize it, it's silently ignored.
   */
  source?: string;
  /**
   * densable Qre poolId — force a self-hosted pool environment id (skips POe).
   * With densable wqr stub always false, pool trust still only activates when
   * selected env.kind === 'byoc' unless a future wqr un-stub.
   */
  poolId?: string;
  /**
   * densable Qre sessionGroupingId — Project grouping. On v1 CreateSession
   * densable always fails with project_not_enabled (new endpoint not enabled).
   */
  sessionGroupingId?: string;
  /**
   * densable Qre agentId — Kindling project dispatch. On v1 always fails
   * with agent_not_enabled.
   */
  agentId?: string;
  /**
   * densable Qre sourceUrl — explicit git repository URL (skips k$ detect).
   */
  sourceUrl?: string;
  /**
   * densable Qre explicitRef — --ref / --on-branch value that must be honored
   * as a real git source (not bundle/empty). Triggers explicit_ref_no_git_source
   * when no gitSource can be built.
   */
  explicitRef?: string;
  /**
   * densable Qre allowBundle. Default true. Local skipBundle=true forces false.
   * Effective: (allowBundle ?? true) && !skipBundle.
   */
  allowBundle?: boolean;
  /**
   * densable Qre `cwd` — working directory for git detect / gitRoot / default-branch
   * (`e.cwd ?? Ct()`). Defaults to process CWD.
   */
  cwd?: string;
  /**
   * densable Qre appendSystemPrompt → session_context.append_system_prompt.
   */
  appendSystemPrompt?: string;
  /**
   * densable Qre outputSchema → session_context.output_schema.
   */
  outputSchema?: Record<string, unknown>;
  /**
   * densable Qre correlationId → session_context.correlation_id.
   */
  correlationId?: string;
}): Promise<TeleportToRemoteResponse | null> {
  const { initialMessage, signal } = options;
  // densable: n = e.cwd ?? Ct()
  const cwd = options.cwd ?? getCwd();
  // densable Qre early gates (before try body network): policy + first-party
  const policyDeny = remoteSessionsPolicyDenyMessage();
  if (policyDeny) {
    options.onCreateFail?.(policyDeny, 'policy_denied');
    return null;
  }
  if (getAPIProvider() !== 'firstParty' || !isFirstPartyAnthropicBaseUrl()) {
    options.onCreateFail?.(
      'Cloud sessions are only available on the first-party Anthropic API provider.',
      'not_first_party',
    );
    return null;
  }
  try {
    // densable: sessionGroupingId / agentId not enabled on v1 CreateSession
    if (options.sessionGroupingId) {
      options.onCreateFail?.(
        isSessionGroupingEligible(options)
          ? "--project requires the new session-create endpoint, which isn't enabled for your account yet — no session was created."
          : '--project cannot be used on a GitHub-PR-bound create; it has no Project input — no session was created.',
        'project_not_enabled',
        { endpoint: 'v1' },
      );
      return null;
    }
    if (options.agentId) {
      options.onCreateFail?.(
        "Dispatching into a Kindling project requires the new session-create endpoint, which isn't enabled for your account yet — no session was created.",
        'agent_not_enabled',
        { endpoint: 'v1' },
      );
      return null;
    }

    // Check authentication
    await checkAndRefreshOAuthTokenIfNeeded();
    const accessToken = getClaudeAIOAuthTokens()?.accessToken;
    if (!accessToken) {
      // densable: Cloud sessions require claude.ai login + optional CCR debug
      let ne = 'Cloud sessions require a claude.ai login. Run /login to authenticate.';
      if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
        ne += ` (in CCR: env=${process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'set' : 'unset'}, fd=${process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR ? 'set' : 'unset'})`;
      }
      logError(new Error(ne));
      options.onCreateFail?.(ne, 'no_access_token');
      return null;
    }

    // Get organization UUID
    const orgUUID = await getOrganizationUUID();
    if (!orgUUID) {
      let ne = 'Unable to get organization UUID for cloud session creation';
      if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
        ne += ` (in CCR: CLAUDE_CODE_ORGANIZATION_UUID=${process.env.CLAUDE_CODE_ORGANIZATION_UUID ? 'set' : 'unset'})`;
      }
      logError(new Error(ne));
      options.onCreateFail?.(ne, 'no_org_uuid');
      return null;
    }

    // densable Qre: l={...e.environmentVariables}; delete l.CLAUDE_CODE_OAUTH_TOKEN
    // (server/bughunter mints container credentials; do not forward caller token)
    const envVars = { ...(options.environmentVariables ?? {}) };
    delete envVars.CLAUDE_CODE_OAUTH_TOKEN;

    // Explicit environmentId short-circuits Haiku title-gen + env selection.
    // Still runs repo detection so the container gets a working directory —
    // the code_review orchestrator reads --repo-dir $(pwd), it doesn't clone
    // (bughunter.go:520 sets a git source too; env-manager does the checkout
    // before the SessionStart hook fires).
    if (options.environmentId) {
      const url = `${getOauthConfig().BASE_API_URL}/v1/sessions`;
      const headers = {
        ...getOAuthHeaders(accessToken),
        'anthropic-beta': 'ccr-byoc-2025-07-29',
        'x-organization-uuid': orgUUID,
      };

      // Bundle mode: upload local working tree (uncommitted changes via
      // refs/seed/stash), container clones from the bundle. No GitHub.
      // densable Qre: Jes({..., baseRef: e.bundleBaseRef, forceScope:
      // e.bundleForceScope}); onBundleFail only when failReason !== "too_large".
      // Otherwise: github source.
      let gitSource: GitSource | null = null;
      let seedBundleFileId: string | null = null;
      if (options.useBundle) {
        const bundle = await createAndUploadGitBundle(
          {
            oauthToken: accessToken,
            sessionId: getSessionId(),
            baseUrl: getOauthConfig().BASE_API_URL,
          },
          {
            signal,
            baseRef: options.bundleBaseRef,
            forceScope: options.bundleForceScope,
          },
        );
        if (!bundle.success) {
          const failBundle = bundle as {
            success: false;
            error: string;
            failReason?: string;
          };
          // Explicit useBundle path has no GitHub fallthrough by design.
          logForDebugging(`Bundle upload failed: ${failBundle.error}`, {
            level: 'error',
          });
          // densable: He.failReason!=="too_large" → onBundleFail?.(error,"bundle")
          if (failBundle.failReason !== 'too_large') {
            options.onBundleFail?.(failBundle.error, 'bundle');
          }
          return null;
        }
        seedBundleFileId = bundle.fileId;
        logEvent('tengu_teleport_bundle_mode', {
          size_bytes: bundle.bundleSizeBytes,
          scope: bundle.scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          has_wip: bundle.hasWip,
          reason: 'explicit_env_bundle' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        });
      } else if (options.sourceUrl) {
        // densable: else if (e.sourceUrl) ae = {type:git_repository,url,revision}
        gitSource = {
          type: 'git_repository',
          url: options.sourceUrl,
          revision: options.branchName,
        };
      } else if (!options.agentId) {
        // densable: else if (!e.agentId) k$(e.cwd) detect — agent defaults skip repo
        const repoInfo = await detectCurrentRepositoryWithHost(cwd);
        if (repoInfo) {
          gitSource = {
            type: 'git_repository',
            url: `https://${repoInfo.host}/${repoInfo.owner}/${repoInfo.name}`,
            revision: options.branchName,
          };
        }
      }

      // densable Qre explicit-env CreateSession body: session_context +
      // environment_id + optional top-level tags. events via eHu.
      // source is observability on the client registration path (ZCu).
      const events = buildTeleportCreateEvents({
        initialMessage,
        initialMessageUuid: options.initialMessageUuid,
        permissionMode: options.permissionMode,
        ultraplan: options.ultraplan,
      });
      const requestBody = {
        title: options.title || options.description || 'Remote task',
        events,
        session_context: {
          sources: gitSource ? [gitSource] : [],
          ...(seedBundleFileId && { seed_bundle_file_id: seedBundleFileId }),
          outcomes: [],
          environment_variables: envVars,
          ...(options.model && { model: options.model }),
          ...(options.appendSystemPrompt && {
            append_system_prompt: options.appendSystemPrompt,
          }),
          ...(options.outputSchema && { output_schema: options.outputSchema }),
          ...(options.correlationId && {
            correlation_id: options.correlationId,
          }),
        },
        environment_id: options.environmentId,
        ...(options.tags && { tags: options.tags }),
      };
      logForDebugging(
        `[teleportToRemote] explicit env ${options.environmentId}, ${Object.keys(envVars).length} env vars, ${seedBundleFileId ? `bundle=${seedBundleFileId}` : `source=${gitSource?.url ?? 'none'}@${options.branchName ?? 'default'}`}`,
      );
      const response = await axios.post(url, requestBody, {
        headers,
        signal,
        validateStatus: status => status < 500,
      });
      if (response.status !== 200 && response.status !== 201) {
        const errMsg = `CreateSession ${response.status}: ${jsonStringify(response.data)}`;
        const data = response.data as { error?: { message?: string; type?: string; reason?: string } } | undefined;
        const safeToken = (v: string | undefined) => (v && /^[a-z][a-z0-9_]*$/.test(v) ? v : undefined);
        // densable explicit fail log: 401/403/429 / github_repo_access_denied →
        // debug error; else logError with type/reason tokens
        if ([401, 403, 429].includes(response.status) || data?.error?.reason === 'github_repo_access_denied') {
          logForDebugging(`[teleportToRemote] ${errMsg}`, { level: 'error' });
        } else {
          logError(
            new Error(`[type=${safeToken(data?.error?.type)},reason=${safeToken(data?.error?.reason)}] ${errMsg}`),
          );
        }
        const groupingMsg =
          options.sessionGroupingId &&
          sessionGroupingCreateFailMessage(
            options.sessionGroupingId,
            data?.error as { type?: string; resource_type?: string; reason?: string } | undefined,
          );
        options.onCreateFail?.(
          groupingMsg || data?.error?.message || `${response.status} ${response.statusText || ''}`.trim() || errMsg,
          'create_request_failed',
          {
            status: response.status,
            serverType: safeToken(data?.error?.type),
            serverReason: safeToken(data?.error?.reason),
            endpoint: 'v1',
          },
        );
        return null;
      }
      const sessionData = response.data as SessionResource;
      if (!sessionData || typeof sessionData.id !== 'string') {
        logError(new Error(`No session id in response: ${jsonStringify(response.data)}`));
        options.onCreateFail?.('Server returned a malformed session response (no session id)', 'malformed_response');
        return null;
      }
      // densable ZCu(..., {project:!1,global:!1}, {endpoint:"v1",grouped:sessionGroupingId!=null})
      recordCcrSessionLink(
        sessionData.id,
        options.source,
        { project: false, global: false },
        {
          endpoint: 'v1',
          grouped: options.sessionGroupingId != null,
        },
      );
      return {
        id: sessionData.id,
        title: sessionData.title || requestBody.title,
      };
    }

    // ── densable Qre non-explicit arm ──────────────────────────────────────
    // Order: POe/wqr pool → env-select (+ auto-create) → branch-detect /
    // source ladder (BYOC skips preflight + disables bundle; FZt rich
    // preflight; explicitRef fail) → create → ZCu.

    // densable: c = e.poolId!==void 0 ? {id:e.poolId} : POe()
    const poolResolution =
      options.poolId !== undefined
        ? {
            id: options.poolId,
            source: undefined,
            ignoredUntrustedPool: undefined,
          }
        : resolveDefaultPoolEnvironment();
    if (poolResolution.ignoredUntrustedPool) {
      logForDebugging(
        `Ignoring self-hosted pool default ${poolResolution.ignoredUntrustedPool.id} from ${poolResolution.ignoredUntrustedPool.source} — pool placement is only honoured from user/policy/flag settings. Run /remote-env to set your pool.`,
        { level: 'warn' },
      );
    }
    const poolPreferredId = poolResolution.id;
    // densable d = wqr(u) — 212 stub always false
    const poolTrusted = isTrustedPoolEnvironment(poolPreferredId);

    // Kick title gen in parallel with env-select when both title + outcome
    // branch are not already provided (densable P1g).
    const titlePromise =
      options.title && options.reuseOutcomeBranch
        ? null
        : generateTitleAndBranch(options.description || initialMessage || 'Background task', signal);

    logForDebugging('[teleport] phase: env-select');
    // densable: if (d) skip Nye; else fetch (+ auto-create)
    let environments = poolTrusted ? [] : await fetchEnvironments();
    if (!poolTrusted && (!environments || environments.length === 0)) {
      try {
        const created = await createDefaultCloudEnvironment('Default');
        environments = [created];
        logForDebugging('[teleportToRemote] Auto-created default cloud env');
      } catch (ne) {
        logForDebugging(`[teleportToRemote] auto-create env failed: ${toError(ne).message}`, { level: 'warn' });
        options.onBundleFail?.(
          'Could not create a cloud environment. Set one up at https://claude.ai/code/onboarding?magic=env-setup',
          'env_create',
        );
        return null;
      }
    }

    if (!poolTrusted) {
      logForDebugging(
        `Available environments: ${environments.map(e => `${e.environment_id} (${e.name}, ${e.kind})`).join(', ')}`,
      );
    }

    // densable m = u (pool preferred id), g = match, y = anthropic_cloud
    let matchedConfigured = poolPreferredId
      ? environments.find(env => env.environment_id === poolPreferredId)
      : undefined;
    let cloudEnv = environments.find(env => env.kind === 'anthropic_cloud');
    if (!poolTrusted && options.useDefaultEnvironment && !matchedConfigured && !cloudEnv) {
      logForDebugging(
        `No configured default or anthropic_cloud in env list (${environments.length} envs); retrying fetchEnvironments`,
      );
      environments = await fetchEnvironments();
      matchedConfigured = poolPreferredId
        ? environments.find(env => env.environment_id === poolPreferredId)
        : undefined;
      cloudEnv = environments.find(env => env.kind === 'anthropic_cloud');
      if (!matchedConfigured && !cloudEnv) {
        const ne = `No configured default or anthropic_cloud environment available after retry (got: ${environments.map(e => `${e.name} (${e.kind})`).join(', ')}${poolPreferredId ? `; configured default ${poolPreferredId} not in list` : ''})`;
        logForDebugging(
          `[teleportToRemote] ${ne}. Silent byoc fallthrough would launch into a dead env — fail fast instead.`,
          { level: 'error' },
        );
        options.onCreateFail?.(ne, 'no_default_env');
        return null;
      }
    }
    // densable: _ = d ? void 0 : g||y||non-bridge||f[0]
    const selectedEnvironment = poolTrusted
      ? undefined
      : matchedConfigured || cloudEnv || environments.find(env => env.kind !== 'bridge') || environments[0];
    if (!selectedEnvironment && !poolTrusted) {
      logError(new Error('No environments available for session creation'));
      options.onCreateFail?.('No environments available for session creation', 'no_environments');
      return null;
    }
    if (poolPreferredId && selectedEnvironment) {
      logForDebugging(
        selectedEnvironment.environment_id === poolPreferredId
          ? `Using configured default environment: ${poolPreferredId}`
          : `Configured default environment ${poolPreferredId} not found, using first available`,
      );
    }
    // densable v = d ? m : _.environment_id
    const environmentId = poolTrusted ? poolPreferredId! : selectedEnvironment!.environment_id;
    // densable D = d || _?.kind === "byoc"
    const isByocEnv = poolTrusted || selectedEnvironment?.kind === 'byoc';
    if (selectedEnvironment) {
      logForDebugging(
        `Selected environment: ${environmentId} (${selectedEnvironment.name}, ${selectedEnvironment.kind})`,
      );
    } else {
      logForDebugging(`Selected environment: ${environmentId}`);
    }

    let gitSource: GitSource | null = null;
    let gitOutcome: GitRepositoryOutcome | null = null;
    let seedBundleFileId: string | null = null;

    // densable: if (e.sourceUrl) S = {type:git_repository,...}
    if (options.sourceUrl) {
      gitSource = {
        type: 'git_repository',
        url: options.sourceUrl,
        revision: options.branchName,
      };
    }

    logForDebugging('[teleport] phase: branch-detect');
    // densable: x = S||e.agentId ? null : k$(e.cwd)
    const repoInfo = gitSource || options.agentId ? null : await detectCurrentRepositoryWithHost(cwd);

    let sessionTitle: string;
    let sessionBranch: string;
    if (titlePromise === null) {
      sessionTitle = options.title!;
      sessionBranch = options.reuseOutcomeBranch!;
    } else {
      const generated = await titlePromise;
      sessionTitle = options.title || generated.title;
      sessionBranch = options.reuseOutcomeBranch || generated.branchName;
    }

    type SourceReason =
      | 'github_preflight_ok'
      | 'ghes_optimistic'
      | 'github_preflight_failed'
      | 'no_github_remote'
      | 'forced_bundle'
      | 'no_git_at_all'
      | 'byoc_env_skip_preflight'
      | 'explicit_source_url'
      | 'agent_defaults';
    let ghViable = false;
    let preflightDefaultBranch: string | null = null;
    let preflightTransient = false;
    let sourceReason: SourceReason = options.sourceUrl
      ? 'explicit_source_url'
      : options.agentId
        ? 'agent_defaults'
        : 'no_git_at_all';

    // densable: $ = wu(n) with n = e.cwd ?? Ct()
    const gitRoot = findGitRoot(cwd);
    // densable allowBundle: e.allowBundle && !D && !e.agentId (local: allowBundle??true && !skipBundle)
    const allowBundleOpt = (options.allowBundle ?? true) && !options.skipBundle;
    const forceBundle = allowBundleOpt && !isByocEnv && !options.agentId && isEnvTruthy(process.env.CCR_FORCE_BUNDLE);
    const bundleSeedGateOn =
      allowBundleOpt &&
      !isByocEnv &&
      !options.agentId &&
      gitRoot !== null &&
      (isEnvTruthy(process.env.CCR_ENABLE_BUNDLE) ||
        (await checkGate_CACHED_OR_BLOCKING('tengu_ccr_bundle_seed_enabled')));

    // densable ladder only when we still need to decide from repoInfo
    // (sourceUrl already set S; agentId skips detect)
    if (repoInfo && !forceBundle) {
      if (isByocEnv) {
        ghViable = true;
        sourceReason = 'byoc_env_skip_preflight';
      } else if (repoInfo.host === 'github.com') {
        const preflight = await checkGithubAppPreflight(repoInfo.owner, repoInfo.name, signal);
        ghViable = preflight.appInstalled;
        preflightDefaultBranch = preflight.defaultBranch;
        preflightTransient = preflight.transient;
        sourceReason = ghViable ? 'github_preflight_ok' : 'github_preflight_failed';
      } else {
        ghViable = true;
        sourceReason = 'ghes_optimistic';
      }
    } else if (forceBundle) {
      sourceReason = 'forced_bundle';
    } else if (gitRoot && !options.agentId) {
      sourceReason = 'no_github_remote';
    }

    // Preflight failed but bundle is off — fall through optimistically.
    if (!ghViable && !bundleSeedGateOn && repoInfo) {
      ghViable = true;
    }

    if (ghViable && repoInfo) {
      const { host, owner, name } = repoInfo;
      const revision = options.branchName ?? (await getDefaultBranchAt(cwd)) ?? undefined;

      // densable reuse-outcome-branch default-branch collision guard
      if (options.reuseOutcomeBranch) {
        const guardEnv = process.env.CCR_ON_BRANCH_DEFAULT_GUARD;
        let mode: 'enforce' | 'observe' | 'off' = 'enforce';
        if (guardEnv != null && String(guardEnv).trim() === 'off') {
          mode = 'off';
        } else if (guardEnv != null && String(guardEnv).trim() === 'observe') {
          mode = 'observe';
        } else if (guardEnv != null && String(guardEnv).trim()) {
          mode = 'enforce';
        } else {
          try {
            const observe = await checkGate_CACHED_OR_BLOCKING('tengu_on_branch_default_guard_observe');
            mode = observe ? 'observe' : 'enforce';
          } catch {
            mode = 'enforce';
          }
        }
        if (mode !== 'off') {
          // densable: ie = P ?? await fLn(cwd) — preflight defaultBranch first
          const defaultBranch = preflightDefaultBranch ?? (await getDefaultBranchAt(cwd));
          if (defaultBranch === null) {
            logForDebugging(
              `[teleportToRemote] reuse-outcome-branch collision guard: default branch unknown (no preflight answer, origin/HEAD unresolved) — failing open for '${options.reuseOutcomeBranch}'`,
            );
          } else if (options.reuseOutcomeBranch === defaultBranch) {
            const isExplicitOnBranch = options.explicitRef === options.reuseOutcomeBranch;
            const isAutofix = options.source === 'autofix_pr';
            logEvent('tengu_teleport_on_branch_default_guard', {
              mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              source: (options.source ?? '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              evidence: (preflightDefaultBranch !== null
                ? 'preflight'
                : 'local_symref') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              arm: (isByocEnv ? 'pool' : 'managed') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            });
            if (isByocEnv) {
              logForDebugging(
                `[teleportToRemote] reuse-outcome-branch collision guard (pool arm): '${options.reuseOutcomeBranch}' is the repository's default branch — allowed on self-hosted pools; emitted for policy telemetry only`,
              );
            } else if (mode === 'observe') {
              logForDebugging(
                `[teleportToRemote] reuse-outcome-branch collision guard (observe): '${options.reuseOutcomeBranch}' is the repository's default branch — would deny; proceeding (CCR_ON_BRANCH_DEFAULT_GUARD=observe)`,
              );
            } else {
              const msg =
                (isExplicitOnBranch
                  ? `--on-branch ${options.reuseOutcomeBranch} targets `
                  : isAutofix
                    ? `This pull request's head branch '${options.reuseOutcomeBranch}' is `
                    : `The requested outcome branch '${options.reuseOutcomeBranch}' is `) +
                "the repository's default branch, which this environment's runner cannot reuse as its work branch (its git checkout -b fails on a name the clone already has). " +
                (isExplicitOnBranch
                  ? `Use --ref ${options.reuseOutcomeBranch} to base the session on it and let it push to a fresh claude/… branch.`
                  : isAutofix
                    ? 'Autofix can monitor this PR from a self-hosted (BYOC) default environment, whose runner tolerates reusing the default branch.'
                    : 'Use a non-default branch.');
              options.onCreateFail?.(msg, 'outcome_branch_is_default');
              return null;
            }
          }
        }
      }

      logForDebugging(`[teleportToRemote] Git source: ${host}/${owner}/${name}, revision: ${revision ?? 'none'}`);
      gitSource = {
        type: 'git_repository',
        url: `https://${host}/${owner}/${name}`,
        revision,
        ...(options.reuseOutcomeBranch && {
          allow_unrestricted_git_push: true,
        }),
      };
      gitOutcome = {
        type: 'git_repository',
        git_info: {
          type: 'github',
          repo: `${owner}/${name}`,
          branches: [sessionBranch],
        },
      };
    }

    // densable: if (!S && !D && e.explicitRef) → explicit_ref / on_branch fail
    if (!gitSource && !isByocEnv && options.explicitRef) {
      const flag = options.reuseOutcomeBranch ? '--on-branch' : '--ref';
      const why = forceBundle
        ? 'CCR_FORCE_BUNDLE is set'
        : repoInfo
          ? preflightTransient
            ? 'the GitHub App preflight failed transiently (network or service hiccup)'
            : 'the GitHub App is not set up for this repository'
          : 'no GitHub remote was detected in this directory';
      const alt = bundleSeedGateOn ? 'be seeded from your local working tree' : 'start with an empty sandbox';
      const setupHint = repoInfo
        ? preflightTransient
          ? 'Retry in a moment, or '
          : 'Set up the GitHub integration at https://claude.ai/code, or '
        : '';
      const dropHint = bundleSeedGateOn
        ? `drop ${flag} to seed from local HEAD.`
        : `drop ${flag} to start with an empty sandbox.`;
      options.onCreateFail?.(
        `${flag} ${options.explicitRef} cannot be honored: ${why}, so the session would ${alt} instead. ${setupHint}${dropHint}`,
        options.reuseOutcomeBranch ? 'on_branch_no_git_source' : 'explicit_ref_no_git_source',
        { preflightTransient },
      );
      return null;
    }

    // Bundle fallback only when managed cloud + gate on + no gitSource.
    if (!gitSource && bundleSeedGateOn) {
      logForDebugging('[teleport] phase: bundle-upload');
      logForDebugging(`[teleportToRemote] Bundling (reason: ${sourceReason})`);
      const bundle = await createAndUploadGitBundle(
        {
          oauthToken: accessToken,
          sessionId: getSessionId(),
          baseUrl: getOauthConfig().BASE_API_URL,
        },
        { signal },
      );
      if (!bundle.success) {
        const failBundle = bundle as {
          success: false;
          error: string;
          failReason?: string;
        };
        logForDebugging(`Bundle upload failed: ${failBundle.error}`, {
          level: 'error',
        });
        const setup = repoInfo ? '. Please setup GitHub on https://claude.ai/code' : '';
        let msg: string;
        switch (failBundle.failReason) {
          case 'empty_repo':
            msg = 'Repository has no commits — run `git add . && git commit -m "initial"` then retry';
            break;
          case 'too_large':
            msg = `Repo is too large to teleport${setup}`;
            break;
          case 'git_error':
            msg = `Failed to create git bundle (${failBundle.error})${setup}`;
            break;
          case 'stash_failed':
          case 'no_changes':
            msg = failBundle.error;
            break;
          case undefined:
            msg = `Bundle upload failed: ${failBundle.error}${setup}`;
            break;
          default:
            msg = `Bundle upload failed: ${failBundle.error}`;
        }
        options.onBundleFail?.(msg, 'bundle');
        return null;
      }
      seedBundleFileId = bundle.fileId;
      logEvent('tengu_teleport_bundle_mode', {
        size_bytes: bundle.bundleSizeBytes,
        scope: bundle.scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        has_wip: bundle.hasWip,
        reason: sourceReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
    }

    logEvent('tengu_teleport_source_decision', {
      reason: sourceReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      path: (gitSource
        ? 'github'
        : seedBundleFileId
          ? 'bundle'
          : 'empty') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });

    if (!gitSource && !seedBundleFileId) {
      // densable: BYOC requires a git source (unless agentId)
      if (isByocEnv && !options.agentId) {
        const refHint = options.explicitRef
          ? ` — so ${options.reuseOutcomeBranch ? '--on-branch' : '--ref'} ${options.explicitRef} cannot be honored`
          : '';
        const te = `The selected environment "${selectedEnvironment?.name ?? environmentId}" requires a git source, but no GitHub remote was detected${refHint}. Check that \`git remote get-url origin\` returns a GitHub URL.`;
        logForDebugging(`[teleportToRemote] ${te} (byoc env, sourceReason=${sourceReason})`, { level: 'error' });
        options.onCreateFail?.(te, 'byoc_no_git_source');
        return null;
      }
      logForDebugging('[teleportToRemote] No repository detected — session will have an empty sandbox');
    }

    const url = `${getOauthConfig().BASE_API_URL}/v1/sessions`;
    const headers = {
      ...getOAuthHeaders(accessToken),
      'anthropic-beta': 'ccr-byoc-2025-07-29',
      'x-organization-uuid': orgUUID,
    };

    // densable non-explicit session_context (Qre J body):
    // sources/seed/outcomes/model/reuse/github_pr, env only if non-empty,
    // append/output/correlation. source is ZCu client-side only (not body).
    const sessionContext = {
      sources: gitSource ? [gitSource] : [],
      ...(seedBundleFileId && { seed_bundle_file_id: seedBundleFileId }),
      outcomes: gitOutcome ? [gitOutcome] : [],
      model: options.model ?? getMainLoopModel(),
      ...(options.reuseOutcomeBranch && { reuse_outcome_branches: true }),
      ...(options.githubPr && { github_pr: options.githubPr }),
      ...(Object.keys(envVars).length > 0 && {
        environment_variables: envVars,
      }),
      ...(options.appendSystemPrompt && {
        append_system_prompt: options.appendSystemPrompt,
      }),
      ...(options.outputSchema && { output_schema: options.outputSchema }),
      ...(options.correlationId && {
        correlation_id: options.correlationId,
      }),
    };

    const events = buildTeleportCreateEvents({
      initialMessage,
      initialMessageUuid: options.initialMessageUuid,
      permissionMode: options.permissionMode,
      ultraplan: options.ultraplan,
    });

    const requestBody = {
      title: options.ultraplan ? `ultraplan: ${sessionTitle}` : sessionTitle,
      events,
      session_context: sessionContext,
      environment_id: environmentId,
      ...(options.tags && { tags: options.tags }),
    };

    logForDebugging(`Creating session with payload: ${jsonStringify(requestBody, null, 2)}`);

    const response = await axios.post(url, requestBody, {
      headers,
      signal,
      validateStatus: status => status < 500,
    });
    const isSuccess = response.status === 200 || response.status === 201;

    if (!isSuccess) {
      const ne = `API request failed with status ${response.status}: ${response.statusText}\n\nResponse data: ${jsonStringify(response.data, null, 2)}`;
      const data = response.data as
        | {
            error?: {
              message?: string;
              type?: string;
              reason?: string;
              resource_type?: string;
            };
          }
        | undefined;
      const ae = data?.error?.type;
      const se = data?.error?.reason;
      const oe = data?.error?.message;
      // densable: re = S ? Qz(S.url) : null; ie = re ? owner/name : w ? seed bundle : S?.url ?? no source
      const parsedSource = gitSource?.url ? parseGitRemote(gitSource.url) : null;
      const sourceDesc = parsedSource
        ? `${parsedSource.owner}/${parsedSource.name}`
        : seedBundleFileId
          ? 'a seed bundle (no git source)'
          : (gitSource?.url ?? 'no source');
      // densable: de = re host is github-family && owner/name anthropics/anthropic
      const sentMonorepo =
        parsedSource !== null &&
        parsedSource.owner.toLowerCase() === 'anthropics' &&
        parsedSource.name.toLowerCase() === 'anthropic';
      // densable He monorepo fail signal
      const monorepoFail =
        (typeof oe === 'string' &&
          oe.includes('source repository configuration is not permitted for this environment')) ||
        se === 'monorepo_source_required' ||
        se === 'monorepo_env_required' ||
        (response.status === 400 &&
          !se &&
          ae === 'invalid_request_error' &&
          !isByocEnv &&
          gitSource !== null &&
          !seedBundleFileId &&
          sentMonorepo &&
          typeof oe === 'string' &&
          /^the request was invalid\.?$/i.test(oe));

      // densable log routing: 401/403/429 / github_repo_access_denied / He → debug error;
      // else logError with type/reason/isByocEnv/sentMonorepo
      if ([401, 403, 429].includes(response.status) || se === 'github_repo_access_denied' || monorepoFail) {
        logForDebugging(ne, { level: 'error' });
      } else {
        const safeTokenLog = (v: string | undefined) => (v && /^[a-z][a-z0-9_]*$/.test(v) ? v : undefined);
        logError(
          new Error(
            `[type=${safeTokenLog(ae)},reason=${safeTokenLog(se)},isByocEnv=${isByocEnv},sentMonorepo=${sentMonorepo}] ${ne}`,
          ),
        );
      }

      const safeToken = (v: string | undefined) => (v && /^[a-z][a-z0-9_]*$/.test(v) ? v : undefined);
      let userMsg = (typeof oe === 'string' && oe) || `${response.status} ${response.statusText || ''}`.trim();
      // densable monorepo He rewrite of user-facing message
      if (monorepoFail) {
        const envLabel = selectedEnvironment?.name ?? environmentId;
        userMsg = sentMonorepo
          ? `The source anthropics/anthropic requires a monorepo environment, but "${envLabel}" was selected. Configure a monorepo environment, or run from a different repository.`
          : `The selected environment "${envLabel}" only accepts the Anthropic monorepo (anthropics/anthropic), but the source was ${sourceDesc}. Run this from a monorepo checkout, or select a different environment.`;
      }
      const groupingMsg =
        options.sessionGroupingId && sessionGroupingCreateFailMessage(options.sessionGroupingId, data?.error);
      options.onCreateFail?.(groupingMsg || userMsg, 'create_request_failed', {
        status: response.status,
        serverType: safeToken(ae),
        serverReason: safeToken(se),
        endpoint: 'v1',
      });
      return null;
    }

    const sessionData = response.data as SessionResource;
    if (!sessionData || typeof sessionData.id !== 'string') {
      logError(new Error(`Cannot determine session ID from API response: ${jsonStringify(response.data)}`));
      options.onCreateFail?.('Server returned a malformed session response (no session id)', 'malformed_response');
      return null;
    }

    // densable ZCu: project: S!==null && N!=="github_preflight_failed"; global: w===null
    recordCcrSessionLink(
      sessionData.id,
      options.source,
      {
        project: gitSource !== null && sourceReason !== 'github_preflight_failed',
        global: seedBundleFileId === null,
      },
      {
        endpoint: 'v1',
        grouped: options.sessionGroupingId != null,
      },
    );
    logForDebugging(`Successfully created remote session: ${sessionData.id}`);
    return {
      id: sessionData.id,
      title: sessionData.title || requestBody.title,
    };
  } catch (error) {
    // densable Qre outer catch:
    // abort/cancel → silent null; network → onCreateFail network_error; else exception
    const err = toError(error);
    if (isAbortError(error) || axios.isCancel(error)) {
      logForDebugging(`Remote session create aborted: ${err.message}`);
      return null;
    }
    const network = isTransientNetworkError(error);
    if (network) {
      logForDebugging(`Remote session create failed (network): ${err.message}`, { level: 'error' });
    } else {
      logError(new Error(`Remote session create failed: ${errorMessage(err)}`));
    }
    options.onCreateFail?.(`Cloud session create failed: ${err.message}`, network ? 'network_error' : 'exception');
    return null;
  }
}

/**
 * densable H8 archiveRemoteSession.
 * POST /v1/code/sessions/{id}/archive — no running-status check (unlike DELETE
 * which 409s on RUNNING). 409 treated as success. densable returns boolean;
 * first-party only; OAuth headers only (no beta / org uuid on this path).
 */
export async function archiveRemoteSession(sessionId: string, timeout = 10_000): Promise<boolean> {
  // densable: if (!ou()) skip
  if (getAPIProvider() !== 'firstParty') {
    logForDebugging(`[archiveRemoteSession] ${sessionId} skipped: non-first-party provider`);
    return false;
  }
  // densable H8: o9t() — keychain or CLAUDE_CODE_REMOTE fallback
  const accessToken = getAccessTokenWithCcrFallback();
  if (!accessToken) return false;
  // densable H8: /v1/code/sessions/${e}/archive + headers Px(token) only
  const url = `${getOauthConfig().BASE_API_URL}/v1/code/sessions/${sessionId}/archive`;
  try {
    const resp = await axios.post(
      url,
      {},
      {
        headers: getOAuthHeaders(accessToken),
        timeout,
        validateStatus: s => s < 500,
      },
    );
    if (resp.status === 200 || resp.status === 409) {
      logForDebugging(`[archiveRemoteSession] archived ${sessionId}`);
      return true;
    }
    logForDebugging(`[archiveRemoteSession] ${sessionId} failed ${resp.status}: ${jsonStringify(resp.data)}`);
    return false;
  } catch (err) {
    logForDebugging(`[archiveRemoteSession] ${sessionId} failed: ${errorMessage(err)}`, { level: 'error' });
    return false;
  }
}

/**
 * densable BZt — build POST events URL/body.
 * Bit() = GrowthBook tengu_ccr_v2_send_events_cli:
 *   false → /v1/sessions/{sessionId}/events, body {events}
 *   true  → /v1/code/sessions/{cse_id}/events, body events wrapped as {payload}
 */
function buildRemoteSessionEventsPost(
  baseUrl: string,
  sessionId: string,
  events: Array<Record<string, unknown>>,
  useV2: boolean,
): { url: string; body: { events: unknown[] } } {
  if (!useV2) {
    return {
      url: `${baseUrl}/v1/sessions/${sessionId}/events`,
      body: { events },
    };
  }
  const infraId = toInfraSessionId(sessionId);
  return {
    url: `${baseUrl}/v1/code/sessions/${encodeURIComponent(infraId)}/events`,
    body: {
      events: events.map(ev => {
        const withUuid = typeof ev.uuid === 'string' && ev.uuid ? ev : { ...ev, uuid: randomUUID() };
        return { payload: withUuid };
      }),
    },
  };
}

/**
 * densable F1g interruptRemoteSession — POST control_request subtype:interrupt
 * to the session events endpoint so the remote aborts mid-turn.
 * Returns true on 2xx.
 */
export async function interruptRemoteSession(sessionId: string, timeout = 10_000): Promise<boolean> {
  // densable: if (!ou()) skip
  if (getAPIProvider() !== 'firstParty') {
    logForDebugging(`[interruptRemoteSession] ${sessionId} skipped: non-first-party provider`);
    return false;
  }
  // densable F1g: o9t() — keychain or CLAUDE_CODE_REMOTE fallback
  const accessToken = getAccessTokenWithCcrFallback();
  if (!accessToken) return false;
  try {
    // densable Kj(e): cse_ → session_ when shim on
    const compatId = toCompatSessionId(sessionId);
    if (!/^session_[A-Za-z0-9_-]+$/.test(compatId)) return false;
    const orgUUID = await getOrganizationUUID();
    if (!orgUUID) return false;
    // densable Bit() = tengu_ccr_v2_send_events_cli
    const useV2 = await checkGate_CACHED_OR_BLOCKING('tengu_ccr_v2_send_events_cli');
    const events: Array<Record<string, unknown>> = [
      {
        type: 'control_request',
        request_id: randomUUID(),
        request: { subtype: 'interrupt' },
        uuid: randomUUID(),
      },
    ];
    const { url, body } = buildRemoteSessionEventsPost(getOauthConfig().BASE_API_URL, compatId, events, useV2);
    // densable eG() trusted device token (optional header)
    const trusted = getTrustedDeviceToken();
    const headers: Record<string, string> = {
      ...getOAuthHeaders(accessToken),
      'anthropic-beta': 'ccr-byoc-2025-07-29',
      'x-organization-uuid': orgUUID,
      ...(trusted ? { 'X-Trusted-Device-Token': trusted } : {}),
    };
    const resp = await axios.post(url, body, {
      headers,
      timeout,
      validateStatus: s => s < 500,
    });
    if (resp.status >= 200 && resp.status < 300) {
      logForDebugging(`[interruptRemoteSession] interrupted ${sessionId}`);
      return true;
    }
    logForDebugging(`[interruptRemoteSession] ${sessionId} failed ${resp.status}: ${jsonStringify(resp.data)}`);
    return false;
  } catch (err) {
    logForDebugging(`[interruptRemoteSession] ${sessionId} failed: ${errorMessage(err)}`, { level: 'error' });
    return false;
  }
}

/**
 * densable nts awaitRemoteSessionResult — block until a cloud session is
 * archived or stably idle (workflow_remote_agent path). Polls OTe every 1s,
 * 30min timeout, 5 consecutive quiet-idle polls, 10 consecutive metadata misses.
 */
export type AwaitRemoteSessionResult = {
  text: string;
  structuredOutput: unknown;
  resultSubtype: string | undefined;
  usage: unknown;
  totalCostUsd: number | undefined;
  modelUsage: unknown;
  numTurns: number | undefined;
  toolCalls: number;
};

function assistantContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(block => {
      if (block && typeof block === 'object' && 'type' in block) {
        const b = block as { type: string; text?: string };
        if (b.type === 'text' && typeof b.text === 'string') return b.text;
      }
      return '';
    })
    .join('\n');
}

export async function awaitRemoteSessionResult(
  sessionId: string,
  signal?: AbortSignal,
): Promise<AwaitRemoteSessionResult> {
  // densable: if (!ou()) throw
  if (getAPIProvider() !== 'firstParty') {
    throw new Error('Cloud sessions are only available on the first-party Anthropic API provider.');
  }
  const pollMs = 1000;
  const timeoutMs = 1_800_000;
  const stableIdlePolls = 5;
  const maxMetadataMisses = 10;
  let lastEventId: string | null = null;
  let lastAssistant: SDKMessage | undefined;
  let lastResult: SDKMessage | undefined;
  let toolCalls = 0;
  let consecutiveIdle = 0;
  let consecutiveMetadataMiss = 0;
  let done = false;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) throw new Error('Workflow aborted');
    const y = await pollRemoteSessionEvents(sessionId, lastEventId);
    lastEventId = y.lastEventId;
    for (const ev of y.newEvents) {
      if (ev.type === 'assistant') {
        lastAssistant = ev;
        const content = (ev as { message?: { content?: unknown } }).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              block &&
              typeof block === 'object' &&
              'type' in block &&
              (block as { type: string }).type === 'tool_use'
            ) {
              toolCalls++;
            }
          }
        }
      } else if (ev.type === 'result') {
        lastResult = ev;
      }
    }
    if (y.sessionStatus === 'archived') {
      done = true;
      break;
    }
    if (y.sessionStatus === 'requires_action') {
      throw new Error(
        `Cloud session ${sessionId} entered 'requires_action' (likely a permission prompt) with no client to answer it. Ensure the cloud agent's allowed_tools cover what it needs, or set a permissive mode.`,
      );
    }
    if (y.sessionStatus === undefined) {
      consecutiveMetadataMiss++;
      if (consecutiveMetadataMiss >= maxMetadataMisses) {
        throw new Error(
          `Cloud session ${sessionId}: fetchSession failed ${maxMetadataMisses} times in a row (last error: ${y.metadataFetchError ?? 'unknown'}). Bailing instead of polling to the 30-min timeout.`,
        );
      }
    } else {
      consecutiveMetadataMiss = 0;
    }
    if (y.sessionStatus === 'idle' && y.newEvents.length === 0) {
      consecutiveIdle++;
      if (consecutiveIdle >= stableIdlePolls) {
        done = true;
        break;
      }
    } else {
      consecutiveIdle = 0;
    }
    await sleep(pollMs, signal);
  }

  if (!done) {
    throw new Error(`Cloud session ${sessionId} timed out after ${timeoutMs / 60000} min`);
  }

  const text =
    lastAssistant && lastAssistant.type === 'assistant'
      ? assistantContentToText((lastAssistant as { message?: { content?: unknown } }).message?.content)
      : '';
  const result =
    lastResult && lastResult.type === 'result'
      ? (lastResult as {
          subtype?: string;
          structured_output?: unknown;
          usage?: unknown;
          total_cost_usd?: number;
          modelUsage?: unknown;
          num_turns?: number;
        })
      : undefined;

  return {
    text,
    structuredOutput: result?.subtype === 'success' ? result.structured_output : undefined,
    resultSubtype: result?.subtype,
    usage: result?.usage,
    totalCostUsd: result?.total_cost_usd,
    modelUsage: result?.modelUsage,
    numTurns: result?.num_turns,
    toolCalls,
  };
}
