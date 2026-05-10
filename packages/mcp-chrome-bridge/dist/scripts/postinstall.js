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

// src/scripts/postinstall.ts
var import_fs2 = __toESM(require("fs"));
var import_os2 = __toESM(require("os"));
var import_path2 = __toESM(require("path"));

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

// src/scripts/constant.ts
var COMMAND_NAME = "mcp-chrome-bridge";
var EXTENSION_ID = "hbdgbgagpkpjffpklnamcljpakneikee";
var HOST_NAME = "com.chromemcp.nativehost";
var DESCRIPTION = "Node.js Host for Browser Bridge Extension";

// src/scripts/utils.ts
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var import_os = __toESM(require("os"));
var import_child_process2 = require("child_process");
var import_util = require("util");

// src/scripts/browser-config.ts
var fs = __toESM(require("fs"));
var os = __toESM(require("os"));
var path = __toESM(require("path"));
var import_child_process = require("child_process");
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

// src/scripts/utils.ts
var __dirname = require("path").dirname(__filename);
var access = import_util.promisify(import_fs.default.access);
var mkdir = import_util.promisify(import_fs.default.mkdir);
var writeFile = import_util.promisify(import_fs.default.writeFile);
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

// src/scripts/postinstall.ts
var __dirname = require("path").dirname(__filename);
var isDirectRun = require.main == module;
function detectGlobalInstall() {
  if (process.env.npm_config_global === "true") {
    return true;
  }
  if (process.env.PNPM_HOME && __dirname.includes(process.env.PNPM_HOME)) {
    return true;
  }
  const globalPnpmPatterns = process.platform === "win32" ? ["\\pnpm\\global\\", "\\pnpm-global\\", "\\AppData\\Roaming\\pnpm\\"] : ["/pnpm/global/", "/.local/share/pnpm/", "/pnpm-global/"];
  if (globalPnpmPatterns.some((pattern) => __dirname.includes(pattern))) {
    return true;
  }
  if (process.env.npm_config_prefix && __dirname.includes(process.env.npm_config_prefix)) {
    return true;
  }
  if (process.platform === "win32") {
    const windowsGlobalPatterns = [
      "\\npm\\node_modules\\",
      "\\AppData\\Roaming\\npm\\node_modules\\",
      "\\Program Files\\nodejs\\node_modules\\",
      "\\nodejs\\node_modules\\"
    ];
    if (windowsGlobalPatterns.some((pattern) => __dirname.includes(pattern))) {
      return true;
    }
  }
  return false;
}
var isGlobalInstall = detectGlobalInstall();
function isRunningElevated() {
  if (process.platform === "win32") {
    return isAdmin();
  } else {
    return process.getuid?.() === 0;
  }
}
async function ensureExecutionPermissions2() {
  if (process.platform === "win32") {
    await ensureWindowsFilePermissions2();
    return;
  }
  const filesToCheck = [
    import_path2.default.join(__dirname, "..", "index.js"),
    import_path2.default.join(__dirname, "..", "run_host.sh"),
    import_path2.default.join(__dirname, "..", "cli.js")
  ];
  for (const filePath of filesToCheck) {
    if (import_fs2.default.existsSync(filePath)) {
      try {
        import_fs2.default.chmodSync(filePath, "755");
        console.log(colorText(`✓ Set execution permissions for ${import_path2.default.basename(filePath)}`, "green"));
      } catch (err) {
        console.warn(colorText(`⚠️ Unable to set execution permissions for ${import_path2.default.basename(filePath)}: ${err.message}`, "yellow"));
      }
    } else {
      console.warn(colorText(`⚠️ File not found: ${filePath}`, "yellow"));
    }
  }
}
async function ensureWindowsFilePermissions2() {
  const filesToCheck = [
    import_path2.default.join(__dirname, "..", "index.js"),
    import_path2.default.join(__dirname, "..", "run_host.bat"),
    import_path2.default.join(__dirname, "..", "cli.js")
  ];
  for (const filePath of filesToCheck) {
    if (import_fs2.default.existsSync(filePath)) {
      try {
        const stats = import_fs2.default.statSync(filePath);
        if (!(stats.mode & parseInt("200", 8))) {
          import_fs2.default.chmodSync(filePath, stats.mode | parseInt("200", 8));
          console.log(colorText(`✓ Removed read-only attribute from ${import_path2.default.basename(filePath)}`, "green"));
        }
        import_fs2.default.accessSync(filePath, import_fs2.default.constants.R_OK);
        console.log(colorText(`✓ Verified file accessibility for ${import_path2.default.basename(filePath)}`, "green"));
      } catch (err) {
        console.warn(colorText(`⚠️ Unable to verify file permissions for ${import_path2.default.basename(filePath)}: ${err.message}`, "yellow"));
      }
    } else {
      console.warn(colorText(`⚠️ File not found: ${filePath}`, "yellow"));
    }
  }
}
async function tryRegisterNativeHost() {
  try {
    console.log(colorText("Attempting to register Chrome Native Messaging host...", "blue"));
    await ensureExecutionPermissions2();
    if (isRunningElevated()) {
      console.log(colorText(`
⚠️  WARNING: Running with elevated privileges (sudo/root)`, "yellow"));
      console.log(colorText("   User-level registration will be written to root's home directory,", "yellow"));
      console.log(colorText("   which may not work correctly for your normal user account.", "yellow"));
      console.log(colorText(`
   Please run the following command as your normal user after installation:`, "blue"));
      console.log(`   ${COMMAND_NAME} register`);
      console.log(colorText(`
   Or if you need system-level installation, use:`, "blue"));
      console.log(`   sudo ${COMMAND_NAME} register --system`);
      return;
    }
    if (isGlobalInstall) {
      const userLevelSuccess = await tryRegisterUserLevelHost();
      if (!userLevelSuccess) {
        console.log(colorText("User-level installation failed, system-level installation may be needed", "yellow"));
        console.log(colorText("Please run the following command for system-level installation:", "blue"));
        console.log(`  ${COMMAND_NAME} register --system`);
        printManualInstructions();
      }
    } else {
      console.log(colorText("Local installation detected, skipping automatic registration", "yellow"));
      printManualInstructions();
    }
  } catch (error) {
    console.log(colorText(`注册过程中出现错误: ${error instanceof Error ? error.message : String(error)}`, "red"));
    printManualInstructions();
  }
}
function printManualInstructions() {
  console.log(`
` + colorText("===== Manual Registration Guide =====", "blue"));
  console.log(colorText("1. Try user-level installation (recommended):", "yellow"));
  if (isGlobalInstall) {
    console.log(`  ${COMMAND_NAME} register`);
  } else {
    console.log(`  npx ${COMMAND_NAME} register`);
  }
  console.log(colorText(`
2. If user-level installation fails, try system-level installation:`, "yellow"));
  console.log(colorText("   Use --system parameter (requires admin privileges):", "yellow"));
  if (isGlobalInstall) {
    console.log(`  ${COMMAND_NAME} register --system`);
  } else {
    console.log(`  npx ${COMMAND_NAME} register --system`);
  }
  console.log(colorText(`
   Or use administrator privileges directly:`, "yellow"));
  if (import_os2.default.platform() === "win32") {
    console.log(colorText("   Please run Command Prompt or PowerShell as administrator and execute:", "yellow"));
    if (isGlobalInstall) {
      console.log(`  ${COMMAND_NAME} register`);
    } else {
      console.log(`  npx ${COMMAND_NAME} register`);
    }
  } else {
    console.log(colorText("   Please run the following command in terminal:", "yellow"));
    if (isGlobalInstall) {
      console.log(`  sudo ${COMMAND_NAME} register`);
    } else {
      console.log(`  sudo npx ${COMMAND_NAME} register`);
    }
  }
  console.log(`
` + colorText("Ensure Chrome extension is installed and refresh the extension to connect to local service.", "blue"));
}
async function main() {
  console.log(colorText(`Installing ${COMMAND_NAME}...`, "green"));
  console.log(colorText("Installation environment debug info:", "blue"));
  console.log(`  __dirname: ${__dirname}`);
  console.log(`  npm_config_global: ${process.env.npm_config_global}`);
  console.log(`  PNPM_HOME: ${process.env.PNPM_HOME}`);
  console.log(`  npm_config_prefix: ${process.env.npm_config_prefix}`);
  console.log(`  isGlobalInstall: ${isGlobalInstall}`);
  await ensureExecutionPermissions2();
  writeNodePathFile(import_path2.default.join(__dirname, ".."));
  if (isGlobalInstall) {
    await tryRegisterNativeHost();
  } else {
    console.log(colorText("Local installation detected", "yellow"));
    printManualInstructions();
  }
}
if (isDirectRun) {
  main().catch((error) => {
    console.error(colorText(`Installation script error: ${error instanceof Error ? error.message : String(error)}`, "red"));
    process.exitCode = 1;
  });
}

//# debugId=C179911678A6A63664756E2164756E21
