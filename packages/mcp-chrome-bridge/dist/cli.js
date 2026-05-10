#!/usr/bin/env node
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// package.json
var require_package = __commonJS((exports2, module2) => {
  module2.exports = {
    name: "@go-hare/mcp-chrome-bridge",
    version: "3.0.2",
    description: "Chrome Native-Messaging host (Node) — MCP + message bridge",
    main: "dist/index.js",
    bin: {
      "mcp-chrome-bridge": "./dist/cli.js",
      "mcp-chrome-stdio": "./dist/mcp/mcp-server-stdio.js"
    },
    scripts: {
      dev: 'nodemon --watch src --ext ts,js,json --ignore dist/ --exec "npm run build && npm run register:dev"',
      build: "bun run  src/scripts/build.ts",
      test: "jest",
      "test:watch": "jest --watch",
      lint: "eslint 'src/**/*.{js,ts}'",
      "lint:fix": "eslint 'src/**/*.{js,ts}' --fix",
      format: "prettier --write 'src/**/*.{js,ts,json}'",
      "register:dev": "node dist/scripts/register-dev.js",
      postinstall: "node dist/scripts/postinstall.js"
    },
    files: [
      "dist",
      "!dist/node_path.txt"
    ],
    preferGlobal: true,
    keywords: [
      "mcp",
      "chrome",
      "browser"
    ],
    author: "hangye",
    license: "MIT",
    dependencies: {
      "@hono/node-server": "^1.19.13",
      "@modelcontextprotocol/sdk": "^1.11.0",
      commander: "^13.1.0",
      hono: "^4.12.12"
    },
    devDependencies: {
      "@jest/globals": "^29.7.0",
      "chrome-mcp-shared": "^1.0.2",
      "@types/chrome": "^0.0.318",
      "@types/jest": "^29.5.14",
      "@types/node": "^22.19.17",
      "@typescript-eslint/parser": "^8.31.1",
      "cross-env": "^7.0.3",
      husky: "^9.1.7",
      jest: "^29.7.0",
      "lint-staged": "^15.5.1",
      nodemon: "^3.1.10",
      rimraf: "^6.0.1",
      "ts-jest": "^29.3.2",
      "ts-node": "^10.9.2",
      typescript: "^5.9.3"
    },
    husky: {
      hooks: {
        "pre-commit": "lint-staged"
      }
    },
    "lint-staged": {
      "*.{js,ts}": [
        "eslint --fix",
        "prettier --write"
      ],
      "*.{json,md}": [
        "prettier --write"
      ]
    }
  };
});

// src/cli.ts
var import_commander = require("commander");

// src/scripts/utils.ts
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var import_os = __toESM(require("os"));
var import_child_process2 = require("child_process");
var import_util = require("util");

// src/scripts/constant.ts
var PACKAGE_NAME = "@go-hare/mcp-chrome-bridge";
var COMMAND_NAME = "mcp-chrome-bridge";
var EXTENSION_ID = "hbdgbgagpkpjffpklnamcljpakneikee";
var HOST_NAME = "com.chromemcp.nativehost";
var DESCRIPTION = "Node.js Host for Browser Bridge Extension";

// src/scripts/browser-config.ts
var fs = __toESM(require("fs"));
var os = __toESM(require("os"));
var path = __toESM(require("path"));
var import_child_process = require("child_process");
var BrowserType;
((BrowserType2) => {
  BrowserType2["CHROME"] = "chrome";
  BrowserType2["CHROMIUM"] = "chromium";
})(BrowserType ||= {});
function getUserManifestPathForBrowser(browser) {
  const platform2 = os.platform();
  if (platform2 === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    switch (browser) {
      case "chrome" /* CHROME */:
        return path.join(appData, "Google", "Chrome", "NativeMessagingHosts", `${HOST_NAME}.json`);
      case "chromium" /* CHROMIUM */:
        return path.join(appData, "Chromium", "NativeMessagingHosts", `${HOST_NAME}.json`);
      default:
        return path.join(appData, "Google", "Chrome", "NativeMessagingHosts", `${HOST_NAME}.json`);
    }
  } else if (platform2 === "darwin") {
    const home = os.homedir();
    switch (browser) {
      case "chrome" /* CHROME */:
        return path.join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts", `${HOST_NAME}.json`);
      case "chromium" /* CHROMIUM */:
        return path.join(home, "Library", "Application Support", "Chromium", "NativeMessagingHosts", `${HOST_NAME}.json`);
      default:
        return path.join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts", `${HOST_NAME}.json`);
    }
  } else {
    const home = os.homedir();
    switch (browser) {
      case "chrome" /* CHROME */:
        return path.join(home, ".config", "google-chrome", "NativeMessagingHosts", `${HOST_NAME}.json`);
      case "chromium" /* CHROMIUM */:
        return path.join(home, ".config", "chromium", "NativeMessagingHosts", `${HOST_NAME}.json`);
      default:
        return path.join(home, ".config", "google-chrome", "NativeMessagingHosts", `${HOST_NAME}.json`);
    }
  }
}
function getSystemManifestPathForBrowser(browser) {
  const platform2 = os.platform();
  if (platform2 === "win32") {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    switch (browser) {
      case "chrome" /* CHROME */:
        return path.join(programFiles, "Google", "Chrome", "NativeMessagingHosts", `${HOST_NAME}.json`);
      case "chromium" /* CHROMIUM */:
        return path.join(programFiles, "Chromium", "NativeMessagingHosts", `${HOST_NAME}.json`);
      default:
        return path.join(programFiles, "Google", "Chrome", "NativeMessagingHosts", `${HOST_NAME}.json`);
    }
  } else if (platform2 === "darwin") {
    switch (browser) {
      case "chrome" /* CHROME */:
        return path.join("/Library", "Google", "Chrome", "NativeMessagingHosts", `${HOST_NAME}.json`);
      case "chromium" /* CHROMIUM */:
        return path.join("/Library", "Application Support", "Chromium", "NativeMessagingHosts", `${HOST_NAME}.json`);
      default:
        return path.join("/Library", "Google", "Chrome", "NativeMessagingHosts", `${HOST_NAME}.json`);
    }
  } else {
    switch (browser) {
      case "chrome" /* CHROME */:
        return path.join("/etc", "opt", "chrome", "native-messaging-hosts", `${HOST_NAME}.json`);
      case "chromium" /* CHROMIUM */:
        return path.join("/etc", "chromium", "native-messaging-hosts", `${HOST_NAME}.json`);
      default:
        return path.join("/etc", "opt", "chrome", "native-messaging-hosts", `${HOST_NAME}.json`);
    }
  }
}
function getRegistryKeys(browser) {
  if (os.platform() !== "win32")
    return;
  const browserPaths = {
    ["chrome" /* CHROME */]: {
      user: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
      system: `HKLM\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`
    },
    ["chromium" /* CHROMIUM */]: {
      user: `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`,
      system: `HKLM\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`
    }
  };
  return browserPaths[browser];
}
function getBrowserConfig(browser) {
  const registryKeys = getRegistryKeys(browser);
  return {
    type: browser,
    displayName: browser.charAt(0).toUpperCase() + browser.slice(1),
    userManifestPath: getUserManifestPathForBrowser(browser),
    systemManifestPath: getSystemManifestPathForBrowser(browser),
    registryKey: registryKeys?.user,
    systemRegistryKey: registryKeys?.system
  };
}
function detectInstalledBrowsers() {
  const detectedBrowsers = [];
  const platform2 = os.platform();
  if (platform2 === "win32") {
    const browsers = [
      { type: "chrome" /* CHROME */, registryPath: "HKLM\\SOFTWARE\\Google\\Chrome" },
      { type: "chromium" /* CHROMIUM */, registryPath: "HKLM\\SOFTWARE\\Chromium" }
    ];
    for (const browser of browsers) {
      try {
        import_child_process.execSync(`reg query "${browser.registryPath}" 2>nul`, { stdio: "pipe" });
        detectedBrowsers.push(browser.type);
      } catch {}
    }
  } else if (platform2 === "darwin") {
    const browsers = [
      { type: "chrome" /* CHROME */, appPath: "/Applications/Google Chrome.app" },
      { type: "chromium" /* CHROMIUM */, appPath: "/Applications/Chromium.app" }
    ];
    for (const browser of browsers) {
      if (fs.existsSync(browser.appPath)) {
        detectedBrowsers.push(browser.type);
      }
    }
  } else {
    const browsers = [
      { type: "chrome" /* CHROME */, commands: ["google-chrome", "google-chrome-stable"] },
      { type: "chromium" /* CHROMIUM */, commands: ["chromium", "chromium-browser"] }
    ];
    for (const browser of browsers) {
      for (const cmd of browser.commands) {
        try {
          import_child_process.execSync(`which ${cmd} 2>/dev/null`, { stdio: "pipe" });
          detectedBrowsers.push(browser.type);
          break;
        } catch {}
      }
    }
  }
  return detectedBrowsers;
}
function parseBrowserType(browserStr) {
  const normalized = browserStr.toLowerCase();
  return Object.values(BrowserType).find((type) => type === normalized);
}

// src/scripts/is-admin.ts
var import_node_child_process = require("node:child_process");
var import_node_process = __toESM(require("node:process"));
function isAdmin() {
  if (import_node_process.default.platform !== "win32") {
    return false;
  }
  try {
    import_node_child_process.execFileSync("fsutil", ["dirty", "query", import_node_process.default.env.systemdrive || "C:"], { stdio: "ignore" });
    return true;
  } catch {
    try {
      import_node_child_process.execFileSync("fltmc", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}

// src/scripts/utils.ts
var __dirname = require("path").dirname(__filename);
var access = import_util.promisify(import_fs.default.access);
var mkdir = import_util.promisify(import_fs.default.mkdir);
var writeFile = import_util.promisify(import_fs.default.writeFile);
function getLogDir() {
  const homedir2 = import_os.default.homedir();
  if (import_os.default.platform() === "darwin") {
    return import_path.default.join(homedir2, "Library", "Logs", "mcp-chrome-bridge");
  } else if (import_os.default.platform() === "win32") {
    return import_path.default.join(process.env.LOCALAPPDATA || import_path.default.join(homedir2, "AppData", "Local"), "mcp-chrome-bridge", "logs");
  } else {
    const xdgState = process.env.XDG_STATE_HOME || import_path.default.join(homedir2, ".local", "state");
    return import_path.default.join(xdgState, "mcp-chrome-bridge", "logs");
  }
}
function colorText(text, color) {
  const colors = {
    red: "\x1B[31m",
    green: "\x1B[32m",
    yellow: "\x1B[33m",
    blue: "\x1B[34m",
    reset: "\x1B[0m"
  };
  return colors[color] + text + colors.reset;
}
function getSystemManifestPath() {
  if (import_os.default.platform() === "win32") {
    return import_path.default.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "NativeMessagingHosts", `${HOST_NAME}.json`);
  } else if (import_os.default.platform() === "darwin") {
    return import_path.default.join("/Library", "Google", "Chrome", "NativeMessagingHosts", `${HOST_NAME}.json`);
  } else {
    return import_path.default.join("/etc", "opt", "chrome", "native-messaging-hosts", `${HOST_NAME}.json`);
  }
}
function resolveDistDir() {
  if (import_fs.default.existsSync(import_path.default.join(__dirname, "run_host.sh")) || import_fs.default.existsSync(import_path.default.join(__dirname, "run_host.bat")) || import_fs.default.existsSync(import_path.default.join(__dirname, "node_path.txt"))) {
    return __dirname;
  }
  return import_path.default.join(__dirname, "..");
}
async function getMainPath() {
  try {
    const packageDistDir = resolveDistDir();
    const wrapperScriptName = process.platform === "win32" ? "run_host.bat" : "run_host.sh";
    const absoluteWrapperPath = import_path.default.resolve(packageDistDir, wrapperScriptName);
    return absoluteWrapperPath;
  } catch (error) {
    console.log(colorText("Cannot find global package path, using current directory", "yellow"));
    throw error;
  }
}
function writeNodePathFile(distDir, nodeExecPath = process.execPath) {
  try {
    const nodePathFile = import_path.default.join(distDir, "node_path.txt");
    import_fs.default.mkdirSync(distDir, { recursive: true });
    console.log(colorText(`Writing Node.js path: ${nodeExecPath}`, "blue"));
    import_fs.default.writeFileSync(nodePathFile, nodeExecPath, "utf8");
    console.log(colorText("✓ Node.js path written for run_host scripts", "green"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(colorText(`⚠️ Failed to write Node.js path: ${message}`, "yellow"));
  }
}
async function ensureExecutionPermissions() {
  try {
    const packageDistDir = resolveDistDir();
    if (process.platform === "win32") {
      await ensureWindowsFilePermissions(packageDistDir);
      return;
    }
    const filesToCheck = [
      import_path.default.join(packageDistDir, "index.js"),
      import_path.default.join(packageDistDir, "run_host.sh"),
      import_path.default.join(packageDistDir, "cli.js")
    ];
    for (const filePath of filesToCheck) {
      if (import_fs.default.existsSync(filePath)) {
        try {
          import_fs.default.chmodSync(filePath, "755");
          console.log(colorText(`✓ Set execution permissions for ${import_path.default.basename(filePath)}`, "green"));
        } catch (err) {
          console.warn(colorText(`⚠️ Unable to set execution permissions for ${import_path.default.basename(filePath)}: ${err.message}`, "yellow"));
        }
      } else {
        console.warn(colorText(`⚠️ File not found: ${filePath}`, "yellow"));
      }
    }
  } catch (error) {
    console.warn(colorText(`⚠️ Error ensuring execution permissions: ${error.message}`, "yellow"));
  }
}
async function ensureWindowsFilePermissions(packageDistDir) {
  const filesToCheck = [
    import_path.default.join(packageDistDir, "index.js"),
    import_path.default.join(packageDistDir, "run_host.bat"),
    import_path.default.join(packageDistDir, "cli.js")
  ];
  for (const filePath of filesToCheck) {
    if (import_fs.default.existsSync(filePath)) {
      try {
        const stats = import_fs.default.statSync(filePath);
        if (!(stats.mode & parseInt("200", 8))) {
          import_fs.default.chmodSync(filePath, stats.mode | parseInt("200", 8));
          console.log(colorText(`✓ Removed read-only attribute from ${import_path.default.basename(filePath)}`, "green"));
        }
        import_fs.default.accessSync(filePath, import_fs.default.constants.R_OK);
        console.log(colorText(`✓ Verified file accessibility for ${import_path.default.basename(filePath)}`, "green"));
      } catch (err) {
        console.warn(colorText(`⚠️ Unable to verify file permissions for ${import_path.default.basename(filePath)}: ${err.message}`, "yellow"));
      }
    } else {
      console.warn(colorText(`⚠️ File not found: ${filePath}`, "yellow"));
    }
  }
}
async function createManifestContent() {
  const mainPath = await getMainPath();
  return {
    name: HOST_NAME,
    description: DESCRIPTION,
    path: mainPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`]
  };
}
function verifyWindowsRegistryEntry(registryKey, expectedPath) {
  if (import_os.default.platform() !== "win32") {
    return true;
  }
  const normalizeForCompare = (filePath) => import_path.default.normalize(filePath).toLowerCase();
  try {
    const output = import_child_process2.execSync(`reg query "${registryKey}" /ve`, {
      encoding: "utf8",
      stdio: "pipe"
    });
    const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/REG_SZ\s+(.*)$/i);
      if (!match?.[1])
        continue;
      const actualPath = match[1].trim();
      return normalizeForCompare(actualPath) === normalizeForCompare(expectedPath);
    }
  } catch {}
  return false;
}
async function tryRegisterUserLevelHost(targetBrowsers) {
  try {
    console.log(colorText("Attempting to register user-level Native Messaging host...", "blue"));
    await ensureExecutionPermissions();
    const browsersToRegister = targetBrowsers || detectInstalledBrowsers();
    if (browsersToRegister.length === 0) {
      browsersToRegister.push("chrome" /* CHROME */, "chromium" /* CHROMIUM */);
      console.log(colorText("No browsers detected, registering for Chrome and Chromium by default", "yellow"));
    } else {
      console.log(colorText(`Detected browsers: ${browsersToRegister.join(", ")}`, "blue"));
    }
    const manifest = await createManifestContent();
    let successCount = 0;
    const results = [];
    for (const browserType of browsersToRegister) {
      const config = getBrowserConfig(browserType);
      console.log(colorText(`
Registering for ${config.displayName}...`, "blue"));
      try {
        await mkdir(import_path.default.dirname(config.userManifestPath), { recursive: true });
        await writeFile(config.userManifestPath, JSON.stringify(manifest, null, 2));
        console.log(colorText(`✓ Manifest written to ${config.userManifestPath}`, "green"));
        if (import_os.default.platform() === "win32" && config.registryKey) {
          try {
            const regCommand = `reg add "${config.registryKey}" /ve /t REG_SZ /d "${config.userManifestPath}" /f`;
            import_child_process2.execSync(regCommand, { stdio: "pipe" });
            if (verifyWindowsRegistryEntry(config.registryKey, config.userManifestPath)) {
              console.log(colorText(`✓ Registry entry created for ${config.displayName}`, "green"));
            } else {
              throw new Error("Registry verification failed");
            }
          } catch (error) {
            throw new Error(`Registry error: ${error.message}`);
          }
        }
        successCount++;
        results.push({ browser: config.displayName, success: true });
        console.log(colorText(`✓ Successfully registered ${config.displayName}`, "green"));
      } catch (error) {
        results.push({ browser: config.displayName, success: false, error: error.message });
        console.log(colorText(`✗ Failed to register ${config.displayName}: ${error.message}`, "red"));
      }
    }
    console.log(colorText(`
===== Registration Summary =====`, "blue"));
    for (const result of results) {
      if (result.success) {
        console.log(colorText(`✓ ${result.browser}: Success`, "green"));
      } else {
        console.log(colorText(`✗ ${result.browser}: Failed - ${result.error}`, "red"));
      }
    }
    return successCount > 0;
  } catch (error) {
    console.log(colorText(`User-level registration failed: ${error instanceof Error ? error.message : String(error)}`, "yellow"));
    return false;
  }
}
async function registerWithElevatedPermissions() {
  try {
    console.log(colorText("Attempting to register system-level manifest...", "blue"));
    await ensureExecutionPermissions();
    const manifest = await createManifestContent();
    const manifestPath = getSystemManifestPath();
    const tempManifestPath = import_path.default.join(import_os.default.tmpdir(), `${HOST_NAME}.json`);
    await writeFile(tempManifestPath, JSON.stringify(manifest, null, 2));
    const isRoot = process.getuid && process.getuid() === 0;
    const hasAdminRights = process.platform === "win32" ? isAdmin() : false;
    const hasElevatedPermissions = isRoot || hasAdminRights;
    const command = import_os.default.platform() === "win32" ? `if not exist "${import_path.default.dirname(manifestPath)}" mkdir "${import_path.default.dirname(manifestPath)}" && copy "${tempManifestPath}" "${manifestPath}"` : `mkdir -p "${import_path.default.dirname(manifestPath)}" && cp "${tempManifestPath}" "${manifestPath}" && chmod 644 "${manifestPath}"`;
    if (hasElevatedPermissions) {
      try {
        if (!import_fs.default.existsSync(import_path.default.dirname(manifestPath))) {
          import_fs.default.mkdirSync(import_path.default.dirname(manifestPath), { recursive: true });
        }
        import_fs.default.copyFileSync(tempManifestPath, manifestPath);
        if (import_os.default.platform() !== "win32") {
          import_fs.default.chmodSync(manifestPath, "644");
        }
        console.log(colorText("System-level manifest registration successful!", "green"));
      } catch (error) {
        console.error(colorText(`System-level manifest installation failed: ${error.message}`, "red"));
        throw error;
      }
    } else {
      console.log(colorText("⚠️ Administrator privileges required for system-level installation", "yellow"));
      console.log(colorText("Please run one of the following commands with administrator privileges:", "blue"));
      if (import_os.default.platform() === "win32") {
        console.log(colorText("  1. Open Command Prompt as Administrator and run:", "blue"));
        console.log(colorText(`     ${command}`, "cyan"));
      } else {
        console.log(colorText("  1. Run with sudo:", "blue"));
        console.log(colorText(`     sudo ${command}`, "cyan"));
      }
      console.log(colorText("  2. Or run the registration command with elevated privileges:", "blue"));
      console.log(colorText(`     sudo ${COMMAND_NAME} register --system`, "cyan"));
      throw new Error("Administrator privileges required for system-level installation");
    }
    if (import_os.default.platform() === "win32") {
      const registryKey = `HKLM\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
      const regCommand = `reg add "${registryKey}" /ve /t REG_SZ /d "${manifestPath}" /f`;
      console.log(colorText(`Creating system registry entry: ${registryKey}`, "blue"));
      console.log(colorText(`Manifest path: ${manifestPath}`, "blue"));
      if (hasElevatedPermissions) {
        try {
          import_child_process2.execSync(regCommand, { stdio: "pipe" });
          if (verifyWindowsRegistryEntry(registryKey, manifestPath)) {
            console.log(colorText("Windows registry entry created successfully!", "green"));
          } else {
            console.log(colorText("⚠️ Registry entry created but verification failed", "yellow"));
          }
        } catch (error) {
          console.error(colorText(`Windows registry entry creation failed: ${error.message}`, "red"));
          console.error(colorText(`Command: ${regCommand}`, "red"));
          throw error;
        }
      } else {
        console.log(colorText("⚠️ Administrator privileges required for Windows registry modification", "yellow"));
        console.log(colorText("Please run the following command as Administrator:", "blue"));
        console.log(colorText(`  ${regCommand}`, "cyan"));
        console.log(colorText("Or run the registration command with elevated privileges:", "blue"));
        console.log(colorText(`  Run Command Prompt as Administrator and execute: ${COMMAND_NAME} register --system`, "cyan"));
        throw new Error("Administrator privileges required for Windows registry modification");
      }
    }
  } catch (error) {
    console.error(colorText(`注册失败: ${error.message}`, "red"));
    throw error;
  }
}

// src/scripts/doctor.ts
var import_fs2 = __toESM(require("fs"));
var import_os2 = __toESM(require("os"));
var import_path2 = __toESM(require("path"));
var import_child_process3 = require("child_process");
var __dirname = require("path").dirname(__filename);
var SCHEMA_VERSION = 1;
function readPackageJson() {
  try {
    return require_package();
  } catch {
    return {};
  }
}
function getCommandInfo(pkg) {
  const bin = pkg.bin;
  if (!bin || typeof bin !== "object") {
    return { canonical: COMMAND_NAME, aliases: [] };
  }
  const canonical = COMMAND_NAME;
  const canonicalTarget = bin[canonical];
  const aliases = canonicalTarget ? Object.keys(bin).filter((name) => name !== canonical && bin[name] === canonicalTarget) : [];
  return { canonical, aliases };
}
function resolveDistDir2() {
  const looksLikeDist = (dir) => {
    return import_fs2.default.existsSync(import_path2.default.join(dir, "run_host.sh")) || import_fs2.default.existsSync(import_path2.default.join(dir, "run_host.bat")) || import_fs2.default.existsSync(import_path2.default.join(dir, "node_path.txt"));
  };
  if (looksLikeDist(__dirname))
    return __dirname;
  const candidateFromDistScripts = import_path2.default.resolve(__dirname, "..");
  if (looksLikeDist(candidateFromDistScripts))
    return candidateFromDistScripts;
  const candidateFromSrcScripts = import_path2.default.resolve(__dirname, "..", "..", "dist");
  if (looksLikeDist(candidateFromSrcScripts))
    return candidateFromSrcScripts;
  return candidateFromDistScripts;
}
function stringifyError(err) {
  if (err instanceof Error)
    return err.message;
  return String(err);
}
function canExecute(filePath) {
  try {
    import_fs2.default.accessSync(filePath, import_fs2.default.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function normalizeComparablePath(filePath) {
  if (process.platform === "win32") {
    return import_path2.default.normalize(filePath).toLowerCase();
  }
  return import_path2.default.normalize(filePath);
}
function stripOuterQuotes(input) {
  const trimmed = input.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') || trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
function expandTilde(inputPath) {
  if (inputPath === "~")
    return import_os2.default.homedir();
  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return import_path2.default.join(import_os2.default.homedir(), inputPath.slice(2));
  }
  return inputPath;
}
function expandWindowsEnvVars(input) {
  if (process.platform !== "win32")
    return input;
  return input.replace(/%([^%]+)%/g, (_match, name) => {
    const key = String(name);
    return process.env[key] ?? process.env[key.toUpperCase()] ?? process.env[key.toLowerCase()] ?? _match;
  });
}
function parseVersionFromDirName(dirName) {
  const cleaned = dirName.trim().replace(/^v/, "");
  if (!/^\d+(\.\d+){0,3}$/.test(cleaned))
    return null;
  return cleaned.split(".").map((part) => Number(part));
}
function compareVersions(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0;i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv)
      return av - bv;
  }
  return 0;
}
function pickLatestVersionDir(parentDir) {
  if (!import_fs2.default.existsSync(parentDir))
    return null;
  const dirents = import_fs2.default.readdirSync(parentDir, { withFileTypes: true });
  let best = null;
  for (const dirent of dirents) {
    if (!dirent.isDirectory())
      continue;
    const parsed = parseVersionFromDirName(dirent.name);
    if (!parsed)
      continue;
    if (!best || compareVersions(parsed, best.version) > 0) {
      best = { name: dirent.name, version: parsed };
    }
  }
  return best ? import_path2.default.join(parentDir, best.name) : null;
}
function resolveNodeCandidate(distDir) {
  const nodeFileName = process.platform === "win32" ? "node.exe" : "node";
  const nodePathFilePath = import_path2.default.join(distDir, "node_path.txt");
  const nodePathFile = {
    path: nodePathFilePath,
    exists: import_fs2.default.existsSync(nodePathFilePath)
  };
  const consider = (source, rawCandidate) => {
    if (!rawCandidate)
      return null;
    let candidate = expandTilde(stripOuterQuotes(rawCandidate));
    try {
      if (import_fs2.default.existsSync(candidate) && import_fs2.default.statSync(candidate).isDirectory()) {
        candidate = import_path2.default.join(candidate, nodeFileName);
      }
    } catch {}
    if (canExecute(candidate)) {
      return { nodePath: candidate, source };
    }
    return null;
  };
  const fromEnv = consider("CHROME_MCP_NODE_PATH", process.env.CHROME_MCP_NODE_PATH);
  if (fromEnv) {
    return { ...fromEnv, nodePathFile };
  }
  if (nodePathFile.exists) {
    try {
      const content = import_fs2.default.readFileSync(nodePathFilePath, "utf8").trim();
      nodePathFile.value = content;
      const fromFile = consider("node_path.txt", content);
      nodePathFile.valid = Boolean(fromFile);
      if (fromFile) {
        return { ...fromFile, nodePathFile };
      }
    } catch (e) {
      nodePathFile.error = stringifyError(e);
      nodePathFile.valid = false;
    }
  }
  const relativeNodePath = process.platform === "win32" ? import_path2.default.resolve(distDir, "..", "..", "..", nodeFileName) : import_path2.default.resolve(distDir, "..", "..", "..", "bin", nodeFileName);
  const fromRelative = consider("relative", relativeNodePath);
  if (fromRelative)
    return { ...fromRelative, nodePathFile };
  const voltaHome = process.env.VOLTA_HOME || import_path2.default.join(import_os2.default.homedir(), ".volta");
  const fromVolta = consider("volta", import_path2.default.join(voltaHome, "bin", nodeFileName));
  if (fromVolta)
    return { ...fromVolta, nodePathFile };
  const asdfDir = process.env.ASDF_DATA_DIR || import_path2.default.join(import_os2.default.homedir(), ".asdf");
  const asdfNodejsDir = import_path2.default.join(asdfDir, "installs", "nodejs");
  const latestAsdf = pickLatestVersionDir(asdfNodejsDir);
  if (latestAsdf) {
    const fromAsdf = consider("asdf", import_path2.default.join(latestAsdf, "bin", nodeFileName));
    if (fromAsdf)
      return { ...fromAsdf, nodePathFile };
  }
  const fnmDir = process.env.FNM_DIR || import_path2.default.join(import_os2.default.homedir(), ".fnm");
  const fnmVersionsDir = import_path2.default.join(fnmDir, "node-versions");
  const latestFnm = pickLatestVersionDir(fnmVersionsDir);
  if (latestFnm) {
    const fnmNodePath = process.platform === "win32" ? import_path2.default.join(latestFnm, "installation", nodeFileName) : import_path2.default.join(latestFnm, "installation", "bin", nodeFileName);
    const fromFnm = consider("fnm", fnmNodePath);
    if (fromFnm)
      return { ...fromFnm, nodePathFile };
  }
  if (process.platform !== "win32") {
    const nvmDir = process.env.NVM_DIR || import_path2.default.join(import_os2.default.homedir(), ".nvm");
    const nvmDefaultAlias = import_path2.default.join(nvmDir, "alias", "default");
    try {
      if (import_fs2.default.existsSync(nvmDefaultAlias)) {
        const stat = import_fs2.default.lstatSync(nvmDefaultAlias);
        const maybeVersion = stat.isSymbolicLink() ? import_fs2.default.readlinkSync(nvmDefaultAlias).trim() : import_fs2.default.readFileSync(nvmDefaultAlias, "utf8").trim();
        const fromDefault = consider("nvm-default", import_path2.default.join(nvmDir, "versions", "node", maybeVersion, "bin", "node"));
        if (fromDefault)
          return { ...fromDefault, nodePathFile };
      }
    } catch {}
    const latestNvm = pickLatestVersionDir(import_path2.default.join(nvmDir, "versions", "node"));
    if (latestNvm) {
      const fromNvm = consider("nvm-latest", import_path2.default.join(latestNvm, "bin", "node"));
      if (fromNvm)
        return { ...fromNvm, nodePathFile };
    }
  }
  const commonPaths = process.platform === "win32" ? [
    import_path2.default.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "node.exe"),
    import_path2.default.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "nodejs", "node.exe"),
    import_path2.default.join(process.env.LOCALAPPDATA || "", "Programs", "nodejs", "node.exe")
  ].filter((p) => import_path2.default.isAbsolute(p)) : ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"];
  for (const common of commonPaths) {
    const resolved = consider("common", common);
    if (resolved)
      return { ...resolved, nodePathFile };
  }
  const pathEnv = process.env.PATH || "";
  for (const rawDir of pathEnv.split(import_path2.default.delimiter)) {
    const dir = stripOuterQuotes(rawDir);
    if (!dir)
      continue;
    const candidate = import_path2.default.join(dir, nodeFileName);
    if (canExecute(candidate)) {
      return { nodePath: candidate, source: "PATH", nodePathFile };
    }
  }
  return { nodePathFile };
}
function resolveTargetBrowsers(browserArg) {
  if (!browserArg)
    return;
  const normalized = browserArg.toLowerCase();
  if (normalized === "all")
    return ["chrome" /* CHROME */, "chromium" /* CHROMIUM */];
  if (normalized === "detect" || normalized === "auto")
    return;
  const parsed = parseBrowserType(normalized);
  if (!parsed) {
    throw new Error(`Invalid browser: ${browserArg}. Use 'chrome', 'chromium', or 'all'`);
  }
  return [parsed];
}
function isBrowserExplicitlyRequested(browserArg) {
  if (!browserArg)
    return false;
  const normalized = browserArg.toLowerCase();
  return normalized !== "detect" && normalized !== "auto";
}
function resolveBrowsersToCheck(requested) {
  if (requested && requested.length > 0)
    return requested;
  const detected = detectInstalledBrowsers();
  if (detected.length > 0)
    return detected;
  return ["chrome" /* CHROME */, "chromium" /* CHROMIUM */];
}
function queryWindowsRegistryDefaultValue(registryKey) {
  try {
    const output = import_child_process3.execFileSync("reg", ["query", registryKey, "/ve"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 2500,
      windowsHide: true
    });
    const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/\b(REG_SZ|REG_EXPAND_SZ)\b\s+(.*)$/i);
      if (match?.[2]) {
        const valueType = match[1].toUpperCase();
        return { value: match[2].trim(), valueType };
      }
    }
    return { error: "No REG_SZ/REG_EXPAND_SZ default value found" };
  } catch (e) {
    return { error: stringifyError(e) };
  }
}
async function attemptFixes(enabled, silent, distDir, targetBrowsers) {
  if (!enabled)
    return [];
  const fixes = [];
  const logDir = getLogDir();
  const nodePathFile = import_path2.default.join(distDir, "node_path.txt");
  const withMutedConsole = async (fn) => {
    if (!silent)
      return await fn();
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
    console.error = () => {};
    try {
      return await fn();
    } finally {
      console.log = originalLog;
      console.info = originalInfo;
      console.warn = originalWarn;
      console.error = originalError;
    }
  };
  const attempt = async (id, description, action) => {
    try {
      await withMutedConsole(async () => {
        await action();
      });
      fixes.push({ id, description, success: true });
    } catch (e) {
      fixes.push({ id, description, success: false, error: stringifyError(e) });
    }
  };
  await attempt("logs", "Ensure logs directory exists", async () => {
    import_fs2.default.mkdirSync(logDir, { recursive: true });
  });
  await attempt("node_path", "Write node_path.txt for run_host scripts", async () => {
    import_fs2.default.writeFileSync(nodePathFile, process.execPath, "utf8");
  });
  await attempt("permissions", "Fix execution permissions for native host files", async () => {
    await ensureExecutionPermissions();
  });
  await attempt("register", "Re-register Native Messaging host (user-level)", async () => {
    const ok = await tryRegisterUserLevelHost(targetBrowsers);
    if (!ok) {
      throw new Error("User-level registration failed");
    }
  });
  return fixes;
}
function readJsonFile(filePath) {
  try {
    const raw = import_fs2.default.readFileSync(filePath, "utf8");
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: stringifyError(e) };
  }
}
function computeSummary(checks) {
  let ok = 0;
  let warn = 0;
  let error = 0;
  for (const check of checks) {
    if (check.status === "ok")
      ok++;
    else if (check.status === "warn")
      warn++;
    else
      error++;
  }
  return { ok, warn, error };
}
function statusBadge(status) {
  if (status === "ok")
    return colorText("[OK]", "green");
  if (status === "warn")
    return colorText("[WARN]", "yellow");
  return colorText("[ERROR]", "red");
}
async function collectDoctorReport(options) {
  const pkg = readPackageJson();
  const distDir = resolveDistDir2();
  const rootDir = import_path2.default.resolve(distDir, "..");
  const packageName = typeof pkg.name === "string" ? pkg.name : PACKAGE_NAME;
  const packageVersion = typeof pkg.version === "string" ? pkg.version : "unknown";
  const commandInfo = getCommandInfo(pkg);
  const targetBrowsers = resolveTargetBrowsers(options.browser);
  const detectedBrowsers = detectInstalledBrowsers();
  const noBrowserDetected = detectedBrowsers.length === 0 && !isBrowserExplicitlyRequested(options.browser);
  const browsersToCheck = resolveBrowsersToCheck(targetBrowsers);
  const wrapperScriptName = process.platform === "win32" ? "run_host.bat" : "run_host.sh";
  const wrapperPath = import_path2.default.resolve(distDir, wrapperScriptName);
  const nodeScriptPath = import_path2.default.resolve(distDir, "index.js");
  const logDir = getLogDir();
  const fixes = await attemptFixes(Boolean(options.fix), Boolean(options.json), distDir, targetBrowsers);
  const checks = [];
  const nextSteps = [];
  checks.push({
    id: "installation",
    title: "Installation",
    status: "ok",
    message: `${packageName}@${packageVersion}, ${process.platform}-${process.arch}, node ${process.version}`,
    details: {
      packageRoot: rootDir,
      distDir,
      execPath: process.execPath,
      aliases: commandInfo.aliases
    }
  });
  const missingHostFiles = [];
  if (!import_fs2.default.existsSync(wrapperPath))
    missingHostFiles.push(wrapperPath);
  if (!import_fs2.default.existsSync(nodeScriptPath))
    missingHostFiles.push(nodeScriptPath);
  if (missingHostFiles.length > 0) {
    checks.push({
      id: "host.files",
      title: "Host files",
      status: "error",
      message: `Missing required files (${missingHostFiles.length})`,
      details: { missing: missingHostFiles }
    });
    nextSteps.push(`Reinstall: npm install -g ${PACKAGE_NAME}`);
  } else {
    checks.push({
      id: "host.files",
      title: "Host files",
      status: "ok",
      message: `Wrapper: ${wrapperPath}`,
      details: { wrapperPath, nodeScriptPath }
    });
  }
  if (process.platform !== "win32" && import_fs2.default.existsSync(wrapperPath)) {
    const executable = canExecute(wrapperPath);
    checks.push({
      id: "host.permissions",
      title: "Host permissions",
      status: executable ? "ok" : "error",
      message: executable ? "run_host.sh is executable" : "run_host.sh is not executable",
      details: {
        path: wrapperPath,
        fix: executable ? undefined : [`${COMMAND_NAME} fix-permissions`, `chmod +x "${wrapperPath}"`]
      }
    });
    if (!executable)
      nextSteps.push(`${COMMAND_NAME} fix-permissions`);
  } else {
    checks.push({
      id: "host.permissions",
      title: "Host permissions",
      status: "ok",
      message: process.platform === "win32" ? "Not applicable on Windows" : "N/A"
    });
  }
  const nodeResolution = resolveNodeCandidate(distDir);
  if (nodeResolution.nodePath) {
    try {
      nodeResolution.version = import_child_process3.execFileSync(nodeResolution.nodePath, ["-v"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 2500,
        windowsHide: true
      }).trim();
    } catch (e) {
      nodeResolution.versionError = stringifyError(e);
    }
  }
  const nodePathWarn = Boolean(nodeResolution.nodePath) && (!nodeResolution.nodePathFile.exists || nodeResolution.nodePathFile.valid === false) && !process.env.CHROME_MCP_NODE_PATH;
  let nodeStatus = "ok";
  let nodeMessage;
  let nodeFix;
  if (!nodeResolution.nodePath) {
    nodeStatus = "error";
    nodeMessage = "Node.js executable not found by wrapper search order";
    nodeFix = [
      `${COMMAND_NAME} doctor --fix`,
      `Or set CHROME_MCP_NODE_PATH to an absolute node path`
    ];
    nextSteps.push(`${COMMAND_NAME} doctor --fix`);
  } else if (nodeResolution.versionError) {
    nodeStatus = "error";
    nodeMessage = `Found ${nodeResolution.source}: ${nodeResolution.nodePath} but failed to run "node -v" (${nodeResolution.versionError})`;
    nodeFix = [
      `Verify the executable: "${nodeResolution.nodePath}" -v`,
      `Reinstall/repair Node.js`
    ];
    nextSteps.push(`Verify Node.js: "${nodeResolution.nodePath}" -v`);
  } else if (nodePathWarn) {
    nodeStatus = "warn";
    nodeMessage = `Using ${nodeResolution.source}: ${nodeResolution.nodePath}${nodeResolution.version ? ` (${nodeResolution.version})` : ""}`;
    nodeFix = [
      `${COMMAND_NAME} doctor --fix`,
      `Or set CHROME_MCP_NODE_PATH to an absolute node path`
    ];
  } else {
    nodeStatus = "ok";
    nodeMessage = `Using ${nodeResolution.source}: ${nodeResolution.nodePath}${nodeResolution.version ? ` (${nodeResolution.version})` : ""}`;
  }
  checks.push({
    id: "node",
    title: "Node executable",
    status: nodeStatus,
    message: nodeMessage,
    details: {
      resolved: nodeResolution.nodePath ? {
        source: nodeResolution.source,
        path: nodeResolution.nodePath,
        version: nodeResolution.version,
        versionError: nodeResolution.versionError
      } : undefined,
      nodePathFile: nodeResolution.nodePathFile,
      fix: nodeFix
    }
  });
  if (noBrowserDetected) {
    checks.push({
      id: "browser.detect",
      title: "Browser detection",
      status: "warn",
      message: "No supported browser (Chrome/Chromium) detected in this environment. " + "The MCP Chrome Bridge requires a browser with the companion extension installed. " + "If you are running in a headless or remote environment (e.g. Codespaces, CI), " + "this is expected — install Chrome and the extension to enable full functionality.",
      details: {
        hint: "You can safely ignore this warning if you only need the MCP server without browser integration."
      }
    });
  } else {
    const expectedOrigin = `chrome-extension://${EXTENSION_ID}/`;
    for (const browser of browsersToCheck) {
      const config = getBrowserConfig(browser);
      const candidates = [config.userManifestPath, config.systemManifestPath];
      const found = candidates.find((p) => import_fs2.default.existsSync(p));
      if (!found) {
        checks.push({
          id: `manifest.${browser}`,
          title: `${config.displayName} manifest`,
          status: "error",
          message: "Manifest not found",
          details: {
            expected: candidates,
            fix: [
              `${COMMAND_NAME} register --browser ${browser}`,
              `${COMMAND_NAME} register --detect`
            ]
          }
        });
        nextSteps.push(`${COMMAND_NAME} register --detect`);
        continue;
      }
      const parsed = readJsonFile(found);
      if (!parsed.ok) {
        checks.push({
          id: `manifest.${browser}`,
          title: `${config.displayName} manifest`,
          status: "error",
          message: `Failed to parse manifest: ${parsed.error}`,
          details: { path: found, fix: [`${COMMAND_NAME} register --browser ${browser}`] }
        });
        nextSteps.push(`${COMMAND_NAME} register --browser ${browser}`);
        continue;
      }
      const manifest = parsed.value;
      const issues = [];
      if (manifest.name !== HOST_NAME)
        issues.push(`name != ${HOST_NAME}`);
      if (manifest.type !== "stdio")
        issues.push(`type != stdio`);
      if (typeof manifest.path !== "string")
        issues.push("path is missing");
      if (typeof manifest.path === "string") {
        const actual = normalizeComparablePath(manifest.path);
        const expected = normalizeComparablePath(wrapperPath);
        if (actual !== expected)
          issues.push("path does not match installed wrapper");
        if (!import_fs2.default.existsSync(manifest.path))
          issues.push("path target does not exist");
      }
      const allowedOrigins = manifest.allowed_origins;
      if (!Array.isArray(allowedOrigins) || !allowedOrigins.includes(expectedOrigin)) {
        issues.push(`allowed_origins missing ${expectedOrigin}`);
      }
      checks.push({
        id: `manifest.${browser}`,
        title: `${config.displayName} manifest`,
        status: issues.length === 0 ? "ok" : "error",
        message: issues.length === 0 ? found : `Invalid manifest (${issues.join("; ")})`,
        details: {
          path: found,
          expectedWrapperPath: wrapperPath,
          expectedOrigin,
          fix: issues.length === 0 ? undefined : [`${COMMAND_NAME} register --browser ${browser}`]
        }
      });
      if (issues.length > 0)
        nextSteps.push(`${COMMAND_NAME} register --browser ${browser}`);
    }
  }
  if (process.platform === "win32" && !noBrowserDetected) {
    for (const browser of browsersToCheck) {
      const config = getBrowserConfig(browser);
      const keySpecs = [
        config.registryKey ? { key: config.registryKey, expected: config.userManifestPath } : null,
        config.systemRegistryKey ? { key: config.systemRegistryKey, expected: config.systemManifestPath } : null
      ].filter(Boolean);
      if (keySpecs.length === 0)
        continue;
      let anyValue = false;
      let anyExistingTarget = false;
      let anyMissingTarget = false;
      let anyMismatch = false;
      const results = [];
      for (const spec of keySpecs) {
        const res = queryWindowsRegistryDefaultValue(spec.key);
        if (!res.value) {
          results.push({ key: spec.key, expected: spec.expected, error: res.error });
          continue;
        }
        anyValue = true;
        const expandedValue = expandWindowsEnvVars(stripOuterQuotes(res.value));
        const exists = import_fs2.default.existsSync(expandedValue);
        const matchesExpected = normalizeComparablePath(expandedValue) === normalizeComparablePath(spec.expected);
        if (exists) {
          anyExistingTarget = true;
          if (!matchesExpected)
            anyMismatch = true;
        } else {
          anyMissingTarget = true;
        }
        results.push({
          key: spec.key,
          expected: spec.expected,
          value: res.value,
          valueType: res.valueType,
          expandedValue: expandedValue !== res.value ? expandedValue : undefined,
          exists,
          matchesExpected
        });
      }
      let status = "error";
      let message = "Registry entry not found";
      if (!anyValue) {
        status = "error";
        message = "Registry entry not found";
      } else if (!anyExistingTarget) {
        status = "error";
        message = "Registry entry points to missing manifest";
      } else if (anyMissingTarget || anyMismatch) {
        status = "warn";
        message = "Registry entry found but inconsistent";
      } else {
        status = "ok";
        message = "Registry entry points to manifest";
      }
      checks.push({
        id: `registry.${browser}`,
        title: `${config.displayName} registry`,
        status,
        message,
        details: {
          keys: keySpecs.map((s) => s.key),
          results,
          fix: status === "ok" ? undefined : [`${COMMAND_NAME} register --browser ${browser}`]
        }
      });
      if (status !== "ok")
        nextSteps.push(`${COMMAND_NAME} register --browser ${browser}`);
    }
  }
  checks.push({
    id: "logs",
    title: "Logs",
    status: import_fs2.default.existsSync(logDir) ? "ok" : "warn",
    message: logDir,
    details: {
      hint: "Wrapper logs are created when Chrome launches the native host."
    }
  });
  const summary = computeSummary(checks);
  const ok = summary.error === 0;
  const report = {
    schemaVersion: SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    ok,
    summary,
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: { version: process.version, execPath: process.execPath },
      package: { name: packageName, version: packageVersion, rootDir, distDir },
      command: { canonical: commandInfo.canonical, aliases: commandInfo.aliases },
      nativeHost: { hostName: HOST_NAME }
    },
    fixes,
    checks,
    nextSteps: Array.from(new Set(nextSteps)).slice(0, 10)
  };
  return report;
}
async function runDoctor(options) {
  const report = await collectDoctorReport(options);
  const packageVersion = report.environment.package.version;
  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + `
`);
  } else {
    console.log(`${COMMAND_NAME} doctor v${packageVersion}
`);
    for (const check of report.checks) {
      console.log(`${statusBadge(check.status)}    ${check.title}: ${check.message}`);
      const fix = check.details?.fix;
      if (check.status !== "ok" && fix && fix.length > 0) {
        console.log(`        Fix: ${fix[0]}`);
      }
    }
    if (report.fixes.length > 0) {
      console.log(`
Fix attempts:`);
      for (const f of report.fixes) {
        const badge = f.success ? colorText("[OK]", "green") : colorText("[ERROR]", "red");
        console.log(`${badge} ${f.description}${f.success ? "" : ` (${f.error})`}`);
      }
    }
    if (report.nextSteps.length > 0) {
      console.log(`
Next steps:`);
      report.nextSteps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
    }
  }
  const hasNoBrowserWarning = report.checks.some((c) => c.id === "browser.detect");
  if (hasNoBrowserWarning) {
    return 0;
  }
  return report.ok ? 0 : 1;
}

// src/cli.ts
var __dirname = require("path").dirname(__filename);
import_commander.program.version(require_package().version).description("Mcp Chrome Bridge - Local service for communicating with Chrome extension");
import_commander.program.command("register").description("Register Native Messaging host").option("-f, --force", "Force re-registration").option("-s, --system", "Use system-level installation (requires administrator/sudo privileges)").option("-b, --browser <browser>", "Register for specific browser (chrome, chromium, or all)").option("-d, --detect", "Auto-detect installed browsers").action(async (options) => {
  try {
    writeNodePathFile(__dirname);
    let targetBrowsers;
    if (options.browser) {
      if (options.browser.toLowerCase() === "all") {
        targetBrowsers = ["chrome" /* CHROME */, "chromium" /* CHROMIUM */];
        console.log(colorText("Registering for all supported browsers...", "blue"));
      } else {
        const browserType = parseBrowserType(options.browser);
        if (!browserType) {
          console.error(colorText(`Invalid browser: ${options.browser}. Use 'chrome', 'chromium', or 'all'`, "red"));
          process.exit(1);
        }
        targetBrowsers = [browserType];
      }
    } else if (options.detect) {
      targetBrowsers = detectInstalledBrowsers();
      if (targetBrowsers.length === 0) {
        console.log(colorText("No supported browsers detected, will register for Chrome and Chromium", "yellow"));
        targetBrowsers = undefined;
      }
    }
    const isRoot = process.getuid && process.getuid() === 0;
    let hasAdmin = false;
    if (process.platform === "win32") {
      try {
        hasAdmin = isAdmin();
      } catch (error) {
        console.warn(colorText("Warning: Unable to detect administrator privileges on Windows", "yellow"));
        hasAdmin = false;
      }
    }
    const hasElevatedPermissions = isRoot || hasAdmin;
    if (options.system || hasElevatedPermissions) {
      await registerWithElevatedPermissions();
      console.log(colorText("System-level Native Messaging host registered successfully!", "green"));
      console.log(colorText("You can now use connectNative in Chrome extension to connect to this service.", "blue"));
    } else {
      console.log(colorText("Registering user-level Native Messaging host...", "blue"));
      const success = await tryRegisterUserLevelHost(targetBrowsers);
      if (success) {
        console.log(colorText("Native Messaging host registered successfully!", "green"));
        console.log(colorText("You can now use connectNative in Chrome extension to connect to this service.", "blue"));
      } else {
        console.log(colorText("User-level registration failed, please try the following methods:", "yellow"));
        console.log(colorText(`  1. sudo ${COMMAND_NAME} register`, "yellow"));
        console.log(colorText(`  2. ${COMMAND_NAME} register --system`, "yellow"));
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(colorText(`Registration failed: ${error.message}`, "red"));
    process.exit(1);
  }
});
import_commander.program.command("fix-permissions").description("Fix execution permissions for native host files").action(async () => {
  try {
    console.log(colorText("Fixing execution permissions...", "blue"));
    await ensureExecutionPermissions();
    console.log(colorText("✓ Execution permissions fixed successfully!", "green"));
  } catch (error) {
    console.error(colorText(`Failed to fix permissions: ${error.message}`, "red"));
    process.exit(1);
  }
});
import_commander.program.command("doctor").description("Diagnose installation and environment issues").option("--json", "Output diagnostics as JSON").option("--fix", "Attempt to fix common issues automatically").option("-b, --browser <browser>", "Target browser (chrome, chromium, or all)").action(async (options) => {
  try {
    const exitCode = await runDoctor({
      json: Boolean(options.json),
      fix: Boolean(options.fix),
      browser: options.browser
    });
    process.exit(exitCode);
  } catch (error) {
    console.error(colorText(`Doctor failed: ${error.message}`, "red"));
    process.exit(1);
  }
});
import_commander.program.parse(process.argv);
if (!process.argv.slice(2).length) {
  import_commander.program.outputHelp();
}

//# debugId=B362647307B337A364756E2164756E21
