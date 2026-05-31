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

// src/server/index.ts
var import_hono = require("hono");
var import_cors = require("hono/cors");
var import_node_server = require("@hono/node-server");

// src/constant/index.ts
var NATIVE_SERVER_PORT = 12306;
var TIMEOUTS = {
  DEFAULT_REQUEST_TIMEOUT: 15000,
  EXTENSION_REQUEST_TIMEOUT: 20000,
  PROCESS_DATA_TIMEOUT: 20000
};
var SERVER_CONFIG = {
  HOST: "127.0.0.1",
  CORS_ORIGIN: [/^chrome-extension:\/\//, /^moz-extension:\/\//, "http://127.0.0.1"],
  LOGGER_ENABLED: false
};
var ERROR_MESSAGES = {
  NATIVE_HOST_NOT_AVAILABLE: "Native host connection not established.",
  SERVER_NOT_RUNNING: "Server is not actively running.",
  REQUEST_TIMEOUT: "Request to extension timed out.",
  INVALID_MCP_REQUEST: "Invalid MCP request or session.",
  INVALID_SESSION_ID: "Invalid or missing MCP session ID.",
  INTERNAL_SERVER_ERROR: "Internal Server Error",
  MCP_SESSION_DELETION_ERROR: "Internal server error during MCP session deletion.",
  MCP_REQUEST_PROCESSING_ERROR: "Internal server error during MCP request processing.",
  INVALID_SSE_SESSION: "Invalid or missing MCP session ID for SSE."
};

// src/server/index.ts
var import_sse = require("@modelcontextprotocol/sdk/server/sse.js");
var import_streamableHttp = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
var import_node_crypto2 = require("node:crypto");
var import_types2 = require("@modelcontextprotocol/sdk/types.js");

// src/mcp/mcp-server.ts
var import_server = require("@modelcontextprotocol/sdk/server/index.js");

// src/mcp/register-tools.ts
var import_types = require("@modelcontextprotocol/sdk/types.js");

// src/native-messaging-host.ts
var import_process = require("process");
var import_node_crypto = require("node:crypto");

// ../../node_modules/.pnpm/chrome-mcp-shared@1.0.2/node_modules/chrome-mcp-shared/dist/index.mjs
var NativeMessageType = /* @__PURE__ */ ((NativeMessageType2) => {
  NativeMessageType2["START"] = "start";
  NativeMessageType2["STARTED"] = "started";
  NativeMessageType2["STOP"] = "stop";
  NativeMessageType2["STOPPED"] = "stopped";
  NativeMessageType2["PING"] = "ping";
  NativeMessageType2["PONG"] = "pong";
  NativeMessageType2["ERROR"] = "error";
  NativeMessageType2["PROCESS_DATA"] = "process_data";
  NativeMessageType2["PROCESS_DATA_RESPONSE"] = "process_data_response";
  NativeMessageType2["CALL_TOOL"] = "call_tool";
  NativeMessageType2["CALL_TOOL_RESPONSE"] = "call_tool_response";
  NativeMessageType2["SERVER_STARTED"] = "server_started";
  NativeMessageType2["SERVER_STOPPED"] = "server_stopped";
  NativeMessageType2["ERROR_FROM_NATIVE_HOST"] = "error_from_native_host";
  NativeMessageType2["CONNECT_NATIVE"] = "connectNative";
  NativeMessageType2["ENSURE_NATIVE"] = "ensure_native";
  NativeMessageType2["PING_NATIVE"] = "ping_native";
  NativeMessageType2["DISCONNECT_NATIVE"] = "disconnect_native";
  return NativeMessageType2;
})(NativeMessageType || {});
var TOOL_NAMES = {
  BROWSER: {
    GET_WINDOWS_AND_TABS: "get_windows_and_tabs",
    SEARCH_TABS_CONTENT: "search_tabs_content",
    NAVIGATE: "chrome_navigate",
    SCREENSHOT: "chrome_screenshot",
    CLOSE_TABS: "chrome_close_tabs",
    SWITCH_TAB: "chrome_switch_tab",
    WEB_FETCHER: "chrome_get_web_content",
    CLICK: "chrome_click_element",
    FILL: "chrome_fill_or_select",
    REQUEST_ELEMENT_SELECTION: "chrome_request_element_selection",
    GET_INTERACTIVE_ELEMENTS: "chrome_get_interactive_elements",
    NETWORK_CAPTURE: "chrome_network_capture",
    NETWORK_CAPTURE_START: "chrome_network_capture_start",
    NETWORK_CAPTURE_STOP: "chrome_network_capture_stop",
    NETWORK_REQUEST: "chrome_network_request",
    NETWORK_DEBUGGER_START: "chrome_network_debugger_start",
    NETWORK_DEBUGGER_STOP: "chrome_network_debugger_stop",
    KEYBOARD: "chrome_keyboard",
    HISTORY: "chrome_history",
    BOOKMARK_SEARCH: "chrome_bookmark_search",
    BOOKMARK_ADD: "chrome_bookmark_add",
    BOOKMARK_DELETE: "chrome_bookmark_delete",
    INJECT_SCRIPT: "chrome_inject_script",
    SEND_COMMAND_TO_INJECT_SCRIPT: "chrome_send_command_to_inject_script",
    JAVASCRIPT: "chrome_javascript",
    CONSOLE: "chrome_console",
    FILE_UPLOAD: "chrome_upload_file",
    READ_PAGE: "chrome_read_page",
    COMPUTER: "chrome_computer",
    HANDLE_DIALOG: "chrome_handle_dialog",
    HANDLE_DOWNLOAD: "chrome_handle_download",
    USERSCRIPT: "chrome_userscript",
    PERFORMANCE_START_TRACE: "performance_start_trace",
    PERFORMANCE_STOP_TRACE: "performance_stop_trace",
    PERFORMANCE_ANALYZE_INSIGHT: "performance_analyze_insight",
    GIF_RECORDER: "chrome_gif_recorder"
  },
  RECORD_REPLAY: {
    FLOW_RUN: "record_replay_flow_run",
    LIST_PUBLISHED: "record_replay_list_published"
  }
};
var TOOL_SCHEMAS = [
  {
    name: TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS,
    description: "Get all currently open browser windows and tabs",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: TOOL_NAMES.BROWSER.PERFORMANCE_START_TRACE,
    description: "Starts a performance trace recording on the selected page. Optionally reloads the page and/or auto-stops after a short duration.",
    inputSchema: {
      type: "object",
      properties: {
        reload: {
          type: "boolean",
          description: "Determines if, once tracing has started, the page should be automatically reloaded (ignore cache)."
        },
        autoStop: {
          type: "boolean",
          description: "Determines if the trace should be automatically stopped (default false)."
        },
        durationMs: {
          type: "number",
          description: "Auto-stop duration in milliseconds when autoStop is true (default 5000)."
        }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.BROWSER.PERFORMANCE_STOP_TRACE,
    description: "Stops the active performance trace recording on the selected page.",
    inputSchema: {
      type: "object",
      properties: {
        saveToDownloads: {
          type: "boolean",
          description: "Whether to save the trace as a JSON file in Downloads (default true)."
        },
        filenamePrefix: {
          type: "string",
          description: "Optional filename prefix for the downloaded trace JSON."
        }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.BROWSER.PERFORMANCE_ANALYZE_INSIGHT,
    description: "Provides a lightweight summary of the last recorded trace. For deep insights (CWV, breakdowns), integrate native-side DevTools trace engine.",
    inputSchema: {
      type: "object",
      properties: {
        insightName: {
          type: "string",
          description: 'Optional insight name for future deep analysis (e.g., "DocumentLatency"). Currently informational only.'
        },
        timeoutMs: {
          type: "number",
          description: "Timeout for deep analysis via native host (milliseconds). Default 60000. Increase for large traces."
        }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.BROWSER.READ_PAGE,
    description: `Get an accessibility tree representation of visible elements on the page. Only returns elements that are visible in the viewport. Optionally filter for only interactive elements.
Tip: If the returned elements do not include the specific element you need, use the computer tool's screenshot (action="screenshot") to capture the element's on-screen coordinates, then operate by coordinates.`,
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description: 'Filter elements: "interactive" for such as  buttons/links/inputs only (default: all visible elements)'
        },
        depth: {
          type: "number",
          description: "Maximum DOM depth to traverse (integer >= 0). Lower values reduce output size and can improve performance."
        },
        refId: {
          type: "string",
          description: 'Focus on the subtree rooted at this element refId (e.g., "ref_12"). The refId must come from a recent chrome_read_page response in the same tab (refs may expire).'
        },
        tabId: {
          type: "number",
          description: "Target an existing tab by ID (default: active tab)."
        },
        windowId: {
          type: "number",
          description: "Target window ID to pick active tab when tabId is omitted."
        }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.BROWSER.COMPUTER,
    description: `Use a mouse and keyboard to interact with a web browser, and take screenshots.
* Whenever you intend to click on an element like an icon, you should consult a read_page to determine the ref of the element before moving the cursor.
* If you tried clicking on a program or link but it failed to load, even after waiting, try screenshot and then adjusting your click location so that the tip of the cursor visually falls on the element that you want to click.
* Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element. Don't click boxes on their edges unless asked.`,
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Target tab ID (default: active tab)" },
        background: {
          type: "boolean",
          description: "Avoid focusing/activating tab/window for certain operations (best-effort). Default: false"
        },
        action: {
          type: "string",
          description: "Action to perform: left_click | right_click | double_click | triple_click | left_click_drag | scroll | scroll_to | type | key | fill | fill_form | hover | wait | resize_page | zoom | screenshot"
        },
        ref: {
          type: "string",
          description: "Element ref from chrome_read_page. For click/scroll/scroll_to/key/type and drag end when provided; takes precedence over coordinates."
        },
        coordinates: {
          type: "object",
          properties: {
            x: { type: "number", description: "X coordinate" },
            y: { type: "number", description: "Y coordinate" }
          },
          description: "Coordinates for actions (in screenshot space if a recent screenshot was taken, otherwise viewport). Required for click/scroll and as end point for drag."
        },
        startCoordinates: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" }
          },
          description: "Starting coordinates for drag action"
        },
        startRef: {
          type: "string",
          description: "Drag start ref from chrome_read_page (alternative to startCoordinates)."
        },
        scrollDirection: {
          type: "string",
          description: "Scroll direction: up | down | left | right"
        },
        scrollAmount: {
          type: "number",
          description: "Scroll ticks (1-10), default 3"
        },
        text: {
          type: "string",
          description: 'Text to type (for action=type) or keys/chords separated by space (for action=key, e.g. "Backspace Enter" or "cmd+a")'
        },
        repeat: {
          type: "number",
          description: "For action=key: number of times to repeat the key sequence (integer 1-100, default 1)."
        },
        modifiers: {
          type: "object",
          description: "Modifier keys for click actions (left_click/right_click/double_click/triple_click).",
          properties: {
            altKey: { type: "boolean" },
            ctrlKey: { type: "boolean" },
            metaKey: { type: "boolean" },
            shiftKey: { type: "boolean" }
          }
        },
        region: {
          type: "object",
          description: "For action=zoom: rectangular region to capture (x0,y0)-(x1,y1) in viewport pixels (or screenshot-space if a recent screenshot context exists).",
          properties: {
            x0: { type: "number" },
            y0: { type: "number" },
            x1: { type: "number" },
            y1: { type: "number" }
          },
          required: ["x0", "y0", "x1", "y1"]
        },
        selector: {
          type: "string",
          description: "CSS selector for fill (alternative to ref)."
        },
        value: {
          oneOf: [{ type: "string" }, { type: "boolean" }, { type: "number" }],
          description: "Value to set for action=fill (string | boolean | number)"
        },
        elements: {
          type: "array",
          description: "For action=fill_form: list of elements to fill (ref + value)",
          items: {
            type: "object",
            properties: {
              ref: { type: "string", description: "Element ref from chrome_read_page" },
              value: { type: "string", description: "Value to set (stringified if non-string)" }
            },
            required: ["ref", "value"]
          }
        },
        width: { type: "number", description: "For action=resize_page: viewport width" },
        height: { type: "number", description: "For action=resize_page: viewport height" },
        appear: {
          type: "boolean",
          description: "For action=wait with text: whether to wait for the text to appear (true, default) or disappear (false)"
        },
        timeout: {
          type: "number",
          description: "For action=wait with text: timeout in milliseconds (default 10000, max 120000)"
        },
        duration: {
          type: "number",
          description: "Seconds to wait for action=wait (max 30s)"
        }
      },
      required: ["action"]
    }
  },
  {
    name: TOOL_NAMES.BROWSER.NAVIGATE,
    description: "Navigate to a URL, refresh the current tab, or navigate browser history (back/forward)",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: 'URL to navigate to. Special values: "back" or "forward" to navigate browser history in the target tab.'
        },
        newWindow: {
          type: "boolean",
          description: "Create a new window to navigate to the URL or not. Defaults to false"
        },
        tabId: {
          type: "number",
          description: "Target an existing tab by ID (if provided, navigate/refresh/back/forward that tab instead of the active tab)."
        },
        windowId: {
          type: "number",
          description: "Target an existing window by ID (when creating a new tab in existing window, or picking active tab if tabId is not provided)."
        },
        background: {
          type: "boolean",
          description: "Perform the operation without stealing focus (do not activate the tab or focus the window). Default: false"
        },
        width: {
          type: "number",
          description: "Window width in pixels (default: 1280). When width or height is provided, a new window will be created."
        },
        height: {
          type: "number",
          description: "Window height in pixels (default: 720). When width or height is provided, a new window will be created."
        },
        refresh: {
          type: "boolean",
          description: "Refresh the current active tab instead of navigating to a URL. When true, the url parameter is ignored. Defaults to false"
        }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.BROWSER.SCREENSHOT,
    description: '[Prefer read_page over taking a screenshot and Prefer chrome_computer] Take a screenshot of the current page or a specific element. For new usage, use chrome_computer with action="screenshot". Use this tool if you need advanced options.',
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for the screenshot, if saving as PNG" },
        selector: { type: "string", description: "CSS selector for element to screenshot" },
        tabId: {
          type: "number",
          description: "Target tab ID to capture from (default: active tab)."
        },
        windowId: {
          type: "number",
          description: "Target window ID to pick active tab from when tabId is not provided."
        },
        background: {
          type: "boolean",
          description: "Attempt capture without bringing tab/window to foreground. CDP-based capture is used for simple viewport captures. For element/full-page capture, the tab may still be made active in its window without focusing the window. Default: false"
        },
        width: { type: "number", description: "Width in pixels (default: 800)" },
        height: { type: "number", description: "Height in pixels (default: 600)" },
        storeBase64: {
          type: "boolean",
          description: "return screenshot in base64 format (default: false) if you want to see the page, recommend set this to be true"
        },
        fullPage: {
          type: "boolean",
          description: "Store screenshot of the entire page (default: true)"
        },
        savePng: {
          type: "boolean",
          description: "Save screenshot as PNG file (default: true)，if you want to see the page, recommend set this to be false, and set storeBase64 to be true"
        }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.BROWSER.CLOSE_TABS,
    description: "Close one or more browser tabs",
    inputSchema: {
      type: "object",
      properties: {
        tabIds: {
          type: "array",
          items: { type: "number" },
          description: "Array of tab IDs to close. If not provided, will close the active tab."
        },
        url: {
          type: "string",
          description: "Close tabs matching this URL. Can be used instead of tabIds."
        }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.BROWSER.SWITCH_TAB,
    description: "Switch to a specific browser tab",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "The ID of the tab to switch to."
        },
        windowId: {
          type: "number",
          description: "The ID of the window where the tab is located."
        }
      },
      required: ["tabId"]
    }
  },
  {
    name: TOOL_NAMES.BROWSER.WEB_FETCHER,
    description: "Fetch content from a web page",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to fetch content from. If not provided, uses the current active tab"
        },
        tabId: {
          type: "number",
          description: "Target an existing tab by ID (default: active tab)."
        },
        background: {
          type: "boolean",
          description: "Do not activate tab/focus window while fetching (default: false)"
        },
        htmlContent: {
          type: "boolean",
          description: "Get the visible HTML content of the page. If true, textContent will be ignored (default: false)"
        },
        textContent: {
          type: "boolean",
          description: "Get the visible text content of the page with metadata. Ignored if htmlContent is true (default: true)"
        },
        selector: {
          type: "string",
          description: "CSS selector to get content from a specific element. If provided, only content from this element will be returned"
        }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.BROWSER.NETWORK_REQUEST,
    description: "Send a network request from the browser with cookies and other browser context",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to send the request to"
        },
        method: {
          type: "string",
          description: "HTTP method to use (default: GET)"
        },
        headers: {
          type: "object",
          description: "Headers to include in the request"
        },
        body: {
          type: "string",
          description: "Body of the request (for POST, PUT, etc.)"
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000)"
        },
        formData: {
          type: "object",
          description: "Multipart/form-data descriptor. If provided, overrides body and builds FormData with optional file attachments. Shape: { fields?: Record<string,string|number|boolean>, files?: Array<{ name: string, fileUrl?: string, filePath?: string, base64Data?: string, filename?: string, contentType?: string }> }. Also supports a compact array form: [ [name, fileSpec, filename?], ... ] where fileSpec may be url:, file:, or base64:."
        }
      },
      required: ["url"]
    }
  },
  {
    name: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
    description: 'Unified network capture tool. Use action="start" to begin capturing, action="stop" to end and retrieve results. Set needResponseBody=true to capture response bodies (uses Debugger API, may conflict with DevTools). Default mode uses webRequest API (lightweight, no debugger conflict, but no response body).',
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "stop"],
          description: 'Action to perform: "start" begins capture, "stop" ends and returns results'
        },
        needResponseBody: {
          type: "boolean",
          description: "When true, captures response body using Debugger API (default: false). Only use when you need to inspect response content."
        },
        url: {
          type: "string",
          description: 'URL to capture network requests from. For action="start". If not provided, uses the current active tab.'
        },
        maxCaptureTime: {
          type: "number",
          description: "Maximum capture time in milliseconds (default: 180000)"
        },
        inactivityTimeout: {
          type: "number",
          description: "Stop after inactivity in milliseconds (default: 60000). Set 0 to disable."
        },
        includeStatic: {
          type: "boolean",
          description: "Include static resources like images/scripts/styles (default: false)"
        }
      },
      required: ["action"]
    }
  },
  {
    name: TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD,
    description: "Wait for a browser download and return details (id, filename, url, state, size)",
    inputSchema: {
      type: "object",
      properties: {
        filenameContains: { type: "string", description: "Filter by substring in filename or URL" },
        timeoutMs: { type: "number", description: "Timeout in ms (default 60000, max 300000)" },
        waitForComplete: { type: "boolean", description: "Wait until completed (default true)" }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.BROWSER.HISTORY,
    description: "Retrieve and search browsing history from Chrome",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to search for in history URLs and titles. Leave empty to retrieve all history entries within the time range."
        },
        startTime: {
          type: "string",
          description: 'Start time as a date string. Supports ISO format (e.g., "2023-10-01", "2023-10-01T14:30:00"), relative times (e.g., "1 day ago", "2 weeks ago", "3 months ago", "1 year ago"), and special keywords ("now", "today", "yesterday"). Default: 24 hours ago'
        },
        endTime: {
          type: "string",
          description: 'End time as a date string. Supports ISO format (e.g., "2023-10-31", "2023-10-31T14:30:00"), relative times (e.g., "1 day ago", "2 weeks ago", "3 months ago", "1 year ago"), and special keywords ("now", "today", "yesterday"). Default: current time'
        },
        maxResults: {
          type: "number",
          description: "Maximum number of history entries to return. Use this to limit results for performance or to focus on the most relevant entries. (default: 100)"
        },
        excludeCurrentTabs: {
          type: "boolean",
          description: "When set to true, filters out URLs that are currently open in any browser tab. Useful for finding pages you've visited but don't have open anymore. (default: false)"
        }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.BROWSER.BOOKMARK_SEARCH,
    description: "Search Chrome bookmarks by title and URL",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to match against bookmark titles and URLs. Leave empty to retrieve all bookmarks."
        },
        maxResults: {
          type: "number",
          description: "Maximum number of bookmarks to return (default: 50)"
        },
        folderPath: {
          type: "string",
          description: 'Optional folder path or ID to limit search to a specific bookmark folder. Can be a path string (e.g., "Work/Projects") or a folder ID.'
        }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.BROWSER.BOOKMARK_ADD,
    description: "Add a new bookmark to Chrome",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to bookmark. If not provided, uses the current active tab URL."
        },
        title: {
          type: "string",
          description: "Title for the bookmark. If not provided, uses the page title from the URL."
        },
        parentId: {
          type: "string",
          description: 'Parent folder path or ID to add the bookmark to. Can be a path string (e.g., "Work/Projects") or a folder ID. If not provided, adds to the "Bookmarks Bar" folder.'
        },
        createFolder: {
          type: "boolean",
          description: "Whether to create the parent folder if it does not exist (default: false)"
        }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.BROWSER.BOOKMARK_DELETE,
    description: "Delete a bookmark from Chrome",
    inputSchema: {
      type: "object",
      properties: {
        bookmarkId: {
          type: "string",
          description: "ID of the bookmark to delete. Either bookmarkId or url must be provided."
        },
        url: {
          type: "string",
          description: "URL of the bookmark to delete. Used if bookmarkId is not provided."
        },
        title: {
          type: "string",
          description: "Title of the bookmark to help with matching when deleting by URL."
        }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.BROWSER.JAVASCRIPT,
    description: "Execute JavaScript code in a browser tab and return the result. Uses CDP Runtime.evaluate with awaitPromise and returnByValue; automatically falls back to chrome.scripting.executeScript if the debugger is busy. Output is sanitized (sensitive data redacted) and truncated by default.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: 'JavaScript code to execute. Runs inside an async function body, so top-level await and "return ..." are supported.'
        },
        tabId: {
          type: "number",
          description: "Target tab ID. If omitted, uses the current active tab."
        },
        timeoutMs: {
          type: "number",
          description: "Execution timeout in milliseconds (default: 15000)."
        },
        maxOutputBytes: {
          type: "number",
          description: "Maximum output size in bytes after sanitization (default: 51200). Output exceeding this limit will be truncated."
        }
      },
      required: ["code"]
    }
  },
  {
    name: TOOL_NAMES.BROWSER.CLICK,
    description: "Click on an element in a web page. Supports multiple targeting methods: CSS selector, XPath, element ref (from chrome_read_page), or viewport coordinates. More focused than chrome_computer for simple click operations.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector or XPath for the element to click."
        },
        selectorType: {
          type: "string",
          enum: ["css", "xpath"],
          description: 'Type of selector (default: "css").'
        },
        ref: {
          type: "string",
          description: "Element ref from chrome_read_page (takes precedence over selector)."
        },
        coordinates: {
          type: "object",
          description: "Viewport coordinates to click at.",
          properties: {
            x: { type: "number" },
            y: { type: "number" }
          },
          required: ["x", "y"]
        },
        double: {
          type: "boolean",
          description: "Perform double click when true (default: false)."
        },
        button: {
          type: "string",
          enum: ["left", "right", "middle"],
          description: 'Mouse button to click (default: "left").'
        },
        modifiers: {
          type: "object",
          description: "Modifier keys to hold during click.",
          properties: {
            altKey: { type: "boolean" },
            ctrlKey: { type: "boolean" },
            metaKey: { type: "boolean" },
            shiftKey: { type: "boolean" }
          }
        },
        waitForNavigation: {
          type: "boolean",
          description: "Wait for navigation to complete after click (default: false)."
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds for waiting (default: 5000)."
        },
        tabId: {
          type: "number",
          description: "Target tab ID. If omitted, uses the current active tab."
        },
        windowId: {
          type: "number",
          description: "Window ID to select active tab from (when tabId is omitted)."
        },
        frameId: {
          type: "number",
          description: "Target frame ID for iframe support."
        }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.BROWSER.FILL,
    description: "Fill or select a form element on a web page. Supports input, textarea, select, checkbox, and radio elements. Use CSS selector, XPath, or element ref to target the element.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector or XPath for the form element."
        },
        selectorType: {
          type: "string",
          enum: ["css", "xpath"],
          description: 'Type of selector (default: "css").'
        },
        ref: {
          type: "string",
          description: "Element ref from chrome_read_page (takes precedence over selector)."
        },
        value: {
          type: ["string", "number", "boolean"],
          description: "Value to fill. For text inputs: string. For checkboxes/radios: boolean. For selects: option value or text."
        },
        tabId: {
          type: "number",
          description: "Target tab ID. If omitted, uses the current active tab."
        },
        windowId: {
          type: "number",
          description: "Window ID to select active tab from (when tabId is omitted)."
        },
        frameId: {
          type: "number",
          description: "Target frame ID for iframe support."
        }
      },
      required: ["value"]
    }
  },
  {
    name: TOOL_NAMES.BROWSER.REQUEST_ELEMENT_SELECTION,
    description: "Request the user to manually select one or more elements on the current page. Use this as a human-in-the-loop fallback when you cannot reliably locate the target element after approximately 3 attempts using chrome_read_page combined with chrome_click_element/chrome_fill_or_select/chrome_computer. The user will see a panel with instructions and can click on the requested elements. Returns element refs compatible with chrome_click_element/chrome_fill_or_select (including iframe frameId for cross-frame support).",
    inputSchema: {
      type: "object",
      properties: {
        requests: {
          type: "array",
          description: "A list of element selection requests. Each request produces exactly one picked element. The user will see these requests in a panel and select each element by clicking on the page.",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: 'Optional stable request id for correlation. If omitted, an id is auto-generated (e.g., "req_1").'
              },
              name: {
                type: "string",
                description: 'Short label shown to the user describing what element to select (e.g., "Login button", "Email input field").'
              },
              description: {
                type: "string",
                description: 'Optional longer instruction shown to the user with more context (e.g., "Click on the primary login button in the top-right corner").'
              }
            },
            required: ["name"]
          }
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds for the user to complete all selections. Default: 180000 (3 minutes). Maximum: 600000 (10 minutes)."
        },
        tabId: {
          type: "number",
          description: "Target tab ID. If omitted, uses the current active tab."
        },
        windowId: {
          type: "number",
          description: "Window ID to select active tab from (when tabId is omitted)."
        }
      },
      required: ["requests"]
    }
  },
  {
    name: TOOL_NAMES.BROWSER.KEYBOARD,
    description: "Simulate keyboard input on a web page. Supports single keys (Enter, Tab, Escape), key combinations (Ctrl+C, Ctrl+V), and text input. Can target a specific element or send to the focused element.",
    inputSchema: {
      type: "object",
      properties: {
        keys: {
          type: "string",
          description: 'Keys or key combinations to simulate. Examples: "Enter", "Tab", "Ctrl+C", "Shift+Tab", "Hello World".'
        },
        selector: {
          type: "string",
          description: "CSS selector or XPath for target element to receive keyboard events."
        },
        selectorType: {
          type: "string",
          enum: ["css", "xpath"],
          description: 'Type of selector (default: "css").'
        },
        delay: {
          type: "number",
          description: "Delay between keystrokes in milliseconds (default: 50)."
        },
        tabId: {
          type: "number",
          description: "Target tab ID. If omitted, uses the current active tab."
        },
        windowId: {
          type: "number",
          description: "Window ID to select active tab from (when tabId is omitted)."
        },
        frameId: {
          type: "number",
          description: "Target frame ID for iframe support."
        }
      },
      required: ["keys"]
    }
  },
  {
    name: TOOL_NAMES.BROWSER.CONSOLE,
    description: "Capture console output from a browser tab. Supports snapshot mode (default; one-time capture with ~2s wait) and buffer mode (persistent per-tab buffer you can read/clear instantly without waiting).",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to navigate to and capture console from. If not provided, uses the current active tab"
        },
        tabId: {
          type: "number",
          description: "Target an existing tab by ID (default: active tab)."
        },
        windowId: {
          type: "number",
          description: "Target window ID to pick active tab when tabId is omitted."
        },
        background: {
          type: "boolean",
          description: "Do not activate tab/focus window when capturing via CDP. Default: false"
        },
        includeExceptions: {
          type: "boolean",
          description: "Include uncaught exceptions in the output (default: true)"
        },
        maxMessages: {
          type: "number",
          description: "Maximum number of console messages to capture in snapshot mode (default: 100). If limit is provided, it takes precedence."
        },
        mode: {
          type: "string",
          enum: ["snapshot", "buffer"],
          description: "Console capture mode: snapshot (default; waits ~2s for messages) or buffer (persistent per-tab buffer; reads from memory instantly)."
        },
        buffer: {
          type: "boolean",
          description: 'Alias for mode="buffer" (default: false).'
        },
        clear: {
          type: "boolean",
          description: "Buffer mode only: clear the buffered logs for this tab before reading (default: false). Use clearAfterRead instead to clear after reading (mcp-tools.js style)."
        },
        clearAfterRead: {
          type: "boolean",
          description: "Buffer mode only: clear the buffered logs for this tab AFTER reading, to avoid duplicate messages on subsequent calls (default: false). This matches mcp-tools.js behavior."
        },
        pattern: {
          type: "string",
          description: "Optional regex filter applied to message/exception text. Supports /pattern/flags syntax."
        },
        onlyErrors: {
          type: "boolean",
          description: "Only return error-level console messages (and exceptions when includeExceptions=true). Default: false."
        },
        limit: {
          type: "number",
          description: "Limit returned console messages. In snapshot mode this is an alias for maxMessages; in buffer mode it limits returned messages from the buffer."
        }
      },
      required: []
    }
  },
  {
    name: TOOL_NAMES.BROWSER.FILE_UPLOAD,
    description: "Upload files to web forms with file input elements using Chrome DevTools Protocol",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Target tab ID (default: active tab)" },
        windowId: {
          type: "number",
          description: "Target window ID to pick active tab when tabId is omitted"
        },
        selector: {
          type: "string",
          description: 'CSS selector for the file input element (input[type="file"])'
        },
        filePath: {
          type: "string",
          description: "Local file path to upload"
        },
        fileUrl: {
          type: "string",
          description: "URL to download file from before uploading"
        },
        base64Data: {
          type: "string",
          description: "Base64 encoded file data to upload"
        },
        fileName: {
          type: "string",
          description: 'Optional filename when using base64 or URL (default: "uploaded-file")'
        },
        multiple: {
          type: "boolean",
          description: "Whether the input accepts multiple files (default: false)"
        }
      },
      required: ["selector"]
    }
  },
  {
    name: TOOL_NAMES.BROWSER.HANDLE_DIALOG,
    description: "Handle JavaScript dialogs (alert/confirm/prompt) via CDP",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "accept | dismiss" },
        promptText: {
          type: "string",
          description: "Optional prompt text when accepting a prompt"
        }
      },
      required: ["action"]
    }
  },
  {
    name: TOOL_NAMES.BROWSER.GIF_RECORDER,
    description: `Record browser tab activity as an animated GIF.

Modes:
- Fixed FPS mode (action="start"): Captures frames at regular intervals. Good for animations/videos.
- Auto-capture mode (action="auto_start"): Captures frames automatically when chrome_computer or chrome_navigate actions succeed. Better for interaction recordings with natural pacing.

Use "stop" to end recording and save the GIF.`,
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "stop", "status", "auto_start", "capture", "clear", "export"],
          description: `Action to perform:
- "start": Begin fixed-FPS recording (captures frames at regular intervals)
- "auto_start": Begin auto-capture mode (frames captured on tool actions)
- "stop": End recording and save GIF
- "status": Get current recording state
- "capture": Manually trigger a frame capture in auto mode
- "clear": Clear all recording state and cached GIF without saving
- "export": Export the last recorded GIF (download or drag&drop upload)`
        },
        tabId: {
          type: "number",
          description: 'Target tab ID (default: active tab). Used with "start"/"auto_start" for recording, and with "export" (download=false) for drag&drop upload target.'
        },
        fps: {
          type: "number",
          description: "Frames per second for fixed-FPS mode (1-30, default: 5). Higher values = smoother but larger file."
        },
        durationMs: {
          type: "number",
          description: "Maximum recording duration in milliseconds (default: 5000, max: 60000). Only for fixed-FPS mode."
        },
        maxFrames: {
          type: "number",
          description: "Maximum number of frames to capture (default: 50 for fixed-FPS, 100 for auto mode, max: 300)."
        },
        width: {
          type: "number",
          description: "Output GIF width in pixels (default: 800, max: 1920)."
        },
        height: {
          type: "number",
          description: "Output GIF height in pixels (default: 600, max: 1080)."
        },
        maxColors: {
          type: "number",
          description: "Maximum colors in palette (default: 256). Lower values = smaller file size."
        },
        filename: {
          type: "string",
          description: "Output filename (without extension). Defaults to timestamped name."
        },
        captureDelayMs: {
          type: "number",
          description: "Auto-capture mode only: Delay in ms after action before capturing frame (default: 150). Allows UI to stabilize."
        },
        frameDelayCs: {
          type: "number",
          description: "Auto-capture mode only: Display duration per frame in centiseconds (default: 20 = 200ms per frame)."
        },
        annotation: {
          type: "string",
          description: 'Auto-capture mode only (action="capture"): Optional text label to render on the captured frame.'
        },
        download: {
          type: "boolean",
          description: "Export action only: Set to true (default) to download the GIF, or false to upload via drag&drop."
        },
        coordinates: {
          type: "object",
          description: "Export action only (when download=false): Target coordinates for drag&drop upload.",
          properties: {
            x: { type: "number" },
            y: { type: "number" }
          },
          required: ["x", "y"]
        },
        ref: {
          type: "string",
          description: "Export action only (when download=false): Element ref from chrome_read_page for drag&drop target."
        },
        selector: {
          type: "string",
          description: "Export action only (when download=false): CSS selector for drag&drop target element."
        },
        enhancedRendering: {
          type: "object",
          description: "Auto-capture mode only: Configure visual overlays for recorded actions (click indicators, drag paths, labels). Pass `true` to enable all defaults.",
          properties: {
            clickIndicators: {
              oneOf: [
                { type: "boolean" },
                {
                  type: "object",
                  properties: {
                    enabled: {
                      type: "boolean",
                      description: "Enable click indicators (default: true)"
                    },
                    color: {
                      type: "string",
                      description: 'CSS color for click indicator (default: "rgba(255, 87, 34, 0.8)")'
                    },
                    radius: { type: "number", description: "Initial radius in px (default: 20)" },
                    animationDurationMs: {
                      type: "number",
                      description: "Animation duration in ms (default: 400)"
                    },
                    animationFrames: {
                      type: "number",
                      description: "Number of animation frames (default: 3)"
                    },
                    animationIntervalMs: {
                      type: "number",
                      description: "Interval between animation frames in ms (default: 80)"
                    }
                  }
                }
              ],
              description: "Click indicator overlay config (true for defaults, or object for custom)."
            },
            dragPaths: {
              oneOf: [
                { type: "boolean" },
                {
                  type: "object",
                  properties: {
                    enabled: {
                      type: "boolean",
                      description: "Enable drag path rendering (default: true)"
                    },
                    color: {
                      type: "string",
                      description: 'CSS color for drag path (default: "rgba(33, 150, 243, 0.7)")'
                    },
                    lineWidth: { type: "number", description: "Line width in px (default: 3)" },
                    lineDash: {
                      type: "array",
                      items: { type: "number" },
                      description: "Dash pattern (default: [6, 4])"
                    },
                    arrowSize: {
                      type: "number",
                      description: "Arrow head size in px (default: 10)"
                    }
                  }
                }
              ],
              description: "Drag path overlay config (true for defaults, or object for custom)."
            },
            labels: {
              oneOf: [
                { type: "boolean" },
                {
                  type: "object",
                  properties: {
                    enabled: {
                      type: "boolean",
                      description: "Enable action labels (default: true)"
                    },
                    font: {
                      type: "string",
                      description: 'Font for labels (default: "bold 12px sans-serif")'
                    },
                    textColor: { type: "string", description: 'Text color (default: "#fff")' },
                    bgColor: {
                      type: "string",
                      description: 'Background color (default: "rgba(0,0,0,0.7)")'
                    },
                    padding: { type: "number", description: "Padding in px (default: 4)" },
                    borderRadius: {
                      type: "number",
                      description: "Border radius in px (default: 4)"
                    },
                    offset: {
                      type: "object",
                      properties: { x: { type: "number" }, y: { type: "number" } },
                      description: "Offset from action position (default: {x: 10, y: -20})"
                    }
                  }
                }
              ],
              description: "Action label overlay config (true for defaults, or object for custom)."
            },
            durationMs: {
              type: "number",
              description: "How long overlays remain visible in ms (default: 1500)."
            }
          }
        }
      },
      required: ["action"]
    }
  }
];

// src/file-handler.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var os = __toESM(require("os"));
var crypto = __toESM(require("crypto"));

class FileHandler {
  tempDir;
  constructor() {
    this.tempDir = path.join(os.tmpdir(), "chrome-mcp-uploads");
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }
  async handleFileRequest(request) {
    const { action, fileUrl, base64Data, fileName, filePath } = request;
    try {
      switch (action) {
        case "prepareFile":
          if (fileUrl) {
            return await this.downloadFile(fileUrl, fileName);
          } else if (base64Data) {
            return await this.saveBase64File(base64Data, fileName);
          } else if (filePath) {
            return await this.verifyFile(filePath);
          }
          break;
        case "readBase64File": {
          if (!filePath)
            return { success: false, error: "filePath is required" };
          return await this.readBase64File(filePath);
        }
        case "cleanupFile":
          return await this.cleanupFile(filePath);
        default:
          return {
            success: false,
            error: `Unknown file action: ${action}`
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  async downloadFile(fileUrl, fileName) {
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }
      const finalFileName = fileName || this.generateFileName(fileUrl);
      const filePath = path.join(this.tempDir, finalFileName);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(filePath, buffer);
      return {
        success: true,
        filePath,
        fileName: finalFileName,
        size: buffer.length
      };
    } catch (error) {
      throw new Error(`Failed to download file from URL: ${error}`);
    }
  }
  async saveBase64File(base64Data, fileName) {
    try {
      const base64Content = base64Data.replace(/^data:.*?;base64,/, "");
      const buffer = Buffer.from(base64Content, "base64");
      const finalFileName = fileName || `upload-${Date.now()}.bin`;
      const filePath = path.join(this.tempDir, finalFileName);
      fs.writeFileSync(filePath, buffer);
      return {
        success: true,
        filePath,
        fileName: finalFileName,
        size: buffer.length
      };
    } catch (error) {
      throw new Error(`Failed to save base64 file: ${error}`);
    }
  }
  async verifyFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File does not exist: ${filePath}`);
      }
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        throw new Error(`Path is not a file: ${filePath}`);
      }
      fs.accessSync(filePath, fs.constants.R_OK);
      return {
        success: true,
        filePath,
        fileName: path.basename(filePath),
        size: stats.size
      };
    } catch (error) {
      throw new Error(`Failed to verify file: ${error}`);
    }
  }
  async readBase64File(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File does not exist: ${filePath}`);
      }
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        throw new Error(`Path is not a file: ${filePath}`);
      }
      const buf = fs.readFileSync(filePath);
      const base64 = buf.toString("base64");
      return {
        success: true,
        filePath,
        fileName: path.basename(filePath),
        size: stats.size,
        base64Data: base64
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  async cleanupFile(filePath) {
    try {
      if (!filePath.startsWith(this.tempDir)) {
        return {
          success: false,
          error: "Can only cleanup files in temp directory"
        };
      }
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return {
        success: true,
        message: "File cleaned up successfully"
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to cleanup file: ${error}`
      };
    }
  }
  generateFileName(url) {
    if (url) {
      try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const basename2 = path.basename(pathname);
        if (basename2 && basename2 !== "/") {
          const ext = path.extname(basename2);
          const name = path.basename(basename2, ext);
          const randomSuffix = crypto.randomBytes(4).toString("hex");
          return `${name}-${randomSuffix}${ext}`;
        }
      } catch {}
    }
    return `upload-${crypto.randomBytes(8).toString("hex")}.bin`;
  }
  cleanupOldFiles() {
    try {
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      const files = fs.readdirSync(this.tempDir);
      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > oneHour) {
          fs.unlinkSync(filePath);
          console.error(`Cleaned up old temp file: ${file}`);
        }
      }
    } catch (error) {
      console.error("Error cleaning up old files:", error);
    }
  }
}
var file_handler_default = new FileHandler;

// src/native-messaging-host.ts
class NativeMessagingHost {
  associatedServer = null;
  pendingRequests = new Map;
  setServer(serverInstance) {
    this.associatedServer = serverInstance;
  }
  start() {
    try {
      this.setupMessageHandling();
    } catch (error) {
      process.exit(1);
    }
  }
  setupMessageHandling() {
    let buffer = Buffer.alloc(0);
    let expectedLength = -1;
    const MAX_MESSAGES_PER_TICK = 100;
    const MAX_MESSAGE_SIZE_BYTES = 16 * 1024 * 1024;
    const processAvailable = () => {
      let processed = 0;
      while (processed < MAX_MESSAGES_PER_TICK) {
        if (expectedLength === -1) {
          if (buffer.length < 4)
            break;
          expectedLength = buffer.readUInt32LE(0);
          buffer = buffer.slice(4);
          if (expectedLength <= 0 || expectedLength > MAX_MESSAGE_SIZE_BYTES) {
            this.sendError(`Invalid message length: ${expectedLength}`);
            expectedLength = -1;
            buffer = Buffer.alloc(0);
            break;
          }
        }
        if (buffer.length < expectedLength)
          break;
        const messageBuffer = buffer.slice(0, expectedLength);
        buffer = buffer.slice(expectedLength);
        expectedLength = -1;
        processed++;
        try {
          const message = JSON.parse(messageBuffer.toString());
          this.handleMessage(message);
        } catch (error) {
          this.sendError(`Failed to parse message: ${error.message}`);
        }
      }
      if (processed === MAX_MESSAGES_PER_TICK) {
        setImmediate(processAvailable);
      }
    };
    import_process.stdin.on("readable", () => {
      let chunk;
      while ((chunk = import_process.stdin.read()) !== null) {
        buffer = Buffer.concat([buffer, chunk]);
        processAvailable();
      }
    });
    import_process.stdin.on("end", () => {
      this.cleanup();
    });
    import_process.stdin.on("error", () => {
      this.cleanup();
    });
  }
  async handleMessage(message) {
    if (!message || typeof message !== "object") {
      this.sendError("Invalid message format");
      return;
    }
    if (message.responseToRequestId) {
      const requestId = message.responseToRequestId;
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeoutId);
        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message.payload);
        }
        this.pendingRequests.delete(requestId);
      } else {}
      return;
    }
    try {
      switch (message.type) {
        case NativeMessageType.START:
          await this.startServer(message.payload?.port || NATIVE_SERVER_PORT);
          break;
        case NativeMessageType.STOP:
          await this.stopServer();
          break;
        case "ping_from_extension":
          this.sendMessage({ type: "pong_to_extension" });
          break;
        case "file_operation":
          await this.handleFileOperation(message);
          break;
        default:
          if (!message.responseToRequestId) {
            this.sendError(`Unknown message type or non-response message: ${message.type || "no type"}`);
          }
      }
    } catch (error) {
      this.sendError(`Failed to handle directive message: ${error.message}`);
    }
  }
  async handleFileOperation(message) {
    try {
      const result = await file_handler_default.handleFileRequest(message.payload);
      if (message.requestId) {
        this.sendMessage({
          type: "file_operation_response",
          responseToRequestId: message.requestId,
          payload: result
        });
      } else {
        this.sendMessage({
          type: "file_operation_result",
          payload: result
        });
      }
    } catch (error) {
      const errorResponse = {
        success: false,
        error: error.message || "Unknown error during file operation"
      };
      if (message.requestId) {
        this.sendMessage({
          type: "file_operation_response",
          responseToRequestId: message.requestId,
          error: errorResponse.error
        });
      } else {
        this.sendError(`File operation failed: ${errorResponse.error}`);
      }
    }
  }
  sendRequestToExtensionAndWait(messagePayload, messageType = "request_data", timeoutMs = TIMEOUTS.DEFAULT_REQUEST_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const requestId = import_node_crypto.randomUUID();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, { resolve, reject, timeoutId });
      this.sendMessage({
        type: messageType,
        payload: messagePayload,
        requestId
      });
    });
  }
  async startServer(port) {
    if (!this.associatedServer) {
      this.sendError("Internal error: server instance not set");
      return;
    }
    try {
      if (this.associatedServer.isRunning) {
        this.sendMessage({
          type: NativeMessageType.ERROR,
          payload: { message: "Server is already running" }
        });
        return;
      }
      await this.associatedServer.start(port, this);
      this.sendMessage({
        type: NativeMessageType.SERVER_STARTED,
        payload: { port }
      });
    } catch (error) {
      this.sendError(`Failed to start server: ${error.message}`);
    }
  }
  async stopServer() {
    if (!this.associatedServer) {
      this.sendError("Internal error: server instance not set");
      return;
    }
    try {
      if (!this.associatedServer.isRunning) {
        this.sendMessage({
          type: NativeMessageType.ERROR,
          payload: { message: "Server is not running" }
        });
        return;
      }
      await this.associatedServer.stop();
      this.sendMessage({ type: NativeMessageType.SERVER_STOPPED });
    } catch (error) {
      this.sendError(`Failed to stop server: ${error.message}`);
    }
  }
  sendMessage(message) {
    try {
      const messageString = JSON.stringify(message);
      const messageBuffer = Buffer.from(messageString);
      const headerBuffer = Buffer.alloc(4);
      headerBuffer.writeUInt32LE(messageBuffer.length, 0);
      import_process.stdout.write(Buffer.concat([headerBuffer, messageBuffer]), (err) => {
        if (err) {} else {}
      });
    } catch (error) {}
  }
  sendError(errorMessage) {
    this.sendMessage({
      type: NativeMessageType.ERROR_FROM_NATIVE_HOST,
      payload: { message: errorMessage }
    });
  }
  cleanup() {
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Native host is shutting down or Chrome disconnected."));
    });
    this.pendingRequests.clear();
    if (this.associatedServer && this.associatedServer.isRunning) {
      this.associatedServer.stop().then(() => {
        process.exit(0);
      }).catch(() => {
        process.exit(1);
      });
    } else {
      process.exit(0);
    }
  }
}
var nativeMessagingHostInstance = new NativeMessagingHost;
var native_messaging_host_default = nativeMessagingHostInstance;

// src/mcp/register-tools.ts
async function listDynamicFlowTools() {
  try {
    const response = await native_messaging_host_default.sendRequestToExtensionAndWait({}, "rr_list_published_flows", 20000);
    if (response && response.status === "success" && Array.isArray(response.items)) {
      const tools = [];
      for (const item of response.items) {
        const name = `flow.${item.slug}`;
        const description = item.meta && item.meta.tool && item.meta.tool.description || item.description || "Recorded flow";
        const properties = {};
        const required = [];
        for (const v of item.variables || []) {
          const desc = v.label || v.key;
          const typ = (v.type || "string").toLowerCase();
          const prop = { description: desc };
          if (typ === "boolean")
            prop.type = "boolean";
          else if (typ === "number")
            prop.type = "number";
          else if (typ === "enum") {
            prop.type = "string";
            if (v.rules && Array.isArray(v.rules.enum))
              prop.enum = v.rules.enum;
          } else if (typ === "array") {
            prop.type = "array";
            prop.items = { type: "string" };
          } else {
            prop.type = "string";
          }
          if (v.default !== undefined)
            prop.default = v.default;
          if (v.rules && v.rules.required)
            required.push(v.key);
          properties[v.key] = prop;
        }
        properties["tabTarget"] = { type: "string", enum: ["current", "new"], default: "current" };
        properties["refresh"] = { type: "boolean", default: false };
        properties["captureNetwork"] = { type: "boolean", default: false };
        properties["returnLogs"] = { type: "boolean", default: false };
        properties["timeoutMs"] = { type: "number", minimum: 0 };
        const tool = {
          name,
          description,
          inputSchema: { type: "object", properties, required }
        };
        tools.push(tool);
      }
      return tools;
    }
    return [];
  } catch (e) {
    return [];
  }
}
var setupTools = (server) => {
  server.setRequestHandler(import_types.ListToolsRequestSchema, async () => {
    const dynamicTools = await listDynamicFlowTools();
    return { tools: [...TOOL_SCHEMAS, ...dynamicTools] };
  });
  server.setRequestHandler(import_types.CallToolRequestSchema, async (request) => handleToolCall(request.params.name, request.params.arguments || {}));
};
var handleToolCall = async (name, args) => {
  try {
    if (name && name.startsWith("flow.")) {
      try {
        const resp = await native_messaging_host_default.sendRequestToExtensionAndWait({}, "rr_list_published_flows", 20000);
        const items = resp && resp.items || [];
        const slug = name.slice("flow.".length);
        const match = items.find((it) => it.slug === slug);
        if (!match)
          throw new Error(`Flow not found for tool ${name}`);
        const flowArgs = { flowId: match.id, args };
        const proxyRes = await native_messaging_host_default.sendRequestToExtensionAndWait({ name: "record_replay_flow_run", args: flowArgs }, NativeMessageType.CALL_TOOL, 120000);
        if (proxyRes.status === "success")
          return proxyRes.data;
        return {
          content: [{ type: "text", text: `Error calling dynamic flow tool: ${proxyRes.error}` }],
          isError: true
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error resolving dynamic flow tool: ${err?.message || String(err)}`
            }
          ],
          isError: true
        };
      }
    }
    const response = await native_messaging_host_default.sendRequestToExtensionAndWait({
      name,
      args
    }, NativeMessageType.CALL_TOOL, 120000);
    if (response.status === "success") {
      return response.data;
    } else {
      return {
        content: [
          {
            type: "text",
            text: `Error calling tool: ${response.error}`
          }
        ],
        isError: true
      };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error calling tool: ${error.message}`
        }
      ],
      isError: true
    };
  }
};

// src/mcp/mcp-server.ts
var createMcpServer = () => {
  const mcpServer = new import_server.Server({
    name: "ChromeMcpServer",
    version: "1.0.0"
  }, {
    capabilities: {
      tools: {}
    }
  });
  setupTools(mcpServer);
  return mcpServer;
};

// src/server/index.ts
class Server2 {
  app;
  httpServer = null;
  isRunning = false;
  nativeHost = null;
  transportsMap = new Map;
  mcpServersMap = new Map;
  constructor() {
    this.app = new import_hono.Hono;
    this.setupRoutes();
  }
  setNativeHost(nativeHost) {
    this.nativeHost = nativeHost;
  }
  setupRoutes() {
    this.app.use("*", import_cors.cors({
      origin: (origin) => {
        if (!origin)
          return "*";
        const allowed = SERVER_CONFIG.CORS_ORIGIN.some((pattern) => pattern instanceof RegExp ? pattern.test(origin) : origin.startsWith(pattern));
        return allowed ? origin : "";
      },
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      credentials: true
    }));
    this.setupHealthRoutes();
    this.setupExtensionRoutes();
    this.setupMcpRoutes();
  }
  setupHealthRoutes() {
    this.app.get("/ping", (c) => c.json({ status: "ok", message: "pong" }));
  }
  setupExtensionRoutes() {
    this.app.get("/ask-extension", async (c) => {
      if (!this.nativeHost) {
        return c.json({ error: ERROR_MESSAGES.NATIVE_HOST_NOT_AVAILABLE }, 500);
      }
      if (!this.isRunning) {
        return c.json({ error: ERROR_MESSAGES.SERVER_NOT_RUNNING }, 500);
      }
      try {
        const query = c.req.query();
        const extensionResponse = await this.nativeHost.sendRequestToExtensionAndWait(query, "process_data", TIMEOUTS.EXTENSION_REQUEST_TIMEOUT);
        return c.json({ status: "success", data: extensionResponse });
      } catch (error) {
        const err = error;
        if (err.message.includes("timed out")) {
          return c.json({ status: "error", message: ERROR_MESSAGES.REQUEST_TIMEOUT }, 504);
        } else {
          return c.json({ status: "error", message: `Failed to get response from extension: ${err.message}` }, 500);
        }
      }
    });
  }
  setupMcpRoutes() {
    this.app.get("/sse", async (c) => {
      const { incoming, outgoing } = c.env;
      outgoing.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      const transport = new import_sse.SSEServerTransport("/messages", outgoing);
      this.transportsMap.set(transport.sessionId, transport);
      const mcpServer = createMcpServer();
      this.mcpServersMap.set(transport.sessionId, mcpServer);
      outgoing.on("close", () => {
        this.transportsMap.delete(transport.sessionId);
        this.mcpServersMap.delete(transport.sessionId);
        mcpServer.close().catch(() => {});
      });
      await mcpServer.connect(transport);
      outgoing.write(`:

`);
      return new Response(null);
    });
    this.app.post("/messages", async (c) => {
      const sessionId = c.req.query("sessionId");
      const transport = this.transportsMap.get(sessionId || "");
      if (!sessionId || !transport) {
        return c.text("No transport found for sessionId", 400);
      }
      const body = await c.req.json();
      const { incoming, outgoing } = c.env;
      await transport.handlePostMessage(incoming, outgoing, body);
      return new Response(null);
    });
    this.app.post("/mcp", async (c) => {
      const sessionId = c.req.header("mcp-session-id");
      let transport = this.transportsMap.get(sessionId || "");
      if (transport) {} else if (!sessionId) {
        const body = await c.req.json();
        if (import_types2.isInitializeRequest(body)) {
          const newSessionId = import_node_crypto2.randomUUID();
          transport = new import_streamableHttp.StreamableHTTPServerTransport({
            sessionIdGenerator: () => newSessionId,
            onsessioninitialized: (initializedSessionId) => {
              if (transport && initializedSessionId === newSessionId) {
                this.transportsMap.set(initializedSessionId, transport);
              }
            }
          });
          const mcpServer = createMcpServer();
          transport.onclose = () => {
            if (transport?.sessionId) {
              this.transportsMap.delete(transport.sessionId);
              this.mcpServersMap.delete(transport.sessionId);
            }
          };
          this.mcpServersMap.set(newSessionId, mcpServer);
          await mcpServer.connect(transport);
        } else {
          return c.json({ error: ERROR_MESSAGES.INVALID_MCP_REQUEST }, 400);
        }
      } else {
        return c.json({ error: ERROR_MESSAGES.INVALID_MCP_REQUEST }, 400);
      }
      try {
        const body = await c.req.json().catch(() => {
          return;
        });
        const { incoming, outgoing } = c.env;
        await transport.handleRequest(incoming, outgoing, body);
        return new Response(null);
      } catch (error) {
        return c.json({ error: ERROR_MESSAGES.MCP_REQUEST_PROCESSING_ERROR }, 500);
      }
    });
    this.app.get("/mcp", async (c) => {
      const sessionId = c.req.header("mcp-session-id");
      const transport = sessionId ? this.transportsMap.get(sessionId) : undefined;
      if (!transport) {
        return c.json({ error: ERROR_MESSAGES.INVALID_SSE_SESSION }, 400);
      }
      const { incoming, outgoing } = c.env;
      outgoing.setHeader("Content-Type", "text/event-stream");
      outgoing.setHeader("Cache-Control", "no-cache");
      outgoing.setHeader("Connection", "keep-alive");
      outgoing.flushHeaders();
      try {
        await transport.handleRequest(incoming, outgoing);
      } catch (error) {
        if (!outgoing.writableEnded) {
          outgoing.end();
        }
      }
      incoming.socket?.on("close", () => {});
      return new Response(null);
    });
    this.app.delete("/mcp", async (c) => {
      const sessionId = c.req.header("mcp-session-id");
      const transport = sessionId ? this.transportsMap.get(sessionId) : undefined;
      if (!transport) {
        return c.json({ error: ERROR_MESSAGES.INVALID_SESSION_ID }, 400);
      }
      try {
        const { incoming, outgoing } = c.env;
        await transport.handleRequest(incoming, outgoing);
        return new Response(null, { status: 204 });
      } catch (error) {
        return c.json({ error: ERROR_MESSAGES.MCP_SESSION_DELETION_ERROR }, 500);
      }
    });
  }
  async start(port = NATIVE_SERVER_PORT, nativeHost) {
    if (!this.nativeHost) {
      this.nativeHost = nativeHost;
    } else if (this.nativeHost !== nativeHost) {
      this.nativeHost = nativeHost;
    }
    if (this.isRunning) {
      return;
    }
    return new Promise((resolve, reject) => {
      const srv = import_node_server.serve({
        fetch: this.app.fetch,
        port,
        hostname: SERVER_CONFIG.HOST
      }, () => {
        process.env.CHROME_MCP_PORT = String(port);
        process.env.MCP_HTTP_PORT = String(port);
        this.isRunning = true;
        resolve();
      });
      this.httpServer = srv;
      this.httpServer?.on("error", (err) => {
        this.isRunning = false;
        reject(err);
      });
    });
  }
  async stop() {
    if (!this.isRunning) {
      return;
    }
    return new Promise((resolve, reject) => {
      if (!this.httpServer) {
        this.isRunning = false;
        resolve();
        return;
      }
      this.httpServer.close((err) => {
        this.httpServer = null;
        this.isRunning = false;
        if (err)
          reject(err);
        else
          resolve();
      });
    });
  }
  getInstance() {
    return this.app;
  }
}
var serverInstance = new Server2;
var server_default = serverInstance;

// src/index.ts
native_messaging_host_default.setServer(server_default);
try {
  native_messaging_host_default.start();
} catch (error) {
  process.exit(1);
}
process.on("error", (error) => {
  process.exit(1);
});
process.on("SIGINT", () => {
  process.exit(0);
});
process.on("SIGTERM", () => {
  process.exit(0);
});
process.on("exit", (_code) => {});
process.on("uncaughtException", (_error) => {
  process.exit(1);
});
process.on("unhandledRejection", (_reason) => {});

//# debugId=9D10913EF822C6EC64756E2164756E21
