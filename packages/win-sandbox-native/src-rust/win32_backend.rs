use crate::protocol::{
    json_escape_string, parse_json, DeniesRequest, DeniesResponse, MxcProbeResponse, MxcProbes,
    MxcUiCapabilities, ProfileForgetResponse, StatusResponse, UserStatus, WfpStatus,
    WfpVerifyResponse,
};
use crate::security::{
    build_windows_command_line, reject_batch_script_program, sanitize_path, validate_guid,
    validate_probe_target, validate_proxy_port, validate_proxy_port_range, validate_proxy_url,
    validate_sandbox_username, validate_windows_sid, DEFAULT_PROXY_PORT_END,
    DEFAULT_PROXY_PORT_START, DEFAULT_SANDBOX_USERNAME, DEFAULT_WFP_SUBLAYER_GUID,
    EXIT_RUNTIME_ERROR, EXIT_UAC_CANCELLED, EXIT_VALIDATION, EXIT_WFP_ERROR,
};
use std::collections::BTreeMap;

/// Canonical `%ProgramData%` subdirectory name aligned with `@anthropic-ai/sandbox-runtime`.
#[cfg_attr(not(windows), allow(dead_code))]
pub const CANONICAL_STATE_DIR_NAME: &str = "sandbox-runtime";

/// Comprehensive NTFS deny-write permission mask preventing modification, deletion,
/// child deletion, rename, DACL tampering, and ownership takeover on protected targets
/// using granular write-only rights (without `(W)` which includes `SYNCHRONIZE` and blocks reads).
#[cfg_attr(not(windows), allow(dead_code))]
pub const DENY_WRITE_PERM: &str = "(WD,AD,WEA,WA,DE,DC,WDAC,WO)";

/// Schema version for persisted `denies.json`.
/// Version 3 guarantees granular `DENY_WRITE_PERM = "(WD,AD,WEA,WA,DE,DC,WDAC,WO)"`
/// (without `SYNCHRONIZE`) and Low integrity labels on `allow_write` roots have been applied;
/// reading legacy v1/v2/array files forces re-application of all deny ACEs.
pub const DENIES_SCHEMA_VERSION: u64 = 3;

/// Winsock `WSAEACCES` (10013) — returned when a WFP ALE_AUTH_CONNECT block filter rejects connect().
#[cfg_attr(not(windows), allow(dead_code))]
pub const WSAEACCES: i32 = 10013;

#[derive(Debug, Clone)]
pub struct BackendError {
    pub exit_code: i32,
    pub message: String,
}

impl BackendError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self {
            exit_code: EXIT_VALIDATION,
            message: message.into(),
        }
    }

    pub fn runtime(message: impl Into<String>) -> Self {
        Self {
            exit_code: EXIT_RUNTIME_ERROR,
            message: message.into(),
        }
    }

    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn uac_cancelled(message: impl Into<String>) -> Self {
        Self {
            exit_code: EXIT_UAC_CANCELLED,
            message: message.into(),
        }
    }

    pub fn wfp(message: impl Into<String>) -> Self {
        Self {
            exit_code: EXIT_WFP_ERROR,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct StatusOptions {
    pub sublayer_guid: Option<String>,
}

#[derive(Debug, Clone)]
pub struct InstallOptions {
    pub sandbox_user: String,
    pub real_user_sid: Option<String>,
    pub sublayer_guid: String,
    pub proxy_port_range: [u16; 2],
    pub allow_loopback: bool,
    pub uac_child: bool,
}

impl Default for InstallOptions {
    fn default() -> Self {
        Self {
            sandbox_user: DEFAULT_SANDBOX_USERNAME.to_string(),
            real_user_sid: None,
            sublayer_guid: DEFAULT_WFP_SUBLAYER_GUID.to_string(),
            proxy_port_range: [DEFAULT_PROXY_PORT_START, DEFAULT_PROXY_PORT_END],
            allow_loopback: true,
            uac_child: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct UninstallOptions {
    pub sandbox_user: String,
    pub sublayer_guid: String,
    pub uac_child: bool,
}

impl Default for UninstallOptions {
    fn default() -> Self {
        Self {
            sandbox_user: DEFAULT_SANDBOX_USERNAME.to_string(),
            sublayer_guid: DEFAULT_WFP_SUBLAYER_GUID.to_string(),
            uac_child: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct WfpVerifyOptions {
    pub target: String,
}

impl Default for WfpVerifyOptions {
    fn default() -> Self {
        Self {
            target: "1.1.1.1:443".to_string(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ProfileForgetOptions {
    pub sid: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RunOptions {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub proxy_port: Option<u16>,
    pub http_proxy: Option<String>,
    pub https_proxy: Option<String>,
    pub sublayer_guid: Option<String>,
    pub no_net: bool,
    pub extra_env: Vec<(String, String)>,
    pub allow_loopback: bool,
    pub block_clipboard_read: bool,
    pub block_clipboard_write: bool,
    pub block_input_injection: bool,
}

#[derive(Debug, Clone)]
pub struct ApplyRestrictedTokenOptions {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
}

pub fn validate_apply_restricted_token_options(
    opts: &ApplyRestrictedTokenOptions,
) -> Result<(String, Option<String>), BackendError> {
    reject_batch_script_program(&opts.program).map_err(BackendError::validation)?;
    let cwd = match opts.cwd.as_deref() {
        Some(raw_cwd) => Some(sanitize_path(raw_cwd).map_err(BackendError::validation)?),
        None => None,
    };
    let cmdline =
        build_windows_command_line(&opts.program, &opts.args).map_err(BackendError::validation)?;
    Ok((cmdline, cwd))
}

/// Builds argv for self-reexec under `CreateProcessWithLogonW` so the `sandbox_user`
/// child applies `DISABLE_MAX_PRIVILEGE | WRITE_RESTRICTED` + Low IL (`S-1-16-4096`)
/// to its own primary token before spawning the target program via `CreateProcessAsUserW`.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn build_self_reexec_restricted_token_args(
    program: &str,
    args: &[String],
    cwd: Option<&str>,
) -> Vec<String> {
    let mut out = vec!["--apply-restricted-token".to_string()];
    if let Some(dir) = cwd {
        out.push("--cwd".to_string());
        out.push(dir.to_string());
    }
    out.push("--".to_string());
    out.push(program.to_string());
    out.extend(args.iter().cloned());
    out
}

pub fn validate_status_options(opts: &StatusOptions) -> Result<(), BackendError> {
    if let Some(ref guid) = opts.sublayer_guid {
        validate_guid(guid).map_err(BackendError::validation)?;
    }
    Ok(())
}

pub fn validate_install_options(opts: &InstallOptions) -> Result<(), BackendError> {
    validate_sandbox_username(&opts.sandbox_user).map_err(BackendError::validation)?;
    if let Some(ref sid) = opts.real_user_sid {
        validate_windows_sid(sid).map_err(BackendError::validation)?;
    }
    validate_guid(&opts.sublayer_guid).map_err(BackendError::validation)?;
    validate_proxy_port_range(opts.proxy_port_range[0], opts.proxy_port_range[1])
        .map_err(BackendError::validation)?;
    Ok(())
}

pub fn validate_uninstall_options(opts: &UninstallOptions) -> Result<(), BackendError> {
    validate_sandbox_username(&opts.sandbox_user).map_err(BackendError::validation)?;
    validate_guid(&opts.sublayer_guid).map_err(BackendError::validation)?;
    Ok(())
}

pub fn validate_wfp_verify_options(opts: &WfpVerifyOptions) -> Result<(), BackendError> {
    validate_probe_target(&opts.target).map_err(BackendError::validation)?;
    Ok(())
}

pub fn validate_profile_forget_options(opts: &ProfileForgetOptions) -> Result<(), BackendError> {
    if let Some(ref sid) = opts.sid {
        validate_windows_sid(sid).map_err(BackendError::validation)?;
    }
    Ok(())
}

pub fn validate_denies_request(req: &DeniesRequest) -> Result<(), BackendError> {
    if let Some(ref sid) = req.sid {
        validate_windows_sid(sid).map_err(BackendError::validation)?;
    }
    for p in &req.deny_read {
        sanitize_path(p).map_err(BackendError::validation)?;
    }
    for p in &req.deny_write {
        sanitize_path(p).map_err(BackendError::validation)?;
    }
    for p in &req.allow_write {
        sanitize_path(p).map_err(BackendError::validation)?;
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct ValidatedRunOptions {
    #[cfg_attr(not(windows), allow(dead_code))]
    pub cmdline: String,
    pub cwd: Option<String>,
    pub http_proxy: Option<String>,
    pub https_proxy: Option<String>,
    #[cfg_attr(not(windows), allow(dead_code))]
    pub sublayer_guid: Option<String>,
}

pub fn validate_run_options(opts: &RunOptions) -> Result<ValidatedRunOptions, BackendError> {
    reject_batch_script_program(&opts.program).map_err(BackendError::validation)?;
    if let Some(port) = opts.proxy_port {
        validate_proxy_port(port).map_err(BackendError::validation)?;
    }
    if let Some(ref guid) = opts.sublayer_guid {
        validate_guid(guid).map_err(BackendError::validation)?;
    }
    let cwd = match opts.cwd.as_deref() {
        Some(raw_cwd) => Some(sanitize_path(raw_cwd).map_err(BackendError::validation)?),
        None => None,
    };
    let explicit_http = match opts.http_proxy.as_deref() {
        Some(raw) => Some(validate_proxy_url(raw).map_err(BackendError::validation)?),
        None => None,
    };
    let explicit_https = match opts.https_proxy.as_deref() {
        Some(raw) => Some(validate_proxy_url(raw).map_err(BackendError::validation)?),
        None => None,
    };
    for (k, v) in &opts.extra_env {
        if k.is_empty()
            || k.contains('=')
            || k.contains('\0')
            || k.contains('\r')
            || k.contains('\n')
            || v.contains('\0')
        {
            return Err(BackendError::validation(format!(
                "Invalid environment override key '{k}'"
            )));
        }
    }
    let default_url = opts
        .proxy_port
        .map(|port| format!("http://127.0.0.1:{port}"));
    let http_proxy = explicit_http.or_else(|| default_url.clone());
    let https_proxy = explicit_https.or(default_url);
    let cmdline =
        build_windows_command_line(&opts.program, &opts.args).map_err(BackendError::validation)?;
    Ok(ValidatedRunOptions {
        cmdline,
        cwd,
        http_proxy,
        https_proxy,
        sublayer_guid: opts.sublayer_guid.clone(),
    })
}

/// Validates `target_sid` and explicitly refuses if it matches the real human user's
/// `current_sid`, preventing sandbox ACL operations from locking out the active user.
pub fn ensure_not_current_user_sid(
    target_sid: &str,
    current_sid: Option<&str>,
) -> Result<(), BackendError> {
    validate_windows_sid(target_sid).map_err(BackendError::validation)?;
    if let Some(cur) = current_sid {
        if target_sid.eq_ignore_ascii_case(cur) {
            return Err(BackendError::validation(format!(
                "Refusing to apply sandbox ACL operation to current user SID '{target_sid}'"
            )));
        }
    }
    Ok(())
}

/// Canonical Windows Credential Manager target name for the sandbox user credential.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn cred_target_name(username: &str) -> String {
    format!("ClaudeSandboxRuntime/{username}")
}

/// Formats an `icacls` permission argument, applying `(OI)(CI)` inheritance flags
/// only for directories and omitting them for regular files.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn icacls_perm_arg(sid_arg: &str, perm: &str, is_dir: bool) -> String {
    if is_dir {
        format!("{sid_arg}:(OI)(CI){perm}")
    } else {
        format!("{sid_arg}:{perm}")
    }
}

/// Formats an `icacls /setintegritylevel` argument, applying `(OI)(CI)` inheritance
/// flags for directories so Low-IL restricted tokens can write into `allow_write`
/// roots without MIC `NO_WRITE_UP` denial and Medium IL is restored on revoke/uninstall.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn icacls_integrity_label_arg(level: &str, is_dir: bool) -> String {
    if is_dir {
        format!("(OI)(CI){level}")
    } else {
        level.to_string()
    }
}

/// Builds `icacls.exe` arguments to harden the `ProgramData\sandbox-runtime` state
/// directory so only `SYSTEM`, `Administrators`, and the validated real user SID
/// have access (removing inherited `Users` write access).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn build_state_dir_icacls_args(dir: &str, real_user_sid: Option<&str>) -> Vec<String> {
    let mut args = vec![
        dir.to_string(),
        "/inheritance:r".to_string(),
        "/grant:r".to_string(),
        "*S-1-5-18:(OI)(CI)F".to_string(),
        "/grant:r".to_string(),
        "*S-1-5-32-544:(OI)(CI)F".to_string(),
    ];
    if let Some(sid) = real_user_sid {
        if validate_windows_sid(sid).is_ok() {
            args.push("/grant:r".to_string());
            args.push(format!("*{sid}:(OI)(CI)F"));
        }
    }
    args
}

/// Normalizes a Windows path for case-insensitive key comparisons (`\` separators,
/// ASCII-lowercased, trailing backslash trimmed except for drive roots like `c:\`).
pub fn normalize_windows_path_key(path: &str) -> String {
    let mut norm = path.replace('/', "\\").to_ascii_lowercase();
    while norm.len() > 3 && norm.ends_with('\\') {
        norm.pop();
    }
    norm
}

/// Builds a normalized tracked-ACL key (`R:<lower>`, `W:<lower>`, or `A:<lower>`).
pub fn normalize_tracked_acl_key(prefix: char, path: &str) -> String {
    format!("{prefix}:{}", normalize_windows_path_key(path))
}

/// Checks whether `target` is equal to or strictly inside any `allow_write` root
/// using case-insensitive segment-boundary matching (so `C:\work2` is NOT under `C:\work`).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn find_matching_allow_write_root<'a>(
    target: &str,
    allow_writes: &'a [String],
) -> Option<&'a str> {
    let target_norm = normalize_windows_path_key(target);
    for root in allow_writes {
        let root_norm = normalize_windows_path_key(root);
        if target_norm == root_norm {
            return Some(root.as_str());
        }
        let prefix_with_sep = if root_norm.ends_with('\\') {
            root_norm
        } else {
            format!("{root_norm}\\")
        };
        if target_norm.starts_with(&prefix_with_sep) {
            return Some(root.as_str());
        }
    }
    None
}

/// Persisted `denies.json` payload with schema version tracking.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(not(windows), allow(dead_code))]
pub struct TrackedDeniesFile {
    pub schema_version: u64,
    pub entries: BTreeMap<String, String>,
}

/// Parses tracked ACL entries and schema version from `denies.json`.
/// Supports:
/// - v2 versioned object: `{ "schema_version": 2, "entries": { "R:c:\\...": "C:\\..." } }`
/// - legacy v1 flat object: `{ "R:c:\\...": "C:\\..." }` -> `schema_version = 1`
/// - legacy array format: `["R:C:\\..."]` -> `schema_version = 1`
#[cfg_attr(not(windows), allow(dead_code))]
pub fn parse_tracked_denies_file(raw: &str) -> TrackedDeniesFile {
    let Ok(val) = parse_json(raw) else {
        return TrackedDeniesFile {
            schema_version: DENIES_SCHEMA_VERSION,
            entries: BTreeMap::new(),
        };
    };
    let mut map = BTreeMap::new();
    if let Some(obj) = val.as_object() {
        if let (Some(ver_val), Some(entries_val)) =
            (obj.get("schema_version"), obj.get("entries"))
        {
            if let (Some(schema_version), Some(entries_obj)) =
                (ver_val.as_u64(), entries_val.as_object())
            {
                for (k, v) in entries_obj {
                    if let Some(orig) = v.as_str() {
                        if let Some((prefix, _)) = k.split_once(':') {
                            if let Some(ch) = prefix.chars().next() {
                                if prefix.len() == 1 && matches!(ch, 'R' | 'W' | 'A') {
                                    map.insert(
                                        normalize_tracked_acl_key(ch, orig),
                                        orig.to_string(),
                                    );
                                }
                            }
                        }
                    }
                }
                return TrackedDeniesFile {
                    schema_version,
                    entries: map,
                };
            }
        }
        // Legacy flat object format (v1)
        for (k, v) in obj {
            if let Some(orig) = v.as_str() {
                if let Some((prefix, _)) = k.split_once(':') {
                    if let Some(ch) = prefix.chars().next() {
                        if prefix.len() == 1 && matches!(ch, 'R' | 'W' | 'A') {
                            map.insert(normalize_tracked_acl_key(ch, orig), orig.to_string());
                        }
                    }
                }
            }
        }
        return TrackedDeniesFile {
            schema_version: 1,
            entries: map,
        };
    } else if let Some(items) = val.as_array() {
        for item in items {
            if let Some(entry) = item.as_str() {
                if let Some((prefix, orig)) = entry.split_once(':') {
                    if let Some(ch) = prefix.chars().next() {
                        if prefix.len() == 1 && matches!(ch, 'R' | 'W' | 'A') {
                            map.insert(normalize_tracked_acl_key(ch, orig), orig.to_string());
                        }
                    }
                }
            }
        }
        return TrackedDeniesFile {
            schema_version: 1,
            entries: map,
        };
    }
    TrackedDeniesFile {
        schema_version: DENIES_SCHEMA_VERSION,
        entries: map,
    }
}

/// Returns `true` if a deny ACE must be (re-)applied: either because `denies.json`
/// was loaded from an older schema version (`< DENIES_SCHEMA_VERSION`) or because
/// `key` is not present in `previous`.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn should_reapply_tracked_deny(
    loaded_schema_version: u64,
    key: &str,
    previous: &BTreeMap<String, String>,
) -> bool {
    loaded_schema_version < DENIES_SCHEMA_VERSION || !previous.contains_key(key)
}

/// Serializes tracked ACL map (`normalized_key -> original_path`) with explicit `schema_version`.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn serialize_tracked_denies_file(
    schema_version: u64,
    map: &BTreeMap<String, String>,
) -> String {
    let mut out = format!(r#"{{"schema_version":{schema_version},"entries":{{"#);
    for (idx, (k, v)) in map.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        out.push_str(&json_escape_string(k));
        out.push(':');
        out.push_str(&json_escape_string(v));
    }
    out.push_str("}}");
    out
}

/// Parses tracked ACL entries from `denies.json`, supporting v2 versioned objects,
/// legacy v1 flat objects (`{ "R:c:\\...": "C:\\..." }`), and legacy arrays (`["R:C:\\..."]`).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn parse_tracked_acl_map(raw: &str) -> BTreeMap<String, String> {
    parse_tracked_denies_file(raw).entries
}

/// Serializes tracked ACL map (`normalized_key -> original_path`) to schema v2 JSON.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn serialize_tracked_acl_map(map: &BTreeMap<String, String>) -> String {
    serialize_tracked_denies_file(DENIES_SCHEMA_VERSION, map)
}

/// Classifies a `TcpStream::connect_timeout` OS error during `wfp verify`:
/// `WSAEACCES (10013)` indicates active WFP block enforcement (`"blocked"`);
/// timeouts or network-unreachable errors are inconclusive (`"not-run"`).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn classify_wfp_connect_error(raw_os_error: Option<i32>) -> &'static str {
    if raw_os_error == Some(WSAEACCES) {
        "blocked"
    } else {
        "not-run"
    }
}

/// Returns `true` if an environment variable name holds credentials or secrets
/// that must never be forwarded into a sandboxed child process.
pub fn is_sensitive_env_var(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    const EXACT_BLOCKED: &[&str] = &[
        "SRT_WIN_SANDBOX_PASSWORD",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "CLAUDE_API_KEY",
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "GITHUB_TOKEN",
        "GH_TOKEN",
        "NPM_TOKEN",
        "AZURE_CLIENT_SECRET",
        "GCP_SERVICE_ACCOUNT_KEY",
    ];
    if EXACT_BLOCKED.contains(&upper.as_str()) {
        return true;
    }
    upper.ends_with("_API_KEY")
        || upper.ends_with("_SECRET_KEY")
        || upper.ends_with("_ACCESS_KEY")
        || upper.ends_with("_SECRET")
        || upper.ends_with("_PASSWORD")
        || upper.ends_with("_TOKEN")
        || upper.ends_with("_PRIVATE_KEY")
}

/// Safe CA trust-bundle and proxy variables that may be forwarded from the parent
/// environment into the sandboxed child process.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn is_safe_ca_or_proxy_env_var(key: &str) -> bool {
    const CA_AND_PROXY_ALLOWLIST: &[&str] = &[
        "NODE_EXTRA_CA_CERTS",
        "SSL_CERT_FILE",
        "CURL_CA_BUNDLE",
        "REQUESTS_CA_BUNDLE",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
    ];
    let upper = key.to_ascii_uppercase();
    CA_AND_PROXY_ALLOWLIST.contains(&upper.as_str())
}

/// Filters environment variables to a minimal safe allowlist when `CreateEnvironmentBlock`
/// is unavailable, ensuring host secrets and inaccessible host user `TEMP`/`TMP`
/// paths are never inherited by sandboxed processes.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn filter_safe_fallback_env(vars: Vec<(String, String)>) -> Vec<(String, String)> {
    const SAFE_ALLOWLIST: &[&str] = &[
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
        "PATH",
        "OS",
        "PROCESSOR_ARCHITECTURE",
        "NUMBER_OF_PROCESSORS",
        "SYSTEMDRIVE",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
        "COMMONPROGRAMFILES",
        "PROGRAMDATA",
        "NODE_EXTRA_CA_CERTS",
        "SSL_CERT_FILE",
        "CURL_CA_BUNDLE",
        "REQUESTS_CA_BUNDLE",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
    ];
    vars.into_iter()
        .filter(|(k, _)| {
            let upper = k.to_ascii_uppercase();
            SAFE_ALLOWLIST.contains(&upper.as_str()) && !is_sensitive_env_var(k)
        })
        .collect()
}

// ============================================================================
// Windows Native Win32 Implementation (#[cfg(windows)])
// ============================================================================

#[cfg(windows)]
mod platform {
    use super::*;
    use crate::protocol::JsonValue;
    use crate::security::{
        canonicalize_path_best_effort, quote_windows_arg, reject_symlinks_and_reparse_points,
        strip_verbatim_prefix_checked,
    };
    use std::ffi::{c_void, OsStr};
    use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::ptr;
    use std::time::{Duration, Instant};

    type Handle = *mut c_void;
    type Bool = i32;
    type Dword = u32;
    type Word = u16;
    type UlongPtr = usize;
    type SizeT = usize;
    type Lpwstr = *mut u16;
    type Lpcwstr = *const u16;

    const FALSE: Bool = 0;
    const TRUE: Bool = 1;
    const INFINITE: Dword = 0xFFFF_FFFF;

    const TOKEN_ASSIGN_PRIMARY: Dword = 0x0001;
    const TOKEN_DUPLICATE: Dword = 0x0002;
    const TOKEN_QUERY: Dword = 0x0008;
    const TOKEN_ADJUST_DEFAULT: Dword = 0x0080;
    const TOKEN_USER_INFO_CLASS: Dword = 1;
    const TOKEN_ELEVATION_INFO_CLASS: Dword = 20;
    const TOKEN_INTEGRITY_LEVEL_INFO_CLASS: Dword = 25;
    const SE_GROUP_INTEGRITY: Dword = 0x0000_0020;

    const DISABLE_MAX_PRIVILEGE: Dword = 0x1;
    const WRITE_RESTRICTED: Dword = 0x8;

    const LOGON32_LOGON_INTERACTIVE: Dword = 2;
    const LOGON32_PROVIDER_DEFAULT: Dword = 0;
    const LOGON_WITH_PROFILE: Dword = 0x0000_0001;

    const CREATE_SUSPENDED: Dword = 0x0000_0004;
    const CREATE_UNICODE_ENVIRONMENT: Dword = 0x0000_0400;

    const STARTF_USESTDHANDLES: Dword = 0x0000_0100;
    const STD_INPUT_HANDLE: Dword = (-10i32) as Dword;
    const STD_OUTPUT_HANDLE: Dword = (-11i32) as Dword;
    const STD_ERROR_HANDLE: Dword = (-12i32) as Dword;
    const HANDLE_FLAG_INHERIT: Dword = 0x0000_0001;
    const INVALID_HANDLE_VALUE: Handle = (-1isize) as Handle;

    const SEE_MASK_NOCLOSEPROCESS: Dword = 0x0000_0040;
    const SEE_MASK_NO_CONSOLE: Dword = 0x0000_8000;
    const SW_HIDE: i32 = 0;

    const POLICY_CREATE_ACCOUNT: Dword = 0x0000_0010;
    const POLICY_LOOKUP_NAMES: Dword = 0x0000_0800;
    const STATUS_SUCCESS: i32 = 0;

    const JOB_OBJECT_BASIC_UI_RESTRICTIONS: Dword = 4;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: Dword = 9;
    const JOB_OBJECT_LIMIT_ACTIVE_PROCESS: Dword = 0x0000_0008;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: Dword = 0x0000_2000;
    const JOB_OBJECT_UILIMIT_HANDLES: Dword = 0x0000_0001;
    const JOB_OBJECT_UILIMIT_READCLIPBOARD: Dword = 0x0000_0002;
    const JOB_OBJECT_UILIMIT_WRITECLIPBOARD: Dword = 0x0000_0004;
    const JOB_OBJECT_UILIMIT_GLOBALATOMS: Dword = 0x0000_0020;
    const JOB_OBJECT_UILIMIT_DESKTOP: Dword = 0x0000_0040;

    const SC_MANAGER_CONNECT: Dword = 0x0001;
    const SERVICE_QUERY_CONFIG: Dword = 0x0001;
    const SERVICE_QUERY_STATUS: Dword = 0x0004;
    const SERVICE_STOPPED: Dword = 1;
    const SERVICE_RUNNING: Dword = 4;
    const SERVICE_DISABLED: Dword = 4;

    const CRED_TYPE_GENERIC: Dword = 1;
    const CRED_PERSIST_LOCAL_MACHINE: Dword = 2;

    const ERROR_ACCESS_DENIED: Dword = 5;
    const ERROR_INSUFFICIENT_BUFFER: Dword = 122;
    const ERROR_NOT_FOUND: Dword = 1168;
    const ERROR_CANCELLED: Dword = 1223;
    const E_ACCESSDENIED: Dword = 0x8007_0005;

    const NERR_SUCCESS: Dword = 0;
    const NERR_USER_NOT_FOUND: Dword = 2221;
    const NERR_USER_EXISTS: Dword = 2224;

    const USER_PRIV_USER: Dword = 1;
    const UF_SCRIPT: Dword = 0x0001;
    const UF_PASSWD_CANT_CHANGE: Dword = 0x0040;
    const UF_NORMAL_ACCOUNT: Dword = 0x0200;
    const UF_DONT_EXPIRE_PASSWD: Dword = 0x0001_0000;

    const BCRYPT_USE_SYSTEM_PREFERRED_RNG: Dword = 0x0000_0002;

    const SECURITY_DESCRIPTOR_REVISION: Dword = 1;
    const ACL_REVISION: Dword = 2;
    const FWP_ACTRL_MATCH: Dword = 0x0000_0001;

    const RPC_C_AUTHN_WINNT: Dword = 10;
    const FWPM_SUBLAYER_FLAG_PERSISTENT: u32 = 0x0000_0001;
    const FWPM_FILTER_FLAG_PERSISTENT: u32 = 0x0000_0001;
    const FWP_E_FILTER_NOT_FOUND: Dword = 0x8032_0003;
    const FWP_E_SUBLAYER_NOT_FOUND: Dword = 0x8032_0007;

    const FWP_UINT8: u32 = 1;
    const FWP_UINT16: u32 = 2;
    const FWP_SECURITY_DESCRIPTOR_TYPE: u32 = 14;
    const FWP_V4_ADDR_MASK: u32 = 0x100;
    const FWP_V6_ADDR_MASK: u32 = 0x101;
    const FWP_RANGE_TYPE: u32 = 0x102;
    const ERROR_PRIVILEGE_NOT_HELD: Dword = 1314;

    const FWP_MATCH_EQUAL: u32 = 0;
    const FWP_MATCH_RANGE: u32 = 5;

    const FWP_ACTION_BLOCK: u32 = 0x0000_1001;
    const FWP_ACTION_PERMIT: u32 = 0x0000_1002;

    const FWPM_LAYER_ALE_AUTH_CONNECT_V4: Guid = Guid {
        data1: 0xc38d_57d1,
        data2: 0x05a7,
        data3: 0x4c33,
        data4: [0x90, 0x4f, 0x7f, 0xbc, 0xee, 0xe6, 0x0e, 0x82],
    };
    const FWPM_LAYER_ALE_AUTH_CONNECT_V6: Guid = Guid {
        data1: 0x4a72_393b,
        data2: 0x319f,
        data3: 0x44bc,
        data4: [0x84, 0xc3, 0xba, 0x54, 0xdc, 0xb3, 0xb6, 0xb4],
    };
    const FWPM_CONDITION_ALE_USER_ID: Guid = Guid {
        data1: 0xaf04_3a0a,
        data2: 0xb34d,
        data3: 0x4f86,
        data4: [0x97, 0x9c, 0xc9, 0x03, 0x71, 0xaf, 0x6e, 0x66],
    };
    const FWPM_CONDITION_IP_REMOTE_ADDRESS: Guid = Guid {
        data1: 0xb235_ae9a,
        data2: 0x1d64,
        data3: 0x49b8,
        data4: [0xa4, 0x4c, 0x5f, 0xf3, 0xd9, 0x09, 0x50, 0x45],
    };
    const FWPM_CONDITION_IP_REMOTE_PORT: Guid = Guid {
        data1: 0xc35a_604d,
        data2: 0xd22b,
        data3: 0x4e1a,
        data4: [0x91, 0xb4, 0x68, 0xf6, 0x74, 0xee, 0x67, 0x4b],
    };

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Guid {
        data1: u32,
        data2: u16,
        data3: u16,
        data4: [u8; 8],
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct SidAndAttributes {
        sid: *mut c_void,
        attributes: Dword,
    }

    #[repr(C)]
    struct TokenUser {
        user: SidAndAttributes,
    }

    #[repr(C)]
    struct TokenElevation {
        token_is_elevated: Dword,
    }

    #[repr(C)]
    struct TokenMandatoryLabel {
        label: SidAndAttributes,
    }

    #[repr(C)]
    struct LsaUnicodeString {
        length: u16,
        maximum_length: u16,
        buffer: Lpwstr,
    }

    #[repr(C)]
    struct LsaObjectAttributes {
        length: Dword,
        root_directory: Handle,
        object_name: *mut LsaUnicodeString,
        attributes: Dword,
        security_descriptor: *mut c_void,
        security_quality_of_service: *mut c_void,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct QueryServiceConfigW {
        dw_service_type: Dword,
        dw_start_type: Dword,
        dw_error_control: Dword,
        lp_binary_path_name: Lpwstr,
        lp_load_order_group: Lpwstr,
        dw_tag_id: Dword,
        lp_dependencies: Lpwstr,
        lp_service_start_name: Lpwstr,
        lp_display_name: Lpwstr,
    }

    #[repr(C)]
    struct ShellExecuteInfoW {
        cb_size: Dword,
        f_mask: Dword,
        hwnd: Handle,
        lp_verb: Lpcwstr,
        lp_file: Lpcwstr,
        lp_parameters: Lpcwstr,
        lp_directory: Lpcwstr,
        n_show: i32,
        h_inst_app: Handle,
        lp_id_list: *mut c_void,
        lp_class: Lpcwstr,
        hkey_class: Handle,
        dw_hot_key: Dword,
        h_icon_or_monitor: Handle,
        h_process: Handle,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct FileTime {
        dw_low_date_time: Dword,
        dw_high_date_time: Dword,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct CredentialW {
        flags: Dword,
        cred_type: Dword,
        target_name: Lpwstr,
        comment: Lpwstr,
        last_written: FileTime,
        credential_blob_size: Dword,
        credential_blob: *mut u8,
        persist: Dword,
        attribute_count: Dword,
        attributes: *mut c_void,
        target_alias: Lpwstr,
        user_name: Lpwstr,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct UserInfo1 {
        usri1_name: Lpwstr,
        usri1_password: Lpwstr,
        usri1_password_age: Dword,
        usri1_priv: Dword,
        usri1_home_dir: Lpwstr,
        usri1_comment: Lpwstr,
        usri1_flags: Dword,
        usri1_script_path: Lpwstr,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct UserInfo1003 {
        usri1003_password: Lpwstr,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct ServiceStatus {
        dw_service_type: Dword,
        dw_current_state: Dword,
        dw_controls_accepted: Dword,
        dw_win32_exit_code: Dword,
        dw_service_specific_exit_code: Dword,
        dw_check_point: Dword,
        dw_wait_hint: Dword,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct StartupInfoW {
        cb: Dword,
        lp_reserved: Lpwstr,
        lp_desktop: Lpwstr,
        lp_title: Lpwstr,
        dw_x: Dword,
        dw_y: Dword,
        dw_x_size: Dword,
        dw_y_size: Dword,
        dw_x_count_chars: Dword,
        dw_y_count_chars: Dword,
        dw_fill_attribute: Dword,
        dw_flags: Dword,
        w_show_window: Word,
        cb_reserved2: Word,
        lp_reserved2: *mut u8,
        h_std_input: Handle,
        h_std_output: Handle,
        h_std_error: Handle,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct ProcessInformation {
        h_process: Handle,
        h_thread: Handle,
        dw_process_id: Dword,
        dw_thread_id: Dword,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct JobObjectBasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: Dword,
        minimum_working_set_size: SizeT,
        maximum_working_set_size: SizeT,
        active_process_limit: Dword,
        affinity: UlongPtr,
        priority_class: Dword,
        scheduling_class: Dword,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct JobObjectExtendedLimitInformation {
        basic_limit_information: JobObjectBasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: SizeT,
        job_memory_limit: SizeT,
        peak_process_memory_used: SizeT,
        peak_job_memory_used: SizeT,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct JobObjectBasicUiRestrictions {
        ui_restrictions_class: Dword,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct FwpmDisplayData0 {
        name: Lpwstr,
        description: Lpwstr,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct FwpmSublayer0 {
        sub_layer_key: Guid,
        display_data: FwpmDisplayData0,
        flags: u32,
        provider_key: *mut Guid,
        provider_data: FwpByteBlob,
        weight: u16,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct FwpByteBlob {
        size: u32,
        data: *mut u8,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct FwpV4AddrAndMask {
        addr: u32,
        mask: u32,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct FwpV6AddrAndMask {
        addr: [u8; 16],
        prefix_length: u8,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    #[allow(dead_code)]
    union FwpValueData {
        uint8: u8,
        uint16: u16,
        byte_blob: *mut FwpByteBlob,
        v4_addr_mask: *mut FwpV4AddrAndMask,
        v6_addr_mask: *mut FwpV6AddrAndMask,
        range_value: *mut FwpRange0,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    #[allow(dead_code)]
    struct FwpValue0 {
        value_type: u32,
        data: FwpValueData,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct FwpRange0 {
        value_low: FwpValue0,
        value_high: FwpValue0,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct FwpmFilterCondition0 {
        field_key: Guid,
        match_type: u32,
        condition_value: FwpValue0,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct FwpmAction0 {
        action_type: u32,
        filter_type: Guid,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct FwpmFilterContext {
        raw: [u64; 2],
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct FwpmFilter0 {
        filter_key: Guid,
        display_data: FwpmDisplayData0,
        flags: u32,
        provider_key: *mut Guid,
        provider_data: FwpByteBlob,
        layer_key: Guid,
        sub_layer_key: Guid,
        weight: FwpValue0,
        num_filter_conditions: u32,
        filter_condition: *mut FwpmFilterCondition0,
        action: FwpmAction0,
        context: FwpmFilterContext,
        reserved: *mut Guid,
        filter_id: u64,
        effective_weight: FwpValue0,
    }

    #[link(name = "advapi32")]
    extern "system" {
        fn OpenProcessToken(
            process_handle: Handle,
            desired_access: Dword,
            token_handle: *mut Handle,
        ) -> Bool;
        fn CreateRestrictedToken(
            existing_token_handle: Handle,
            flags: Dword,
            disable_sid_count: Dword,
            sids_to_disable: *const c_void,
            delete_privilege_count: Dword,
            privileges_to_delete: *const c_void,
            restricted_sid_count: Dword,
            sids_to_restrict: *const c_void,
            new_token_handle: *mut Handle,
        ) -> Bool;
        fn LogonUserW(
            lpsz_username: Lpcwstr,
            lpsz_domain: Lpcwstr,
            lpsz_password: Lpcwstr,
            dw_logon_type: Dword,
            dw_logon_provider: Dword,
            ph_token: *mut Handle,
        ) -> Bool;
        fn ImpersonateLoggedOnUser(h_token: Handle) -> Bool;
        fn RevertToSelf() -> Bool;
        fn CreateProcessAsUserW(
            h_token: Handle,
            lp_application_name: Lpcwstr,
            lp_command_line: Lpwstr,
            lp_process_attributes: *const c_void,
            lp_thread_attributes: *const c_void,
            b_inherit_handles: Bool,
            dw_creation_flags: Dword,
            lp_environment: *const c_void,
            lp_current_directory: Lpcwstr,
            lp_startup_info: *const StartupInfoW,
            lp_process_information: *mut ProcessInformation,
        ) -> Bool;
        fn CreateProcessWithTokenW(
            h_token: Handle,
            dw_logon_flags: Dword,
            lp_application_name: Lpcwstr,
            lp_command_line: Lpwstr,
            dw_creation_flags: Dword,
            lp_environment: *const c_void,
            lp_current_directory: Lpcwstr,
            lp_startup_info: *const StartupInfoW,
            lp_process_information: *mut ProcessInformation,
        ) -> Bool;
        fn CreateProcessWithLogonW(
            lp_username: Lpcwstr,
            lp_domain: Lpcwstr,
            lp_password: Lpcwstr,
            dw_logon_flags: Dword,
            lp_application_name: Lpcwstr,
            lp_command_line: Lpwstr,
            dw_creation_flags: Dword,
            lp_environment: *const c_void,
            lp_current_directory: Lpcwstr,
            lp_startup_info: *const StartupInfoW,
            lp_process_information: *mut ProcessInformation,
        ) -> Bool;
        fn GetTokenInformation(
            token_handle: Handle,
            token_information_class: Dword,
            token_information: *mut c_void,
            token_information_length: Dword,
            return_length: *mut Dword,
        ) -> Bool;
        fn SetTokenInformation(
            token_handle: Handle,
            token_information_class: Dword,
            token_information: *const c_void,
            token_information_length: Dword,
        ) -> Bool;
        fn GetLengthSid(p_sid: *mut c_void) -> Dword;
        fn LookupAccountNameW(
            lp_system_name: Lpcwstr,
            lp_account_name: Lpcwstr,
            sid: *mut c_void,
            cb_sid: *mut Dword,
            referenced_domain_name: Lpwstr,
            cch_referenced_domain_name: *mut Dword,
            pe_use: *mut Dword,
        ) -> Bool;
        fn ConvertSidToStringSidW(sid: *const c_void, string_sid: *mut Lpwstr) -> Bool;
        fn ConvertStringSidToSidW(string_sid: Lpcwstr, sid: *mut *mut c_void) -> Bool;
        fn LsaOpenPolicy(
            system_name: *const LsaUnicodeString,
            object_attributes: *const LsaObjectAttributes,
            desired_access: Dword,
            policy_handle: *mut Handle,
        ) -> i32;
        fn LsaAddAccountRights(
            policy_handle: Handle,
            account_sid: *mut c_void,
            user_rights: *const LsaUnicodeString,
            count_of_rights: Dword,
        ) -> i32;
        fn LsaClose(object_handle: Handle) -> i32;
        fn InitializeSecurityDescriptor(
            p_security_descriptor: *mut c_void,
            dw_revision: Dword,
        ) -> Bool;
        fn InitializeAcl(p_acl: *mut c_void, n_acl_length: Dword, dw_acl_revision: Dword) -> Bool;
        fn AddAccessAllowedAce(
            p_acl: *mut c_void,
            dw_ace_revision: Dword,
            access_mask: Dword,
            p_sid: *mut c_void,
        ) -> Bool;
        fn SetSecurityDescriptorDacl(
            p_security_descriptor: *mut c_void,
            b_dacl_present: Bool,
            p_dacl: *mut c_void,
            b_dacl_defaulted: Bool,
        ) -> Bool;
        fn SetSecurityDescriptorOwner(
            p_security_descriptor: *mut c_void,
            p_owner: *mut c_void,
            b_owner_defaulted: Bool,
        ) -> Bool;
        fn SetSecurityDescriptorGroup(
            p_security_descriptor: *mut c_void,
            p_group: *mut c_void,
            b_group_defaulted: Bool,
        ) -> Bool;
        fn MakeSelfRelativeSD(
            p_absolute_security_descriptor: *const c_void,
            p_self_relative_security_descriptor: *mut c_void,
            lpdw_buffer_length: *mut Dword,
        ) -> Bool;
        fn OpenSCManagerW(
            lp_machine_name: Lpcwstr,
            lp_database_name: Lpcwstr,
            dw_desired_access: Dword,
        ) -> Handle;
        fn OpenServiceW(
            h_sc_manager: Handle,
            lp_service_name: Lpcwstr,
            dw_desired_access: Dword,
        ) -> Handle;
        fn QueryServiceStatus(h_service: Handle, lp_service_status: *mut ServiceStatus) -> Bool;
        fn QueryServiceConfigW(
            h_service: Handle,
            lp_service_config: *mut QueryServiceConfigW,
            cb_buf_size: Dword,
            pcb_bytes_needed: *mut Dword,
        ) -> Bool;
        fn CloseServiceHandle(h_sc_object: Handle) -> Bool;
        fn CredReadW(
            target_name: Lpcwstr,
            cred_type: Dword,
            flags: Dword,
            credential: *mut *mut c_void,
        ) -> Bool;
        fn CredWriteW(credential: *const CredentialW, flags: Dword) -> Bool;
        fn CredDeleteW(target_name: Lpcwstr, cred_type: Dword, flags: Dword) -> Bool;
        fn CredFree(buffer: *mut c_void);
    }

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteExW(p_exec_info: *mut ShellExecuteInfoW) -> Bool;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> Handle;
        fn GetStdHandle(n_std_handle: Dword) -> Handle;
        fn SetHandleInformation(h_object: Handle, dw_mask: Dword, dw_flags: Dword) -> Bool;
        fn CreateJobObjectW(lp_job_attributes: *const c_void, lp_name: Lpcwstr) -> Handle;
        fn SetInformationJobObject(
            h_job: Handle,
            job_object_information_class: Dword,
            lp_job_object_information: *const c_void,
            cb_job_object_information_length: Dword,
        ) -> Bool;
        fn AssignProcessToJobObject(h_job: Handle, h_process: Handle) -> Bool;
        fn ResumeThread(h_thread: Handle) -> Dword;
        fn TerminateProcess(h_process: Handle, u_exit_code: Dword) -> Bool;
        fn WaitForSingleObject(h_handle: Handle, dw_milliseconds: Dword) -> Dword;
        fn GetExitCodeProcess(h_process: Handle, lp_exit_code: *mut Dword) -> Bool;
        fn CloseHandle(h_object: Handle) -> Bool;
        fn LocalFree(h_mem: *mut c_void) -> *mut c_void;
        fn GetLastError() -> Dword;
    }

    #[link(name = "netapi32")]
    extern "system" {
        fn NetUserGetInfo(
            servername: Lpcwstr,
            username: Lpcwstr,
            level: Dword,
            bufptr: *mut *mut u8,
        ) -> Dword;
        fn NetUserAdd(
            servername: Lpcwstr,
            level: Dword,
            buf: *const u8,
            parm_err: *mut Dword,
        ) -> Dword;
        fn NetUserSetInfo(
            servername: Lpcwstr,
            username: Lpcwstr,
            level: Dword,
            buf: *const u8,
            parm_err: *mut Dword,
        ) -> Dword;
        fn NetUserDel(servername: Lpcwstr, username: Lpcwstr) -> Dword;
        fn NetApiBufferFree(buffer: *mut c_void) -> Dword;
    }

    #[link(name = "bcrypt")]
    extern "system" {
        fn BCryptGenRandom(
            h_algorithm: Handle,
            pb_buffer: *mut u8,
            cb_buffer: Dword,
            dw_flags: Dword,
        ) -> i32;
    }

    #[link(name = "fwpuclnt")]
    extern "system" {
        fn FwpmEngineOpen0(
            server_name: Lpcwstr,
            authn_service: Dword,
            auth_identity: *const c_void,
            session: *const c_void,
            engine_handle: *mut Handle,
        ) -> Dword;
        fn FwpmEngineClose0(engine_handle: Handle) -> Dword;
        fn FwpmTransactionBegin0(engine_handle: Handle, flags: Dword) -> Dword;
        fn FwpmTransactionCommit0(engine_handle: Handle) -> Dword;
        fn FwpmTransactionAbort0(engine_handle: Handle) -> Dword;
        fn FwpmSubLayerGetByKey0(
            engine_handle: Handle,
            key: *const Guid,
            sub_layer: *mut *mut FwpmSublayer0,
        ) -> Dword;
        fn FwpmSubLayerAdd0(
            engine_handle: Handle,
            sub_layer: *const FwpmSublayer0,
            sd: *const c_void,
        ) -> Dword;
        fn FwpmSubLayerDeleteByKey0(engine_handle: Handle, key: *const Guid) -> Dword;
        fn FwpmFilterGetByKey0(
            engine_handle: Handle,
            key: *const Guid,
            filter: *mut *mut FwpmFilter0,
        ) -> Dword;
        fn FwpmFilterAdd0(
            engine_handle: Handle,
            filter: *const FwpmFilter0,
            sd: *const c_void,
            id: *mut u64,
        ) -> Dword;
        fn FwpmFilterDeleteByKey0(engine_handle: Handle, key: *const Guid) -> Dword;
        fn FwpmFreeMemory0(p: *mut *mut c_void);
    }

    #[link(name = "userenv")]
    extern "system" {
        fn CreateEnvironmentBlock(
            lp_environment: *mut *mut c_void,
            h_token: Handle,
            b_inherit: Bool,
        ) -> Bool;
        fn DestroyEnvironmentBlock(lp_environment: *mut c_void) -> Bool;
    }

    struct OwnedHandle(Handle);

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
    }

    struct ImpersonationGuard;

    impl Drop for ImpersonationGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = RevertToSelf();
            }
        }
    }

    struct OwnedSid {
        buf: Vec<u64>,
        byte_len: Dword,
    }

    impl OwnedSid {
        fn as_ptr(&self) -> *mut c_void {
            self.buf.as_ptr() as *mut c_void
        }
    }

    fn zeroize_u16(buf: &mut [u16]) {
        for slot in buf.iter_mut() {
            unsafe {
                ptr::write_volatile(slot, 0);
            }
        }
    }

    fn zeroize_u8(buf: &mut [u8]) {
        for slot in buf.iter_mut() {
            unsafe {
                ptr::write_volatile(slot, 0);
            }
        }
    }

    fn to_wide_null(s: &str) -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn parse_guid_struct(guid: &str) -> Result<Guid, BackendError> {
        validate_guid(guid).map_err(BackendError::validation)?;
        let hex: String = guid.chars().filter(|&c| c != '-').collect();
        let data1 = u32::from_str_radix(&hex[0..8], 16)
            .map_err(|e| BackendError::validation(format!("Invalid GUID data1: {e}")))?;
        let data2 = u16::from_str_radix(&hex[8..12], 16)
            .map_err(|e| BackendError::validation(format!("Invalid GUID data2: {e}")))?;
        let data3 = u16::from_str_radix(&hex[12..16], 16)
            .map_err(|e| BackendError::validation(format!("Invalid GUID data3: {e}")))?;
        let mut data4 = [0u8; 8];
        for i in 0..8 {
            data4[i] = u8::from_str_radix(&hex[16 + i * 2..18 + i * 2], 16)
                .map_err(|e| BackendError::validation(format!("Invalid GUID data4: {e}")))?;
        }
        Ok(Guid {
            data1,
            data2,
            data3,
            data4,
        })
    }

    fn derived_filter_guid(sublayer: &Guid, tag: u8) -> Guid {
        let mut g = *sublayer;
        g.data4[7] = g.data4[7].wrapping_add(tag);
        g.data4[6] ^= tag.wrapping_mul(0x5A);
        g
    }

    fn configured_sandbox_username() -> Result<String, BackendError> {
        let user = std::env::var("SRT_WIN_SANDBOX_USER")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| DEFAULT_SANDBOX_USERNAME.to_string());
        validate_sandbox_username(&user).map_err(BackendError::validation)?;
        Ok(user)
    }

    fn state_dir() -> PathBuf {
        #[cfg(debug_assertions)]
        if let Ok(dir) = std::env::var("SRT_WIN_TEST_STATE_DIR") {
            if !dir.trim().is_empty() {
                return PathBuf::from(dir);
            }
        }
        let base = std::env::var("ProgramData")
            .or_else(|_| std::env::var("PROGRAMDATA"))
            .or_else(|_| std::env::var("LOCALAPPDATA"))
            .unwrap_or_else(|_| r"C:\ProgramData".to_string());
        PathBuf::from(base).join(CANONICAL_STATE_DIR_NAME)
    }

    fn harden_state_dir_acl(dir: &Path, real_user_sid: Option<&str>) -> Result<(), BackendError> {
        std::fs::create_dir_all(dir).map_err(|e| {
            BackendError::runtime(format!(
                "Failed to create state directory '{}': {e}",
                dir.display()
            ))
        })?;
        let icacls = icacls_exe_path()?;
        let dir_str = dir.to_string_lossy();
        let args = build_state_dir_icacls_args(&dir_str, real_user_sid);
        let status = Command::new(&icacls)
            .args(&args)
            .status()
            .map_err(|e| {
                BackendError::runtime(format!(
                    "Failed to invoke icacls.exe to harden state dir '{}': {e}",
                    dir.display()
                ))
            })?;
        if !status.success() {
            return Err(BackendError::runtime(format!(
                "icacls.exe failed to harden state directory '{}' (exit {:?})",
                dir.display(),
                status.code()
            )));
        }
        Ok(())
    }

    #[derive(Debug, Clone)]
    struct WfpPersistedConfig {
        sandbox_user: Option<String>,
        sublayer_guid: Option<String>,
        allow_loopback: bool,
        proxy_port_range: Option<[u16; 2]>,
    }

    fn wfp_config_file() -> PathBuf {
        state_dir().join("wfp-config.json")
    }

    fn save_wfp_config(opts: &InstallOptions) -> Result<(), BackendError> {
        let dir = state_dir();
        let real_sid = opts.real_user_sid.clone().or_else(current_user_sid);
        harden_state_dir_acl(&dir, real_sid.as_deref())?;
        let json = format!(
            "{{\"sandboxUser\":{},\"sublayerGuid\":{},\"allowLoopback\":{},\"proxyPortRange\":[{},{}]}}",
            json_escape_string(&opts.sandbox_user),
            json_escape_string(&opts.sublayer_guid),
            opts.allow_loopback,
            opts.proxy_port_range[0],
            opts.proxy_port_range[1],
        );
        std::fs::write(wfp_config_file(), json)
            .map_err(|e| BackendError::runtime(format!("Failed to write wfp-config.json: {e}")))
    }

    fn load_wfp_config() -> Option<WfpPersistedConfig> {
        let raw = std::fs::read_to_string(wfp_config_file()).ok()?;
        let val = parse_json(&raw).ok()?;
        let map = val.as_object()?;
        let sandbox_user = map
            .get("sandboxUser")
            .and_then(JsonValue::as_str)
            .map(ToString::to_string);
        let sublayer_guid = map
            .get("sublayerGuid")
            .and_then(JsonValue::as_str)
            .map(ToString::to_string);
        let allow_loopback = map
            .get("allowLoopback")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false);
        let proxy_port_range = map
            .get("proxyPortRange")
            .and_then(JsonValue::as_array)
            .and_then(|arr| {
                if arr.len() == 2 {
                    let s = arr[0].as_u64().and_then(|v| u16::try_from(v).ok())?;
                    let e = arr[1].as_u64().and_then(|v| u16::try_from(v).ok())?;
                    Some([s, e])
                } else {
                    None
                }
            });
        Some(WfpPersistedConfig {
            sandbox_user,
            sublayer_guid,
            allow_loopback,
            proxy_port_range,
        })
    }

    fn is_process_elevated() -> bool {
        unsafe {
            let mut token: Handle = ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == FALSE {
                return false;
            }
            let _guard = OwnedHandle(token);
            let mut elevation = TokenElevation {
                token_is_elevated: 0,
            };
            let mut ret_len: Dword = 0;
            if GetTokenInformation(
                token,
                TOKEN_ELEVATION_INFO_CLASS,
                &mut elevation as *mut TokenElevation as *mut c_void,
                std::mem::size_of::<TokenElevation>() as Dword,
                &mut ret_len,
            ) == FALSE
            {
                return false;
            }
            elevation.token_is_elevated != 0
        }
    }

    fn self_elevate_with_uac(subcommand_args: &[String]) -> Result<i32, BackendError> {
        let exe_path = std::env::current_exe().map_err(|e| {
            BackendError::runtime(format!("Failed to resolve current executable for UAC: {e}"))
        })?;
        let exe_w = to_wide_null(&exe_path.to_string_lossy());
        let verb_w = to_wide_null("runas");
        let params_str = subcommand_args
            .iter()
            .map(|a| quote_windows_arg(a))
            .collect::<Vec<_>>()
            .join(" ");
        let params_w = to_wide_null(&params_str);

        unsafe {
            let mut sei: ShellExecuteInfoW = std::mem::zeroed();
            sei.cb_size = std::mem::size_of::<ShellExecuteInfoW>() as Dword;
            sei.f_mask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NO_CONSOLE;
            sei.lp_verb = verb_w.as_ptr();
            sei.lp_file = exe_w.as_ptr();
            sei.lp_parameters = params_w.as_ptr();
            sei.n_show = SW_HIDE;

            if ShellExecuteExW(&mut sei) == FALSE {
                let err = GetLastError();
                if err == ERROR_CANCELLED {
                    return Err(BackendError::uac_cancelled(
                        "Administrator elevation (UAC) was cancelled by the user",
                    ));
                }
                return Err(BackendError::runtime(format!(
                    "ShellExecuteExW UAC elevation failed with error {err}"
                )));
            }

            if sei.h_process.is_null() {
                return Err(BackendError::runtime(
                    "ShellExecuteExW succeeded without returning a child process handle",
                ));
            }
            let _proc_guard = OwnedHandle(sei.h_process);
            WaitForSingleObject(sei.h_process, INFINITE);
            let mut exit_code: Dword = 1;
            if GetExitCodeProcess(sei.h_process, &mut exit_code) == FALSE {
                return Err(BackendError::runtime(format!(
                    "GetExitCodeProcess on elevated helper failed with error {}",
                    GetLastError()
                )));
            }
            Ok(exit_code as i32)
        }
    }

    fn icacls_exe_path() -> Result<PathBuf, BackendError> {
        let sys_root = std::env::var("SystemRoot")
            .or_else(|_| std::env::var("WINDIR"))
            .map_err(|_| {
                BackendError::runtime(
                    "SystemRoot/WINDIR is not set; cannot safely resolve icacls.exe",
                )
            })?;
        let sanitized_root = sanitize_path(&sys_root).map_err(BackendError::runtime)?;
        let exe = PathBuf::from(sanitized_root)
            .join("System32")
            .join("icacls.exe");
        if !exe.is_file() {
            return Err(BackendError::runtime(format!(
                "System icacls.exe not found at '{}'",
                exe.display()
            )));
        }
        Ok(exe)
    }

    unsafe fn sid_ptr_to_string(sid_ptr: *const c_void) -> Option<String> {
        if sid_ptr.is_null() {
            return None;
        }
        let mut wide_sid: Lpwstr = ptr::null_mut();
        if ConvertSidToStringSidW(sid_ptr, &mut wide_sid) == FALSE || wide_sid.is_null() {
            return None;
        }
        let mut len = 0usize;
        while *wide_sid.add(len) != 0 {
            len += 1;
        }
        let slice = std::slice::from_raw_parts(wide_sid, len);
        let sid_str = String::from_utf16_lossy(slice);
        LocalFree(wide_sid as *mut c_void);
        Some(sid_str)
    }

    /// Queries `TOKEN_USER` into an 8-byte aligned `Vec<u64>` buffer (P1-6: avoids misaligned
    /// pointer UB) and returns `(aligned_buffer, user_sid_ptr)`.
    unsafe fn query_token_user_buf(token: Handle) -> Option<(Vec<u64>, *mut c_void)> {
        let mut needed: Dword = 0;
        GetTokenInformation(
            token,
            TOKEN_USER_INFO_CLASS,
            ptr::null_mut(),
            0,
            &mut needed,
        );
        if (needed as usize) < std::mem::size_of::<TokenUser>() {
            return None;
        }
        let u64_len = (needed as usize).div_ceil(std::mem::size_of::<u64>());
        let mut buf = vec![0u64; u64_len];
        if GetTokenInformation(
            token,
            TOKEN_USER_INFO_CLASS,
            buf.as_mut_ptr() as *mut c_void,
            needed,
            &mut needed,
        ) == FALSE
        {
            return None;
        }
        if (needed as usize) < std::mem::size_of::<TokenUser>() {
            return None;
        }
        let tu: TokenUser = ptr::read_unaligned(buf.as_ptr() as *const TokenUser);
        if tu.user.sid.is_null() {
            return None;
        }
        Some((buf, tu.user.sid))
    }

    fn current_user_sid() -> Option<String> {
        unsafe {
            let mut token: Handle = ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == FALSE {
                return None;
            }
            let _token_guard = OwnedHandle(token);
            let (_buf, sid_ptr) = query_token_user_buf(token)?;
            sid_ptr_to_string(sid_ptr)
        }
    }

    fn lookup_account_sid(username: &str) -> Result<OwnedSid, BackendError> {
        validate_sandbox_username(username).map_err(BackendError::validation)?;
        let wide_user = to_wide_null(username);
        unsafe {
            let mut sid_len: Dword = 0;
            let mut domain_len: Dword = 0;
            let mut sid_use: Dword = 0;
            let _ = LookupAccountNameW(
                ptr::null(),
                wide_user.as_ptr(),
                ptr::null_mut(),
                &mut sid_len,
                ptr::null_mut(),
                &mut domain_len,
                &mut sid_use,
            );
            if sid_len == 0 {
                return Err(BackendError::runtime(format!(
                    "LookupAccountNameW failed for sandbox user '{}' with error {}",
                    username,
                    GetLastError()
                )));
            }
            let u64_len = (sid_len as usize).div_ceil(std::mem::size_of::<u64>());
            let mut sid_buf = vec![0u64; u64_len];
            let mut domain_buf = vec![0u16; domain_len.max(1) as usize];
            if LookupAccountNameW(
                ptr::null(),
                wide_user.as_ptr(),
                sid_buf.as_mut_ptr() as *mut c_void,
                &mut sid_len,
                domain_buf.as_mut_ptr(),
                &mut domain_len,
                &mut sid_use,
            ) == FALSE
            {
                return Err(BackendError::runtime(format!(
                    "LookupAccountNameW failed for sandbox user '{}' with error {}",
                    username,
                    GetLastError()
                )));
            }
            Ok(OwnedSid {
                buf: sid_buf,
                byte_len: sid_len,
            })
        }
    }

    fn resolve_sandbox_user_sid(username: &str) -> Result<String, BackendError> {
        let owned_sid = lookup_account_sid(username)?;
        let sid_str = unsafe { sid_ptr_to_string(owned_sid.as_ptr()) }.ok_or_else(|| {
            BackendError::runtime(format!(
                "ConvertSidToStringSidW failed for sandbox user '{username}'"
            ))
        })?;
        validate_windows_sid(&sid_str).map_err(BackendError::validation)?;
        Ok(sid_str)
    }

    fn query_seclogon_state() -> String {
        unsafe {
            let scm = OpenSCManagerW(ptr::null(), ptr::null(), SC_MANAGER_CONNECT);
            if scm.is_null() {
                return "unknown".to_string();
            }
            let name = to_wide_null("seclogon");
            let mut svc = OpenServiceW(
                scm,
                name.as_ptr(),
                SERVICE_QUERY_STATUS | SERVICE_QUERY_CONFIG,
            );
            let can_query_config = !svc.is_null();
            if svc.is_null() {
                svc = OpenServiceW(scm, name.as_ptr(), SERVICE_QUERY_STATUS);
            }
            if svc.is_null() {
                CloseServiceHandle(scm);
                return "unknown".to_string();
            }

            if can_query_config {
                let mut needed: Dword = 0;
                let _ = QueryServiceConfigW(svc, ptr::null_mut(), 0, &mut needed);
                if needed > 0 && GetLastError() == ERROR_INSUFFICIENT_BUFFER {
                    let u64_len = (needed as usize).div_ceil(std::mem::size_of::<u64>());
                    let mut cfg_buf = vec![0u64; u64_len];
                    if QueryServiceConfigW(
                        svc,
                        cfg_buf.as_mut_ptr() as *mut QueryServiceConfigW,
                        needed,
                        &mut needed,
                    ) != FALSE
                    {
                        let cfg = &*(cfg_buf.as_ptr() as *const QueryServiceConfigW);
                        if cfg.dw_start_type == SERVICE_DISABLED {
                            CloseServiceHandle(svc);
                            CloseServiceHandle(scm);
                            return "disabled".to_string();
                        }
                    }
                }
            }

            let mut status: ServiceStatus = std::mem::zeroed();
            let ok = QueryServiceStatus(svc, &mut status);
            CloseServiceHandle(svc);
            CloseServiceHandle(scm);
            if ok == FALSE {
                return "unknown".to_string();
            }
            match status.dw_current_state {
                SERVICE_RUNNING => "running".to_string(),
                SERVICE_STOPPED => "stopped".to_string(),
                _ => "unknown".to_string(),
            }
        }
    }

    fn check_sandbox_user_exists(username: &str) -> bool {
        let wide = to_wide_null(username);
        unsafe {
            let mut buf: *mut u8 = ptr::null_mut();
            let rc = NetUserGetInfo(ptr::null(), wide.as_ptr(), 0, &mut buf);
            if !buf.is_null() {
                NetApiBufferFree(buf as *mut c_void);
            }
            rc == NERR_SUCCESS
        }
    }

    fn check_sandbox_cred_present(username: &str) -> bool {
        let target = to_wide_null(&cred_target_name(username));
        unsafe {
            let mut cred: *mut c_void = ptr::null_mut();
            if CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut cred) != FALSE {
                if !cred.is_null() {
                    CredFree(cred);
                }
                true
            } else {
                false
            }
        }
    }

    /// Reads the sandbox account password from Windows Credential Manager
    /// (`ClaudeSandboxRuntime/<username>`), returning a NUL-terminated UTF-16 vector.
    fn read_sandbox_password(username: &str) -> Result<Vec<u16>, BackendError> {
        let target_str = cred_target_name(username);
        let target_w = to_wide_null(&target_str);
        unsafe {
            let mut cred_ptr: *mut c_void = ptr::null_mut();
            if CredReadW(target_w.as_ptr(), CRED_TYPE_GENERIC, 0, &mut cred_ptr) == FALSE
                || cred_ptr.is_null()
            {
                return Err(BackendError::runtime(format!(
                    "Sandbox credential '{}' not found in Windows Credential Manager (error {})",
                    target_str,
                    GetLastError()
                )));
            }
            let cred = &*(cred_ptr as *const CredentialW);
            let blob_len = cred.credential_blob_size as usize;
            if cred.credential_blob.is_null() || blob_len == 0 || blob_len % 2 != 0 {
                CredFree(cred_ptr);
                return Err(BackendError::runtime(format!(
                    "Sandbox credential '{target_str}' has an invalid password blob"
                )));
            }
            let raw_bytes = std::slice::from_raw_parts(cred.credential_blob, blob_len);
            let mut wide_pass: Vec<u16> = raw_bytes
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect();
            CredFree(cred_ptr);
            while wide_pass.last() == Some(&0) {
                wide_pass.pop();
            }
            if wide_pass.is_empty() {
                return Err(BackendError::runtime(format!(
                    "Sandbox credential '{target_str}' contains an empty password"
                )));
            }
            wide_pass.push(0);
            Ok(wide_pass)
        }
    }

    fn generate_sandbox_password() -> Result<Vec<u16>, BackendError> {
        let mut raw = [0u8; 32];
        let status = unsafe {
            BCryptGenRandom(
                ptr::null_mut(),
                raw.as_mut_ptr(),
                raw.len() as Dword,
                BCRYPT_USE_SYSTEM_PREFERRED_RNG,
            )
        };
        if status != 0 {
            zeroize_u8(&mut raw);
            return Err(BackendError::runtime(format!(
                "BCryptGenRandom failed with NTSTATUS 0x{:08x}",
                status as u32
            )));
        }

        const UPPER: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ";
        const LOWER: &[u8] = b"abcdefghijkmnopqrstuvwxyz";
        const DIGIT: &[u8] = b"23456789";
        const SYMBOL: &[u8] = b"!@#$%^&*-_=+";
        const ALL: &[u8] =
            b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+";

        let mut pass_w: Vec<u16> = Vec::with_capacity(33);
        pass_w.push(UPPER[(raw[0] as usize) % UPPER.len()] as u16);
        pass_w.push(LOWER[(raw[1] as usize) % LOWER.len()] as u16);
        pass_w.push(DIGIT[(raw[2] as usize) % DIGIT.len()] as u16);
        pass_w.push(SYMBOL[(raw[3] as usize) % SYMBOL.len()] as u16);
        for &b in &raw[4..] {
            pass_w.push(ALL[(b as usize) % ALL.len()] as u16);
        }
        pass_w.push(0);
        zeroize_u8(&mut raw);
        Ok(pass_w)
    }

    fn write_sandbox_credential(username: &str, pass_w: &[u16]) -> Result<(), BackendError> {
        let mut target_w = to_wide_null(&cred_target_name(username));
        let mut user_w = to_wide_null(username);
        let mut comment_w = to_wide_null("Claude Code Windows Sandbox Runtime credential");
        let pass_no_nul = pass_w.strip_suffix(&[0]).unwrap_or(pass_w);
        let mut blob_bytes: Vec<u8> = Vec::with_capacity(pass_no_nul.len() * 2);
        for &w in pass_no_nul {
            blob_bytes.extend_from_slice(&w.to_le_bytes());
        }

        let cred = CredentialW {
            flags: 0,
            cred_type: CRED_TYPE_GENERIC,
            target_name: target_w.as_mut_ptr(),
            comment: comment_w.as_mut_ptr(),
            last_written: FileTime {
                dw_low_date_time: 0,
                dw_high_date_time: 0,
            },
            credential_blob_size: blob_bytes.len() as Dword,
            credential_blob: blob_bytes.as_mut_ptr(),
            persist: CRED_PERSIST_LOCAL_MACHINE,
            attribute_count: 0,
            attributes: ptr::null_mut(),
            target_alias: ptr::null_mut(),
            user_name: user_w.as_mut_ptr(),
        };

        let ok = unsafe { CredWriteW(&cred, 0) };
        let err = if ok == FALSE {
            unsafe { GetLastError() }
        } else {
            0
        };
        zeroize_u8(&mut blob_bytes);
        if ok == FALSE {
            return Err(BackendError::runtime(format!(
                "CredWriteW failed for sandbox user '{username}' with error {err}"
            )));
        }
        Ok(())
    }

    fn grant_interactive_logon_right(sandbox_sid: &OwnedSid) -> Result<(), BackendError> {
        unsafe {
            let mut obj_attr: LsaObjectAttributes = std::mem::zeroed();
            obj_attr.length = std::mem::size_of::<LsaObjectAttributes>() as Dword;
            let mut policy: Handle = ptr::null_mut();
            let open_status = LsaOpenPolicy(
                ptr::null(),
                &obj_attr,
                POLICY_CREATE_ACCOUNT | POLICY_LOOKUP_NAMES,
                &mut policy,
            );
            if open_status != STATUS_SUCCESS || policy.is_null() {
                return Err(BackendError::runtime(format!(
                    "LsaOpenPolicy failed with NTSTATUS 0x{:08x}",
                    open_status as u32
                )));
            }

            let mut right_w = to_wide_null("SeInteractiveLogonRight");
            let char_count = right_w.len().saturating_sub(1);
            let right_lsa = LsaUnicodeString {
                length: (char_count * 2) as u16,
                maximum_length: (right_w.len() * 2) as u16,
                buffer: right_w.as_mut_ptr(),
            };
            let add_status = LsaAddAccountRights(policy, sandbox_sid.as_ptr(), &right_lsa, 1);
            let _ = LsaClose(policy);
            if add_status != STATUS_SUCCESS {
                return Err(BackendError::runtime(format!(
                    "LsaAddAccountRights(SeInteractiveLogonRight) failed with NTSTATUS 0x{:08x}",
                    add_status as u32
                )));
            }
            Ok(())
        }
    }

    fn provision_sandbox_user(username: &str) -> Result<(), BackendError> {
        if check_sandbox_user_exists(username) && check_sandbox_cred_present(username) {
            let sid = lookup_account_sid(username)?;
            grant_interactive_logon_right(&sid)?;
            return Ok(());
        }

        let mut pass_w = generate_sandbox_password()?;
        let mut name_w = to_wide_null(username);
        let mut comment_w = to_wide_null("Claude Code isolated sandbox account");
        let mut parm_err: Dword = 0;

        let info = UserInfo1 {
            usri1_name: name_w.as_mut_ptr(),
            usri1_password: pass_w.as_mut_ptr(),
            usri1_password_age: 0,
            usri1_priv: USER_PRIV_USER,
            usri1_home_dir: ptr::null_mut(),
            usri1_comment: comment_w.as_mut_ptr(),
            usri1_flags: UF_SCRIPT
                | UF_NORMAL_ACCOUNT
                | UF_PASSWD_CANT_CHANGE
                | UF_DONT_EXPIRE_PASSWD,
            usri1_script_path: ptr::null_mut(),
        };

        let rc = unsafe {
            NetUserAdd(
                ptr::null(),
                1,
                &info as *const UserInfo1 as *const u8,
                &mut parm_err,
            )
        };

        if rc == NERR_USER_EXISTS {
            let pw_info = UserInfo1003 {
                usri1003_password: pass_w.as_mut_ptr(),
            };
            let set_rc = unsafe {
                NetUserSetInfo(
                    ptr::null(),
                    name_w.as_ptr(),
                    1003,
                    &pw_info as *const UserInfo1003 as *const u8,
                    &mut parm_err,
                )
            };
            if set_rc != NERR_SUCCESS {
                zeroize_u16(&mut pass_w);
                return Err(BackendError::runtime(format!(
                    "NetUserSetInfo failed for existing sandbox user '{username}' with code {set_rc} (parm_err {parm_err})"
                )));
            }
        } else if rc != NERR_SUCCESS {
            zeroize_u16(&mut pass_w);
            return Err(BackendError::runtime(format!(
                "NetUserAdd failed for sandbox user '{username}' with code {rc} (parm_err {parm_err})"
            )));
        }

        let cred_res = write_sandbox_credential(username, &pass_w);
        zeroize_u16(&mut pass_w);
        cred_res?;

        // R3-P0-5: Grant SeInteractiveLogonRight so LogonUserW(LOGON32_LOGON_INTERACTIVE)
        // succeeds without ERROR_LOGON_TYPE_NOT_GRANTED (1385).
        let sid = lookup_account_sid(username)?;
        grant_interactive_logon_right(&sid)
    }

    fn logon_sandbox_user(username: &str) -> Result<OwnedHandle, BackendError> {
        let mut pass_w = read_sandbox_password(username)?;
        let user_w = to_wide_null(username);
        let domain_w = to_wide_null(".");
        let mut token: Handle = ptr::null_mut();
        let ok = unsafe {
            LogonUserW(
                user_w.as_ptr(),
                domain_w.as_ptr(),
                pass_w.as_ptr(),
                LOGON32_LOGON_INTERACTIVE,
                LOGON32_PROVIDER_DEFAULT,
                &mut token,
            )
        };
        let err = if ok == FALSE {
            unsafe { GetLastError() }
        } else {
            0
        };
        zeroize_u16(&mut pass_w);
        if ok == FALSE || token.is_null() {
            return Err(BackendError::runtime(format!(
                "LogonUserW failed for sandbox user '{username}' with error {err}"
            )));
        }
        Ok(OwnedHandle(token))
    }

    /// Creates a restricted token from `base_token` with `DISABLE_MAX_PRIVILEGE | WRITE_RESTRICTED`
    /// (failing closed if `TOKEN_USER` cannot be queried), and lowers its Mandatory Integrity Level
    /// to Low (`S-1-16-4096`) via `SetTokenInformation(TokenIntegrityLevel)` using an 8-byte-aligned
    /// buffer holding `TokenMandatoryLabel` followed inline by the Low IL SID bytes (E5-P2-1).
    unsafe fn create_sandbox_restricted_token(
        base_token: Handle,
    ) -> Result<OwnedHandle, BackendError> {
        let (_user_buf, sid_ptr) = query_token_user_buf(base_token).ok_or_else(|| {
            BackendError::runtime(
                "GetTokenInformation(TokenUser) failed while creating WRITE_RESTRICTED sandbox token",
            )
        })?;
        let restrict_entry = SidAndAttributes {
            sid: sid_ptr,
            attributes: 0,
        };
        let mut restricted_token: Handle = ptr::null_mut();
        let ok = CreateRestrictedToken(
            base_token,
            DISABLE_MAX_PRIVILEGE | WRITE_RESTRICTED,
            0,
            ptr::null(),
            0,
            ptr::null(),
            1,
            &restrict_entry as *const SidAndAttributes as *const c_void,
            &mut restricted_token,
        );
        if ok == FALSE || restricted_token.is_null() {
            return Err(BackendError::runtime(format!(
                "CreateRestrictedToken failed with error {}",
                GetLastError()
            )));
        }
        let owned = OwnedHandle(restricted_token);

        // Lower Mandatory Integrity Level to Low (S-1-16-4096).
        // E5-P2-1: Allocate an 8-byte-aligned Vec<u64> holding TokenMandatoryLabel + inline SID
        // bytes so SetTokenInformation never reads past a stack-allocated struct.
        let low_il_w = to_wide_null("S-1-16-4096");
        let mut low_sid: *mut c_void = ptr::null_mut();
        if ConvertStringSidToSidW(low_il_w.as_ptr(), &mut low_sid) == FALSE || low_sid.is_null() {
            return Err(BackendError::runtime(format!(
                "ConvertStringSidToSidW(S-1-16-4096) failed with error {}",
                GetLastError()
            )));
        }
        let sid_len = GetLengthSid(low_sid) as usize;
        if sid_len == 0 {
            LocalFree(low_sid);
            return Err(BackendError::runtime(
                "GetLengthSid(S-1-16-4096) returned 0",
            ));
        }
        let tml_size = std::mem::size_of::<TokenMandatoryLabel>();
        let total_bytes = tml_size + sid_len;
        let u64_len = total_bytes.div_ceil(std::mem::size_of::<u64>());
        let mut tml_buf = vec![0u64; u64_len];
        let base_ptr = tml_buf.as_mut_ptr() as *mut u8;
        let inline_sid_ptr = base_ptr.add(tml_size);
        ptr::copy_nonoverlapping(low_sid as *const u8, inline_sid_ptr, sid_len);
        LocalFree(low_sid);

        ptr::write(
            base_ptr as *mut TokenMandatoryLabel,
            TokenMandatoryLabel {
                label: SidAndAttributes {
                    sid: inline_sid_ptr as *mut c_void,
                    attributes: SE_GROUP_INTEGRITY,
                },
            },
        );
        let set_ok = SetTokenInformation(
            owned.0,
            TOKEN_INTEGRITY_LEVEL_INFO_CLASS,
            tml_buf.as_ptr() as *const c_void,
            total_bytes as Dword,
        );
        let set_err = if set_ok == FALSE { GetLastError() } else { 0 };
        if set_ok == FALSE {
            return Err(BackendError::runtime(format!(
                "SetTokenInformation(TokenIntegrityLevel=Low) failed with error {set_err}"
            )));
        }

        Ok(owned)
    }

    struct OwnedSelfRelativeSd {
        buf: Vec<u64>,
        byte_len: Dword,
    }

    impl OwnedSelfRelativeSd {
        fn as_mut_ptr(&mut self) -> *mut u8 {
            self.buf.as_mut_ptr() as *mut u8
        }
    }

    /// Builds an 8-byte-aligned self-relative `SECURITY_DESCRIPTOR` granting `FWP_ACTRL_MATCH`
    /// to `sandbox_sid` for use with `FWPM_CONDITION_ALE_USER_ID`.
    fn build_wfp_user_match_sd(sandbox_sid: &OwnedSid) -> Result<OwnedSelfRelativeSd, BackendError> {
        unsafe {
            let mut abs_sd = [0u64; 8];
            if InitializeSecurityDescriptor(
                abs_sd.as_mut_ptr() as *mut c_void,
                SECURITY_DESCRIPTOR_REVISION,
            ) == FALSE
            {
                return Err(BackendError::wfp(format!(
                    "InitializeSecurityDescriptor failed with error {}",
                    GetLastError()
                )));
            }

            // ACL header (8) + ACCESS_ALLOWED_ACE header (8) + SID bytes, rounded up to 8-byte alignment
            let acl_bytes = ((16usize + sandbox_sid.byte_len as usize + 7) & !7) as Dword;
            let mut acl_buf = vec![0u64; (acl_bytes as usize) / 8];
            if InitializeAcl(
                acl_buf.as_mut_ptr() as *mut c_void,
                acl_bytes,
                ACL_REVISION,
            ) == FALSE
            {
                return Err(BackendError::wfp(format!(
                    "InitializeAcl failed with error {}",
                    GetLastError()
                )));
            }
            if AddAccessAllowedAce(
                acl_buf.as_mut_ptr() as *mut c_void,
                ACL_REVISION,
                FWP_ACTRL_MATCH,
                sandbox_sid.as_ptr(),
            ) == FALSE
            {
                return Err(BackendError::wfp(format!(
                    "AddAccessAllowedAce failed with error {}",
                    GetLastError()
                )));
            }
            if SetSecurityDescriptorDacl(
                abs_sd.as_mut_ptr() as *mut c_void,
                TRUE,
                acl_buf.as_mut_ptr() as *mut c_void,
                FALSE,
            ) == FALSE
            {
                return Err(BackendError::wfp(format!(
                    "SetSecurityDescriptorDacl failed with error {}",
                    GetLastError()
                )));
            }
            // Windows BFE / SeAccessCheck requires valid Owner and Group SIDs on WFP user-match SDs.
            if SetSecurityDescriptorOwner(
                abs_sd.as_mut_ptr() as *mut c_void,
                sandbox_sid.as_ptr(),
                FALSE,
            ) == FALSE
            {
                return Err(BackendError::wfp(format!(
                    "SetSecurityDescriptorOwner failed with error {}",
                    GetLastError()
                )));
            }
            if SetSecurityDescriptorGroup(
                abs_sd.as_mut_ptr() as *mut c_void,
                sandbox_sid.as_ptr(),
                FALSE,
            ) == FALSE
            {
                return Err(BackendError::wfp(format!(
                    "SetSecurityDescriptorGroup failed with error {}",
                    GetLastError()
                )));
            }

            let mut self_rel_len: Dword = 0;
            let _ = MakeSelfRelativeSD(
                abs_sd.as_ptr() as *const c_void,
                ptr::null_mut(),
                &mut self_rel_len,
            );
            if self_rel_len == 0 {
                return Err(BackendError::wfp(format!(
                    "MakeSelfRelativeSD sizing failed with error {}",
                    GetLastError()
                )));
            }
            // R3-P2-4: Allocate MakeSelfRelativeSD buffer as Vec<u64> for guaranteed 8-byte alignment.
            let u64_len = (self_rel_len as usize).div_ceil(std::mem::size_of::<u64>());
            let mut self_rel = vec![0u64; u64_len];
            if MakeSelfRelativeSD(
                abs_sd.as_ptr() as *const c_void,
                self_rel.as_mut_ptr() as *mut c_void,
                &mut self_rel_len,
            ) == FALSE
            {
                return Err(BackendError::wfp(format!(
                    "MakeSelfRelativeSD failed with error {}",
                    GetLastError()
                )));
            }
            Ok(OwnedSelfRelativeSd {
                buf: self_rel,
                byte_len: self_rel_len,
            })
        }
    }

    unsafe fn add_wfp_filter(
        engine: Handle,
        filter_key: Guid,
        sublayer_key: Guid,
        layer_key: Guid,
        name: &str,
        weight: u8,
        action_type: u32,
        conditions: &mut [FwpmFilterCondition0],
    ) -> Result<(), BackendError> {
        let _ = FwpmFilterDeleteByKey0(engine, &filter_key);
        let mut name_w = to_wide_null(name);
        let mut desc_w = to_wide_null("Claude Code Windows Sandbox WFP egress filter");
        let filter = FwpmFilter0 {
            filter_key,
            display_data: FwpmDisplayData0 {
                name: name_w.as_mut_ptr(),
                description: desc_w.as_mut_ptr(),
            },
            flags: FWPM_FILTER_FLAG_PERSISTENT,
            provider_key: ptr::null_mut(),
            provider_data: FwpByteBlob {
                size: 0,
                data: ptr::null_mut(),
            },
            layer_key,
            sub_layer_key: sublayer_key,
            weight: FwpValue0 {
                value_type: FWP_UINT8,
                data: FwpValueData { uint8: weight },
            },
            num_filter_conditions: conditions.len() as u32,
            filter_condition: conditions.as_mut_ptr(),
            action: FwpmAction0 {
                action_type,
                filter_type: Guid {
                    data1: 0,
                    data2: 0,
                    data3: 0,
                    data4: [0; 8],
                },
            },
            context: FwpmFilterContext { raw: [0, 0] },
            reserved: ptr::null_mut(),
            filter_id: 0,
            effective_weight: FwpValue0 {
                value_type: FWP_UINT8,
                data: FwpValueData { uint8: 0 },
            },
        };
        let mut id: u64 = 0;
        let rc = FwpmFilterAdd0(engine, &filter, ptr::null(), &mut id);
        if rc != 0 {
            return Err(BackendError::wfp(format!(
                "FwpmFilterAdd0 ('{name}') failed with code 0x{rc:08x}"
            )));
        }
        Ok(())
    }

    fn install_wfp_filters(
        engine: Handle,
        sublayer_guid: &Guid,
        sandbox_sid: &OwnedSid,
        proxy_port_range: [u16; 2],
        allow_loopback: bool,
    ) -> Result<(), BackendError> {
        let mut sd_owned = build_wfp_user_match_sd(sandbox_sid)?;
        let mut sd_blob = FwpByteBlob {
            size: sd_owned.byte_len,
            data: sd_owned.as_mut_ptr(),
        };
        let user_cond = FwpmFilterCondition0 {
            field_key: FWPM_CONDITION_ALE_USER_ID,
            match_type: FWP_MATCH_EQUAL,
            condition_value: FwpValue0 {
                value_type: FWP_SECURITY_DESCRIPTOR_TYPE,
                data: FwpValueData {
                    byte_blob: &mut sd_blob,
                },
            },
        };
        let mut v4_loopback = FwpV4AddrAndMask {
            addr: 0x7F00_0000, // 127.0.0.0/8
            mask: 0xFF00_0000,
        };
        let mut v6_loopback = FwpV6AddrAndMask {
            addr: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], // ::1/128
            prefix_length: 128,
        };
        let mut port_range = FwpRange0 {
            value_low: FwpValue0 {
                value_type: FWP_UINT16,
                data: FwpValueData {
                    uint16: proxy_port_range[0],
                },
            },
            value_high: FwpValue0 {
                value_type: FWP_UINT16,
                data: FwpValueData {
                    uint16: proxy_port_range[1],
                },
            },
        };

        unsafe {
            // 1. Default block outbound IPv4 for sandbox user SID (weight 1)
            let mut block_v4_conds = [FwpmFilterCondition0 {
                field_key: user_cond.field_key,
                match_type: user_cond.match_type,
                condition_value: user_cond.condition_value,
            }];
            add_wfp_filter(
                engine,
                derived_filter_guid(sublayer_guid, 1),
                *sublayer_guid,
                FWPM_LAYER_ALE_AUTH_CONNECT_V4,
                "Claude Sandbox Block Outbound IPv4",
                1,
                FWP_ACTION_BLOCK,
                &mut block_v4_conds,
            )?;

            // 2. Default block outbound IPv6 for sandbox user SID (weight 1)
            let mut block_v6_conds = [FwpmFilterCondition0 {
                field_key: user_cond.field_key,
                match_type: user_cond.match_type,
                condition_value: user_cond.condition_value,
            }];
            add_wfp_filter(
                engine,
                derived_filter_guid(sublayer_guid, 2),
                *sublayer_guid,
                FWPM_LAYER_ALE_AUTH_CONNECT_V6,
                "Claude Sandbox Block Outbound IPv6",
                1,
                FWP_ACTION_BLOCK,
                &mut block_v6_conds,
            )?;

            // 3. Permit loopback proxy port range IPv4 (weight 10)
            let mut proxy_v4_conds = [
                FwpmFilterCondition0 {
                    field_key: user_cond.field_key,
                    match_type: user_cond.match_type,
                    condition_value: user_cond.condition_value,
                },
                FwpmFilterCondition0 {
                    field_key: FWPM_CONDITION_IP_REMOTE_ADDRESS,
                    match_type: FWP_MATCH_EQUAL,
                    condition_value: FwpValue0 {
                        value_type: FWP_V4_ADDR_MASK,
                        data: FwpValueData {
                            v4_addr_mask: &mut v4_loopback,
                        },
                    },
                },
                FwpmFilterCondition0 {
                    field_key: FWPM_CONDITION_IP_REMOTE_PORT,
                    match_type: FWP_MATCH_RANGE,
                    condition_value: FwpValue0 {
                        value_type: FWP_RANGE_TYPE,
                        data: FwpValueData {
                            range_value: &mut port_range,
                        },
                    },
                },
            ];
            add_wfp_filter(
                engine,
                derived_filter_guid(sublayer_guid, 3),
                *sublayer_guid,
                FWPM_LAYER_ALE_AUTH_CONNECT_V4,
                "Claude Sandbox Permit Loopback Proxy IPv4",
                10,
                FWP_ACTION_PERMIT,
                &mut proxy_v4_conds,
            )?;

            // 4. Permit loopback proxy port range IPv6 (weight 10)
            let mut proxy_v6_conds = [
                FwpmFilterCondition0 {
                    field_key: user_cond.field_key,
                    match_type: user_cond.match_type,
                    condition_value: user_cond.condition_value,
                },
                FwpmFilterCondition0 {
                    field_key: FWPM_CONDITION_IP_REMOTE_ADDRESS,
                    match_type: FWP_MATCH_EQUAL,
                    condition_value: FwpValue0 {
                        value_type: FWP_V6_ADDR_MASK,
                        data: FwpValueData {
                            v6_addr_mask: &mut v6_loopback,
                        },
                    },
                },
                FwpmFilterCondition0 {
                    field_key: FWPM_CONDITION_IP_REMOTE_PORT,
                    match_type: FWP_MATCH_RANGE,
                    condition_value: FwpValue0 {
                        value_type: FWP_RANGE_TYPE,
                        data: FwpValueData {
                            range_value: &mut port_range,
                        },
                    },
                },
            ];
            add_wfp_filter(
                engine,
                derived_filter_guid(sublayer_guid, 4),
                *sublayer_guid,
                FWPM_LAYER_ALE_AUTH_CONNECT_V6,
                "Claude Sandbox Permit Loopback Proxy IPv6",
                10,
                FWP_ACTION_PERMIT,
                &mut proxy_v6_conds,
            )?;

            // 5 & 6. Optional loopback permit for IPv4 & IPv6 (weight 5)
            if allow_loopback {
                let mut loop_v4_conds = [
                    FwpmFilterCondition0 {
                        field_key: user_cond.field_key,
                        match_type: user_cond.match_type,
                        condition_value: user_cond.condition_value,
                    },
                    FwpmFilterCondition0 {
                        field_key: FWPM_CONDITION_IP_REMOTE_ADDRESS,
                        match_type: FWP_MATCH_EQUAL,
                        condition_value: FwpValue0 {
                            value_type: FWP_V4_ADDR_MASK,
                            data: FwpValueData {
                                v4_addr_mask: &mut v4_loopback,
                            },
                        },
                    },
                ];
                add_wfp_filter(
                    engine,
                    derived_filter_guid(sublayer_guid, 5),
                    *sublayer_guid,
                    FWPM_LAYER_ALE_AUTH_CONNECT_V4,
                    "Claude Sandbox Permit Loopback IPv4",
                    5,
                    FWP_ACTION_PERMIT,
                    &mut loop_v4_conds,
                )?;

                let mut loop_v6_conds = [
                    FwpmFilterCondition0 {
                        field_key: user_cond.field_key,
                        match_type: user_cond.match_type,
                        condition_value: user_cond.condition_value,
                    },
                    FwpmFilterCondition0 {
                        field_key: FWPM_CONDITION_IP_REMOTE_ADDRESS,
                        match_type: FWP_MATCH_EQUAL,
                        condition_value: FwpValue0 {
                            value_type: FWP_V6_ADDR_MASK,
                            data: FwpValueData {
                                v6_addr_mask: &mut v6_loopback,
                            },
                        },
                    },
                ];
                add_wfp_filter(
                    engine,
                    derived_filter_guid(sublayer_guid, 6),
                    *sublayer_guid,
                    FWPM_LAYER_ALE_AUTH_CONNECT_V6,
                    "Claude Sandbox Permit Loopback IPv6",
                    5,
                    FWP_ACTION_PERMIT,
                    &mut loop_v6_conds,
                )?;
            } else {
                let _ = FwpmFilterDeleteByKey0(engine, &derived_filter_guid(sublayer_guid, 5));
                let _ = FwpmFilterDeleteByKey0(engine, &derived_filter_guid(sublayer_guid, 6));
            }
        }
        Ok(())
    }

    enum WfpCheckState {
        Installed,
        Degraded,
        Absent,
        CannotRead,
    }

    unsafe fn check_wfp_filter_exists(engine: Handle, key: &Guid) -> Result<bool, Dword> {
        let mut filter: *mut FwpmFilter0 = ptr::null_mut();
        let rc = FwpmFilterGetByKey0(engine, key, &mut filter);
        if !filter.is_null() {
            let mut raw = filter as *mut c_void;
            FwpmFreeMemory0(&mut raw);
        }
        if rc == 0 {
            Ok(true)
        } else if rc == FWP_E_FILTER_NOT_FOUND {
            Ok(false)
        } else {
            Err(rc)
        }
    }

    fn check_wfp_sublayer_state(sublayer_guid: &str) -> Result<WfpCheckState, BackendError> {
        let guid = parse_guid_struct(sublayer_guid)?;
        unsafe {
            let mut engine: Handle = ptr::null_mut();
            let rc = FwpmEngineOpen0(
                ptr::null(),
                RPC_C_AUTHN_WINNT,
                ptr::null(),
                ptr::null(),
                &mut engine,
            );
            if rc == ERROR_ACCESS_DENIED || rc == E_ACCESSDENIED {
                return Ok(WfpCheckState::CannotRead);
            }
            if rc != 0 {
                return Ok(WfpCheckState::Absent);
            }
            let mut sublayer: *mut FwpmSublayer0 = ptr::null_mut();
            let get_rc = FwpmSubLayerGetByKey0(engine, &guid, &mut sublayer);
            if !sublayer.is_null() {
                let mut raw = sublayer as *mut c_void;
                FwpmFreeMemory0(&mut raw);
            }

            if get_rc == ERROR_ACCESS_DENIED || get_rc == E_ACCESSDENIED {
                FwpmEngineClose0(engine);
                return Ok(WfpCheckState::CannotRead);
            }

            let sublayer_present = get_rc == 0;
            let block_v4 = check_wfp_filter_exists(engine, &derived_filter_guid(&guid, 1));
            let block_v6 = check_wfp_filter_exists(engine, &derived_filter_guid(&guid, 2));
            FwpmEngineClose0(engine);

            let (v4_ok, v6_ok) = match (block_v4, block_v6) {
                (Ok(a), Ok(b)) => (a, b),
                (Err(e), _) | (_, Err(e)) if e == ERROR_ACCESS_DENIED || e == E_ACCESSDENIED => {
                    return Ok(WfpCheckState::CannotRead);
                }
                _ => (false, false),
            };

            if sublayer_present && v4_ok && v6_ok {
                Ok(WfpCheckState::Installed)
            } else if sublayer_present || v4_ok || v6_ok {
                Ok(WfpCheckState::Degraded)
            } else {
                Ok(WfpCheckState::Absent)
            }
        }
    }

    fn check_write_restricted_token_supported() -> bool {
        unsafe {
            let mut token: Handle = ptr::null_mut();
            if OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ADJUST_DEFAULT,
                &mut token,
            ) == FALSE
            {
                return false;
            }
            let _token_guard = OwnedHandle(token);
            create_sandbox_restricted_token(token).is_ok()
        }
    }

    fn probe_job_ui_isolation() -> bool {
        unsafe {
            let job = CreateJobObjectW(ptr::null(), ptr::null());
            if job.is_null() {
                return false;
            }
            let _job_guard = OwnedHandle(job);
            // R3-P0-5: Include JOB_OBJECT_UILIMIT_HANDLES so probe matches actual input-injection restriction.
            let ui = JobObjectBasicUiRestrictions {
                ui_restrictions_class: JOB_OBJECT_UILIMIT_HANDLES
                    | JOB_OBJECT_UILIMIT_READCLIPBOARD
                    | JOB_OBJECT_UILIMIT_WRITECLIPBOARD
                    | JOB_OBJECT_UILIMIT_DESKTOP
                    | JOB_OBJECT_UILIMIT_GLOBALATOMS,
            };
            SetInformationJobObject(
                job,
                JOB_OBJECT_BASIC_UI_RESTRICTIONS,
                &ui as *const _ as *const c_void,
                std::mem::size_of::<JobObjectBasicUiRestrictions>() as Dword,
            ) != FALSE
        }
    }

    unsafe fn parse_utf16_env_block(env_ptr: *const u16) -> Vec<(String, String)> {
        let mut vars = Vec::new();
        let mut p = env_ptr;
        loop {
            if *p == 0 {
                break;
            }
            let mut len = 0usize;
            while *p.add(len) != 0 {
                len += 1;
            }
            let entry = String::from_utf16_lossy(std::slice::from_raw_parts(p, len));
            if let Some((k, v)) = entry.split_once('=') {
                if !k.is_empty() {
                    vars.push((k.to_string(), v.to_string()));
                }
            }
            p = p.add(len + 1);
        }
        vars
    }

    fn build_windows_env_block(
        token: Handle,
        opts: &RunOptions,
        validated: &ValidatedRunOptions,
    ) -> Result<Vec<u16>, BackendError> {
        // P0-4 & R3-P1-4: Build child env from CreateEnvironmentBlock (b_inherit = FALSE) for the
        // sandbox token; if unavailable, fall back ONLY to a scrubbed minimal safe allowlist
        // (excluding host user TEMP/TMP).
        let mut vars: Vec<(String, String)> = unsafe {
            let mut env_ptr: *mut c_void = ptr::null_mut();
            if CreateEnvironmentBlock(&mut env_ptr, token, FALSE) != FALSE && !env_ptr.is_null() {
                let parsed = parse_utf16_env_block(env_ptr as *const u16);
                DestroyEnvironmentBlock(env_ptr);
                parsed
            } else {
                filter_safe_fallback_env(std::env::vars().collect())
            }
        };

        let mut set_var = |key: &str, val: String| {
            if is_sensitive_env_var(key) {
                return;
            }
            if let Some(existing) = vars.iter_mut().find(|(k, _)| k.eq_ignore_ascii_case(key)) {
                existing.1 = val;
            } else {
                vars.push((key.to_string(), val));
            }
        };

        // R3-P1-4: Forward allowlisted CA trust-bundle and proxy vars from parent env.
        for (k, v) in std::env::vars() {
            if is_safe_ca_or_proxy_env_var(&k) && !is_sensitive_env_var(&k) {
                set_var(&k, v);
            }
        }

        // R3-P1-4: Merge explicit --env KEY=VAL overrides (scrubbed via is_sensitive_env_var).
        for (k, v) in &opts.extra_env {
            set_var(k, v.clone());
        }

        // Always scrub any sensitive credentials/tokens before injecting proxy settings.
        vars.retain(|(k, _)| !is_sensitive_env_var(k));

        let mut set_final_var = |key: &str, val: String| {
            if let Some(existing) = vars.iter_mut().find(|(k, _)| k.eq_ignore_ascii_case(key)) {
                existing.1 = val;
            } else {
                vars.push((key.to_string(), val));
            }
        };
        if let Some(ref http) = validated.http_proxy {
            set_final_var("HTTP_PROXY", http.clone());
            set_final_var("http_proxy", http.clone());
        }
        if let Some(ref https) = validated.https_proxy {
            set_final_var("HTTPS_PROXY", https.clone());
            set_final_var("https_proxy", https.clone());
        }
        if opts.allow_loopback {
            set_final_var("NO_PROXY", "127.0.0.1,localhost".to_string());
        }
        set_final_var("SRT_WIN_SANDBOXED", "1".to_string());

        vars.sort_by(|a, b| a.0.to_ascii_lowercase().cmp(&b.0.to_ascii_lowercase()));
        let mut block: Vec<u16> = Vec::new();
        for (k, v) in vars {
            if k.contains('\0') || v.contains('\0') || k.contains('=') {
                continue;
            }
            block.extend(OsStr::new(&format!("{k}={v}")).encode_wide());
            block.push(0);
        }
        block.push(0);
        Ok(block)
    }

    fn query_status_for(username: &str, sublayer_guid: &str) -> Result<StatusResponse, BackendError> {
        let persisted = load_wfp_config();
        let effective_user = persisted
            .as_ref()
            .and_then(|c| c.sandbox_user.as_deref())
            .filter(|u| validate_sandbox_username(u).is_ok())
            .unwrap_or(username);
        let provisioned = check_sandbox_user_exists(effective_user);
        let cred_present = check_sandbox_cred_present(effective_user);
        let wfp_state_enum = check_wfp_sublayer_state(sublayer_guid)?;
        let (wfp_state_str, wfp_present) = match wfp_state_enum {
            WfpCheckState::Installed => ("installed".to_string(), true),
            WfpCheckState::Degraded => ("degraded".to_string(), true),
            WfpCheckState::CannotRead => ("cannot-read".to_string(), false),
            WfpCheckState::Absent => ("absent".to_string(), false),
        };

        let allow_loopback = if wfp_present {
            persisted.as_ref().map_or(false, |c| c.allow_loopback)
        } else {
            false
        };
        let proxy_port_range = if wfp_present {
            persisted
                .as_ref()
                .and_then(|c| c.proxy_port_range)
                .or(Some([DEFAULT_PROXY_PORT_START, DEFAULT_PROXY_PORT_END]))
        } else {
            None
        };

        Ok(StatusResponse {
            user: UserStatus {
                provisioned,
                cred_present,
                real_user_sid: current_user_sid(),
                sandbox_user: if provisioned {
                    Some(effective_user.to_string())
                } else {
                    None
                },
                seclogon_state: query_seclogon_state(),
            },
            wfp: WfpStatus {
                state: wfp_state_str,
                allow_loopback,
                sublayer_guid: if wfp_present {
                    Some(sublayer_guid.to_string())
                } else {
                    None
                },
                proxy_port_range,
            },
        })
    }

    pub fn cmd_status(opts: &StatusOptions) -> Result<StatusResponse, BackendError> {
        validate_status_options(opts)?;
        let username =
            configured_sandbox_username().unwrap_or_else(|_| DEFAULT_SANDBOX_USERNAME.to_string());
        let persisted_guid = load_wfp_config().and_then(|c| c.sublayer_guid);
        let guid = opts
            .sublayer_guid
            .as_deref()
            .or(persisted_guid.as_deref())
            .unwrap_or(DEFAULT_WFP_SUBLAYER_GUID);
        query_status_for(&username, guid)
    }

    pub fn cmd_install(opts: &InstallOptions) -> Result<StatusResponse, BackendError> {
        validate_install_options(opts)?;

        // R3-P0-5: Self-elevate via UAC (`ShellExecuteExW` "runas") when invoked non-elevated.
        if !opts.uac_child && !is_process_elevated() {
            let mut child_args = vec![
                "install".to_string(),
                "--uac-child".to_string(),
                "--user".to_string(),
                opts.sandbox_user.clone(),
                "--sublayer-guid".to_string(),
                opts.sublayer_guid.clone(),
                "--proxy-port-range".to_string(),
                format!("{}-{}", opts.proxy_port_range[0], opts.proxy_port_range[1]),
                if opts.allow_loopback {
                    "--allow-loopback".to_string()
                } else {
                    "--no-allow-loopback".to_string()
                },
            ];
            let effective_sid = opts.real_user_sid.clone().or_else(current_user_sid);
            if let Some(sid) = effective_sid {
                child_args.push("--sid".to_string());
                child_args.push(sid);
            }
            let code = self_elevate_with_uac(&child_args)?;
            if code != 0 {
                return Err(BackendError {
                    exit_code: code,
                    message: format!("Elevated srt-win install failed with exit code {code}"),
                });
            }
            return query_status_for(&opts.sandbox_user, &opts.sublayer_guid);
        }

        // P0-5 & R3-P0-5: Provision local sandbox account + cryptographic random password + SeInteractiveLogonRight
        provision_sandbox_user(&opts.sandbox_user)?;
        let sandbox_sid = lookup_account_sid(&opts.sandbox_user)?;

        let guid = parse_guid_struct(&opts.sublayer_guid)?;
        let mut name_w = to_wide_null("Claude Code Sandbox Sublayer");
        let mut desc_w = to_wide_null("Blocks non-proxy egress for srt-win sandbox user");

        unsafe {
            let mut engine: Handle = ptr::null_mut();
            let rc = FwpmEngineOpen0(
                ptr::null(),
                RPC_C_AUTHN_WINNT,
                ptr::null(),
                ptr::null(),
                &mut engine,
            );
            if rc == ERROR_CANCELLED {
                return Err(BackendError::uac_cancelled(
                    "UAC elevation cancelled while opening WFP engine",
                ));
            }
            if rc != 0 {
                return Err(BackendError::wfp(format!(
                    "FwpmEngineOpen0 failed with code 0x{rc:08x}"
                )));
            }

            // R3-P0-1: Wrap WFP sublayer + filter mutations in an atomic transaction.
            let tx_rc = FwpmTransactionBegin0(engine, 0);
            if tx_rc != 0 {
                FwpmEngineClose0(engine);
                return Err(BackendError::wfp(format!(
                    "FwpmTransactionBegin0 failed with code 0x{tx_rc:08x}"
                )));
            }

            let mut tx_result: Result<(), BackendError> = (|| {
                let mut existing: *mut FwpmSublayer0 = ptr::null_mut();
                let get_rc = FwpmSubLayerGetByKey0(engine, &guid, &mut existing);
                if !existing.is_null() {
                    let mut raw = existing as *mut c_void;
                    FwpmFreeMemory0(&mut raw);
                }
                if get_rc != 0 {
                    let sublayer = FwpmSublayer0 {
                        sub_layer_key: guid,
                        display_data: FwpmDisplayData0 {
                            name: name_w.as_mut_ptr(),
                            description: desc_w.as_mut_ptr(),
                        },
                        flags: FWPM_SUBLAYER_FLAG_PERSISTENT,
                        provider_key: ptr::null_mut(),
                        provider_data: FwpByteBlob {
                            size: 0,
                            data: ptr::null_mut(),
                        },
                        weight: 0x7FFF,
                    };
                    let add_rc = FwpmSubLayerAdd0(engine, &sublayer, ptr::null());
                    if add_rc != 0 {
                        return Err(BackendError::wfp(format!(
                            "FwpmSubLayerAdd0 failed with code 0x{add_rc:08x}"
                        )));
                    }
                }

                install_wfp_filters(
                    engine,
                    &guid,
                    &sandbox_sid,
                    opts.proxy_port_range,
                    opts.allow_loopback,
                )
            })();

            if tx_result.is_ok() {
                let commit_rc = FwpmTransactionCommit0(engine);
                if commit_rc != 0 {
                    let _ = FwpmTransactionAbort0(engine);
                    tx_result = Err(BackendError::wfp(format!(
                        "FwpmTransactionCommit0 failed with code 0x{commit_rc:08x}"
                    )));
                }
            } else {
                let _ = FwpmTransactionAbort0(engine);
            }
            FwpmEngineClose0(engine);
            tx_result?;
        }

        // Persist actual WFP config metadata + harden state_dir() ACLs (R3-P0-3 & R3-P2-1)
        save_wfp_config(opts)?;

        Ok(StatusResponse {
            user: UserStatus {
                provisioned: check_sandbox_user_exists(&opts.sandbox_user),
                cred_present: check_sandbox_cred_present(&opts.sandbox_user),
                real_user_sid: opts.real_user_sid.clone().or_else(current_user_sid),
                sandbox_user: Some(opts.sandbox_user.clone()),
                seclogon_state: query_seclogon_state(),
            },
            wfp: WfpStatus {
                state: "installed".to_string(),
                allow_loopback: opts.allow_loopback,
                sublayer_guid: Some(opts.sublayer_guid.clone()),
                proxy_port_range: Some(opts.proxy_port_range),
            },
        })
    }

    pub fn cmd_uninstall(opts: &UninstallOptions) -> Result<StatusResponse, BackendError> {
        validate_uninstall_options(opts)?;

        // R3-P0-5: Self-elevate via UAC (`ShellExecuteExW` "runas") when invoked non-elevated.
        if !opts.uac_child && !is_process_elevated() {
            let child_args = vec![
                "uninstall".to_string(),
                "--uac-child".to_string(),
                "--user".to_string(),
                opts.sandbox_user.clone(),
                "--sublayer-guid".to_string(),
                opts.sublayer_guid.clone(),
            ];
            let code = self_elevate_with_uac(&child_args)?;
            if code != 0 {
                return Err(BackendError {
                    exit_code: code,
                    message: format!("Elevated srt-win uninstall failed with exit code {code}"),
                });
            }
            return query_status_for(&opts.sandbox_user, &opts.sublayer_guid);
        }

        let guid = parse_guid_struct(&opts.sublayer_guid)?;
        let mut errors: Vec<String> = Vec::new();

        // R3-P1-5 & P0-1 & P1-E1 & P1-E2: Revoke all tracked allow_write grants (`A:`)
        // (restoring Medium integrity level) and deny ACEs (`R:`/`W:`) before removing account,
        // skipping any symlink/reparse point targets.
        let denies_file = state_dir().join("denies.json");
        let tracked = load_tracked_denies(&denies_file).entries;
        if !tracked.is_empty() {
            if let Ok(sandbox_sid) = resolve_sandbox_user_sid(&opts.sandbox_user) {
                let current_sid = current_user_sid();
                if ensure_not_current_user_sid(&sandbox_sid, current_sid.as_deref()).is_ok() {
                    if let Ok(icacls) = icacls_exe_path() {
                        let sid_arg = format!("*{sandbox_sid}");
                        for (key, raw_path) in &tracked {
                            let Ok(clean_path) = sanitize_path(raw_path) else {
                                continue;
                            };
                            let path_ref = Path::new(&clean_path);
                            if reject_symlinks_and_reparse_points(path_ref).is_err() {
                                continue;
                            }
                            if key.starts_with("A:") {
                                let _ = Command::new(&icacls)
                                    .arg(&clean_path)
                                    .arg("/remove:g")
                                    .arg(&sid_arg)
                                    .status();
                                if path_ref.exists() {
                                    let il_arg =
                                        icacls_integrity_label_arg("Medium", path_ref.is_dir());
                                    let _ = Command::new(&icacls)
                                        .arg(&clean_path)
                                        .arg("/setintegritylevel")
                                        .arg(&il_arg)
                                        .status();
                                }
                            } else if key.starts_with("R:") || key.starts_with("W:") {
                                let _ = Command::new(&icacls)
                                    .arg(&clean_path)
                                    .arg("/remove:d")
                                    .arg(&sid_arg)
                                    .status();
                            }
                        }
                    }
                }
            }
            let _ = std::fs::remove_file(&denies_file);
        }

        unsafe {
            let mut engine: Handle = ptr::null_mut();
            let rc = FwpmEngineOpen0(
                ptr::null(),
                RPC_C_AUTHN_WINNT,
                ptr::null(),
                ptr::null(),
                &mut engine,
            );
            if rc == ERROR_CANCELLED {
                return Err(BackendError::uac_cancelled(
                    "UAC elevation cancelled during uninstall",
                ));
            }
            if rc != 0 {
                errors.push(format!("FwpmEngineOpen0 failed with code 0x{rc:08x}"));
            } else {
                // R3-P0-1: Wrap WFP uninstall deletions in a transaction.
                let tx_rc = FwpmTransactionBegin0(engine, 0);
                if tx_rc != 0 {
                    errors.push(format!(
                        "FwpmTransactionBegin0 failed with code 0x{tx_rc:08x}"
                    ));
                } else {
                    let mut wfp_errs: Vec<String> = Vec::new();
                    for tag in 1..=6u8 {
                        let fkey = derived_filter_guid(&guid, tag);
                        let frc = FwpmFilterDeleteByKey0(engine, &fkey);
                        if frc != 0 && frc != FWP_E_FILTER_NOT_FOUND {
                            wfp_errs.push(format!(
                                "FwpmFilterDeleteByKey0 (tag {tag}) failed with code 0x{frc:08x}"
                            ));
                        }
                    }
                    let sl_rc = FwpmSubLayerDeleteByKey0(engine, &guid);
                    if sl_rc != 0 && sl_rc != FWP_E_SUBLAYER_NOT_FOUND {
                        wfp_errs.push(format!(
                            "FwpmSubLayerDeleteByKey0 failed with code 0x{sl_rc:08x}"
                        ));
                    }
                    if wfp_errs.is_empty() {
                        let commit_rc = FwpmTransactionCommit0(engine);
                        if commit_rc != 0 {
                            let _ = FwpmTransactionAbort0(engine);
                            errors.push(format!(
                                "FwpmTransactionCommit0 failed with code 0x{commit_rc:08x}"
                            ));
                        }
                    } else {
                        let _ = FwpmTransactionAbort0(engine);
                        errors.extend(wfp_errs);
                    }
                }
                FwpmEngineClose0(engine);
            }

            let target = to_wide_null(&cred_target_name(&opts.sandbox_user));
            if CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) == FALSE {
                let cerr = GetLastError();
                if cerr != ERROR_NOT_FOUND {
                    errors.push(format!(
                        "CredDeleteW for '{}' failed with error {cerr}",
                        opts.sandbox_user
                    ));
                }
            }

            let wide_user = to_wide_null(&opts.sandbox_user);
            let del_rc = NetUserDel(ptr::null(), wide_user.as_ptr());
            if del_rc != NERR_SUCCESS && del_rc != NERR_USER_NOT_FOUND {
                errors.push(format!(
                    "NetUserDel for '{}' failed with code {del_rc}",
                    opts.sandbox_user
                ));
            }
        }

        let _ = std::fs::remove_file(wfp_config_file());

        if !errors.is_empty() {
            return Err(BackendError::runtime(format!(
                "Uninstall failed: {}",
                errors.join("; ")
            )));
        }

        query_status_for(&opts.sandbox_user, &opts.sublayer_guid)
    }

    pub fn cmd_wfp_verify(opts: &WfpVerifyOptions) -> Result<WfpVerifyResponse, BackendError> {
        validate_wfp_verify_options(opts)?;
        // P0-5: Run egress probe under the sandbox user token (LogonUserW + ImpersonateLoggedOnUser),
        // NEVER under the unsandboxed real user's token.
        let sandbox_user = configured_sandbox_username()?;
        let sandbox_token = logon_sandbox_user(&sandbox_user)?;
        let write_restricted =
            unsafe { create_sandbox_restricted_token(sandbox_token.0).is_ok() };

        let probe_status = {
            if unsafe { ImpersonateLoggedOnUser(sandbox_token.0) } == FALSE {
                return Err(BackendError::wfp(format!(
                    "ImpersonateLoggedOnUser failed with error {}",
                    unsafe { GetLastError() }
                )));
            }
            let _impersonation = ImpersonationGuard;

            // R3-P2-2: Only WSAEACCES (10013) proves WFP blocked egress; timeout/unreachable is "not-run".
            let probe_addr = |addr: SocketAddr| -> String {
                match TcpStream::connect_timeout(&addr, Duration::from_millis(1200)) {
                    Ok(_) => "allowed".to_string(),
                    Err(e) => classify_wfp_connect_error(e.raw_os_error()).to_string(),
                }
            };

            match opts.target.to_socket_addrs() {
                Ok(mut addrs) => {
                    if let Some(addr) = addrs.next() {
                        probe_addr(addr)
                    } else {
                        "not-run".to_string()
                    }
                }
                Err(_) => {
                    if let Ok(addr) = opts.target.parse::<SocketAddr>() {
                        probe_addr(addr)
                    } else {
                        "not-run".to_string()
                    }
                }
            }
        };

        Ok(WfpVerifyResponse {
            egress_probe: probe_status,
            target: opts.target.clone(),
            write_restricted_token: write_restricted,
        })
    }

    pub fn cmd_profile_forget(
        opts: &ProfileForgetOptions,
    ) -> Result<ProfileForgetResponse, BackendError> {
        validate_profile_forget_options(opts)?;
        let Some(raw_profile_dir) = std::env::var("USERPROFILE").ok() else {
            return Ok(ProfileForgetResponse {
                cleared: false,
                deferred: false,
            });
        };
        // P0-6: Sanitize USERPROFILE before passing to icacls.exe
        let profile_dir = sanitize_path(&raw_profile_dir).map_err(BackendError::validation)?;

        // P0-2: Resolve sandbox account SID (NEVER fall back to current_user_sid!) and refuse self-SID
        let sid = match opts.sid.as_deref() {
            Some(s) => s.to_string(),
            None => {
                let sandbox_user = configured_sandbox_username()?;
                resolve_sandbox_user_sid(&sandbox_user)?
            }
        };
        let current_sid = current_user_sid();
        ensure_not_current_user_sid(&sid, current_sid.as_deref())?;

        let icacls = icacls_exe_path()?;
        let status = Command::new(&icacls)
            .arg(&profile_dir)
            .arg("/remove:g")
            .arg(format!("*{sid}"))
            .status()
            .map_err(|e| BackendError::runtime(format!("Failed to invoke icacls.exe: {e}")))?;

        Ok(ProfileForgetResponse {
            cleared: status.success(),
            deferred: !status.success(),
        })
    }

    fn load_tracked_denies(file: &Path) -> TrackedDeniesFile {
        let Ok(raw) = std::fs::read_to_string(file) else {
            return TrackedDeniesFile {
                schema_version: DENIES_SCHEMA_VERSION,
                entries: BTreeMap::new(),
            };
        };
        parse_tracked_denies_file(&raw)
    }

    fn save_tracked_denies(
        file: &Path,
        schema_version: u64,
        items: &BTreeMap<String, String>,
        real_user_sid: Option<&str>,
    ) {
        if let Some(parent) = file.parent() {
            if !parent.exists() {
                let _ = harden_state_dir_acl(parent, real_user_sid);
            }
        }
        let _ = std::fs::write(file, serialize_tracked_denies_file(schema_version, items));
    }

    pub fn cmd_denies(req: &DeniesRequest) -> Result<DeniesResponse, BackendError> {
        validate_denies_request(req)?;
        // P0-2: Resolve sandbox account SID (NEVER fall back to current_user_sid!) and refuse self-SID
        let sid = match req.sid.as_deref() {
            Some(s) => s.to_string(),
            None => {
                let sandbox_user = configured_sandbox_username()?;
                resolve_sandbox_user_sid(&sandbox_user)?
            }
        };
        let current_sid = current_user_sid();
        ensure_not_current_user_sid(&sid, current_sid.as_deref())?;

        // R3-P0-3: Validate allow_write paths reject symlinks/junctions/reparse points and \\?\UNC\
        let mut canon_allow_writes: Vec<String> = Vec::with_capacity(req.allow_write.len());
        for raw_allow in &req.allow_write {
            let sanitized = sanitize_path(raw_allow).map_err(BackendError::validation)?;
            reject_symlinks_and_reparse_points(Path::new(&sanitized))
                .map_err(BackendError::validation)?;
            let canon =
                canonicalize_path_best_effort(&sanitized).map_err(BackendError::validation)?;
            reject_symlinks_and_reparse_points(&canon).map_err(BackendError::validation)?;
            canon_allow_writes.push(canon.to_string_lossy().into_owned());
        }

        let icacls = icacls_exe_path()?;
        let started = Instant::now();
        let deadline = req.deadline_ms.map(Duration::from_millis);
        let state_file = state_dir().join("denies.json");
        let loaded = load_tracked_denies(&state_file);
        let loaded_schema_version = loaded.schema_version;
        let previous = loaded.entries;
        let mut next_tracked: BTreeMap<String, String> = BTreeMap::new();

        let mut in_place = 0u64;
        let mut planted = 0u64;
        let mut laid = 0u64;
        let mut guarded = 0u64;
        let mut extras_skipped = 0u64;
        let mut stands = 0u64;
        let mut handed_back = 0u64;
        let mut deadline_expired = false;
        let mut unguarded_errors: Vec<String> = Vec::new();

        let sid_arg = format!("*{sid}");

        for raw_path in &req.deny_read {
            let sanitized = sanitize_path(raw_path).map_err(BackendError::validation)?;
            reject_symlinks_and_reparse_points(Path::new(&sanitized))
                .map_err(BackendError::validation)?;
            let path =
                canonicalize_path_best_effort(&sanitized).map_err(BackendError::validation)?;
            reject_symlinks_and_reparse_points(&path).map_err(BackendError::validation)?;
            let path_str = path.to_string_lossy().into_owned();
            let key = normalize_tracked_acl_key('R', &path_str);
            if deadline.is_some_and(|d| started.elapsed() >= d) {
                deadline_expired = true;
                extras_skipped += 1;
                if path.exists()
                    && should_reapply_tracked_deny(loaded_schema_version, &key, &previous)
                {
                    unguarded_errors.push(format!(
                        "Deadline expired before guarding existing denyRead target '{path_str}'"
                    ));
                } else if let Some(root) =
                    find_matching_allow_write_root(&path_str, &canon_allow_writes)
                {
                    unguarded_errors.push(format!(
                        "Deadline expired before guarding denyRead target '{path_str}' inside allowWrite root '{root}'"
                    ));
                }
                continue;
            }
            if !path.exists() {
                // R3-P0-2: Do NOT silently skip non-existent deny_read targets inside allow_write.
                if let Some(root) = find_matching_allow_write_root(&path_str, &canon_allow_writes) {
                    unguarded_errors.push(format!(
                        "Cannot guard non-existent denyRead target '{path_str}' inside allowWrite root '{root}'"
                    ));
                }
                extras_skipped += 1;
                continue;
            }
            if !should_reapply_tracked_deny(loaded_schema_version, &key, &previous) {
                in_place += 1;
                stands += 1;
                next_tracked.insert(key, path_str);
                continue;
            }
            let perm_arg = icacls_perm_arg(&sid_arg, "R", path.is_dir());
            let ok = Command::new(&icacls)
                .arg(&path)
                .arg("/deny")
                .arg(&perm_arg)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if ok {
                planted += 1;
                guarded += 1;
                next_tracked.insert(key, path_str);
            } else {
                extras_skipped += 1;
                unguarded_errors.push(format!(
                    "icacls /deny failed for existing denyRead target '{path_str}'"
                ));
            }
        }

        for raw_path in &req.deny_write {
            let sanitized = sanitize_path(raw_path).map_err(BackendError::validation)?;
            reject_symlinks_and_reparse_points(Path::new(&sanitized))
                .map_err(BackendError::validation)?;
            let path =
                canonicalize_path_best_effort(&sanitized).map_err(BackendError::validation)?;
            reject_symlinks_and_reparse_points(&path).map_err(BackendError::validation)?;
            let path_str = path.to_string_lossy().into_owned();
            let key = normalize_tracked_acl_key('W', &path_str);
            if deadline.is_some_and(|d| started.elapsed() >= d) {
                deadline_expired = true;
                extras_skipped += 1;
                if path.exists()
                    && should_reapply_tracked_deny(loaded_schema_version, &key, &previous)
                {
                    unguarded_errors.push(format!(
                        "Deadline expired before guarding existing denyWrite target '{path_str}'"
                    ));
                } else if let Some(root) =
                    find_matching_allow_write_root(&path_str, &canon_allow_writes)
                {
                    unguarded_errors.push(format!(
                        "Deadline expired before guarding denyWrite target '{path_str}' inside allowWrite root '{root}'"
                    ));
                }
                continue;
            }
            if !path.exists() {
                // R3-P0-2: Do NOT silently skip non-existent deny_write targets inside allow_write.
                if let Some(root) = find_matching_allow_write_root(&path_str, &canon_allow_writes) {
                    unguarded_errors.push(format!(
                        "Cannot guard non-existent denyWrite target '{path_str}' inside allowWrite root '{root}'"
                    ));
                }
                extras_skipped += 1;
                continue;
            }
            if !should_reapply_tracked_deny(loaded_schema_version, &key, &previous) {
                in_place += 1;
                stands += 1;
                next_tracked.insert(key, path_str);
                continue;
            }
            // P1-E1(b): When upgrading from legacy schema (< DENIES_SCHEMA_VERSION), strip old
            // `(W,...)` deny ACE (which included SYNCHRONIZE and broke reads) before applying
            // granular `DENY_WRITE_PERM`; if paired `R:` was already applied in this pass, restore it.
            let is_dir = path.is_dir();
            if loaded_schema_version < DENIES_SCHEMA_VERSION && previous.contains_key(&key) {
                let _ = Command::new(&icacls)
                    .arg(&path)
                    .arg("/remove:d")
                    .arg(&sid_arg)
                    .status();
                let paired_r_key = normalize_tracked_acl_key('R', &path_str);
                if next_tracked.contains_key(&paired_r_key) {
                    let r_perm_arg = icacls_perm_arg(&sid_arg, "R", is_dir);
                    let r_ok = Command::new(&icacls)
                        .arg(&path)
                        .arg("/deny")
                        .arg(&r_perm_arg)
                        .status()
                        .map(|s| s.success())
                        .unwrap_or(false);
                    if !r_ok {
                        next_tracked.remove(&paired_r_key);
                        unguarded_errors.push(format!(
                            "icacls /deny (R) re-apply failed during schema migration for '{path_str}'"
                        ));
                    }
                }
            }
            // P1-E1(b): Deny granular write-only rights `(WD,AD,WEA,WA,DE,DC,WDAC,WO)` so
            // sandboxed process cannot write/delete/rename without blocking SYNCHRONIZE reads.
            let perm_arg = icacls_perm_arg(&sid_arg, DENY_WRITE_PERM, is_dir);
            let ok = Command::new(&icacls)
                .arg(&path)
                .arg("/deny")
                .arg(&perm_arg)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if ok {
                planted += 1;
                guarded += 1;
                next_tracked.insert(key, path_str);
            } else {
                extras_skipped += 1;
                unguarded_errors.push(format!(
                    "icacls /deny failed for existing denyWrite target '{path_str}'"
                ));
            }
        }

        // E5-P1-3 & P1-E2(c): Fail closed before granting allow_write if ANY deny target failed to
        // be guarded (non-existent inside allow_write, icacls /deny failure on existing target, or
        // deadline expiry before guarding any existing deny target).
        if !unguarded_errors.is_empty() {
            for (k, v) in &previous {
                next_tracked.entry(k.clone()).or_insert_with(|| v.clone());
            }
            save_tracked_denies(
                &state_file,
                loaded_schema_version.min(DENIES_SCHEMA_VERSION),
                &next_tracked,
                current_sid.as_deref(),
            );
            return Err(BackendError::runtime(format!(
                "Unguarded deny target(s) before allowWrite grant: {}",
                unguarded_errors.join("; ")
            )));
        }

        for path_str in &canon_allow_writes {
            if deadline.is_some_and(|d| started.elapsed() >= d) {
                deadline_expired = true;
                extras_skipped += 1;
                continue;
            }
            let path = Path::new(path_str);
            if !path.exists() {
                extras_skipped += 1;
                continue;
            }
            let key = normalize_tracked_acl_key('A', path_str);
            let is_dir = path.is_dir();
            let perm_arg = icacls_perm_arg(&sid_arg, "M", is_dir);
            let grant_ok = Command::new(&icacls)
                .arg(path)
                .arg("/grant")
                .arg(&perm_arg)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if grant_ok {
                // P1-E1(a): Apply Low integrity label to allow_write roots so Low-IL restricted
                // tokens can write without MIC NO_WRITE_UP denial.
                let il_arg = icacls_integrity_label_arg("Low", is_dir);
                let il_ok = Command::new(&icacls)
                    .arg(path)
                    .arg("/setintegritylevel")
                    .arg(&il_arg)
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
                if il_ok {
                    laid += 1;
                    next_tracked.insert(key, path_str.clone());
                } else {
                    // Roll back the /grant if lowering the integrity label failed.
                    let _ = Command::new(&icacls)
                        .arg(path)
                        .arg("/remove:g")
                        .arg(&sid_arg)
                        .status();
                    extras_skipped += 1;
                }
            } else {
                extras_skipped += 1;
            }
        }

        // R3-P0-3: If deadline expired mid-loop, preserve ALL remaining previous keys and SKIP
        // the stale-entry removal loop so existing .ssh/.aws deny ACEs are NEVER stripped on timeout!
        if deadline_expired {
            for (old_key, old_path) in &previous {
                next_tracked
                    .entry(old_key.clone())
                    .or_insert_with(|| old_path.clone());
            }
        } else {
            for (old_key, raw_old_path) in &previous {
                if !next_tracked.contains_key(old_key) {
                    let Some((prefix, _)) = old_key.split_once(':') else {
                        continue;
                    };
                    // P0-6: Sanitize every old_path loaded from denies.json before invoking icacls.exe
                    let Ok(old_path) = sanitize_path(raw_old_path) else {
                        continue;
                    };
                    // P1-E2(a): Never invoke icacls /remove:g or /remove:d on a symlink/reparse point.
                    let old_path_ref = Path::new(&old_path);
                    if reject_symlinks_and_reparse_points(old_path_ref).is_err() {
                        continue;
                    }
                    if prefix == "A" {
                        // R3-P1-5 & P1-E1(a): Revoke stale allow_write grant and restore Medium IL.
                        let _ = Command::new(&icacls)
                            .arg(&old_path)
                            .arg("/remove:g")
                            .arg(&sid_arg)
                            .status();
                        if old_path_ref.exists() {
                            let il_arg =
                                icacls_integrity_label_arg("Medium", old_path_ref.is_dir());
                            let _ = Command::new(&icacls)
                                .arg(&old_path)
                                .arg("/setintegritylevel")
                                .arg(&il_arg)
                                .status();
                        }
                        continue;
                    }
                    let _ = Command::new(&icacls)
                        .arg(&old_path)
                        .arg("/remove:d")
                        .arg(&sid_arg)
                        .status();
                    // P1-11 & R3-P1-5 & P1-E2(b): Scoped un-track using normalized lowercase keys —
                    // if the paired deny mode (R vs W) is still active, immediately re-apply it and
                    // check exit status (removing from next_tracked and failing closed on error).
                    let is_dir = old_path_ref.is_dir();
                    let paired_reapply = if prefix == "W" {
                        let r_key = normalize_tracked_acl_key('R', &old_path);
                        if next_tracked.contains_key(&r_key) {
                            Some((r_key, "R"))
                        } else {
                            None
                        }
                    } else if prefix == "R" {
                        let w_key = normalize_tracked_acl_key('W', &old_path);
                        if next_tracked.contains_key(&w_key) {
                            Some((w_key, DENY_WRITE_PERM))
                        } else {
                            None
                        }
                    } else {
                        None
                    };
                    if let Some((paired_key, perm)) = paired_reapply {
                        let perm_arg = icacls_perm_arg(&sid_arg, perm, is_dir);
                        let reapply_ok = Command::new(&icacls)
                            .arg(&old_path)
                            .arg("/deny")
                            .arg(&perm_arg)
                            .status()
                            .map(|s| s.success())
                            .unwrap_or(false);
                        if !reapply_ok {
                            next_tracked.remove(&paired_key);
                            unguarded_errors.push(format!(
                                "Failed to re-apply paired deny ACE ({perm}) for '{old_path}' after removing stale '{old_key}'"
                            ));
                        }
                    }
                    handed_back += 1;
                }
            }
        }

        let persisted_version = if deadline_expired || !unguarded_errors.is_empty() {
            loaded_schema_version.min(DENIES_SCHEMA_VERSION)
        } else {
            DENIES_SCHEMA_VERSION
        };
        save_tracked_denies(
            &state_file,
            persisted_version,
            &next_tracked,
            current_sid.as_deref(),
        );

        if !unguarded_errors.is_empty() {
            return Err(BackendError::runtime(format!(
                "Unguarded deny target(s) after stale ACL cleanup: {}",
                unguarded_errors.join("; ")
            )));
        }

        Ok(DeniesResponse {
            in_place,
            planted,
            laid,
            pushed_down: 0,
            guarded,
            extras_skipped,
            ms: started.elapsed().as_millis() as u64,
            stands,
            handed_back,
        })
    }

    pub fn cmd_run(opts: &RunOptions) -> Result<i32, BackendError> {
        let validated = validate_run_options(opts)?;
        let cmdline_w = to_wide_null(&validated.cmdline);
        // P2-5: Use trimmed & sanitized cwd from validate_run_options
        let cwd_w = validated.cwd.as_deref().map(to_wide_null);

        // R3-P0-1: Verify WFP sublayer and block filters are present before spawning (fail closed).
        if !opts.no_net {
            let persisted = load_wfp_config();
            let sublayer_guid = validated
                .sublayer_guid
                .as_deref()
                .or_else(|| persisted.as_ref().and_then(|c| c.sublayer_guid.as_deref()))
                .unwrap_or(DEFAULT_WFP_SUBLAYER_GUID);
            match check_wfp_sublayer_state(sublayer_guid)? {
                WfpCheckState::Installed => {}
                WfpCheckState::CannotRead => {
                    if persisted.is_none() {
                        return Err(BackendError::wfp(
                            "Unable to verify WFP sandbox sublayer/filters (cannot-read and no persisted install config); run 'claude sandbox install' as administrator",
                        ));
                    }
                }
                WfpCheckState::Absent | WfpCheckState::Degraded => {
                    return Err(BackendError::wfp(
                        "WFP sandbox sublayer or outbound block filters are missing/degraded; run 'claude sandbox install' as administrator",
                    ));
                }
            }
        }

        // P0-4: Retrieve sandbox user credential from Windows Credential Manager and fail closed
        // if missing or if LogonUserW fails (NEVER fall back to OpenProcessToken(GetCurrentProcess())).
        let sandbox_user = configured_sandbox_username()?;
        let base_token = logon_sandbox_user(&sandbox_user)?;

        unsafe {
            let restricted_token = create_sandbox_restricted_token(base_token.0)?;

            let job = CreateJobObjectW(ptr::null(), ptr::null());
            if job.is_null() {
                return Err(BackendError::runtime(format!(
                    "CreateJobObjectW failed with error {}",
                    GetLastError()
                )));
            }
            let _job_guard = OwnedHandle(job);

            let mut ext: JobObjectExtendedLimitInformation = std::mem::zeroed();
            ext.basic_limit_information.limit_flags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
            ext.basic_limit_information.active_process_limit = 64;
            if SetInformationJobObject(
                job,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                &ext as *const _ as *const c_void,
                std::mem::size_of::<JobObjectExtendedLimitInformation>() as Dword,
            ) == FALSE
            {
                return Err(BackendError::runtime(format!(
                    "SetInformationJobObject(ExtendedLimit) failed with error {}",
                    GetLastError()
                )));
            }

            let mut ui_flags = JOB_OBJECT_UILIMIT_DESKTOP | JOB_OBJECT_UILIMIT_GLOBALATOMS;
            if opts.block_clipboard_read {
                ui_flags |= JOB_OBJECT_UILIMIT_READCLIPBOARD;
            }
            if opts.block_clipboard_write {
                ui_flags |= JOB_OBJECT_UILIMIT_WRITECLIPBOARD;
            }
            if opts.block_input_injection {
                ui_flags |= JOB_OBJECT_UILIMIT_HANDLES;
            }
            let ui = JobObjectBasicUiRestrictions {
                ui_restrictions_class: ui_flags,
            };
            // P1-11: Fail closed if Job UI restrictions cannot be applied
            if SetInformationJobObject(
                job,
                JOB_OBJECT_BASIC_UI_RESTRICTIONS,
                &ui as *const _ as *const c_void,
                std::mem::size_of::<JobObjectBasicUiRestrictions>() as Dword,
            ) == FALSE
            {
                return Err(BackendError::runtime(format!(
                    "SetInformationJobObject(BasicUiRestrictions) failed with error {}",
                    GetLastError()
                )));
            }

            let env_block = build_windows_env_block(restricted_token.0, opts, &validated)?;

            // R3-P0-5: Populate StartupInfoW with STARTF_USESTDHANDLES and inheritable stdio handles
            let h_stdin = GetStdHandle(STD_INPUT_HANDLE);
            let h_stdout = GetStdHandle(STD_OUTPUT_HANDLE);
            let h_stderr = GetStdHandle(STD_ERROR_HANDLE);
            for h in [h_stdin, h_stdout, h_stderr] {
                if !h.is_null() && h != INVALID_HANDLE_VALUE {
                    let _ = SetHandleInformation(h, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
                }
            }

            let mut si: StartupInfoW = std::mem::zeroed();
            si.cb = std::mem::size_of::<StartupInfoW>() as Dword;
            si.dw_flags = STARTF_USESTDHANDLES;
            si.h_std_input = h_stdin;
            si.h_std_output = h_stdout;
            si.h_std_error = h_stderr;
            let mut pi: ProcessInformation = std::mem::zeroed();

            let mut cmdline_attempt1 = cmdline_w.clone();
            let mut created = CreateProcessAsUserW(
                restricted_token.0,
                ptr::null(),
                cmdline_attempt1.as_mut_ptr(),
                ptr::null(),
                ptr::null(),
                TRUE,
                CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                env_block.as_ptr() as *const c_void,
                cwd_w.as_ref().map_or(ptr::null(), |w| w.as_ptr()),
                &si,
                &mut pi,
            );
            if created == FALSE {
                let first_err = GetLastError();
                if first_err == ERROR_PRIVILEGE_NOT_HELD {
                    // Desktop sessions lack SE_ASSIGNPRIMARYTOKEN_NAME; try CreateProcessWithTokenW
                    // first (preserves the restricted Low-IL token when SE_IMPERSONATE_NAME is held).
                    let mut cmdline_attempt2 = cmdline_w.clone();
                    created = CreateProcessWithTokenW(
                        restricted_token.0,
                        0,
                        ptr::null(),
                        cmdline_attempt2.as_mut_ptr(),
                        CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                        env_block.as_ptr() as *const c_void,
                        cwd_w.as_ref().map_or(ptr::null(), |w| w.as_ptr()),
                        &si,
                        &mut pi,
                    );
                    if created == FALSE {
                        let second_err = GetLastError();
                        if second_err == ERROR_PRIVILEGE_NOT_HELD {
                            // E5-P0-2: Non-elevated desktop sessions also lack SE_IMPERSONATE_NAME.
                            // CreateProcessWithLogonW spawns under sandbox_user WITHOUT WRITE_RESTRICTED
                            // or Low IL, so we self-reexec `srt-win.exe --apply-restricted-token` as
                            // sandbox_user; the child owns its token, applies WRITE_RESTRICTED + Low IL
                            // (failing closed on error), and spawns the target via CreateProcessAsUserW.
                            let self_exe = std::env::current_exe().map_err(|e| {
                                BackendError::runtime(format!(
                                    "Failed to resolve srt-win executable for --apply-restricted-token re-exec: {e}"
                                ))
                            })?;
                            let self_exe_str =
                                strip_verbatim_prefix_checked(&self_exe.to_string_lossy())
                                    .map_err(BackendError::runtime)?
                                    .to_string_lossy()
                                    .into_owned();
                            let reexec_args = build_self_reexec_restricted_token_args(
                                &opts.program,
                                &opts.args,
                                validated.cwd.as_deref(),
                            );
                            let reexec_cmdline =
                                build_windows_command_line(&self_exe_str, &reexec_args)
                                    .map_err(BackendError::validation)?;
                            let self_exe_w = to_wide_null(&self_exe_str);
                            let mut reexec_cmdline_w = to_wide_null(&reexec_cmdline);

                            let mut pass_w = read_sandbox_password(&sandbox_user)?;
                            let user_w = to_wide_null(&sandbox_user);
                            let domain_w = to_wide_null(".");
                            created = CreateProcessWithLogonW(
                                user_w.as_ptr(),
                                domain_w.as_ptr(),
                                pass_w.as_ptr(),
                                LOGON_WITH_PROFILE,
                                self_exe_w.as_ptr(),
                                reexec_cmdline_w.as_mut_ptr(),
                                CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                                env_block.as_ptr() as *const c_void,
                                cwd_w.as_ref().map_or(ptr::null(), |w| w.as_ptr()),
                                &si,
                                &mut pi,
                            );
                            let third_err = if created == FALSE { GetLastError() } else { 0 };
                            zeroize_u16(&mut pass_w);
                            if created == FALSE {
                                return Err(BackendError::runtime(format!(
                                    "CreateProcessWithLogonW (--apply-restricted-token re-exec) failed with error {third_err} (after CreateProcessWithTokenW ERROR_PRIVILEGE_NOT_HELD); ensure Secondary Logon (seclogon) is running"
                                )));
                            }
                        } else {
                            return Err(BackendError::runtime(format!(
                                "CreateProcessWithTokenW fallback failed with error {second_err} (after CreateProcessAsUserW ERROR_PRIVILEGE_NOT_HELD); ensure Secondary Logon (seclogon) is running"
                            )));
                        }
                    }
                } else {
                    return Err(BackendError::runtime(format!(
                        "CreateProcessAsUserW failed with error {first_err}"
                    )));
                }
            }

            let _proc_guard = OwnedHandle(pi.h_process);
            let _thread_guard = OwnedHandle(pi.h_thread);

            // P0-8: Terminate suspended child immediately if job assignment or resume fails
            if AssignProcessToJobObject(job, pi.h_process) == FALSE {
                let err = GetLastError();
                let _ = TerminateProcess(pi.h_process, 1);
                return Err(BackendError::runtime(format!(
                    "AssignProcessToJobObject failed with error {err}"
                )));
            }

            if ResumeThread(pi.h_thread) == Dword::MAX {
                let err = GetLastError();
                let _ = TerminateProcess(pi.h_process, 1);
                return Err(BackendError::runtime(format!(
                    "ResumeThread failed with error {err}"
                )));
            }

            WaitForSingleObject(pi.h_process, INFINITE);
            let mut exit_code: Dword = 1;
            GetExitCodeProcess(pi.h_process, &mut exit_code);
            Ok(exit_code as i32)
        }
    }

    /// E5-P0-2: Self-reexec helper running as `sandbox_user`. Opens its own primary process
    /// token, creates a `DISABLE_MAX_PRIVILEGE | WRITE_RESTRICTED` + Low IL (`S-1-16-4096`)
    /// restricted token (failing closed if creation fails — NEVER runs unrestricted), and
    /// spawns `<program> <args...>` via `CreateProcessAsUserW` (which requires no elevated
    /// privilege when spawning with a restricted derivation of the caller's own token).
    pub fn cmd_apply_restricted_token(
        opts: &ApplyRestrictedTokenOptions,
    ) -> Result<i32, BackendError> {
        let (cmdline, cwd) = validate_apply_restricted_token_options(opts)?;
        let cmdline_w = to_wide_null(&cmdline);
        let cwd_w = cwd.as_deref().map(to_wide_null);

        unsafe {
            let mut proc_token: Handle = ptr::null_mut();
            if OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_ASSIGN_PRIMARY | TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ADJUST_DEFAULT,
                &mut proc_token,
            ) == FALSE
                || proc_token.is_null()
            {
                return Err(BackendError::runtime(format!(
                    "OpenProcessToken(GetCurrentProcess) failed in --apply-restricted-token mode with error {}",
                    GetLastError()
                )));
            }
            let proc_token_guard = OwnedHandle(proc_token);
            let restricted_token = create_sandbox_restricted_token(proc_token_guard.0)?;

            let h_stdin = GetStdHandle(STD_INPUT_HANDLE);
            let h_stdout = GetStdHandle(STD_OUTPUT_HANDLE);
            let h_stderr = GetStdHandle(STD_ERROR_HANDLE);
            for h in [h_stdin, h_stdout, h_stderr] {
                if !h.is_null() && h != INVALID_HANDLE_VALUE {
                    let _ = SetHandleInformation(h, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
                }
            }

            let mut si: StartupInfoW = std::mem::zeroed();
            si.cb = std::mem::size_of::<StartupInfoW>() as Dword;
            si.dw_flags = STARTF_USESTDHANDLES;
            si.h_std_input = h_stdin;
            si.h_std_output = h_stdout;
            si.h_std_error = h_stderr;
            let mut pi: ProcessInformation = std::mem::zeroed();

            let mut cmdline_attempt = cmdline_w.clone();
            let created = CreateProcessAsUserW(
                restricted_token.0,
                ptr::null(),
                cmdline_attempt.as_mut_ptr(),
                ptr::null(),
                ptr::null(),
                TRUE,
                0,
                ptr::null(),
                cwd_w.as_ref().map_or(ptr::null(), |w| w.as_ptr()),
                &si,
                &mut pi,
            );
            if created == FALSE {
                return Err(BackendError::runtime(format!(
                    "CreateProcessAsUserW failed in --apply-restricted-token mode with error {}",
                    GetLastError()
                )));
            }

            let _proc_guard = OwnedHandle(pi.h_process);
            let _thread_guard = OwnedHandle(pi.h_thread);
            WaitForSingleObject(pi.h_process, INFINITE);
            let mut exit_code: Dword = 1;
            GetExitCodeProcess(pi.h_process, &mut exit_code);
            Ok(exit_code as i32)
        }
    }

    pub fn cmd_probe_mxc() -> Result<MxcProbeResponse, BackendError> {
        let ui_ok = probe_job_ui_isolation();
        let wrt_ok = check_write_restricted_token_supported();
        let tier = if ui_ok && wrt_ok {
            "job-restricted".to_string()
        } else {
            "none".to_string()
        };
        Ok(MxcProbeResponse {
            tier,
            needs_dacl_augmentation: true,
            probes: MxcProbes {
                base_container_supports_deny_paths: wrt_ok,
                base_container_supports_identityless_loopback_proxy: wrt_ok,
                base_container_supports_ingress_host_loopback_allow: wrt_ok,
                ui_capabilities: MxcUiCapabilities {
                    can_block_clipboard_read: ui_ok,
                    can_block_clipboard_write: ui_ok,
                    can_block_input_injection: ui_ok,
                },
            },
            error: if ui_ok && wrt_ok {
                None
            } else {
                Some("Win32 restricted token or JobObject UI isolation unavailable".to_string())
            },
        })
    }
}

// ============================================================================
// Non-Windows Implementation (#[cfg(not(windows))])
// - Default: clean non-Windows diagnostics
// - SRT_WIN_TEST_STATE_DIR: realistic persistent state JSON for cross-platform E2E
// ============================================================================

#[cfg(not(windows))]
mod platform {
    use super::*;
    use crate::protocol::{
        json_escape_string, json_opt_string, json_string_array, parse_json, JsonValue,
    };
    use crate::security::{canonicalize_path_best_effort, reject_symlinks_and_reparse_points};
    use std::collections::BTreeSet;
    use std::path::PathBuf;
    use std::process::Command;
    use std::time::Instant;

    const TEST_DEFAULT_REAL_USER_SID: &str = "S-1-5-21-3623811015-3361044348-30300820-1001";

    #[derive(Debug, Clone)]
    struct TestPersistedState {
        provisioned: bool,
        cred_present: bool,
        real_user_sid: Option<String>,
        sandbox_user: Option<String>,
        seclogon_state: String,
        wfp_state: String,
        allow_loopback: bool,
        sublayer_guid: Option<String>,
        proxy_port_range: Option<[u16; 2]>,
        profile_read_granted: bool,
        deny_read: BTreeSet<String>,
        deny_write: BTreeSet<String>,
        allow_write: BTreeSet<String>,
    }

    impl Default for TestPersistedState {
        fn default() -> Self {
            Self {
                provisioned: false,
                cred_present: false,
                real_user_sid: None,
                sandbox_user: None,
                seclogon_state: "unknown".to_string(),
                wfp_state: "absent".to_string(),
                allow_loopback: false,
                sublayer_guid: None,
                proxy_port_range: None,
                profile_read_granted: false,
                deny_read: BTreeSet::new(),
                deny_write: BTreeSet::new(),
                allow_write: BTreeSet::new(),
            }
        }
    }

    impl TestPersistedState {
        fn to_status(&self) -> StatusResponse {
            StatusResponse {
                user: UserStatus {
                    provisioned: self.provisioned,
                    cred_present: self.cred_present,
                    real_user_sid: self.real_user_sid.clone(),
                    sandbox_user: self.sandbox_user.clone(),
                    seclogon_state: self.seclogon_state.clone(),
                },
                wfp: WfpStatus {
                    state: self.wfp_state.clone(),
                    allow_loopback: self.allow_loopback,
                    sublayer_guid: self.sublayer_guid.clone(),
                    proxy_port_range: self.proxy_port_range,
                },
            }
        }

        fn to_json(&self) -> String {
            let port_range = match self.proxy_port_range {
                Some([s, e]) => format!("[{s},{e}]"),
                None => "null".to_string(),
            };
            let dr: Vec<String> = self.deny_read.iter().cloned().collect();
            let dw: Vec<String> = self.deny_write.iter().cloned().collect();
            let aw: Vec<String> = self.allow_write.iter().cloned().collect();
            format!(
                "{{\"provisioned\":{},\"credPresent\":{},\"realUserSid\":{},\"sandboxUser\":{},\"seclogonState\":{},\"wfpState\":{},\"allowLoopback\":{},\"sublayerGuid\":{},\"proxyPortRange\":{},\"profileReadGranted\":{},\"denyRead\":{},\"denyWrite\":{},\"allowWrite\":{}}}",
                self.provisioned,
                self.cred_present,
                json_opt_string(&self.real_user_sid),
                json_opt_string(&self.sandbox_user),
                json_escape_string(&self.seclogon_state),
                json_escape_string(&self.wfp_state),
                self.allow_loopback,
                json_opt_string(&self.sublayer_guid),
                port_range,
                self.profile_read_granted,
                json_string_array(&dr),
                json_string_array(&dw),
                json_string_array(&aw)
            )
        }

        fn from_json(raw: &str) -> Result<Self, String> {
            let val = parse_json(raw)?;
            let map = val
                .as_object()
                .ok_or_else(|| "State JSON must be an object".to_string())?;
            let get_bool = |k: &str| map.get(k).and_then(JsonValue::as_bool).unwrap_or(false);
            let get_opt_str = |k: &str| {
                map.get(k)
                    .and_then(JsonValue::as_str)
                    .map(ToString::to_string)
            };
            let get_set = |k: &str| -> BTreeSet<String> {
                map.get(k)
                    .and_then(JsonValue::as_array)
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(ToString::to_string))
                            .collect()
                    })
                    .unwrap_or_default()
            };
            let proxy_port_range = map
                .get("proxyPortRange")
                .and_then(JsonValue::as_array)
                .and_then(|arr| {
                    if arr.len() == 2 {
                        Some([arr[0].as_u16()?, arr[1].as_u16()?])
                    } else {
                        None
                    }
                });

            Ok(Self {
                provisioned: get_bool("provisioned"),
                cred_present: get_bool("credPresent"),
                real_user_sid: get_opt_str("realUserSid"),
                sandbox_user: get_opt_str("sandboxUser"),
                seclogon_state: get_opt_str("seclogonState").unwrap_or_else(|| "unknown".into()),
                wfp_state: get_opt_str("wfpState").unwrap_or_else(|| "absent".into()),
                allow_loopback: get_bool("allowLoopback"),
                sublayer_guid: get_opt_str("sublayerGuid"),
                proxy_port_range,
                profile_read_granted: get_bool("profileReadGranted"),
                deny_read: get_set("denyRead"),
                deny_write: get_set("denyWrite"),
                allow_write: get_set("allowWrite"),
            })
        }
    }

    fn test_state_dir() -> Option<PathBuf> {
        #[cfg(any(test, debug_assertions, feature = "test-harness"))]
        {
            std::env::var("SRT_WIN_TEST_STATE_DIR")
                .ok()
                .filter(|v| !v.trim().is_empty())
                .map(PathBuf::from)
        }
        #[cfg(not(any(test, debug_assertions, feature = "test-harness")))]
        {
            None
        }
    }

    fn state_file_path(dir: &PathBuf) -> PathBuf {
        dir.join("state.json")
    }

    fn load_state(dir: &PathBuf) -> Result<TestPersistedState, BackendError> {
        let path = state_file_path(dir);
        if !path.exists() {
            return Ok(TestPersistedState::default());
        }
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| BackendError::runtime(format!("Failed to read test state: {e}")))?;
        TestPersistedState::from_json(&raw)
            .map_err(|e| BackendError::runtime(format!("Corrupt test state JSON: {e}")))
    }

    fn save_state(dir: &PathBuf, state: &TestPersistedState) -> Result<(), BackendError> {
        std::fs::create_dir_all(dir)
            .map_err(|e| BackendError::runtime(format!("Failed to create test state dir: {e}")))?;
        std::fs::write(state_file_path(dir), state.to_json())
            .map_err(|e| BackendError::runtime(format!("Failed to write test state: {e}")))
    }

    fn check_test_fault_injection() -> Result<(), BackendError> {
        #[cfg(any(test, debug_assertions, feature = "test-harness"))]
        {
            if std::env::var("SRT_WIN_TEST_SIMULATE_UAC_CANCEL").as_deref() == Ok("1") {
                return Err(BackendError::uac_cancelled(
                    "Simulated UAC elevation cancellation",
                ));
            }
            if std::env::var("SRT_WIN_TEST_SIMULATE_WFP_ERROR").as_deref() == Ok("1") {
                return Err(BackendError::wfp("Simulated WFP subsystem failure"));
            }
        }
        Ok(())
    }

    fn should_defer_profile_forget_in_test() -> bool {
        #[cfg(any(test, debug_assertions, feature = "test-harness"))]
        {
            std::env::var("SRT_WIN_TEST_DEFER_PROFILE_FORGET").as_deref() == Ok("1")
        }
        #[cfg(not(any(test, debug_assertions, feature = "test-harness")))]
        {
            false
        }
    }

    pub fn cmd_status(opts: &StatusOptions) -> Result<StatusResponse, BackendError> {
        validate_status_options(opts)?;
        let Some(dir) = test_state_dir() else {
            return Ok(StatusResponse::absent());
        };
        let mut status = load_state(&dir)?.to_status();
        if let Some(ref requested_guid) = opts.sublayer_guid {
            let matches = status
                .wfp
                .sublayer_guid
                .as_deref()
                .is_some_and(|g| g.eq_ignore_ascii_case(requested_guid));
            if !matches {
                status.wfp.state = "absent".to_string();
                status.wfp.allow_loopback = false;
                status.wfp.sublayer_guid = None;
                status.wfp.proxy_port_range = None;
            }
        }
        Ok(status)
    }

    pub fn cmd_install(opts: &InstallOptions) -> Result<StatusResponse, BackendError> {
        validate_install_options(opts)?;
        let Some(dir) = test_state_dir() else {
            return Err(BackendError::runtime(
                "Windows native sandbox install requires native Windows",
            ));
        };
        check_test_fault_injection()?;
        let state = TestPersistedState {
            provisioned: true,
            cred_present: true,
            real_user_sid: Some(
                opts.real_user_sid
                    .clone()
                    .unwrap_or_else(|| TEST_DEFAULT_REAL_USER_SID.to_string()),
            ),
            sandbox_user: Some(opts.sandbox_user.clone()),
            seclogon_state: "running".to_string(),
            wfp_state: "installed".to_string(),
            allow_loopback: opts.allow_loopback,
            sublayer_guid: Some(opts.sublayer_guid.clone()),
            proxy_port_range: Some(opts.proxy_port_range),
            profile_read_granted: true,
            deny_read: BTreeSet::new(),
            deny_write: BTreeSet::new(),
            allow_write: BTreeSet::new(),
        };
        save_state(&dir, &state)?;
        Ok(state.to_status())
    }

    pub fn cmd_uninstall(opts: &UninstallOptions) -> Result<StatusResponse, BackendError> {
        validate_uninstall_options(opts)?;
        let Some(dir) = test_state_dir() else {
            return Err(BackendError::runtime(
                "Windows native sandbox uninstall requires native Windows",
            ));
        };
        check_test_fault_injection()?;
        let path = state_file_path(&dir);
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| BackendError::runtime(format!("Failed to remove test state: {e}")))?;
        }
        Ok(StatusResponse::absent())
    }

    pub fn cmd_wfp_verify(opts: &WfpVerifyOptions) -> Result<WfpVerifyResponse, BackendError> {
        validate_wfp_verify_options(opts)?;
        let Some(dir) = test_state_dir() else {
            return Ok(WfpVerifyResponse {
                egress_probe: "not-run".to_string(),
                target: opts.target.clone(),
                write_restricted_token: false,
            });
        };
        check_test_fault_injection()?;
        let state = load_state(&dir)?;
        let installed = state.provisioned && state.wfp_state == "installed";
        Ok(WfpVerifyResponse {
            egress_probe: if installed {
                "blocked".to_string()
            } else {
                "allowed".to_string()
            },
            target: opts.target.clone(),
            write_restricted_token: installed,
        })
    }

    pub fn cmd_profile_forget(
        opts: &ProfileForgetOptions,
    ) -> Result<ProfileForgetResponse, BackendError> {
        validate_profile_forget_options(opts)?;
        let Some(dir) = test_state_dir() else {
            return Ok(ProfileForgetResponse {
                cleared: false,
                deferred: false,
            });
        };
        let mut state = load_state(&dir)?;
        if let Some(ref sid) = opts.sid {
            ensure_not_current_user_sid(sid, state.real_user_sid.as_deref())?;
        }
        if should_defer_profile_forget_in_test() {
            return Ok(ProfileForgetResponse {
                cleared: false,
                deferred: true,
            });
        }
        let was_granted = state.profile_read_granted;
        state.profile_read_granted = false;
        save_state(&dir, &state)?;
        Ok(ProfileForgetResponse {
            cleared: was_granted,
            deferred: false,
        })
    }

    pub fn cmd_denies(req: &DeniesRequest) -> Result<DeniesResponse, BackendError> {
        validate_denies_request(req)?;
        let Some(dir) = test_state_dir() else {
            return Err(BackendError::runtime(
                "Windows native sandbox denies require native Windows",
            ));
        };
        let started = Instant::now();
        let deadline = req.deadline_ms.map(std::time::Duration::from_millis);
        let mut state = load_state(&dir)?;
        if !state.provisioned {
            return Err(BackendError::runtime(
                "Sandbox user is not provisioned; run 'install' first",
            ));
        }
        if let Some(ref sid) = req.sid {
            ensure_not_current_user_sid(sid, state.real_user_sid.as_deref())?;
        }

        let prev_deny_read: BTreeSet<String> = state
            .deny_read
            .iter()
            .map(|p| normalize_windows_path_key(p))
            .collect();
        let prev_deny_write: BTreeSet<String> = state
            .deny_write
            .iter()
            .map(|p| normalize_windows_path_key(p))
            .collect();

        let mut new_deny_read = BTreeSet::new();
        let mut new_deny_write = BTreeSet::new();
        let mut new_allow_write = BTreeSet::new();

        let mut canon_allow_writes: Vec<String> = Vec::with_capacity(req.allow_write.len());
        for raw_allow in &req.allow_write {
            let sanitized = sanitize_path(raw_allow).map_err(BackendError::validation)?;
            reject_symlinks_and_reparse_points(std::path::Path::new(&sanitized))
                .map_err(BackendError::validation)?;
            let canon =
                canonicalize_path_best_effort(&sanitized).map_err(BackendError::validation)?;
            reject_symlinks_and_reparse_points(&canon).map_err(BackendError::validation)?;
            canon_allow_writes.push(canon.to_string_lossy().into_owned());
        }

        let mut in_place = 0u64;
        let mut planted = 0u64;
        let mut laid = 0u64;
        let mut pushed_down = 0u64;
        let mut guarded = 0u64;
        let mut extras_skipped = 0u64;
        let mut stands = 0u64;
        let mut handed_back = 0u64;
        let mut deadline_expired = false;
        let mut unguarded_errors: Vec<String> = Vec::new();

        for raw in &req.deny_read {
            let sanitized = sanitize_path(raw).map_err(BackendError::validation)?;
            reject_symlinks_and_reparse_points(std::path::Path::new(&sanitized))
                .map_err(BackendError::validation)?;
            let canon =
                canonicalize_path_best_effort(&sanitized).map_err(BackendError::validation)?;
            reject_symlinks_and_reparse_points(&canon).map_err(BackendError::validation)?;
            let canon_str = canon.to_string_lossy().into_owned();
            let norm = normalize_windows_path_key(&canon_str);
            if deadline.is_some_and(|d| started.elapsed() >= d) {
                deadline_expired = true;
                extras_skipped += 1;
                if canon.exists() && !prev_deny_read.contains(&norm) {
                    unguarded_errors.push(format!(
                        "Deadline expired before guarding existing denyRead target '{canon_str}'"
                    ));
                } else if let Some(root) =
                    find_matching_allow_write_root(&canon_str, &canon_allow_writes)
                {
                    unguarded_errors.push(format!(
                        "Deadline expired before guarding denyRead target '{canon_str}' inside allowWrite root '{root}'"
                    ));
                }
                continue;
            }
            if new_deny_read.insert(norm.clone()) {
                if prev_deny_read.contains(&norm) {
                    in_place += 1;
                    stands += 1;
                } else {
                    planted += 1;
                    guarded += 1;
                }
            }
        }
        for raw in &req.deny_write {
            let sanitized = sanitize_path(raw).map_err(BackendError::validation)?;
            reject_symlinks_and_reparse_points(std::path::Path::new(&sanitized))
                .map_err(BackendError::validation)?;
            let canon =
                canonicalize_path_best_effort(&sanitized).map_err(BackendError::validation)?;
            reject_symlinks_and_reparse_points(&canon).map_err(BackendError::validation)?;
            let canon_str = canon.to_string_lossy().into_owned();
            let norm = normalize_windows_path_key(&canon_str);
            if deadline.is_some_and(|d| started.elapsed() >= d) {
                deadline_expired = true;
                extras_skipped += 1;
                if canon.exists() && !prev_deny_write.contains(&norm) {
                    unguarded_errors.push(format!(
                        "Deadline expired before guarding existing denyWrite target '{canon_str}'"
                    ));
                } else if let Some(root) =
                    find_matching_allow_write_root(&canon_str, &canon_allow_writes)
                {
                    unguarded_errors.push(format!(
                        "Deadline expired before guarding denyWrite target '{canon_str}' inside allowWrite root '{root}'"
                    ));
                }
                continue;
            }
            if new_deny_write.insert(norm.clone()) {
                if prev_deny_write.contains(&norm) {
                    in_place += 1;
                    stands += 1;
                } else {
                    planted += 1;
                    guarded += 1;
                }
            }
        }
        if !unguarded_errors.is_empty() {
            return Err(BackendError::runtime(format!(
                "Unguarded deny target(s) before allowWrite grant: {}",
                unguarded_errors.join("; ")
            )));
        }
        for canon_str in &canon_allow_writes {
            if deadline.is_some_and(|d| started.elapsed() >= d) {
                deadline_expired = true;
                extras_skipped += 1;
                continue;
            }
            let norm = normalize_windows_path_key(canon_str);
            if new_allow_write.insert(norm.clone()) {
                laid += 1;
                if new_deny_write
                    .iter()
                    .any(|dw| norm.starts_with(dw.as_str()) && norm.len() > dw.len())
                {
                    pushed_down += 1;
                }
            }
        }

        // R3-P0-3: On deadline expiry, preserve ALL previous tracked denies and skip stale removal.
        if deadline_expired {
            for old in &prev_deny_read {
                new_deny_read.insert(old.clone());
            }
            for old in &prev_deny_write {
                new_deny_write.insert(old.clone());
            }
            for old in &state.allow_write {
                new_allow_write.insert(normalize_windows_path_key(old));
            }
        } else {
            for old in &prev_deny_read {
                if !new_deny_read.contains(old) {
                    handed_back += 1;
                }
            }
            for old in &prev_deny_write {
                if !new_deny_write.contains(old) {
                    handed_back += 1;
                }
            }
        }

        state.deny_read = new_deny_read;
        state.deny_write = new_deny_write;
        state.allow_write = new_allow_write;
        save_state(&dir, &state)?;

        Ok(DeniesResponse {
            in_place,
            planted,
            laid,
            pushed_down,
            guarded,
            extras_skipped,
            ms: started.elapsed().as_millis() as u64,
            stands,
            handed_back,
        })
    }

    pub fn cmd_run(opts: &RunOptions) -> Result<i32, BackendError> {
        let validated = validate_run_options(opts)?;
        let Some(dir) = test_state_dir() else {
            return Err(BackendError::runtime(
                "Windows native sandbox run requires native Windows",
            ));
        };
        let state = load_state(&dir)?;
        if !state.provisioned {
            return Err(BackendError::runtime(
                "Sandbox user is not provisioned; run 'install' first",
            ));
        }
        // R3-P0-1: Verify WFP is installed before spawning (fail closed unless --no-net).
        if !opts.no_net && state.wfp_state != "installed" {
            return Err(BackendError::wfp(format!(
                "WFP sandbox filters are not installed (state: '{}'); run 'install' first",
                state.wfp_state
            )));
        }

        let mut cmd = Command::new(&opts.program);
        cmd.args(&opts.args);
        // P2-5: Use trimmed & sanitized cwd
        if let Some(ref cwd) = validated.cwd {
            cmd.current_dir(cwd);
        }
        // P0-4: Scrub sensitive secrets from child environment
        for (k, _) in std::env::vars() {
            if is_sensitive_env_var(&k) {
                cmd.env_remove(&k);
            }
        }
        // R3-P1-4: Merge explicit --env KEY=VAL overrides (scrubbed via is_sensitive_env_var)
        for (k, v) in &opts.extra_env {
            if !is_sensitive_env_var(k) {
                cmd.env(k, v);
            }
        }
        if let Some(ref http) = validated.http_proxy {
            cmd.env("HTTP_PROXY", http);
            cmd.env("http_proxy", http);
        }
        if let Some(ref https) = validated.https_proxy {
            cmd.env("HTTPS_PROXY", https);
            cmd.env("https_proxy", https);
        }
        if opts.allow_loopback {
            cmd.env("NO_PROXY", "127.0.0.1,localhost");
        }
        cmd.env("SRT_WIN_SANDBOXED", "1");
        cmd.env(
            "SRT_WIN_BLOCK_CLIPBOARD_READ",
            if opts.block_clipboard_read { "1" } else { "0" },
        );
        cmd.env(
            "SRT_WIN_BLOCK_CLIPBOARD_WRITE",
            if opts.block_clipboard_write { "1" } else { "0" },
        );
        cmd.env(
            "SRT_WIN_BLOCK_INPUT_INJECTION",
            if opts.block_input_injection { "1" } else { "0" },
        );

        let status = cmd.status().map_err(|e| {
            BackendError::runtime(format!("Failed to spawn '{}': {e}", opts.program))
        })?;
        Ok(status.code().unwrap_or(1))
    }

    pub fn cmd_apply_restricted_token(
        opts: &ApplyRestrictedTokenOptions,
    ) -> Result<i32, BackendError> {
        let (_cmdline, cwd) = validate_apply_restricted_token_options(opts)?;
        let Some(_dir) = test_state_dir() else {
            return Err(BackendError::runtime(
                "Windows native sandbox --apply-restricted-token requires native Windows",
            ));
        };
        let mut cmd = Command::new(&opts.program);
        cmd.args(&opts.args);
        if let Some(ref dir) = cwd {
            cmd.current_dir(dir);
        }
        cmd.env("SRT_WIN_RESTRICTED_TOKEN_APPLIED", "1");
        let status = cmd.status().map_err(|e| {
            BackendError::runtime(format!("Failed to spawn '{}': {e}", opts.program))
        })?;
        Ok(status.code().unwrap_or(1))
    }

    pub fn cmd_probe_mxc() -> Result<MxcProbeResponse, BackendError> {
        let Some(dir) = test_state_dir() else {
            return Ok(MxcProbeResponse {
                tier: "none".to_string(),
                needs_dacl_augmentation: true,
                probes: MxcProbes {
                    base_container_supports_deny_paths: false,
                    base_container_supports_identityless_loopback_proxy: false,
                    base_container_supports_ingress_host_loopback_allow: false,
                    ui_capabilities: MxcUiCapabilities {
                        can_block_clipboard_read: false,
                        can_block_clipboard_write: false,
                        can_block_input_injection: false,
                    },
                },
                error: Some("Windows native sandbox requires native Windows".to_string()),
            });
        };
        let state = load_state(&dir)?;
        if state.provisioned {
            Ok(MxcProbeResponse {
                tier: "job-restricted".to_string(),
                needs_dacl_augmentation: true,
                probes: MxcProbes {
                    base_container_supports_deny_paths: true,
                    base_container_supports_identityless_loopback_proxy: true,
                    base_container_supports_ingress_host_loopback_allow: state.allow_loopback,
                    ui_capabilities: MxcUiCapabilities {
                        can_block_clipboard_read: true,
                        can_block_clipboard_write: true,
                        can_block_input_injection: true,
                    },
                },
                error: None,
            })
        } else {
            Ok(MxcProbeResponse {
                tier: "none".to_string(),
                needs_dacl_augmentation: true,
                probes: MxcProbes {
                    base_container_supports_deny_paths: false,
                    base_container_supports_identityless_loopback_proxy: false,
                    base_container_supports_ingress_host_loopback_allow: false,
                    ui_capabilities: MxcUiCapabilities {
                        can_block_clipboard_read: false,
                        can_block_clipboard_write: false,
                        can_block_input_injection: false,
                    },
                },
                error: Some("Sandbox not provisioned in test state".to_string()),
            })
        }
    }
}

pub use platform::{
    cmd_apply_restricted_token, cmd_denies, cmd_install, cmd_probe_mxc, cmd_profile_forget,
    cmd_run, cmd_status, cmd_uninstall, cmd_wfp_verify,
};

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn non_windows_default_reports_absent_and_none_tier() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("SRT_WIN_TEST_STATE_DIR");

        let status = cmd_status(&StatusOptions::default()).unwrap();
        assert!(!status.user.provisioned);
        assert_eq!(status.wfp.state, "absent");

        let probe = cmd_probe_mxc().unwrap();
        assert_eq!(probe.tier, "none");
        assert!(probe
            .error
            .as_deref()
            .unwrap()
            .contains("requires native Windows"));
    }

    #[test]
    fn non_windows_test_state_full_lifecycle() {
        let _guard = ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "srt-win-rust-unit-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&tmp);
        std::env::set_var("SRT_WIN_TEST_STATE_DIR", &tmp);

        let initial = cmd_status(&StatusOptions::default()).unwrap();
        assert!(!initial.user.provisioned);
        assert_eq!(initial.wfp.state, "absent");

        let installed = cmd_install(&InstallOptions::default()).unwrap();
        assert!(installed.user.provisioned);
        assert!(installed.user.cred_present);
        assert_eq!(installed.wfp.state, "installed");
        assert_eq!(installed.wfp.proxy_port_range, Some([60080, 60089]));

        // R3-P2-1: status with mismatched --sublayer-guid reports absent WFP
        let mismatched = cmd_status(&StatusOptions {
            sublayer_guid: Some("11111111-2222-3333-4444-555555555555".to_string()),
        })
        .unwrap();
        assert_eq!(mismatched.wfp.state, "absent");

        let verified = cmd_wfp_verify(&WfpVerifyOptions::default()).unwrap();
        assert_eq!(verified.egress_probe, "blocked");
        assert!(verified.write_restricted_token);

        let sandbox_sid = "S-1-5-21-3623811015-3361044348-30300820-2002".to_string();

        // P0-2: Self-SID refusal in cmd_denies and cmd_profile_forget
        let real_sid = installed.user.real_user_sid.clone().unwrap();
        let self_deny_err = cmd_denies(&DeniesRequest {
            deny_read: vec![r"C:\secret\ssh".to_string()],
            deny_write: vec![],
            allow_write: vec![],
            sid: Some(real_sid.clone()),
            deadline_ms: None,
        })
        .unwrap_err();
        assert_eq!(self_deny_err.exit_code, EXIT_VALIDATION);

        let self_forget_err = cmd_profile_forget(&ProfileForgetOptions {
            sid: Some(real_sid),
        })
        .unwrap_err();
        assert_eq!(self_forget_err.exit_code, EXIT_VALIDATION);

        let first_denies = cmd_denies(&DeniesRequest {
            deny_read: vec![r"C:\secret\ssh".to_string()],
            deny_write: vec![r"C:\sys".to_string()],
            allow_write: vec![r"C:\sys\allowed".to_string()],
            sid: Some(sandbox_sid.clone()),
            deadline_ms: Some(5000),
        })
        .unwrap();
        assert_eq!(first_denies.planted, 2);
        assert_eq!(first_denies.in_place, 0);
        assert_eq!(first_denies.laid, 1);
        assert_eq!(first_denies.pushed_down, 1);
        assert_eq!(first_denies.handed_back, 0);

        // R3-P0-3: deadline_ms=0 expires mid-loop and must preserve ALL previous denies (handed_back == 0)
        let expired_denies = cmd_denies(&DeniesRequest {
            deny_read: vec![r"C:\new\path".to_string()],
            deny_write: vec![],
            allow_write: vec![],
            sid: Some(sandbox_sid.clone()),
            deadline_ms: Some(0),
        })
        .unwrap();
        assert_eq!(expired_denies.handed_back, 0);
        assert_eq!(expired_denies.extras_skipped, 1);

        // E5-P1-3: deadline_ms=0 skipping a deny target INSIDE allow_write must fail closed
        let unguarded_deadline_err = cmd_denies(&DeniesRequest {
            deny_read: vec![],
            deny_write: vec![r"C:\work\.git\config".to_string()],
            allow_write: vec![r"C:\work".to_string()],
            sid: Some(sandbox_sid.clone()),
            deadline_ms: Some(0),
        })
        .unwrap_err();
        assert_eq!(unguarded_deadline_err.exit_code, EXIT_RUNTIME_ERROR);
        assert!(unguarded_deadline_err.message.contains("Deadline expired"));

        // R3-P1-5: case-insensitive path key match (uppercase C:\SECRET\SSH matches c:\secret\ssh)
        let second_denies = cmd_denies(&DeniesRequest {
            deny_read: vec![r"C:\SECRET\SSH".to_string()],
            deny_write: vec![],
            allow_write: vec![],
            sid: Some(sandbox_sid.clone()),
            deadline_ms: None,
        })
        .unwrap();
        assert_eq!(second_denies.in_place, 1);
        assert_eq!(second_denies.stands, 1);
        assert_eq!(second_denies.handed_back, 1);

        let forget = cmd_profile_forget(&ProfileForgetOptions {
            sid: Some(sandbox_sid),
        })
        .unwrap();
        assert!(forget.cleared);
        assert!(!forget.deferred);

        let probe = cmd_probe_mxc().unwrap();
        assert_eq!(probe.tier, "job-restricted");
        assert!(probe.probes.ui_capabilities.can_block_clipboard_read);

        let uninstalled = cmd_uninstall(&UninstallOptions::default()).unwrap();
        assert!(!uninstalled.user.provisioned);
        assert_eq!(uninstalled.wfp.state, "absent");

        std::env::remove_var("SRT_WIN_TEST_STATE_DIR");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn enforces_self_sid_refusal_and_security_helpers() {
        let user_sid = "S-1-5-21-100-200-300-1001";
        let sandbox_sid = "S-1-5-21-100-200-300-1002";
        assert!(ensure_not_current_user_sid(user_sid, Some(user_sid)).is_err());
        assert!(ensure_not_current_user_sid(sandbox_sid, Some(user_sid)).is_ok());

        assert_eq!(
            cred_target_name("claude_srt"),
            "ClaudeSandboxRuntime/claude_srt"
        );
        assert_eq!(CANONICAL_STATE_DIR_NAME, "sandbox-runtime");
        assert_eq!(
            icacls_perm_arg("*S-1-5-21-1-2-3-1002", "R", true),
            "*S-1-5-21-1-2-3-1002:(OI)(CI)R"
        );
        assert_eq!(
            icacls_perm_arg("*S-1-5-21-1-2-3-1002", "R", false),
            "*S-1-5-21-1-2-3-1002:R"
        );
        // P1-E1(b): deny_write uses granular write-only rights (without `(W)` / SYNCHRONIZE)
        assert_eq!(DENY_WRITE_PERM, "(WD,AD,WEA,WA,DE,DC,WDAC,WO)");
        assert_eq!(
            icacls_perm_arg("*S-1-5-21-1-2-3-1002", DENY_WRITE_PERM, true),
            "*S-1-5-21-1-2-3-1002:(OI)(CI)(WD,AD,WEA,WA,DE,DC,WDAC,WO)"
        );
        assert_eq!(
            icacls_perm_arg("*S-1-5-21-1-2-3-1002", DENY_WRITE_PERM, false),
            "*S-1-5-21-1-2-3-1002:(WD,AD,WEA,WA,DE,DC,WDAC,WO)"
        );
        // P1-E1(a): Low/Medium integrity level labels for allow_write directories & files
        assert_eq!(icacls_integrity_label_arg("Low", true), "(OI)(CI)Low");
        assert_eq!(icacls_integrity_label_arg("Low", false), "Low");
        assert_eq!(icacls_integrity_label_arg("Medium", true), "(OI)(CI)Medium");
        assert_eq!(icacls_integrity_label_arg("Medium", false), "Medium");

        // R3-P0-2: allow_write containment matching (case-insensitive, segment-boundary aware)
        let roots = vec![r"C:\Users\Alice\Work".to_string()];
        assert_eq!(
            find_matching_allow_write_root(r"c:\users\alice\work\.git\config", &roots),
            Some(r"C:\Users\Alice\Work")
        );
        assert_eq!(
            find_matching_allow_write_root(r"C:\Users\Alice\Work2\file.txt", &roots),
            None
        );

        // R3-P0-3: state dir ACL hardening args
        let acl_args =
            build_state_dir_icacls_args(r"C:\ProgramData\sandbox-runtime", Some(user_sid));
        assert!(acl_args.contains(&"/inheritance:r".to_string()));
        assert!(acl_args.contains(&"*S-1-5-18:(OI)(CI)F".to_string()));
        assert!(acl_args.contains(&"*S-1-5-32-544:(OI)(CI)F".to_string()));
        assert!(acl_args.contains(&format!("*{user_sid}:(OI)(CI)F")));
        let bad_acl_args =
            build_state_dir_icacls_args(r"C:\ProgramData\sandbox-runtime", Some("S-1-5-18"));
        assert_eq!(bad_acl_args.len(), 6);

        // R3-P1-5 & E5-P1-3: tracked ACL map object + schema_version: 2 + legacy migration forces re-apply
        let legacy_arr =
            parse_tracked_denies_file(r#"["R:C:\\Users\\Alice\\.ssh","W:C:\\Work\\.env"]"#);
        assert_eq!(legacy_arr.schema_version, 1);
        assert!(should_reapply_tracked_deny(
            legacy_arr.schema_version,
            r"W:c:\work\.env",
            &legacy_arr.entries
        ));
        let legacy_obj =
            parse_tracked_denies_file(r#"{"W:c:\\work\\.env":"C:\\Work\\.env"}"#);
        assert_eq!(legacy_obj.schema_version, 1);
        assert!(should_reapply_tracked_deny(
            legacy_obj.schema_version,
            r"W:c:\work\.env",
            &legacy_obj.entries
        ));

        let legacy = parse_tracked_acl_map(r#"["R:C:\\Users\\Alice\\.ssh","W:C:\\Work\\.env"]"#);
        assert_eq!(
            legacy.get(r"R:c:\users\alice\.ssh").map(String::as_str),
            Some(r"C:\Users\Alice\.ssh")
        );
        let serialized = serialize_tracked_acl_map(&legacy);
        assert!(serialized.contains(r#""schema_version":3"#));
        let parsed_v3 = parse_tracked_denies_file(&serialized);
        assert_eq!(parsed_v3.schema_version, DENIES_SCHEMA_VERSION);
        assert_eq!(parsed_v3.entries, legacy);
        assert!(!should_reapply_tracked_deny(
            parsed_v3.schema_version,
            r"W:c:\work\.env",
            &parsed_v3.entries
        ));
        // Upgrading from schema_version 2 forces re-application to strip legacy `(W)` SYNCHRONIZE ACE
        assert!(should_reapply_tracked_deny(
            2,
            r"W:c:\work\.env",
            &parsed_v3.entries
        ));
        assert!(should_reapply_tracked_deny(
            parsed_v3.schema_version,
            r"W:c:\work\other",
            &parsed_v3.entries
        ));

        // E5-P0-2: self-reexec --apply-restricted-token argv & validation
        let reexec = build_self_reexec_restricted_token_args(
            "powershell.exe",
            &["-NoProfile".to_string(), "-Command".to_string(), "echo ok".to_string()],
            Some(r"C:\Users\Alice\Work"),
        );
        assert_eq!(
            reexec,
            vec![
                "--apply-restricted-token",
                "--cwd",
                r"C:\Users\Alice\Work",
                "--",
                "powershell.exe",
                "-NoProfile",
                "-Command",
                "echo ok",
            ]
        );
        assert!(validate_apply_restricted_token_options(&ApplyRestrictedTokenOptions {
            program: r"C:\temp\payload.bat".to_string(),
            args: vec![],
            cwd: None,
        })
        .is_err());
        assert!(validate_apply_restricted_token_options(&ApplyRestrictedTokenOptions {
            program: "powershell.exe".to_string(),
            args: vec!["-Command".to_string(), "echo ok".to_string()],
            cwd: Some(r"C:\Users\Alice\Work".to_string()),
        })
        .is_ok());

        // R3-P2-2: WSAEACCES (10013) -> "blocked", timeout/unreachable -> "not-run"
        assert_eq!(classify_wfp_connect_error(Some(WSAEACCES)), "blocked");
        assert_eq!(classify_wfp_connect_error(Some(10060)), "not-run");
        assert_eq!(classify_wfp_connect_error(None), "not-run");

        assert!(is_sensitive_env_var("ANTHROPIC_API_KEY"));
        assert!(is_sensitive_env_var("SRT_WIN_SANDBOX_PASSWORD"));
        assert!(is_sensitive_env_var("CLAUDE_CODE_OAUTH_TOKEN"));
        assert!(is_sensitive_env_var("AWS_SECRET_ACCESS_KEY"));
        assert!(!is_sensitive_env_var("PATH"));
        assert!(!is_sensitive_env_var("SYSTEMROOT"));

        // R3-P1-4: fallback env drops TEMP/TMP and keeps CA/proxy allowlist
        let filtered = filter_safe_fallback_env(vec![
            ("PATH".to_string(), r"C:\Windows\System32".to_string()),
            ("TEMP".to_string(), r"C:\Users\host\AppData\Local\Temp".to_string()),
            ("TMP".to_string(), r"C:\Users\host\AppData\Local\Temp".to_string()),
            ("NODE_EXTRA_CA_CERTS".to_string(), r"C:\ProgramData\sandbox-runtime\ca\cert.pem".to_string()),
            ("ANTHROPIC_API_KEY".to_string(), "sk-secret".to_string()),
            ("CUSTOM_UNSAFE".to_string(), "value".to_string()),
        ]);
        assert_eq!(
            filtered,
            vec![
                ("PATH".to_string(), r"C:\Windows\System32".to_string()),
                (
                    "NODE_EXTRA_CA_CERTS".to_string(),
                    r"C:\ProgramData\sandbox-runtime\ca\cert.pem".to_string()
                ),
            ]
        );
    }

    #[test]
    fn validate_run_options_guards_batbadbut_cwd_and_proxy_urls() {
        let base = RunOptions {
            program: "cmd.exe".to_string(),
            args: vec!["/c".to_string(), "echo ok".to_string()],
            cwd: Some(r"  C:\Users\alice\work  ".to_string()),
            proxy_port: Some(60080),
            http_proxy: None,
            https_proxy: None,
            sublayer_guid: None,
            no_net: false,
            extra_env: vec![(
                "NODE_EXTRA_CA_CERTS".to_string(),
                r"C:\ProgramData\sandbox-runtime\ca\cert.pem".to_string(),
            )],
            allow_loopback: true,
            block_clipboard_read: true,
            block_clipboard_write: true,
            block_input_injection: true,
        };
        let validated = validate_run_options(&base).unwrap();
        assert_eq!(validated.cwd.as_deref(), Some(r"C:\Users\alice\work"));
        assert_eq!(
            validated.http_proxy.as_deref(),
            Some("http://127.0.0.1:60080")
        );

        let bat_opts = RunOptions {
            program: r"C:\temp\payload.bat".to_string(),
            ..base.clone()
        };
        assert!(validate_run_options(&bat_opts).is_err());

        let ads_opts = RunOptions {
            program: r"C:\temp\payload.bat::$DATA".to_string(),
            ..base.clone()
        };
        assert!(validate_run_options(&ads_opts).is_err());

        let crlf_opts = RunOptions {
            program: "cmd.exe\r\nevil".to_string(),
            ..base.clone()
        };
        assert!(validate_run_options(&crlf_opts).is_err());

        let cmd_opts = RunOptions {
            program: r"C:\temp\payload.CMD.. ".to_string(),
            ..base.clone()
        };
        assert!(validate_run_options(&cmd_opts).is_err());

        let bad_proxy = RunOptions {
            http_proxy: Some("socks5://127.0.0.1:1080".to_string()),
            ..base.clone()
        };
        assert!(validate_run_options(&bad_proxy).is_err());

        let bad_cwd = RunOptions {
            cwd: Some(r" \\.\PhysicalDrive0".to_string()),
            ..base
        };
        assert!(validate_run_options(&bad_cwd).is_err());
    }

    #[test]
    fn windows_backend_invariants_p0_1_p1_e1_p1_e2() {
        let full_src = include_str!("win32_backend.rs");
        let src = full_src
            .split("#[cfg(all(test, not(windows)))]")
            .next()
            .unwrap();
        // P0-1: cmd_uninstall must unwrap `.entries` from load_tracked_denies(&denies_file)
        assert!(src.contains("let tracked = load_tracked_denies(&denies_file).entries;"));
        assert!(!src.contains("let tracked = load_tracked_denies(&denies_file);"));
        // P1-E1(a): Low IL applied to allow_write roots and Medium IL restored on revoke/uninstall
        assert!(src.contains(r#"icacls_integrity_label_arg("Low", is_dir)"#));
        assert!(src.contains(r#"icacls_integrity_label_arg("Medium", old_path_ref.is_dir())"#));
        assert!(src.contains(r#"icacls_integrity_label_arg("Medium", path_ref.is_dir())"#));
        // P1-E1(b): Granular write-only rights without SYNCHRONIZE
        assert_eq!(DENY_WRITE_PERM, "(WD,AD,WEA,WA,DE,DC,WDAC,WO)");
        // P1-E1(c): check_write_restricted_token_supported requests TOKEN_ADJUST_DEFAULT
        assert!(src.contains("TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ADJUST_DEFAULT"));
        // P1-E2(a): reject_symlinks_and_reparse_points called before stale & uninstall icacls removals
        assert!(src.contains("if reject_symlinks_and_reparse_points(path_ref).is_err()"));
        assert!(src.contains("if reject_symlinks_and_reparse_points(old_path_ref).is_err()"));
        // P1-E2(b): paired deny re-apply failure removes key from next_tracked and fails closed
        assert!(src.contains("next_tracked.remove(&paired_key);"));
        assert!(src.contains("Unguarded deny target(s) after stale ACL cleanup:"));
        // P1-E2(c): deadline expiry fails closed on existing deny targets outside allow_write
        assert!(src.contains("Deadline expired before guarding existing denyRead target"));
        assert!(src.contains("Deadline expired before guarding existing denyWrite target"));
    }
}
