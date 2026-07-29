/**
 * Multi-browser tools handled in CLI (toolCalls.ts) — never inside browser_batch
 * and never as extension tool_request. Always ListTools-visible (native sockets
 * or copper bridge). Name kept for densable parity / batch rejection.
 */
export const BRIDGE_ONLY_BROWSER_TOOL_NAMES = [
  'switch_browser',
  'list_connected_browsers',
  'select_browser',
] as const

export const BRIDGE_ONLY_BROWSER_TOOLS = new Set<string>(
  BRIDGE_ONLY_BROWSER_TOOL_NAMES,
)

export const BROWSER_TOOLS = [
  {
    name: 'javascript_tool',
    description:
      "Execute JavaScript code in the context of the current page. The code runs in the page's context and can interact with the DOM, window object, and page variables. Returns the result of the last expression or any thrown errors. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: "Must be set to 'javascript_exec'",
        },
        text: {
          type: 'string',
          description:
            "The JavaScript code to execute. The code will be evaluated in the page context. The result of the last expression will be returned automatically. Do NOT use 'return' statements - just write the expression you want to evaluate (e.g., 'window.myData.value' not 'return window.myData.value'). You can access and modify the DOM, call page functions, and interact with page variables.",
        },
        tabId: {
          type: 'number',
          description:
            "Tab ID to execute the code in. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID.",
        },
      },
      required: ['action', 'text', 'tabId'],
    },
  },
  {
    name: 'read_page',
    description:
      "Get an accessibility tree representation of elements on the page. By default returns all elements including non-visible ones. Output is limited to 50000 characters by default. If the output exceeds this limit, you will receive an error asking you to specify a smaller depth or focus on a specific element using ref_id. Optionally filter for only interactive elements. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs.",
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: ['interactive', 'all'],
          description:
            'Filter elements: "interactive" for buttons/links/inputs only, "all" for all elements including non-visible ones (default: all elements)',
        },
        tabId: {
          type: 'number',
          description:
            "Tab ID to read from. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID.",
        },
        depth: {
          type: 'number',
          description:
            'Maximum depth of the tree to traverse (default: 15). Use a smaller depth if output is too large.',
        },
        ref_id: {
          type: 'string',
          description:
            'Reference ID of a parent element to read. Will return the specified element and all its children. Use this to focus on a specific part of the page when output is too large.',
        },
        max_chars: {
          type: 'number',
          description:
            'Maximum characters for output (default: 50000). Set to a higher value if your client can handle large outputs.',
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'find',
    description:
      'Find elements on the page using natural language. Can search for elements by their purpose (e.g., "search bar", "login button") or by text content (e.g., "organic mango product"). Returns up to 20 matching elements with references that can be used with other tools. If more than 20 matches exist, you\'ll be notified to use a more specific query. If you don\'t have a valid tab ID, use tabs_context_mcp first to get available tabs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Natural language description of what to find (e.g., "search bar", "add to cart button", "product title containing organic")',
        },
        tabId: {
          type: 'number',
          description:
            "Tab ID to search in. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID.",
        },
      },
      required: ['query', 'tabId'],
    },
  },
  {
    name: 'form_input',
    description:
      "Set values in form elements using element reference ID from the read_page tool. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs.",
    inputSchema: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description:
            'Element reference ID from the read_page tool (e.g., "ref_1", "ref_2")',
        },
        value: {
          type: ['string', 'boolean', 'number'],
          description:
            'The value to set. For checkboxes use boolean, for selects use option value or text, for other inputs use appropriate string/number',
        },
        tabId: {
          type: 'number',
          description:
            "Tab ID to set form value in. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID.",
        },
      },
      required: ['ref', 'value', 'tabId'],
    },
  },
  {
    name: 'browser_batch',
    description:
      "Execute a sequence of browser tool calls in ONE round trip. Each item is {name, input} where input is exactly what you'd pass to that tool standalone. Actions execute SEQUENTIALLY (not in parallel) and stop on the first error. Use this tool extensively to quickly execute work whenever you can predict two or more steps ahead — e.g. navigate, click a field, type, press Return, screenshot. Each tool's own permission check runs per item — if an action navigates to a domain without permission, the next item's check fails and the batch stops. Screenshots and other images are returned interleaved with outputs; coordinates you write in THIS batch refer to the screenshot taken BEFORE this call. browser_batch cannot be nested.",
    inputSchema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description:
                  'Tool name (e.g. computer, navigate, find, tabs_create_mcp). browser_batch cannot be nested.',
              },
              input: {
                type: 'object',
                description:
                  "That tool's input — same shape you'd pass when calling it directly.",
              },
            },
            required: ['name', 'input'],
          },
          description:
            'List of tool calls to execute sequentially. Example: [{"name":"computer","input":{"action":"left_click","coordinate":[100,200],"tabId":123}},{"name":"computer","input":{"action":"type","text":"hello","tabId":123}},{"name":"navigate","input":{"url":"https://example.com","tabId":123}}]',
        },
      },
      required: ['actions'],
    },
  },
  {
    name: 'computer',
    description: `Use a mouse and keyboard to interact with a web browser, and take screenshots. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs.\n* Whenever you intend to click on an element like an icon, you should consult a screenshot to determine the coordinates of the element before moving the cursor.\n* If you tried clicking on a program or link but it failed to load, even after waiting, try adjusting your click location so that the tip of the cursor visually falls on the element that you want to click.\n* Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element. Don't click boxes on their edges unless asked.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'left_click',
            'right_click',
            'type',
            'screenshot',
            'wait',
            'scroll',
            'key',
            'left_click_drag',
            'double_click',
            'triple_click',
            'zoom',
            'scroll_to',
            'hover',
          ],
          description:
            'The action to perform:\n* `left_click`: Click the left mouse button at the specified coordinates.\n* `right_click`: Click the right mouse button at the specified coordinates to open context menus.\n* `double_click`: Double-click the left mouse button at the specified coordinates.\n* `triple_click`: Triple-click the left mouse button at the specified coordinates.\n* `type`: Type a string of text.\n* `screenshot`: Take a screenshot of the screen.\n* `wait`: Wait for a specified number of seconds.\n* `scroll`: Scroll up, down, left, or right at the specified coordinates.\n* `key`: Press a specific keyboard key.\n* `left_click_drag`: Drag from start_coordinate to coordinate.\n* `zoom`: Take a screenshot of a specific region for closer inspection.\n* `scroll_to`: Scroll an element into view using its element reference ID from read_page or find tools.\n* `hover`: Move the mouse cursor to the specified coordinates or element without clicking. Useful for revealing tooltips, dropdown menus, or triggering hover states.',
        },
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          minItems: 2,
          maxItems: 2,
          description:
            '(x, y): The x (pixels from the left edge) and y (pixels from the top edge) coordinates. Required for `left_click`, `right_click`, `double_click`, `triple_click`, and `scroll`. For `left_click_drag`, this is the end position.',
        },
        text: {
          type: 'string',
          description:
            'The text to type (for `type` action) or the key(s) to press (for `key` action). For `key` action: Provide space-separated keys (e.g., "Backspace Backspace Delete"). Supports keyboard shortcuts using the platform\'s modifier key (use "cmd" on Mac, "ctrl" on Windows/Linux, e.g., "cmd+a" or "ctrl+a" for select all).',
        },
        duration: {
          type: 'number',
          minimum: 0,
          maximum: 30,
          description:
            'The number of seconds to wait. Required for `wait`. Maximum 30 seconds.',
        },
        scroll_direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'The direction to scroll. Required for `scroll`.',
        },
        scroll_amount: {
          type: 'number',
          minimum: 1,
          maximum: 10,
          description:
            'The number of scroll wheel ticks. Optional for `scroll`, defaults to 3.',
        },
        start_coordinate: {
          type: 'array',
          items: { type: 'number' },
          minItems: 2,
          maxItems: 2,
          description:
            '(x, y): The starting coordinates for `left_click_drag`.',
        },
        region: {
          type: 'array',
          items: { type: 'number' },
          minItems: 4,
          maxItems: 4,
          description:
            '(x0, y0, x1, y1): The rectangular region to capture for `zoom`. Coordinates define a rectangle from top-left (x0, y0) to bottom-right (x1, y1) in pixels from the viewport origin. Required for `zoom` action. Useful for inspecting small UI elements like icons, buttons, or text.',
        },
        repeat: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          description:
            'Number of times to repeat the key sequence. Only applicable for `key` action. Must be a positive integer between 1 and 100. Default is 1. Useful for navigation tasks like pressing arrow keys multiple times.',
        },
        ref: {
          type: 'string',
          description:
            'Element reference ID from read_page or find tools (e.g., "ref_1", "ref_2"). Required for `scroll_to` action. Can be used as alternative to `coordinate` for click actions.',
        },
        modifiers: {
          type: 'string',
          description:
            'Modifier keys for click actions. Supports: "ctrl", "shift", "alt", "cmd" (or "meta"), "win" (or "windows"). Can be combined with "+" (e.g., "ctrl+shift", "cmd+alt"). Optional.',
        },
        tabId: {
          type: 'number',
          description:
            "Tab ID to execute the action on. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID.",
        },
      },
      required: ['action', 'tabId'],
    },
  },
  {
    name: 'navigate',
    description:
      "Navigate to a URL, or go forward/back in browser history. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs.",
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'The URL to navigate to. Can be provided with or without protocol (defaults to https://). Use "forward" to go forward in history or "back" to go back in history.',
        },
        tabId: {
          type: 'number',
          description:
            "Tab ID to navigate. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID.",
        },
      },
      required: ['url', 'tabId'],
    },
  },
  {
    name: 'resize_window',
    description:
      "Resize the current browser window to specified dimensions. Useful for testing responsive designs or setting up specific screen sizes. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs.",
    inputSchema: {
      type: 'object',
      properties: {
        width: {
          type: 'number',
          description: 'Target window width in pixels',
        },
        height: {
          type: 'number',
          description: 'Target window height in pixels',
        },
        tabId: {
          type: 'number',
          description:
            "Tab ID to get the window for. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID.",
        },
      },
      required: ['width', 'height', 'tabId'],
    },
  },
  {
    name: 'gif_creator',
    description:
      "Manage GIF recording and export for browser automation sessions. Control when to start/stop recording browser actions (clicks, scrolls, navigation), then export as an animated GIF with visual overlays (click indicators, action labels, progress bar, watermark). All operations are scoped to the tab's group. When starting recording, take a screenshot immediately after to capture the initial state as the first frame. When stopping recording, take a screenshot immediately before to capture the final state as the last frame. For export, either provide 'coordinate' to drag/drop upload to a page element, or set 'download: true' to download the GIF.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start_recording', 'stop_recording', 'export', 'clear'],
          description:
            "Action to perform: 'start_recording' (begin capturing), 'stop_recording' (stop capturing but keep frames), 'export' (generate and export GIF), 'clear' (discard frames)",
        },
        tabId: {
          type: 'number',
          description:
            'Tab ID to identify which tab group this operation applies to',
        },
        download: {
          type: 'boolean',
          description:
            "Always set this to true for the 'export' action only. This causes the gif to be downloaded in the browser.",
        },
        filename: {
          type: 'string',
          description:
            "Optional filename for exported GIF (default: 'recording-[timestamp].gif'). For 'export' action only.",
        },
        options: {
          type: 'object',
          description:
            "Optional GIF enhancement options for 'export' action. Properties: showClickIndicators (bool), showDragPaths (bool), showActionLabels (bool), showProgressBar (bool), showWatermark (bool), quality (number 1-30). All default to true except quality (default: 10).",
          properties: {
            showClickIndicators: {
              type: 'boolean',
              description:
                'Show orange circles at click locations (default: true)',
            },
            showDragPaths: {
              type: 'boolean',
              description: 'Show red arrows for drag actions (default: true)',
            },
            showActionLabels: {
              type: 'boolean',
              description:
                'Show black labels describing actions (default: true)',
            },
            showProgressBar: {
              type: 'boolean',
              description: 'Show orange progress bar at bottom (default: true)',
            },
            showWatermark: {
              type: 'boolean',
              description: 'Show Claude logo watermark (default: true)',
            },
            quality: {
              type: 'number',
              description:
                'GIF compression quality, 1-30 (lower = better quality, slower encoding). Default: 10',
            },
          },
        },
      },
      required: ['action', 'tabId'],
    },
  },
  {
    name: 'upload_image',
    description:
      'Upload a previously captured screenshot or user-uploaded image to a file input or drag & drop target. Supports two approaches: (1) ref - for targeting specific elements, especially hidden file inputs, (2) coordinate - for drag & drop to visible locations like Google Docs. Provide either ref or coordinate, not both.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description:
            "ID of a previously captured screenshot (from the computer tool's screenshot action) or a user-uploaded image",
        },
        ref: {
          type: 'string',
          description:
            'Element reference ID from read_page or find tools (e.g., "ref_1", "ref_2"). Use this for file inputs (especially hidden ones) or specific elements. Provide either ref or coordinate, not both.',
        },
        coordinate: {
          type: 'array',
          items: {
            type: 'number',
          },
          description:
            'Viewport coordinates [x, y] for drag & drop to a visible location. Use this for drag & drop targets like Google Docs. Provide either ref or coordinate, not both.',
        },
        tabId: {
          type: 'number',
          description:
            'Tab ID where the target element is located. This is where the image will be uploaded to.',
        },
        filename: {
          type: 'string',
          description:
            'Optional filename for the uploaded file (default: "image.png")',
        },
      },
      required: ['imageId', 'tabId'],
    },
  },
  {
    name: 'get_page_text',
    description:
      "Extract raw text content from the page, prioritizing article content. Ideal for reading articles, blog posts, or other text-heavy pages. Returns plain text without HTML formatting. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs.",
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description:
            "Tab ID to extract text from. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID.",
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'tabs_context_mcp',
    title: 'Tabs Context',
    description:
      'Get context information about the current MCP tab group. Returns all tab IDs inside the group if it exists. CRITICAL: Call this first (with createIfEmpty: true, or omit createIfEmpty — Host defaults it to true) before tabs_create_mcp / navigate / computer. Without a group, tabs_create_mcp fails with "No MCP tab group exists". Each new conversation should create its own new tab (using tabs_create_mcp) rather than reusing existing tabs, unless the user explicitly asks to use an existing tab.',
    inputSchema: {
      type: 'object',
      properties: {
        createIfEmpty: {
          type: 'boolean',
          description:
            'Creates a new MCP tab group if none exists (new window + empty tab). If a group already exists, no effect. Omit or true for session start; pass false only to probe without creating.',
        },
      },
      required: [],
    },
  },
  {
    name: 'tabs_create_mcp',
    title: 'Tabs Create',
    description:
      'Creates a new empty tab in the existing MCP tab group. Does NOT create the group itself — if you get "No MCP tab group exists", call tabs_context_mcp with createIfEmpty: true first, then retry. Prefer that bootstrap before any other browser tools.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'tabs_close_mcp',
    title: 'Tabs Close',
    description:
      "Close a tab in the MCP tab group by its ID. Use to clean up tabs you're done with. Only tabs in this session's group are closable; call tabs_context_mcp first to get valid IDs. If you close the group's last tab, Chrome auto-removes the group — the next tabs_context_mcp with createIfEmpty starts fresh.",
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'integer',
          description:
            "The ID of the tab to close. Must be in this session's tab group. Get valid IDs from tabs_context_mcp.",
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'update_plan',
    description:
      'Present a plan to the user for approval before taking actions. The user will see the domains you intend to visit and your approach. Once approved, you can proceed with actions on the approved domains without additional permission prompts.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        domains: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description:
            "List of domains you will visit (e.g., ['github.com', 'stackoverflow.com']). These domains will be approved for the session when the user accepts the plan.",
        },
        approach: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description:
            'High-level description of what you will do. Focus on outcomes and key actions, not implementation details. Be concise - aim for 3-7 items.',
        },
      },
      required: ['domains', 'approach'],
    },
  },
  {
    name: 'read_console_messages',
    description:
      "Read browser console messages (console.log, console.error, console.warn, etc.) from a specific tab. Useful for debugging JavaScript errors, viewing application logs, or understanding what's happening in the browser console. Returns console messages from the current domain only. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs. IMPORTANT: Always provide a pattern to filter messages - without a pattern, you may get too many irrelevant messages.",
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description:
            "Tab ID to read console messages from. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID.",
        },
        onlyErrors: {
          type: 'boolean',
          description:
            'If true, only return error and exception messages. Default is false (return all message types).',
        },
        clear: {
          type: 'boolean',
          description:
            'If true, clear the console messages after reading to avoid duplicates on subsequent calls. Default is false.',
        },
        pattern: {
          type: 'string',
          description:
            "Regex pattern to filter console messages. Only messages matching this pattern will be returned (e.g., 'error|warning' to find errors and warnings, 'MyApp' to filter app-specific logs). You should always provide a pattern to avoid getting too many irrelevant messages.",
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of messages to return. Defaults to 100. Increase only if you need more results.',
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'read_network_requests',
    description:
      "Read HTTP network requests (XHR, Fetch, documents, images, etc.) from a specific tab. Useful for debugging API calls, monitoring network activity, or understanding what requests a page is making. Returns all network requests made by the current page, including cross-origin requests. Requests are automatically cleared when the page navigates to a different domain. If you don't have a valid tab ID, use tabs_context_mcp first to get available tabs.",
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description:
            "Tab ID to read network requests from. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID.",
        },
        urlPattern: {
          type: 'string',
          description:
            "Optional URL pattern to filter requests. Only requests whose URL contains this string will be returned (e.g., '/api/' to filter API calls, 'example.com' to filter by domain).",
        },
        clear: {
          type: 'boolean',
          description:
            'If true, clear the network requests after reading to avoid duplicates on subsequent calls. Default is false.',
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of requests to return. Defaults to 100. Increase only if you need more results.',
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'shortcuts_list',
    description:
      'List all available shortcuts and workflows (shortcuts and workflows are interchangeable). Returns shortcuts with their commands, descriptions, and whether they are workflows. Use shortcuts_execute to run a shortcut or workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description:
            "Tab ID to list shortcuts from. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID.",
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'shortcuts_execute',
    description:
      'Execute a shortcut or workflow by running it in a new sidepanel window using the current tab (shortcuts and workflows are interchangeable). Use shortcuts_list first to see available shortcuts. This starts the execution and returns immediately - it does not wait for completion.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description:
            "Tab ID to execute the shortcut on. Must be a tab in the current group. Use tabs_context_mcp first if you don't have a valid tab ID.",
        },
        shortcutId: {
          type: 'string',
          description: 'The ID of the shortcut to execute',
        },
        command: {
          type: 'string',
          description:
            "The command name of the shortcut to execute (e.g., 'debug', 'summarize'). Do not include the leading slash.",
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'file_upload',
    description:
      'Upload one or multiple files to a file input element on the page. Do not click on file upload buttons or file inputs — clicking opens a native file picker dialog that you cannot see or interact with. Instead, use read_page or find to locate the file input element, then use this tool with its ref to upload files directly. Pass `paths` only (never pre-encoded `files`). When run via Claude Code, the Host enforces densable session allowlist (attachments, /add-dir, project cwd, or bypass-permissions) before the bridge sees contents. Symlinks are resolved; hard-linked files (e.g. many node_modules entries) are rejected — copy the file first. Combined size of all files in a single call must stay under 10 MB.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Absolute paths for Host session-allowlist expansion (attachments, /add-dir, project cwd). Combined size ≤10 MB. Do not pass base64 `files`.',
        },
        ref: {
          type: 'string',
          description:
            'Element reference ID of the file input from read_page or find tools (e.g., "ref_1", "ref_2").',
        },
        tabId: {
          type: 'number',
          description:
            "Tab ID where the file input is located. Use tabs_context_mcp first if you don't have a valid tab ID.",
        },
      },
      required: ['paths', 'ref', 'tabId'],
    },
  },
  {
    name: 'switch_browser',
    description:
      'Switch the active browser for automation. With cloud bridge: broadcasts a pairing request and waits (up to 2 minutes) for the user to click Connect in Chrome. With local native sockets (no OAuth): cycles among connected Chrome profiles/hosts. Prefer select_browser with a known deviceId when you already have a list from list_connected_browsers.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_connected_browsers',
    description:
      'List Chrome browsers currently available for automation. Cloud bridge: account-connected extension instances. Local native (no OAuth): live native-messaging sockets (deviceId is the socket path). Returns deviceId, display name, OS platform, and whether it appears local. Use before select_browser.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'select_browser',
    description:
      'Select a specific Chrome browser by deviceId for browser automation. After list_connected_browsers: cloud bridge routes by peer deviceId; local native pins the preferred socket (no pairing broadcast).',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: {
          type: 'string',
          description: 'The deviceId from list_connected_browsers.',
        },
      },
      required: ['deviceId'],
    },
  },
]
