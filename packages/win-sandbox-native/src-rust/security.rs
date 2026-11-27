use std::path::{Path, PathBuf};

pub const MAX_WINDOWS_CMDLINE_UTF16: usize = 32_767;
pub const DEFAULT_PROXY_PORT_START: u16 = 60_080;
pub const DEFAULT_PROXY_PORT_END: u16 = 60_089;
pub const DEFAULT_SANDBOX_USERNAME: &str = "claude_srt";
pub const DEFAULT_WFP_SUBLAYER_GUID: &str = "c8d1f2a4-5e7b-4a9c-8d12-3f6a9b0c1e2f";

pub const EXIT_OK: i32 = 0;
pub const EXIT_RUNTIME_ERROR: i32 = 1;
pub const EXIT_USAGE: i32 = 2;
pub const EXIT_VALIDATION: i32 = 3;
pub const EXIT_UAC_CANCELLED: i32 = 10;
pub const EXIT_WFP_ERROR: i32 = 19;

const BLOCKED_SYSTEM_SIDS: &[&str] = &["S-1-5-18", "S-1-5-19", "S-1-5-20"];

const RESERVED_WINDOWS_USERNAMES: &[&str] = &[
    "administrator",
    "guest",
    "system",
    "defaultaccount",
    "wdagutilityaccount",
    "krbtgt",
    "localsystem",
    "localservice",
    "networkservice",
    "trustedinstaller",
    "everyone",
    "anonymous",
];

const DOS_DEVICE_NAMES: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Validates a Windows domain/local user SID (`^S-1-5-21-\d+-\d+-\d+-\d+$`)
/// and explicitly rejects well-known system SIDs (`S-1-5-18`, `S-1-5-19`, `S-1-5-20`).
pub fn validate_windows_sid(sid: &str) -> Result<(), String> {
    if sid.is_empty() {
        return Err("Windows SID must not be empty".to_string());
    }
    for blocked in BLOCKED_SYSTEM_SIDS {
        if sid.eq_ignore_ascii_case(blocked) {
            return Err(format!(
                "Well-known system SID '{sid}' is not permitted for sandbox operations"
            ));
        }
    }
    let Some(rest) = sid.strip_prefix("S-1-5-21-") else {
        return Err(format!(
            "Invalid Windows SID '{sid}': expected format S-1-5-21-<d>-<d>-<d>-<rid>"
        ));
    };
    let parts: Vec<&str> = rest.split('-').collect();
    if parts.len() != 4 {
        return Err(format!(
            "Invalid Windows SID '{sid}': expected exactly 4 numeric sub-authorities after S-1-5-21"
        ));
    }
    for part in parts {
        if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return Err(format!(
                "Invalid Windows SID '{sid}': sub-authorities must be unsigned decimal integers"
            ));
        }
        if part.parse::<u32>().is_err() {
            return Err(format!(
                "Invalid Windows SID '{sid}': sub-authority '{part}' overflows u32"
            ));
        }
    }
    Ok(())
}

/// Validates a Windows local sandbox username (`^[A-Za-z0-9._-]{1,20}$`),
/// rejecting reserved Windows account names, Windows DOS device names (`CON`, `NUL`,
/// `COM1`-`COM9`, `LPT1`-`LPT9`, with or without `.ext`), and invalid leading/trailing punctuation.
pub fn validate_sandbox_username(username: &str) -> Result<(), String> {
    if username.is_empty() || username.len() > 20 {
        return Err(format!(
            "Invalid sandbox username '{username}': length must be between 1 and 20 characters"
        ));
    }
    if !username
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
    {
        return Err(format!(
            "Invalid sandbox username '{username}': allowed characters are A-Z, a-z, 0-9, '.', '_', '-'"
        ));
    }
    if username.starts_with('.') || username.ends_with('.') || username.starts_with('-') {
        return Err(format!(
            "Invalid sandbox username '{username}': cannot start with '.' or '-', or end with '.'"
        ));
    }
    let lower = username.to_ascii_lowercase();
    if RESERVED_WINDOWS_USERNAMES.contains(&lower.as_str()) {
        return Err(format!(
            "Reserved Windows username '{username}' is not permitted as a sandbox account"
        ));
    }
    let stem = lower.split('.').next().unwrap_or("");
    if DOS_DEVICE_NAMES.contains(&stem) {
        return Err(format!(
            "Windows DOS device name '{username}' is not permitted as a sandbox account"
        ));
    }
    Ok(())
}

/// Validates a canonical hyphenated GUID (`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`).
pub fn validate_guid(guid: &str) -> Result<(), String> {
    let bytes = guid.as_bytes();
    if bytes.len() != 36 {
        return Err(format!(
            "Invalid GUID '{guid}': expected 36 characters in 8-4-4-4-12 hex format"
        ));
    }
    for (idx, &b) in bytes.iter().enumerate() {
        let is_dash = matches!(idx, 8 | 13 | 18 | 23);
        if is_dash {
            if b != b'-' {
                return Err(format!("Invalid GUID '{guid}': expected '-' at index {idx}"));
            }
        } else if !b.is_ascii_hexdigit() {
            return Err(format!(
                "Invalid GUID '{guid}': non-hex character at index {idx}"
            ));
        }
    }
    Ok(())
}

/// Validates a proxy port range (`1024 <= start <= end <= 65535`).
pub fn validate_proxy_port_range(start: u16, end: u16) -> Result<(u16, u16), String> {
    if start < 1024 {
        return Err(format!(
            "Invalid proxy port range [{start}, {end}]: start port must be >= 1024"
        ));
    }
    if start > end {
        return Err(format!(
            "Invalid proxy port range [{start}, {end}]: start port must be <= end port"
        ));
    }
    Ok((start, end))
}

/// Validates a single non-privileged loopback proxy port (`1024 <= port <= 65535`).
pub fn validate_proxy_port(port: u16) -> Result<u16, String> {
    validate_proxy_port_range(port, port).map(|(p, _)| p)
}

/// Parses a proxy port range specification like `"60080-60089"` or `"60080:60089"` or `"60080,60089"`.
pub fn parse_proxy_port_range(spec: &str) -> Result<(u16, u16), String> {
    let trimmed = spec.trim();
    if trimmed.is_empty() {
        return Err("Proxy port range specification must not be empty".to_string());
    }
    let sep = if trimmed.contains('-') {
        Some('-')
    } else if trimmed.contains(':') {
        Some(':')
    } else if trimmed.contains(',') {
        Some(',')
    } else {
        None
    };

    if let Some(delim) = sep {
        let parts: Vec<&str> = trimmed.split(delim).collect();
        if parts.len() != 2 {
            return Err(format!(
                "Invalid proxy port range '{spec}': expected '<start>-<end>'"
            ));
        }
        let start = parts[0]
            .trim()
            .parse::<u16>()
            .map_err(|_| format!("Invalid proxy port start '{}' in '{spec}'", parts[0]))?;
        let end = parts[1]
            .trim()
            .parse::<u16>()
            .map_err(|_| format!("Invalid proxy port end '{}' in '{spec}'", parts[1]))?;
        validate_proxy_port_range(start, end)
    } else {
        let port = trimmed
            .parse::<u16>()
            .map_err(|_| format!("Invalid proxy port '{spec}'"))?;
        validate_proxy_port_range(port, port)
    }
}

/// Quotes a single argument according to Win32 `CommandLineToArgvW` / MSVCRT rules.
pub fn quote_windows_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.bytes().any(|b| matches!(b, b' ' | b'\t' | b'"')) {
        return arg.to_string();
    }

    let mut out = String::with_capacity(arg.len() + 2);
    out.push('"');
    let mut backslashes = 0usize;

    for ch in arg.chars() {
        if ch == '\\' {
            backslashes += 1;
        } else if ch == '"' {
            for _ in 0..(backslashes * 2 + 1) {
                out.push('\\');
            }
            out.push('"');
            backslashes = 0;
        } else {
            for _ in 0..backslashes {
                out.push('\\');
            }
            backslashes = 0;
            out.push(ch);
        }
    }

    for _ in 0..(backslashes * 2) {
        out.push('\\');
    }
    out.push('"');
    out
}

/// Rejects Windows batch script targets (`.bat` / `.cmd`, case-insensitive,
/// after trimming trailing dots and whitespace per Win32 path normalization) to
/// prevent BatBadBut implicit `cmd.exe` argument injection via `CreateProcessW`/`CreateProcessAsUserW`.
pub fn reject_batch_script_program(program: &str) -> Result<(), String> {
    let normalized = program.trim_end_matches(|c: char| c == '.' || c == ' ' || c == '\t');
    let lower = normalized.to_ascii_lowercase();
    if lower.ends_with(".bat") || lower.ends_with(".cmd") {
        return Err(format!(
            "Refusing to execute batch script '{program}' directly (.bat/.cmd targets are disallowed)"
        ));
    }
    Ok(())
}

/// Validates an HTTP(S) proxy URL (`http://` or `https://` scheme, non-empty host,
/// no NUL bytes, control characters, or whitespace).
pub fn validate_proxy_url(raw: &str) -> Result<String, String> {
    if raw.is_empty() || raw.len() > 2048 {
        return Err("Proxy URL must be between 1 and 2048 characters".to_string());
    }
    for ch in raw.chars() {
        if ch == '\0' || ch.is_ascii_control() || ch.is_whitespace() {
            return Err(
                "Proxy URL must not contain NUL, control characters, or whitespace".to_string(),
            );
        }
    }
    let rest = if let Some(r) = raw.strip_prefix("http://") {
        r
    } else if let Some(r) = raw.strip_prefix("https://") {
        r
    } else {
        return Err(format!(
            "Invalid proxy URL '{raw}': scheme must be http:// or https://"
        ));
    };

    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host_port = authority.rsplit_once('@').map_or(authority, |(_, hp)| hp);
    let host = if let Some(after_bracket) = host_port.strip_prefix('[') {
        let Some((ipv6_host, after_close)) = after_bracket.split_once(']') else {
            return Err(format!(
                "Invalid proxy URL '{raw}': unclosed IPv6 host bracket"
            ));
        };
        if let Some(port_part) = after_close.strip_prefix(':') {
            let port = port_part
                .parse::<u16>()
                .map_err(|_| format!("Invalid proxy URL '{raw}': invalid port '{port_part}'"))?;
            if port == 0 {
                return Err(format!("Invalid proxy URL '{raw}': port must be > 0"));
            }
        } else if !after_close.is_empty() {
            return Err(format!("Invalid proxy URL '{raw}': malformed authority"));
        }
        ipv6_host
    } else if let Some((h, port_part)) = host_port.rsplit_once(':') {
        let port = port_part
            .parse::<u16>()
            .map_err(|_| format!("Invalid proxy URL '{raw}': invalid port '{port_part}'"))?;
        if port == 0 {
            return Err(format!("Invalid proxy URL '{raw}': port must be > 0"));
        }
        h
    } else {
        host_port
    };

    if host.is_empty() {
        return Err(format!(
            "Invalid proxy URL '{raw}': host must not be empty"
        ));
    }
    Ok(raw.to_string())
}

/// Builds a Win32 command line from `program` and `args`, enforcing NUL safety
/// and the `CreateProcessW` 32,767 UTF-16 code-unit limit (including the terminating NUL).
pub fn build_windows_command_line(program: &str, args: &[String]) -> Result<String, String> {
    if program.is_empty() {
        return Err("Program path must not be empty".to_string());
    }
    if program.contains('\0') {
        return Err("Program path must not contain NUL bytes".to_string());
    }
    let mut cmdline = quote_windows_arg(program);
    for arg in args {
        if arg.contains('\0') {
            return Err("Command argument must not contain NUL bytes".to_string());
        }
        cmdline.push(' ');
        cmdline.push_str(&quote_windows_arg(arg));
    }

    let utf16_len = cmdline.encode_utf16().count();
    if utf16_len + 1 > MAX_WINDOWS_CMDLINE_UTF16 {
        return Err(format!(
            "Command line length ({utf16_len} UTF-16 code units + terminating NUL) exceeds Windows CreateProcessW limit of {MAX_WINDOWS_CMDLINE_UTF16}"
        ));
    }
    Ok(cmdline)
}

/// Sanitizes a filesystem path:
/// - Rejects NUL bytes and ASCII control characters (`0x00..=0x1F`, `0x7F`).
/// - Trims whitespace FIRST before prefix/character checks.
/// - Rejects empty paths, Win32 device/extended prefixes (`\\?\`, `\\.\`, `\??\`),
///   UNC prefixes (`\\`, `//`), leading `/` (could be parsed as an `icacls` switch),
///   wildcard characters (`*`, `?`), `..` path traversal segments, and ADS colons.
pub fn sanitize_path(raw: &str) -> Result<String, String> {
    for ch in raw.chars() {
        if ch == '\0' {
            return Err("Path must not contain NUL bytes".to_string());
        }
        if ch.is_ascii_control() {
            return Err(format!(
                "Path contains disallowed control character U+{:04X}",
                ch as u32
            ));
        }
    }

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Path must not be empty".to_string());
    }

    let normalized = trimmed.replace('/', "\\");
    if normalized.starts_with(r"\\?\")
        || normalized.starts_with(r"\\.\")
        || normalized.starts_with(r"\??\")
    {
        return Err(format!(
            "Path '{trimmed}' uses a disallowed Windows device/extended namespace prefix"
        ));
    }

    if trimmed.starts_with(r"\\") || trimmed.starts_with("//") || normalized.starts_with(r"\\") {
        return Err(format!(
            "Path '{trimmed}' uses a disallowed UNC network prefix"
        ));
    }

    if trimmed.starts_with('/') {
        return Err(format!(
            "Path '{trimmed}' must not start with '/' (disallowed icacls switch prefix)"
        ));
    }

    if trimmed.contains('*') || trimmed.contains('?') {
        return Err(format!(
            "Path '{trimmed}' contains disallowed wildcard character"
        ));
    }

    if normalized.split('\\').any(|seg| seg == "..") {
        return Err(format!(
            "Path '{trimmed}' contains disallowed '..' traversal segment"
        ));
    }

    // Reject Windows alternate data stream suffixes like `file.txt:stream` (allowing drive letter `C:\...`)
    let after_drive = if trimmed.len() >= 2
        && trimmed.as_bytes()[0].is_ascii_alphabetic()
        && trimmed.as_bytes()[1] == b':'
    {
        &trimmed[2..]
    } else {
        trimmed
    };
    if after_drive.contains(':') {
        return Err(format!(
            "Path '{trimmed}' contains disallowed colon outside drive prefix"
        ));
    }

    Ok(trimmed.to_string())
}

/// Canonicalizes an existing path on disk when possible, stripping the Windows `\\?\`
/// verbatim prefix returned by `std::fs::canonicalize` on Windows hosts.
pub fn canonicalize_path_best_effort(raw: &str) -> Result<PathBuf, String> {
    let sanitized = sanitize_path(raw)?;
    let path = Path::new(&sanitized);
    if path.exists() {
        match std::fs::canonicalize(path) {
            Ok(canon) => {
                let s = canon.to_string_lossy();
                if let Some(stripped) = s.strip_prefix(r"\\?\") {
                    Ok(PathBuf::from(stripped))
                } else {
                    Ok(canon)
                }
            }
            Err(_) => Ok(path.to_path_buf()),
        }
    } else {
        Ok(path.to_path_buf())
    }
}

/// Validates a host:port target string for WFP egress verification.
pub fn validate_probe_target(target: &str) -> Result<(), String> {
    if target.is_empty() || target.len() > 255 {
        return Err("Probe target must be between 1 and 255 characters".to_string());
    }
    if target.chars().any(|c| c.is_ascii_control() || c.is_whitespace()) {
        return Err("Probe target must not contain whitespace or control characters".to_string());
    }
    let Some((host, port_str)) = target.rsplit_once(':') else {
        return Err(format!(
            "Invalid probe target '{target}': expected '<host>:<port>'"
        ));
    };
    if host.is_empty() {
        return Err(format!("Invalid probe target '{target}': empty host"));
    }
    let port: u16 = port_str
        .parse()
        .map_err(|_| format!("Invalid probe target '{target}': invalid port '{port_str}'"))?;
    if port == 0 {
        return Err(format!("Invalid probe target '{target}': port must be > 0"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_domain_and_local_user_sids() {
        assert!(validate_windows_sid("S-1-5-21-3623811015-3361044348-30300820-1001").is_ok());
        assert!(validate_windows_sid("S-1-5-21-0-0-0-500").is_ok());
        assert!(validate_windows_sid("S-1-5-21-4294967295-1-2-1000").is_ok());
    }

    #[test]
    fn rejects_system_and_malformed_sids() {
        assert!(validate_windows_sid("S-1-5-18").is_err());
        assert!(validate_windows_sid("S-1-5-19").is_err());
        assert!(validate_windows_sid("S-1-5-20").is_err());
        assert!(validate_windows_sid("s-1-5-18").is_err());
        assert!(validate_windows_sid("").is_err());
        assert!(validate_windows_sid("S-1-5-21-1-2-3").is_err());
        assert!(validate_windows_sid("S-1-5-21-1-2-3-4-5").is_err());
        assert!(validate_windows_sid("S-1-5-21-1-2-abc-1001").is_err());
        assert!(validate_windows_sid("S-1-5-21-1-2-3-4294967296").is_err());
        assert!(validate_windows_sid("S-1-1-0").is_err());
    }

    #[test]
    fn validates_sandbox_usernames() {
        assert!(validate_sandbox_username("claude_srt").is_ok());
        assert!(validate_sandbox_username("srt-user.01").is_ok());
        assert!(validate_sandbox_username("a").is_ok());
        assert!(validate_sandbox_username("12345678901234567890").is_ok());
    }

    #[test]
    fn rejects_reserved_and_invalid_usernames() {
        assert!(validate_sandbox_username("").is_err());
        assert!(validate_sandbox_username("123456789012345678901").is_err());
        assert!(validate_sandbox_username("Administrator").is_err());
        assert!(validate_sandbox_username("guest").is_err());
        assert!(validate_sandbox_username("SYSTEM").is_err());
        assert!(validate_sandbox_username("LocalService").is_err());
        assert!(validate_sandbox_username("bad user").is_err());
        assert!(validate_sandbox_username("bad;user").is_err());
        assert!(validate_sandbox_username("-leadingdash").is_err());
        assert!(validate_sandbox_username("trailingdot.").is_err());
        // P1-12: leading dot & Windows DOS device names (with or without .ext)
        assert!(validate_sandbox_username(".foo").is_err());
        assert!(validate_sandbox_username("...").is_err());
        assert!(validate_sandbox_username("CON").is_err());
        assert!(validate_sandbox_username("prn").is_err());
        assert!(validate_sandbox_username("Aux").is_err());
        assert!(validate_sandbox_username("NUL").is_err());
        assert!(validate_sandbox_username("NUL.txt").is_err());
        assert!(validate_sandbox_username("COM1").is_err());
        assert!(validate_sandbox_username("com9.ext").is_err());
        assert!(validate_sandbox_username("LPT1").is_err());
        assert!(validate_sandbox_username("lpt9.log").is_err());
        assert!(validate_sandbox_username("console").is_ok());
    }

    #[test]
    fn validates_guids() {
        assert!(validate_guid(DEFAULT_WFP_SUBLAYER_GUID).is_ok());
        assert!(validate_guid("01234567-89AB-CDEF-0123-456789abcdef").is_ok());
        assert!(validate_guid("01234567-89ab-cdef-0123-456789abcde").is_err());
        assert!(validate_guid("01234567-89ab-cdef-0123-456789abcdef0").is_err());
        assert!(validate_guid("01234567_89ab-cdef-0123-456789abcdef").is_err());
        assert!(validate_guid("zzzzzzzz-89ab-cdef-0123-456789abcdef").is_err());
        assert!(validate_guid("{01234567-89ab-cdef-0123-456789abcdef}").is_err());
    }

    #[test]
    fn validates_proxy_port_ranges() {
        assert_eq!(validate_proxy_port_range(60080, 60089), Ok((60080, 60089)));
        assert_eq!(validate_proxy_port_range(1024, 65535), Ok((1024, 65535)));
        assert_eq!(parse_proxy_port_range("60080-60089"), Ok((60080, 60089)));
        assert_eq!(parse_proxy_port_range("60080"), Ok((60080, 60080)));
        assert!(validate_proxy_port_range(80, 1024).is_err());
        assert!(validate_proxy_port_range(1023, 60089).is_err());
        assert!(validate_proxy_port_range(60090, 60080).is_err());
        assert!(parse_proxy_port_range("60080-99999").is_err());
        assert!(parse_proxy_port_range("abc-def").is_err());
    }

    #[test]
    fn quotes_and_guards_windows_command_line() {
        assert_eq!(quote_windows_arg("simple"), "simple");
        assert_eq!(quote_windows_arg(""), "\"\"");
        assert_eq!(quote_windows_arg("hello world"), "\"hello world\"");
        assert_eq!(
            quote_windows_arg(r#"a\"b"#),
            r#""a\\\"b""#
        );
        assert_eq!(
            quote_windows_arg(r#"C:\Program Files\"#),
            r#""C:\Program Files\\""#
        );

        let ok_cmd = build_windows_command_line("cmd.exe", &["/c".to_string(), "echo hi".to_string()]);
        assert_eq!(ok_cmd.unwrap(), r#"cmd.exe /c "echo hi""#);

        // P1-1: 32,767 UTF-16 limit includes terminating NUL, so max content is 32,766
        let max_valid_arg = "a".repeat(MAX_WINDOWS_CMDLINE_UTF16 - 5); // "cmd " (4) + 32762 = 32766 (+ NUL = 32767)
        assert!(build_windows_command_line("cmd", &[max_valid_arg]).is_ok());

        let off_by_one_arg = "a".repeat(MAX_WINDOWS_CMDLINE_UTF16 - 4); // "cmd " (4) + 32763 = 32767 (+ NUL = 32768)
        assert!(build_windows_command_line("cmd", &[off_by_one_arg]).is_err());

        let too_long_arg = "a".repeat(MAX_WINDOWS_CMDLINE_UTF16);
        assert!(build_windows_command_line("cmd", &[too_long_arg]).is_err());

        assert!(build_windows_command_line("cmd\0.exe", &[]).is_err());
        assert!(build_windows_command_line("cmd", &["bad\0arg".to_string()]).is_err());
    }

    #[test]
    fn sanitizes_paths_against_bypass_vectors() {
        assert_eq!(
            sanitize_path(r"  C:\Users\alice\project  ").unwrap(),
            r"C:\Users\alice\project"
        );
        assert!(sanitize_path("C:/Users/alice/project/file..txt").is_ok());
        assert!(sanitize_path("relative\\sub\\file.txt").is_ok());
        assert!(sanitize_path("").is_err());
        assert!(sanitize_path("   ").is_err());
        assert!(sanitize_path("C:\\bad\0path").is_err());
        assert!(sanitize_path("C:\\bad\npath").is_err());
        assert!(sanitize_path("C:\\bad\x7fpath").is_err());
        assert!(sanitize_path(r"\\?\C:\Windows\System32").is_err());
        assert!(sanitize_path(r"\\.\PhysicalDrive0").is_err());
        // P0-6: leading whitespace before device prefix
        assert!(sanitize_path(r" \\.\PhysicalDrive0").is_err());
        assert!(sanitize_path(r"  \\?\C:\Windows").is_err());
        assert!(sanitize_path(r"\??\C:\Windows").is_err());
        assert!(sanitize_path("//?/C:/Windows").is_err());
        // P0-6: UNC paths, leading '/', wildcards, '..' traversal
        assert!(sanitize_path(r"\\evil\share\file").is_err());
        assert!(sanitize_path(" //evil/share/file").is_err());
        assert!(sanitize_path("/reset").is_err());
        assert!(sanitize_path(" /grant").is_err());
        assert!(sanitize_path("/tmp/project/file.txt").is_err());
        assert!(sanitize_path(r"C:\Users\alice\*.txt").is_err());
        assert!(sanitize_path(r"C:\Users\alice\a?.txt").is_err());
        assert!(sanitize_path(r"C:\Users\alice\..\bob").is_err());
        assert!(sanitize_path("C:/Users/alice/../bob").is_err());
        assert!(sanitize_path("..").is_err());
        assert!(sanitize_path(r"C:\Users\alice\secret.txt:ads").is_err());
    }

    #[test]
    fn validates_proxy_urls() {
        assert_eq!(
            validate_proxy_url("http://127.0.0.1:60080").unwrap(),
            "http://127.0.0.1:60080"
        );
        assert_eq!(
            validate_proxy_url("https://[::1]:60081").unwrap(),
            "https://[::1]:60081"
        );
        assert!(validate_proxy_url("http://localhost:8080/proxy").is_ok());
        assert!(validate_proxy_url("").is_err());
        assert!(validate_proxy_url("http://").is_err());
        assert!(validate_proxy_url("http://:8080").is_err());
        assert!(validate_proxy_url("http:///path").is_err());
        assert!(validate_proxy_url("socks5://127.0.0.1:1080").is_err());
        assert!(validate_proxy_url("http://127.0.0.1:8080\r\nInjected: 1").is_err());
        assert!(validate_proxy_url("http://127.0.0.1:8080 ").is_err());
        assert!(validate_proxy_url("http://127.0.0.1:0").is_err());
        assert!(validate_proxy_url("http://127.0.0.1:70000").is_err());
        assert!(validate_proxy_url("http://127.0.0.1\0:8080").is_err());
    }

    #[test]
    fn rejects_batch_script_programs_batbadbut() {
        assert!(reject_batch_script_program("cmd.exe").is_ok());
        assert!(reject_batch_script_program("powershell.exe").is_ok());
        assert!(reject_batch_script_program("/bin/sh").is_ok());
        assert!(reject_batch_script_program(r"C:\scripts\run.bat").is_err());
        assert!(reject_batch_script_program(r"C:\scripts\RUN.BAT").is_err());
        assert!(reject_batch_script_program(r"C:\scripts\run.cmd").is_err());
        assert!(reject_batch_script_program(r"C:\scripts\run.Cmd...  ").is_err());
        assert!(reject_batch_script_program("evil.bat . ").is_err());
    }
}
