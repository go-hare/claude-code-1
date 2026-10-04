/**
 * densable 2.1.283 leftover hideHelp CLI flag strings.
 * Gold SEA /tmp/official-283/package/claude.
 * --forward-home-settings / --attach-serve / --client-data-url gates.
 */
export const FORWARD_HOME_BOOL_PREFIX =
  'Error: --forward-home-settings takes true or false, not '
export const FORWARD_HOME_CLOUD_GATE =
  "Error: --forward-home-settings says whether this machine's settings go into a cloud session; pass --cloud (a new session, or one to attach to) or --environment"
export const ATTACH_SERVE_COMBINE_CLOUD =
  'Error: --attach-serve cannot be combined with --cloud/--remote'
export const ATTACH_SERVE_EXPECTS_PREFIX =
  'Error: --attach-serve expects a session id (cse_...), got '
export const ATTACH_SERVE_REQUIRES_HEADLESS =
  'Error: --attach-serve requires the serve-only headless launch (non-interactive, --input-format stream-json and --output-format stream-json) and an enabled headless cloud client; it never falls back to a plain attach'
export const CLIENT_DATA_CLOUD_REFUSE =
  '--client-data-url (a cloud session loads its own configuration, so the document could not be used there)'
export const CLIENT_DATA_URL_ERROR_PREFIX = 'Error: --client-data-url: '
export const CLIENT_DATA_URL_ERROR_SUFFIX =
  '. Claude Code does not start without the configuration it was given; to start without it, remove the flag, or remove CLAUDE_CODE_CLIENT_DATA_URL from your environment or settings.'
