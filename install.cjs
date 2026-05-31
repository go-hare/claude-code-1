#!/usr/bin/env node
// Postinstall for the claude wrapper package.
//
// In development (monorepo with .git), delegates to the dev postinstall scripts.
// In production (npm install from registry), copies the native binary from the
// platform-specific optionalDependency into bin/claude.exe.
//
// Platform detection + PLATFORMS map is duplicated in cli-wrapper.cjs — keep in sync.

const { spawnSync } = require("child_process");
const {
  copyFileSync,
  existsSync,
  linkSync,
  unlinkSync,
  chmodSync,
  readFileSync,
  writeFileSync,
  statSync,
} = require("fs");
const { arch } = require("os");
const path = require("path");

// Dev environment detection: if .git exists at package root, we're in the monorepo
if (existsSync(path.join(__dirname, ".git"))) {
  const r = spawnSync(
    "node",
    [
      "scripts/run-parallel.mjs",
      "scripts/postinstall.cjs",
      "scripts/setup-chrome-mcp.mjs",
    ],
    { cwd: __dirname, stdio: "inherit" },
  );
  process.exit(r.status ?? 0);
}

const PACKAGE_PREFIX = "@go-hare/claude-code";
const BINARY_NAME = "claude";
const WRAPPER_NAME = require("./package.json").name;

const PLATFORMS = {
  "darwin-arm64": { pkg: PACKAGE_PREFIX + "-darwin-arm64", bin: BINARY_NAME },
  "darwin-x64": { pkg: PACKAGE_PREFIX + "-darwin-x64", bin: BINARY_NAME },
  "linux-x64": { pkg: PACKAGE_PREFIX + "-linux-x64", bin: BINARY_NAME },
  "linux-arm64": { pkg: PACKAGE_PREFIX + "-linux-arm64", bin: BINARY_NAME },
  "linux-x64-musl": {
    pkg: PACKAGE_PREFIX + "-linux-x64-musl",
    bin: BINARY_NAME,
  },
  "linux-arm64-musl": {
    pkg: PACKAGE_PREFIX + "-linux-arm64-musl",
    bin: BINARY_NAME,
  },
  "linux-arm64-android": {
    pkg: PACKAGE_PREFIX + "-linux-arm64-android",
    bin: BINARY_NAME,
  },
  "linux-x64-android": {
    pkg: PACKAGE_PREFIX + "-linux-x64-android",
    bin: BINARY_NAME,
  },
  "freebsd-x64": { pkg: PACKAGE_PREFIX + "-freebsd-x64", bin: BINARY_NAME },
  "freebsd-arm64": {
    pkg: PACKAGE_PREFIX + "-freebsd-arm64",
    bin: BINARY_NAME,
  },
  "win32-x64": {
    pkg: PACKAGE_PREFIX + "-win32-x64",
    bin: BINARY_NAME + ".exe",
  },
  "win32-arm64": {
    pkg: PACKAGE_PREFIX + "-win32-arm64",
    bin: BINARY_NAME + ".exe",
  },
};

function detectMusl() {
  if (process.platform !== "linux") return false;
  const report =
    typeof process.report?.getReport === "function"
      ? process.report.getReport()
      : null;
  return report != null && report.header?.glibcVersionRuntime === undefined;
}

function getPlatformKey() {
  const platform = process.platform;
  let cpu = arch();
  if (platform === "android") return "linux-" + cpu + "-android";
  if (platform === "linux") return "linux-" + cpu + (detectMusl() ? "-musl" : "");
  if (platform === "darwin" && cpu === "x64") {
    const r = spawnSync("sysctl", ["-n", "sysctl.proc_translated"], {
      encoding: "utf8",
    });
    if (r.stdout?.trim() === "1") cpu = "arm64";
  }
  return platform + "-" + cpu;
}

function placeBinary(src, dest) {
  try {
    linkSync(src, dest);
  } catch (err) {
    if (err.code === "EEXIST") {
      const stub = statSync(dest).size < 4096 ? readFileSync(dest) : null;
      unlinkSync(dest);
      try {
        linkSync(src, dest);
      } catch {
        try {
          copyFileSync(src, dest);
        } catch (copyErr) {
          if (stub) {
            try { writeFileSync(dest, stub, { mode: 0o755 }); } catch {}
          }
          throw copyErr;
        }
      }
    } else if (err.code === "EXDEV" || err.code === "EPERM") {
      copyFileSync(src, dest);
    } else {
      throw err;
    }
  }
  if (process.platform !== "win32") chmodSync(dest, 0o755);
}
function main() {
  const platformKey = getPlatformKey();
  const info = PLATFORMS[platformKey];

  if (!info) {
    console.error(
      `[${WRAPPER_NAME} postinstall] Unsupported platform: ${process.platform} ${arch()}`,
    );
    console.error(`  Supported: ${Object.keys(PLATFORMS).join(", ")}`);
    return;
  }

  const optionalDeps = require("./package.json").optionalDependencies || {};
  if (!optionalDeps[info.pkg]) {
    console.error(
      `[${WRAPPER_NAME} postinstall] Native binaries for ${platformKey} are not available on this release channel.`,
    );
    console.error(
      `  Available: ${Object.keys(optionalDeps).map((p) => p.replace(PACKAGE_PREFIX + "-", "")).join(", ")}`,
    );
    return;
  }

  let src;
  try {
    const pkgDir = path.dirname(require.resolve(info.pkg + "/package.json"));
    src = path.join(pkgDir, info.bin);
  } catch {
    console.error(
      `[${WRAPPER_NAME} postinstall] Native package "${info.pkg}" not found.`,
    );
    console.error(
      "  This happens with --omit=optional or when the download failed.",
    );
    console.error(
      "  The `claude` command will print instructions when invoked.",
    );
    console.error(
      "  Fallback: node " + path.join(__dirname, "cli-wrapper.cjs"),
    );
    return;
  }

  const dest = path.join(__dirname, "bin", "claude.exe");

  try {
    placeBinary(src, dest);
  } catch (err) {
    console.error(
      `[${WRAPPER_NAME} postinstall] Failed to place binary: ${err.message}`,
    );
    console.error(
      "  Fallback: node " + path.join(__dirname, "cli-wrapper.cjs"),
    );
    process.exitCode = 1;
  }
}

main();

