use std::collections::BTreeMap;

/// Maximum JSON object/array nesting depth permitted by the parser (DoS protection).
pub const MAX_JSON_DEPTH: usize = 64;

/// Minimal RFC 8259 JSON value representation (zero external crates).
#[derive(Debug, Clone, PartialEq)]
pub enum JsonValue {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<JsonValue>),
    Object(BTreeMap<String, JsonValue>),
}

impl JsonValue {
    pub fn as_object(&self) -> Option<&BTreeMap<String, JsonValue>> {
        match self {
            JsonValue::Object(map) => Some(map),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[JsonValue]> {
        match self {
            JsonValue::Array(arr) => Some(arr),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            JsonValue::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            JsonValue::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_u64(&self) -> Option<u64> {
        match self {
            // Note: `u64::MAX as f64` rounds up to 2^64 (18446744073709551616.0), so
            // requiring `*n < (u64::MAX as f64)` prevents saturating casts on `>= 2^64`.
            JsonValue::Number(n)
                if n.is_finite()
                    && *n >= 0.0
                    && n.fract() == 0.0
                    && *n < (u64::MAX as f64) =>
            {
                Some(*n as u64)
            }
            _ => None,
        }
    }

    #[cfg_attr(windows, allow(dead_code))]
    pub fn as_u16(&self) -> Option<u16> {
        self.as_u64().and_then(|v| u16::try_from(v).ok())
    }
}

struct JsonParser<'a> {
    src: &'a str,
    bytes: &'a [u8],
    pos: usize,
    depth: usize,
}

impl<'a> JsonParser<'a> {
    fn new(input: &'a str) -> Self {
        Self {
            src: input,
            bytes: input.as_bytes(),
            pos: 0,
            depth: 0,
        }
    }

    fn skip_ws(&mut self) {
        while self.pos < self.bytes.len() {
            match self.bytes[self.pos] {
                b' ' | b'\t' | b'\r' | b'\n' => self.pos += 1,
                _ => break,
            }
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn parse_value(&mut self) -> Result<JsonValue, String> {
        self.skip_ws();
        let Some(b) = self.peek() else {
            return Err("Unexpected end of JSON input".to_string());
        };
        match b {
            b'{' => self.parse_object(),
            b'[' => self.parse_array(),
            b'"' => self.parse_string().map(JsonValue::String),
            b't' => self.parse_literal(b"true", JsonValue::Bool(true)),
            b'f' => self.parse_literal(b"false", JsonValue::Bool(false)),
            b'n' => self.parse_literal(b"null", JsonValue::Null),
            b'-' | b'0'..=b'9' => self.parse_number(),
            _ => Err(format!(
                "Unexpected byte 0x{:02x} at position {}",
                b, self.pos
            )),
        }
    }

    fn parse_literal(&mut self, expected: &[u8], value: JsonValue) -> Result<JsonValue, String> {
        if self.bytes[self.pos..].starts_with(expected) {
            self.pos += expected.len();
            Ok(value)
        } else {
            Err(format!("Invalid JSON literal at position {}", self.pos))
        }
    }

    fn parse_object(&mut self) -> Result<JsonValue, String> {
        if self.depth >= MAX_JSON_DEPTH {
            return Err(format!(
                "JSON nesting depth exceeds maximum of {MAX_JSON_DEPTH}"
            ));
        }
        self.depth += 1;
        let res = self.parse_object_inner();
        self.depth -= 1;
        res
    }

    fn parse_object_inner(&mut self) -> Result<JsonValue, String> {
        self.pos += 1; // '{'
        self.skip_ws();
        let mut map = BTreeMap::new();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(JsonValue::Object(map));
        }
        loop {
            self.skip_ws();
            if self.peek() != Some(b'"') {
                return Err(format!(
                    "Expected string key in JSON object at position {}",
                    self.pos
                ));
            }
            let key = self.parse_string()?;
            self.skip_ws();
            if self.peek() != Some(b':') {
                return Err(format!(
                    "Expected ':' after object key '{key}' at position {}",
                    self.pos
                ));
            }
            self.pos += 1;
            let value = self.parse_value()?;
            map.insert(key, value);
            self.skip_ws();
            match self.peek() {
                Some(b',') => {
                    self.pos += 1;
                }
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(JsonValue::Object(map));
                }
                _ => {
                    return Err(format!(
                        "Expected ',' or '}}' in JSON object at position {}",
                        self.pos
                    ));
                }
            }
        }
    }

    fn parse_array(&mut self) -> Result<JsonValue, String> {
        if self.depth >= MAX_JSON_DEPTH {
            return Err(format!(
                "JSON nesting depth exceeds maximum of {MAX_JSON_DEPTH}"
            ));
        }
        self.depth += 1;
        let res = self.parse_array_inner();
        self.depth -= 1;
        res
    }

    fn parse_array_inner(&mut self) -> Result<JsonValue, String> {
        self.pos += 1; // '['
        self.skip_ws();
        let mut items = Vec::new();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(JsonValue::Array(items));
        }
        loop {
            let item = self.parse_value()?;
            items.push(item);
            self.skip_ws();
            match self.peek() {
                Some(b',') => {
                    self.pos += 1;
                }
                Some(b']') => {
                    self.pos += 1;
                    return Ok(JsonValue::Array(items));
                }
                _ => {
                    return Err(format!(
                        "Expected ',' or ']' in JSON array at position {}",
                        self.pos
                    ));
                }
            }
        }
    }

    fn parse_hex4(&mut self) -> Result<u16, String> {
        if self.pos + 4 > self.bytes.len() {
            return Err("Incomplete \\uXXXX escape in JSON string".to_string());
        }
        let raw = &self.bytes[self.pos..self.pos + 4];
        if !raw.iter().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!("Invalid hex escape at position {}", self.pos));
        }
        let slice = &self.src[self.pos..self.pos + 4];
        let code = u16::from_str_radix(slice, 16)
            .map_err(|_| format!("Invalid hex escape '\\u{slice}'"))?;
        self.pos += 4;
        Ok(code)
    }

    fn parse_string(&mut self) -> Result<String, String> {
        self.pos += 1; // opening '"'
        let mut out = String::new();
        while self.pos < self.bytes.len() {
            let b = self.bytes[self.pos];
            if b == b'"' {
                self.pos += 1;
                return Ok(out);
            }
            if b < 0x20 {
                return Err(format!(
                    "Unescaped control character 0x{:02x} in JSON string",
                    b
                ));
            }
            if b == b'\\' {
                self.pos += 1;
                let Some(&esc) = self.bytes.get(self.pos) else {
                    return Err("Unexpected end of JSON string after '\\'".to_string());
                };
                self.pos += 1;
                match esc {
                    b'"' => out.push('"'),
                    b'\\' => out.push('\\'),
                    b'/' => out.push('/'),
                    b'b' => out.push('\u{0008}'),
                    b'f' => out.push('\u{000C}'),
                    b'n' => out.push('\n'),
                    b'r' => out.push('\r'),
                    b't' => out.push('\t'),
                    b'u' => {
                        let code = self.parse_hex4()?;
                        if (0xD800..=0xDBFF).contains(&code) {
                            if self.pos + 2 > self.bytes.len()
                                || self.bytes[self.pos] != b'\\'
                                || self.bytes[self.pos + 1] != b'u'
                            {
                                return Err("Lone high surrogate in JSON string".to_string());
                            }
                            self.pos += 2;
                            let low = self.parse_hex4()?;
                            if !(0xDC00..=0xDFFF).contains(&low) {
                                return Err("Invalid low surrogate in JSON string".to_string());
                            }
                            let combined =
                                0x10000 + (((code as u32 - 0xD800) << 10) | (low as u32 - 0xDC00));
                            let ch = char::from_u32(combined)
                                .ok_or_else(|| "Invalid Unicode scalar value".to_string())?;
                            out.push(ch);
                        } else if (0xDC00..=0xDFFF).contains(&code) {
                            return Err("Unexpected low surrogate in JSON string".to_string());
                        } else {
                            let ch = char::from_u32(code as u32)
                                .ok_or_else(|| "Invalid Unicode scalar value".to_string())?;
                            out.push(ch);
                        }
                    }
                    _ => {
                        return Err(format!("Invalid escape '\\{}' in JSON string", esc as char));
                    }
                }
            } else if b < 0x80 {
                // O(1) ASCII fast path
                out.push(b as char);
                self.pos += 1;
            } else {
                // O(1) UTF-8 scalar decode from already-validated &str without rescanning to EOF
                let ch = self.src[self.pos..]
                    .chars()
                    .next()
                    .ok_or_else(|| "Unexpected end of JSON string".to_string())?;
                out.push(ch);
                self.pos += ch.len_utf8();
            }
        }
        Err("Unterminated JSON string".to_string())
    }

    fn parse_number(&mut self) -> Result<JsonValue, String> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        match self.peek() {
            Some(b'0') => {
                self.pos += 1;
            }
            Some(b'1'..=b'9') => {
                while matches!(self.peek(), Some(b'0'..=b'9')) {
                    self.pos += 1;
                }
            }
            _ => return Err(format!("Invalid JSON number at position {start}")),
        }
        if self.peek() == Some(b'.') {
            self.pos += 1;
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(format!("Invalid JSON fraction at position {}", self.pos));
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.pos += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.pos += 1;
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(format!("Invalid JSON exponent at position {}", self.pos));
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }
        let raw = &self.src[start..self.pos];
        let n = raw
            .parse::<f64>()
            .map_err(|_| format!("Failed to parse JSON number '{raw}'"))?;
        if !n.is_finite() {
            return Err(format!("Non-finite JSON number '{raw}'"));
        }
        Ok(JsonValue::Number(n))
    }
}

pub fn parse_json(input: &str) -> Result<JsonValue, String> {
    let mut parser = JsonParser::new(input);
    let val = parser.parse_value()?;
    parser.skip_ws();
    if parser.pos != parser.bytes.len() {
        return Err(format!(
            "Trailing non-whitespace characters at position {}",
            parser.pos
        ));
    }
    Ok(val)
}

pub fn json_escape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000C}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

pub fn json_opt_string(opt: &Option<String>) -> String {
    match opt {
        Some(s) => json_escape_string(s),
        None => "null".to_string(),
    }
}

pub fn json_string_array(items: &[String]) -> String {
    let mut out = String::from("[");
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&json_escape_string(item));
    }
    out.push(']');
    out
}

// ============================================================================
// Wire structures matching official Claude Code 2.1.331 srt-win protocol
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserStatus {
    pub provisioned: bool,
    pub cred_present: bool,
    pub real_user_sid: Option<String>,
    pub sandbox_user: Option<String>,
    pub seclogon_state: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WfpStatus {
    pub state: String,
    pub allow_loopback: bool,
    pub sublayer_guid: Option<String>,
    pub proxy_port_range: Option<[u16; 2]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusResponse {
    pub user: UserStatus,
    pub wfp: WfpStatus,
}

impl StatusResponse {
    pub fn absent() -> Self {
        Self {
            user: UserStatus {
                provisioned: false,
                cred_present: false,
                real_user_sid: None,
                sandbox_user: None,
                seclogon_state: "unknown".to_string(),
            },
            wfp: WfpStatus {
                state: "absent".to_string(),
                allow_loopback: false,
                sublayer_guid: None,
                proxy_port_range: None,
            },
        }
    }

    pub fn to_json(&self) -> String {
        let port_range = match self.wfp.proxy_port_range {
            Some([start, end]) => format!("[{start},{end}]"),
            None => "null".to_string(),
        };
        format!(
            "{{\"user\":{{\"provisioned\":{},\"credPresent\":{},\"realUserSid\":{},\"sandboxUser\":{},\"seclogonState\":{}}},\"wfp\":{{\"state\":{},\"allowLoopback\":{},\"sublayerGuid\":{},\"proxyPortRange\":{}}}}}",
            self.user.provisioned,
            self.user.cred_present,
            json_opt_string(&self.user.real_user_sid),
            json_opt_string(&self.user.sandbox_user),
            json_escape_string(&self.user.seclogon_state),
            json_escape_string(&self.wfp.state),
            self.wfp.allow_loopback,
            json_opt_string(&self.wfp.sublayer_guid),
            port_range
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WfpVerifyResponse {
    pub egress_probe: String,
    pub target: String,
    pub write_restricted_token: bool,
}

impl WfpVerifyResponse {
    pub fn to_json(&self) -> String {
        format!(
            "{{\"egress_probe\":{},\"target\":{},\"write_restricted_token\":{}}}",
            json_escape_string(&self.egress_probe),
            json_escape_string(&self.target),
            self.write_restricted_token
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileForgetResponse {
    pub cleared: bool,
    pub deferred: bool,
}

impl ProfileForgetResponse {
    pub fn to_json(&self) -> String {
        format!(
            "{{\"cleared\":{},\"deferred\":{}}}",
            self.cleared, self.deferred
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeniesRequest {
    pub deny_read: Vec<String>,
    pub deny_write: Vec<String>,
    pub allow_write: Vec<String>,
    pub sid: Option<String>,
    pub deadline_ms: Option<u64>,
}

fn extract_string_array(
    map: &BTreeMap<String, JsonValue>,
    key: &str,
) -> Result<Vec<String>, String> {
    match map.get(key) {
        None | Some(JsonValue::Null) => Ok(Vec::new()),
        Some(v) => {
            let arr = v
                .as_array()
                .ok_or_else(|| format!("Field '{key}' must be an array of strings"))?;
            let mut out = Vec::with_capacity(arr.len());
            for (idx, item) in arr.iter().enumerate() {
                let s = item
                    .as_str()
                    .ok_or_else(|| format!("Field '{key}[{idx}]' must be a string"))?;
                out.push(s.to_string());
            }
            Ok(out)
        }
    }
}

impl DeniesRequest {
    pub fn from_json(input: &str) -> Result<Self, String> {
        let root = parse_json(input)?;
        let map = root
            .as_object()
            .ok_or_else(|| "DeniesRequest must be a JSON object".to_string())?;

        let deny_read = extract_string_array(map, "denyRead")?;
        let deny_write = extract_string_array(map, "denyWrite")?;
        let allow_write = extract_string_array(map, "allowWrite")?;

        let sid = match map.get("sid") {
            None | Some(JsonValue::Null) => None,
            Some(v) => Some(
                v.as_str()
                    .ok_or_else(|| "Field 'sid' must be a string".to_string())?
                    .to_string(),
            ),
        };

        let deadline_ms = match map.get("deadlineMs") {
            None | Some(JsonValue::Null) => None,
            Some(v) => Some(
                v.as_u64()
                    .ok_or_else(|| "Field 'deadlineMs' must be a non-negative integer".to_string())?,
            ),
        };

        Ok(Self {
            deny_read,
            deny_write,
            allow_write,
            sid,
            deadline_ms,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeniesResponse {
    pub in_place: u64,
    pub planted: u64,
    pub laid: u64,
    pub pushed_down: u64,
    pub guarded: u64,
    pub extras_skipped: u64,
    pub ms: u64,
    pub stands: u64,
    pub handed_back: u64,
}

impl DeniesResponse {
    pub fn to_json(&self) -> String {
        format!(
            "{{\"inPlace\":{},\"planted\":{},\"laid\":{},\"pushedDown\":{},\"guarded\":{},\"extrasSkipped\":{},\"ms\":{},\"stands\":{},\"handedBack\":{}}}",
            self.in_place,
            self.planted,
            self.laid,
            self.pushed_down,
            self.guarded,
            self.extras_skipped,
            self.ms,
            self.stands,
            self.handed_back
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MxcUiCapabilities {
    pub can_block_clipboard_read: bool,
    pub can_block_clipboard_write: bool,
    pub can_block_input_injection: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MxcProbes {
    pub base_container_supports_deny_paths: bool,
    pub base_container_supports_identityless_loopback_proxy: bool,
    pub base_container_supports_ingress_host_loopback_allow: bool,
    pub ui_capabilities: MxcUiCapabilities,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MxcProbeResponse {
    pub tier: String,
    pub needs_dacl_augmentation: bool,
    pub probes: MxcProbes,
    pub error: Option<String>,
}

impl MxcProbeResponse {
    pub fn to_json(&self) -> String {
        let err_part = match &self.error {
            Some(msg) => format!(",\"error\":{}", json_escape_string(msg)),
            None => String::new(),
        };
        format!(
            "{{\"tier\":{},\"needsDaclAugmentation\":{},\"probes\":{{\"baseContainerSupportsDenyPaths\":{},\"baseContainerSupportsIdentitylessLoopbackProxy\":{},\"baseContainerSupportsIngressHostLoopbackAllow\":{},\"uiCapabilities\":{{\"canBlockClipboardRead\":{},\"canBlockClipboardWrite\":{},\"canBlockInputInjection\":{}}}}}{}}}",
            json_escape_string(&self.tier),
            self.needs_dacl_augmentation,
            self.probes.base_container_supports_deny_paths,
            self.probes.base_container_supports_identityless_loopback_proxy,
            self.probes.base_container_supports_ingress_host_loopback_allow,
            self.probes.ui_capabilities.can_block_clipboard_read,
            self.probes.ui_capabilities.can_block_clipboard_write,
            self.probes.ui_capabilities.can_block_input_injection,
            err_part
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_string_escaping_and_round_trip() {
        let tricky = "C:\\Users\\alice\\quote\"tab\tnewline\nctrl\u{0001}unicode✓";
        let encoded = json_escape_string(tricky);
        let parsed = parse_json(&encoded).unwrap();
        assert_eq!(parsed.as_str(), Some(tricky));
    }

    #[test]
    fn parses_surrogate_pair_unicode() {
        let parsed = parse_json("\"\\uD83D\\uDE80\"").unwrap();
        assert_eq!(parsed.as_str(), Some("🚀"));
    }

    #[test]
    fn serializes_status_response_exact_keys() {
        let resp = StatusResponse {
            user: UserStatus {
                provisioned: true,
                cred_present: true,
                real_user_sid: Some("S-1-5-21-1-2-3-1001".to_string()),
                sandbox_user: Some("claude_srt".to_string()),
                seclogon_state: "running".to_string(),
            },
            wfp: WfpStatus {
                state: "installed".to_string(),
                allow_loopback: true,
                sublayer_guid: Some("c8d1f2a4-5e7b-4a9c-8d12-3f6a9b0c1e2f".to_string()),
                proxy_port_range: Some([60080, 60089]),
            },
        };
        let json = resp.to_json();
        let parsed = parse_json(&json).unwrap();
        let root = parsed.as_object().unwrap();
        let user = root.get("user").unwrap().as_object().unwrap();
        assert_eq!(user.get("provisioned").unwrap().as_bool(), Some(true));
        assert_eq!(user.get("credPresent").unwrap().as_bool(), Some(true));
        assert_eq!(
            user.get("realUserSid").unwrap().as_str(),
            Some("S-1-5-21-1-2-3-1001")
        );
        assert_eq!(user.get("sandboxUser").unwrap().as_str(), Some("claude_srt"));
        assert_eq!(user.get("seclogonState").unwrap().as_str(), Some("running"));

        let wfp = root.get("wfp").unwrap().as_object().unwrap();
        assert_eq!(wfp.get("state").unwrap().as_str(), Some("installed"));
        assert_eq!(wfp.get("allowLoopback").unwrap().as_bool(), Some(true));
        assert_eq!(
            wfp.get("sublayerGuid").unwrap().as_str(),
            Some("c8d1f2a4-5e7b-4a9c-8d12-3f6a9b0c1e2f")
        );
        let range = wfp.get("proxyPortRange").unwrap().as_array().unwrap();
        assert_eq!(range[0].as_u64(), Some(60080));
        assert_eq!(range[1].as_u64(), Some(60089));
    }

    #[test]
    fn parses_denies_request_and_serializes_response() {
        let input = r#"{
            "denyRead": ["C:\\Users\\alice\\.ssh", "C:\\Users\\alice\\.aws"],
            "denyWrite": ["C:\\Windows\\System32"],
            "allowWrite": ["C:\\Users\\alice\\project"],
            "sid": "S-1-5-21-111-222-333-1001",
            "deadlineMs": 5000
        }"#;
        let req = DeniesRequest::from_json(input).unwrap();
        assert_eq!(req.deny_read.len(), 2);
        assert_eq!(req.deny_write, vec![r"C:\Windows\System32"]);
        assert_eq!(req.allow_write, vec![r"C:\Users\alice\project"]);
        assert_eq!(req.sid.as_deref(), Some("S-1-5-21-111-222-333-1001"));
        assert_eq!(req.deadline_ms, Some(5000));

        let resp = DeniesResponse {
            in_place: 1,
            planted: 2,
            laid: 1,
            pushed_down: 0,
            guarded: 1,
            extras_skipped: 0,
            ms: 12,
            stands: 1,
            handed_back: 0,
        };
        let parsed = parse_json(&resp.to_json()).unwrap();
        let obj = parsed.as_object().unwrap();
        assert_eq!(obj.get("inPlace").unwrap().as_u64(), Some(1));
        assert_eq!(obj.get("planted").unwrap().as_u64(), Some(2));
        assert_eq!(obj.get("laid").unwrap().as_u64(), Some(1));
        assert_eq!(obj.get("pushedDown").unwrap().as_u64(), Some(0));
        assert_eq!(obj.get("guarded").unwrap().as_u64(), Some(1));
        assert_eq!(obj.get("extrasSkipped").unwrap().as_u64(), Some(0));
        assert_eq!(obj.get("ms").unwrap().as_u64(), Some(12));
        assert_eq!(obj.get("stands").unwrap().as_u64(), Some(1));
        assert_eq!(obj.get("handedBack").unwrap().as_u64(), Some(0));
    }

    #[test]
    fn serializes_mxc_probe_response_with_and_without_error() {
        let with_err = MxcProbeResponse {
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
        };
        let parsed = parse_json(&with_err.to_json()).unwrap();
        let obj = parsed.as_object().unwrap();
        assert_eq!(obj.get("tier").unwrap().as_str(), Some("none"));
        assert_eq!(
            obj.get("error").unwrap().as_str(),
            Some("Windows native sandbox requires native Windows")
        );

        let without_err = MxcProbeResponse {
            error: None,
            ..with_err
        };
        let parsed2 = parse_json(&without_err.to_json()).unwrap();
        assert!(!parsed2.as_object().unwrap().contains_key("error"));
    }

    #[test]
    fn rejects_invalid_json_inputs() {
        assert!(parse_json("").is_err());
        assert!(parse_json("{invalid}").is_err());
        assert!(parse_json("{\"a\": 1} trailing").is_err());
        assert!(DeniesRequest::from_json("[]").is_err());
        assert!(DeniesRequest::from_json("{\"denyRead\": \"not-an-array\"}").is_err());
        assert!(parse_json("\"\\u🚀\"").is_err());
    }

    #[test]
    fn enforces_max_json_nesting_depth() {
        let ok_arr = format!("{}{}", "[".repeat(MAX_JSON_DEPTH), "]".repeat(MAX_JSON_DEPTH));
        assert!(parse_json(&ok_arr).is_ok());

        let too_deep_arr = format!(
            "{}{}",
            "[".repeat(MAX_JSON_DEPTH + 1),
            "]".repeat(MAX_JSON_DEPTH + 1)
        );
        let err = parse_json(&too_deep_arr).unwrap_err();
        assert!(err.contains("depth"));

        let mut too_deep_obj = String::new();
        for _ in 0..=MAX_JSON_DEPTH {
            too_deep_obj.push_str("{\"a\":");
        }
        too_deep_obj.push_str("1");
        for _ in 0..=MAX_JSON_DEPTH {
            too_deep_obj.push('}');
        }
        assert!(parse_json(&too_deep_obj).is_err());
    }

    #[test]
    fn guards_numeric_conversions_against_saturation_and_truncation() {
        assert_eq!(parse_json("0").unwrap().as_u64(), Some(0));
        assert_eq!(parse_json("65535").unwrap().as_u16(), Some(65535));
        assert_eq!(parse_json("65536").unwrap().as_u16(), None);
        assert_eq!(parse_json("131072").unwrap().as_u16(), None);
        assert_eq!(parse_json("-1").unwrap().as_u64(), None);
        assert_eq!(parse_json("1.5").unwrap().as_u64(), None);
        assert_eq!(parse_json("1e30").unwrap().as_u64(), None);
        assert_eq!(parse_json("18446744073709551616").unwrap().as_u64(), None);
        assert_eq!(JsonValue::Number(f64::NAN).as_u64(), None);
        assert_eq!(JsonValue::Number(f64::INFINITY).as_u64(), None);
        assert_eq!(JsonValue::Number(f64::NEG_INFINITY).as_u64(), None);
        assert!(DeniesRequest::from_json("{\"deadlineMs\": 1e30}").is_err());
    }
}
