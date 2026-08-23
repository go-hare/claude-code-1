// In its own file to avoid circular dependencies.
// FileReadTool/prompt.ts imports pdfUtils → model.js, which loops back through
// compact/query; a module-init Set of FILE_READ_TOOL_NAME from prompt.ts hits
// "Cannot access before initialization".
export const FILE_READ_TOOL_NAME = 'Read'
