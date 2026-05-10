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

// src/scripts/register.ts
var import_path2 = __toESM(require("path"));

// src/scripts/constant.ts
var COMMAND_NAME = "mcp-chrome-bridge";
var EXTENSION_ID = "hbdgbgagpkpjffpklnamcljpakneikee";
var HOST_NAME = "com.chromemcp.nativehost";
var DESCRIPTION = "Node.js Host for Browser Bridge Extension";

// src/scripts/utils.ts
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var import_os = __toESM(require("os"));
var import_child_process = require("child_process");
var import_util = require("util");

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
    const output = import_child_process.execSync(`reg query "${registryKey}" /ve`, {
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
          import_child_process.execSync(regCommand, { stdio: "pipe" });
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

// src/scripts/register.ts
var __dirname = require("path").dirname(__filename);
async function main() {
  console.log(colorText(`正在注册 ${COMMAND_NAME} Native Messaging主机...`, "blue"));
  try {
    writeNodePathFile(import_path2.default.join(__dirname, ".."));
    await registerWithElevatedPermissions();
    console.log(colorText("注册成功！现在Chrome扩展可以通过Native Messaging与本地服务通信。", "green"));
  } catch (error) {
    console.error(colorText(`注册失败: ${error.message}`, "red"));
    process.exit(1);
  }
}
main();

//# debugId=E4DB68AC958C6DD164756E2164756E21
