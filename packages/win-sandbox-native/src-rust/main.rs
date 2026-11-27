mod protocol;
mod security;
mod win32_backend;

use std::io::Read;
use std::process::ExitCode;

use protocol::DeniesRequest;
use security::{
    parse_proxy_port_range, EXIT_OK, EXIT_RUNTIME_ERROR, EXIT_USAGE, EXIT_VALIDATION,
};
use win32_backend::{
    cmd_denies, cmd_install, cmd_probe_mxc, cmd_profile_forget, cmd_run, cmd_status, cmd_uninstall,
    cmd_wfp_verify, BackendError, InstallOptions, ProfileForgetOptions, RunOptions,
    UninstallOptions, WfpVerifyOptions,
};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_DENIES_STDIN_BYTES: u64 = 4 * 1024 * 1024; // 4 MiB

fn print_usage() {
    eprintln!(
        "srt-win {VERSION} — Native Win32 Sandbox Helper\n\
         \n\
         USAGE:\n\
           srt-win --version\n\
           srt-win status [--json]\n\
           srt-win install [--user <name>] [--sid <sid>] [--sublayer-guid <guid>] [--proxy-port-range <start>-<end>] [--allow-loopback|--no-allow-loopback]\n\
           srt-win uninstall [--user <name>] [--sublayer-guid <guid>]\n\
           srt-win wfp verify [--target <host:port>]\n\
           srt-win profile forget [--sid <sid>]\n\
           srt-win denies [--sid <sid>] [--deadline-ms <ms>]\n\
           srt-win probe-mxc\n\
           srt-win run [--cwd <dir>] [--proxy-port <port>] [--http-proxy <url>] [--https-proxy <url>] [--allow-loopback] [--block-clipboard-read] [--block-clipboard-write] [--block-input-injection] -- <program> [args...]"
    );
}

fn require_flag_value(args: &[String], idx: &mut usize, flag: &str) -> Result<String, BackendError> {
    *idx += 1;
    args.get(*idx)
        .cloned()
        .ok_or_else(|| BackendError {
            exit_code: EXIT_USAGE,
            message: format!("Missing value for flag '{flag}'"),
        })
}

fn handle_status(args: &[String]) -> Result<i32, BackendError> {
    for arg in args {
        if arg != "--json" {
            return Err(BackendError {
                exit_code: EXIT_USAGE,
                message: format!("Unknown flag '{arg}' for 'status'"),
            });
        }
    }
    let resp = cmd_status()?;
    println!("{}", resp.to_json());
    Ok(EXIT_OK)
}

fn handle_install(args: &[String]) -> Result<i32, BackendError> {
    let mut opts = InstallOptions::default();
    let mut i = 0;
    while i < args.len() {
        let flag = args[i].as_str();
        match flag {
            "--user" | "--sandbox-user" => {
                opts.sandbox_user = require_flag_value(args, &mut i, flag)?;
            }
            "--sid" | "--real-user-sid" => {
                opts.real_user_sid = Some(require_flag_value(args, &mut i, flag)?);
            }
            "--sublayer-guid" => {
                opts.sublayer_guid = require_flag_value(args, &mut i, "--sublayer-guid")?;
            }
            "--proxy-port-range" => {
                let raw = require_flag_value(args, &mut i, "--proxy-port-range")?;
                let (start, end) = parse_proxy_port_range(&raw).map_err(BackendError::validation)?;
                opts.proxy_port_range = [start, end];
            }
            "--allow-loopback" => {
                opts.allow_loopback = true;
            }
            "--no-allow-loopback" => {
                opts.allow_loopback = false;
            }
            "--json" => {}
            other => {
                return Err(BackendError {
                    exit_code: EXIT_USAGE,
                    message: format!("Unknown flag '{other}' for 'install'"),
                });
            }
        }
        i += 1;
    }

    let resp = cmd_install(&opts)?;
    println!("{}", resp.to_json());
    Ok(EXIT_OK)
}

fn handle_uninstall(args: &[String]) -> Result<i32, BackendError> {
    let mut opts = UninstallOptions::default();
    let mut i = 0;
    while i < args.len() {
        let flag = args[i].as_str();
        match flag {
            "--user" | "--sandbox-user" => {
                opts.sandbox_user = require_flag_value(args, &mut i, flag)?;
            }
            "--sublayer-guid" => {
                opts.sublayer_guid = require_flag_value(args, &mut i, "--sublayer-guid")?;
            }
            "--json" => {}
            other => {
                return Err(BackendError {
                    exit_code: EXIT_USAGE,
                    message: format!("Unknown flag '{other}' for 'uninstall'"),
                });
            }
        }
        i += 1;
    }

    let resp = cmd_uninstall(&opts)?;
    println!("{}", resp.to_json());
    Ok(EXIT_OK)
}

fn handle_wfp(args: &[String]) -> Result<i32, BackendError> {
    let Some((sub, rest)) = args.split_first() else {
        return Err(BackendError {
            exit_code: EXIT_USAGE,
            message: "Expected subcommand after 'wfp' (e.g. 'wfp verify')".to_string(),
        });
    };
    if sub != "verify" {
        return Err(BackendError {
            exit_code: EXIT_USAGE,
            message: format!("Unknown 'wfp' subcommand '{sub}'; expected 'verify'"),
        });
    }

    let mut opts = WfpVerifyOptions::default();
    let mut i = 0;
    while i < rest.len() {
        match rest[i].as_str() {
            "--target" => {
                opts.target = require_flag_value(rest, &mut i, "--target")?;
            }
            "--json" => {}
            other => {
                return Err(BackendError {
                    exit_code: EXIT_USAGE,
                    message: format!("Unknown flag '{other}' for 'wfp verify'"),
                });
            }
        }
        i += 1;
    }

    let resp = cmd_wfp_verify(&opts)?;
    println!("{}", resp.to_json());
    Ok(EXIT_OK)
}

fn handle_profile(args: &[String]) -> Result<i32, BackendError> {
    let Some((sub, rest)) = args.split_first() else {
        return Err(BackendError {
            exit_code: EXIT_USAGE,
            message: "Expected subcommand after 'profile' (e.g. 'profile forget')".to_string(),
        });
    };
    if sub != "forget" {
        return Err(BackendError {
            exit_code: EXIT_USAGE,
            message: format!("Unknown 'profile' subcommand '{sub}'; expected 'forget'"),
        });
    }

    let mut opts = ProfileForgetOptions::default();
    let mut i = 0;
    while i < rest.len() {
        match rest[i].as_str() {
            "--sid" => {
                opts.sid = Some(require_flag_value(rest, &mut i, "--sid")?);
            }
            "--json" => {}
            other => {
                return Err(BackendError {
                    exit_code: EXIT_USAGE,
                    message: format!("Unknown flag '{other}' for 'profile forget'"),
                });
            }
        }
        i += 1;
    }

    let resp = cmd_profile_forget(&opts)?;
    println!("{}", resp.to_json());
    Ok(EXIT_OK)
}

fn handle_denies(args: &[String]) -> Result<i32, BackendError> {
    let mut flag_sid: Option<String> = None;
    let mut flag_deadline_ms: Option<u64> = None;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--sid" => {
                flag_sid = Some(require_flag_value(args, &mut i, "--sid")?);
            }
            "--deadline-ms" => {
                let raw = require_flag_value(args, &mut i, "--deadline-ms")?;
                let parsed = raw.parse::<u64>().map_err(|_| {
                    BackendError::validation(format!("Invalid --deadline-ms value '{raw}'"))
                })?;
                flag_deadline_ms = Some(parsed);
            }
            "--json" => {}
            other => {
                return Err(BackendError {
                    exit_code: EXIT_USAGE,
                    message: format!("Unknown flag '{other}' for 'denies'"),
                });
            }
        }
        i += 1;
    }

    let mut raw_bytes = Vec::new();
    std::io::stdin()
        .take(MAX_DENIES_STDIN_BYTES + 1)
        .read_to_end(&mut raw_bytes)
        .map_err(|e| BackendError::runtime(format!("Failed to read denies JSON from stdin: {e}")))?;
    if (raw_bytes.len() as u64) > MAX_DENIES_STDIN_BYTES {
        return Err(BackendError::validation(format!(
            "Denies JSON input exceeds maximum allowed size of {MAX_DENIES_STDIN_BYTES} bytes"
        )));
    }
    let stdin_buf = String::from_utf8(raw_bytes)
        .map_err(|_| BackendError::validation("Denies JSON stdin must be valid UTF-8"))?;

    let trimmed = stdin_buf.trim();
    if trimmed.is_empty() {
        return Err(BackendError {
            exit_code: EXIT_VALIDATION,
            message: "Expected DeniesRequest JSON on stdin".to_string(),
        });
    }

    let mut req = DeniesRequest::from_json(trimmed).map_err(BackendError::validation)?;
    if flag_sid.is_some() {
        req.sid = flag_sid;
    }
    if flag_deadline_ms.is_some() {
        req.deadline_ms = flag_deadline_ms;
    }

    let resp = cmd_denies(&req)?;
    println!("{}", resp.to_json());
    Ok(EXIT_OK)
}

fn handle_probe_mxc(args: &[String]) -> Result<i32, BackendError> {
    for arg in args {
        if arg != "--json" {
            return Err(BackendError {
                exit_code: EXIT_USAGE,
                message: format!("Unknown flag '{arg}' for 'probe-mxc'"),
            });
        }
    }
    let resp = cmd_probe_mxc()?;
    println!("{}", resp.to_json());
    Ok(EXIT_OK)
}

fn handle_run(args: &[String]) -> Result<i32, BackendError> {
    let mut cwd: Option<String> = None;
    let mut proxy_port: Option<u16> = None;
    let mut http_proxy: Option<String> = None;
    let mut https_proxy: Option<String> = None;
    let mut allow_loopback = true;
    let mut block_clipboard_read = true;
    let mut block_clipboard_write = true;
    let mut block_input_injection = true;

    let mut i = 0;
    let mut cmd_start: Option<usize> = None;

    while i < args.len() {
        match args[i].as_str() {
            "--" => {
                cmd_start = Some(i + 1);
                break;
            }
            "--cwd" => {
                cwd = Some(require_flag_value(args, &mut i, "--cwd")?);
            }
            "--proxy-port" => {
                let raw = require_flag_value(args, &mut i, "--proxy-port")?;
                let port = raw.parse::<u16>().map_err(|_| {
                    BackendError::validation(format!("Invalid --proxy-port value '{raw}'"))
                })?;
                proxy_port = Some(port);
            }
            "--http-proxy" => {
                http_proxy = Some(require_flag_value(args, &mut i, "--http-proxy")?);
            }
            "--https-proxy" => {
                https_proxy = Some(require_flag_value(args, &mut i, "--https-proxy")?);
            }
            "--allow-loopback" => {
                allow_loopback = true;
            }
            "--no-allow-loopback" => {
                allow_loopback = false;
            }
            "--block-clipboard-read" => {
                block_clipboard_read = true;
            }
            "--allow-clipboard-read" => {
                block_clipboard_read = false;
            }
            "--block-clipboard-write" => {
                block_clipboard_write = true;
            }
            "--allow-clipboard-write" => {
                block_clipboard_write = false;
            }
            "--block-input-injection" => {
                block_input_injection = true;
            }
            "--allow-input-injection" => {
                block_input_injection = false;
            }
            other if other.starts_with('-') => {
                return Err(BackendError {
                    exit_code: EXIT_USAGE,
                    message: format!("Unknown flag '{other}' for 'run'"),
                });
            }
            _ => {
                cmd_start = Some(i);
                break;
            }
        }
        i += 1;
    }

    let start = cmd_start.ok_or_else(|| BackendError {
        exit_code: EXIT_USAGE,
        message: "Missing command to execute for 'run'".to_string(),
    })?;
    let cmd_slice = &args[start..];
    let Some((program, program_args)) = cmd_slice.split_first() else {
        return Err(BackendError {
            exit_code: EXIT_USAGE,
            message: "Missing command after '--' for 'run'".to_string(),
        });
    };

    let opts = RunOptions {
        program: program.clone(),
        args: program_args.to_vec(),
        cwd,
        proxy_port,
        http_proxy,
        https_proxy,
        allow_loopback,
        block_clipboard_read,
        block_clipboard_write,
        block_input_injection,
    };

    cmd_run(&opts)
}

fn dispatch(args: &[String]) -> Result<i32, BackendError> {
    let Some((cmd, rest)) = args.split_first() else {
        print_usage();
        return Err(BackendError {
            exit_code: EXIT_USAGE,
            message: "No subcommand provided".to_string(),
        });
    };

    match cmd.as_str() {
        "--version" | "-V" | "version" => {
            println!("srt-win {VERSION}");
            Ok(EXIT_OK)
        }
        "--help" | "-h" | "help" => {
            print_usage();
            Ok(EXIT_OK)
        }
        "status" => handle_status(rest),
        "install" => handle_install(rest),
        "uninstall" => handle_uninstall(rest),
        "wfp" => handle_wfp(rest),
        "profile" => handle_profile(rest),
        "denies" => handle_denies(rest),
        "probe-mxc" => handle_probe_mxc(rest),
        "run" => handle_run(rest),
        other => {
            print_usage();
            Err(BackendError {
                exit_code: EXIT_USAGE,
                message: format!("Unknown subcommand '{other}'"),
            })
        }
    }
}

/// Maps an `i32` process exit code to a POSIX/Windows `u8` `ExitCode` without
/// ever clamping non-zero/negative NTSTATUS crash codes (e.g. `0xC0000005` = `-1073741819`) to `0`.
fn normalize_exit_code(code: i32) -> u8 {
    if code == 0 {
        0
    } else if (1..=255).contains(&code) {
        code as u8
    } else {
        1
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match dispatch(&args) {
        Ok(code) => ExitCode::from(normalize_exit_code(code)),
        Err(err) => {
            eprintln!("srt-win: {}", err.message);
            let code = if err.exit_code == 0 {
                EXIT_RUNTIME_ERROR
            } else {
                err.exit_code
            };
            ExitCode::from(normalize_exit_code(code))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_exit_codes_without_clamping_ntstatus_to_zero() {
        assert_eq!(normalize_exit_code(0), 0);
        assert_eq!(normalize_exit_code(1), 1);
        assert_eq!(normalize_exit_code(10), 10);
        assert_eq!(normalize_exit_code(19), 19);
        assert_eq!(normalize_exit_code(255), 255);
        // P1-7: Windows ACCESS_VIOLATION 0xC0000005 as i32 (-1073741819) must map to 1, never 0
        assert_eq!(normalize_exit_code(0xC000_0005u32 as i32), 1);
        assert_eq!(normalize_exit_code(-1), 1);
        assert_eq!(normalize_exit_code(256), 1);
        assert_eq!(normalize_exit_code(i32::MIN), 1);
        assert_eq!(normalize_exit_code(i32::MAX), 1);
    }
}
