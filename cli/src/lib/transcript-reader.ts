/**
 * Transcript Reader — reads and parses session transcripts from AI coding agents
 *
 * Supports:
 * - Claude Code: ~/.claude/projects/ (JSONL session files)
 * - OpenClaw: ~/.openclaw/transcripts/ or ~/.clawdbot/transcripts/ (JSONL)
 * - Gemini CLI: ~/.gemini/sessions/ (JSONL)
 * - Codex CLI (OpenAI): ~/.codex/sessions/ and ~/.codex/history.jsonl (JSONL)
 * - Aider: .aider.chat.history.md in project dirs (Markdown)
 * - Continue.dev: ~/.continue/sessions/ (JSON)
 * - Cline: VS Code globalStorage/saoudrizwan.claude-dev/tasks/ (JSON)
 * - GitHub Copilot Chat: VS Code globalStorage/github.copilot-chat/ (JSON)
 * - Cursor: ~/Library/Application Support/Cursor/ (SQLite/JSON — best-effort)
 * - Windsurf: ~/Library/Application Support/Windsurf/ (best-effort)
 * - Zed AI: ~/Library/Application Support/Zed/ (best-effort)
 * - Amazon Q Developer CLI: ~/.aws/amazonq/ (best-effort)
 * - Warp AI: ~/Library/Application Support/dev.warp.Warp-Stable/ (best-effort)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { homedir, platform } from "node:os";
import type { ParsedTranscript, TranscriptMessage, TranscriptSource } from "./analyzer-types.js";

// ── Source Directories ─────────────────────────────────────────────────

const isMac = platform() === "darwin";
const home = homedir();
const appSupport = isMac
	? join(home, "Library", "Application Support")
	: join(home, ".config");

// VS Code globalStorage base path
const vscodeGlobalStorage = join(
	appSupport,
	isMac ? "Code" : "Code",
	"User",
	"globalStorage",
);

const TRANSCRIPT_SOURCES: Array<{
	source: TranscriptSource;
	dirs: string[];
	/** File extensions to look for (default: [".jsonl", ".json"]) */
	extensions?: string[];
	/** Max directory traversal depth (default: 3) */
	maxDepth?: number;
}> = [
	{
		source: "claude-code",
		dirs: [join(home, ".claude", "projects")],
	},
	{
		source: "openclaw",
		dirs: [
			join(home, ".openclaw", "transcripts"),
			join(home, ".clawdbot", "transcripts"),
		],
	},
	{
		source: "gemini",
		dirs: [join(home, ".gemini", "sessions")],
	},
	{
		// Codex CLI stores session transcripts as JSONL under ~/.codex/sessions/
		// Also has a combined history.jsonl at ~/.codex/history.jsonl
		source: "codex",
		dirs: [
			join(home, ".codex", "sessions"),
			join(home, ".codex"),
		],
	},
	{
		// Aider stores chat history as markdown in project directories
		// Users typically have .aider.chat.history.md in their project roots
		// We can't scan all projects, so we check common locations
		// TODO: Allow user-configured project dirs to scan for aider histories
		source: "aider",
		dirs: [join(home, ".aider")],
		extensions: [".md"],
		maxDepth: 1,
	},
	{
		// Continue.dev stores session files as JSON under ~/.continue/sessions/
		// Each session is a JSON file with a ChatMessage array
		source: "continue",
		dirs: [
			join(home, ".continue", "sessions"),
			join(home, ".continue", "session-transcripts"),
		],
	},
	{
		// Cline (formerly Claude Dev) stores per-task conversation history as JSON
		// under VS Code's globalStorage: saoudrizwan.claude-dev/tasks/<id>/api_conversation_history.json
		source: "cline",
		dirs: [
			join(vscodeGlobalStorage, "saoudrizwan.claude-dev", "tasks"),
		],
		maxDepth: 2,
	},
	{
		// GitHub Copilot Chat stores conversation data in VS Code globalStorage
		// Format: JSON files with conversation arrays
		source: "copilot-chat",
		dirs: [
			join(vscodeGlobalStorage, "github.copilot-chat"),
		],
	},
	{
		// Cursor stores conversations in its app data directory
		// TODO: Cursor likely uses SQLite (state.vscdb). JSONL/JSON parsing is best-effort.
		// May need a SQLite reader for full support.
		source: "cursor",
		dirs: [
			join(appSupport, "Cursor", "User", "globalStorage"),
			join(home, ".cursor"),
		],
		maxDepth: 4,
	},
	{
		// Windsurf (Codeium) stores data in its app support directory
		// TODO: Verify exact conversation file format and location
		source: "windsurf",
		dirs: [
			join(appSupport, "Windsurf", "User", "globalStorage"),
		],
		maxDepth: 4,
	},
	{
		// Zed AI conversations
		// TODO: Verify exact location — may be under conversations/ or assistant/
		source: "zed",
		dirs: [
			join(appSupport, isMac ? "Zed" : "zed", "conversations"),
			join(appSupport, isMac ? "Zed" : "zed", "assistant"),
		],
	},
	{
		// Amazon Q Developer CLI stores conversation history per-directory
		// TODO: Verify exact path structure — may use ~/.aws/amazonq/conversations/
		source: "amazon-q",
		dirs: [
			join(home, ".aws", "amazonq", "conversations"),
			join(home, ".aws", "amazonq"),
		],
	},
	{
		// Warp terminal AI chat history
		// TODO: Verify exact file format — likely JSON or SQLite
		source: "warp",
		dirs: [
			join(appSupport, "dev.warp.Warp-Stable", "ai"),
			join(appSupport, "dev.warp.Warp-Stable"),
		],
		maxDepth: 2,
	},
];

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Discover all available transcript files across all sources.
 * Returns file paths grouped by source.
 */
export function discoverTranscripts(options?: {
	since?: Date;
	maxFiles?: number;
}): Array<{ source: TranscriptSource; files: string[] }> {
	const results: Array<{ source: TranscriptSource; files: string[] }> = [];
	const since = options?.since ?? new Date(0);
	const maxFiles = options?.maxFiles ?? 100;

	for (const { source, dirs, extensions, maxDepth } of TRANSCRIPT_SOURCES) {
		const files: string[] = [];
		const exts = extensions ?? [".jsonl", ".json"];
		for (const dir of dirs) {
			if (!existsSync(dir)) continue;
			collectFiles(dir, files, since, maxDepth ?? 3, exts);
		}
		// Sort by modification time descending, take most recent
		files.sort((a, b) => {
			try {
				return statSync(b).mtimeMs - statSync(a).mtimeMs;
			} catch {
				return 0;
			}
		});
		if (files.length > 0) {
			results.push({ source, files: files.slice(0, maxFiles) });
		}
	}

	return results;
}

/**
 * Parse a single transcript file into a normalized format.
 */
export function parseTranscriptFile(filePath: string, source: TranscriptSource): ParsedTranscript | null {
	try {
		const content = readFileSync(filePath, "utf-8");

		switch (source) {
			case "claude-code": {
				const lines = content.split("\n").filter((l) => l.trim());
				return parseClaudeCodeTranscript(filePath, lines);
			}
			case "openclaw": {
				const lines = content.split("\n").filter((l) => l.trim());
				return parseOpenClawTranscript(filePath, lines);
			}
			case "gemini": {
				const lines = content.split("\n").filter((l) => l.trim());
				return parseGeminiTranscript(filePath, lines);
			}
			case "codex": {
				const lines = content.split("\n").filter((l) => l.trim());
				return parseCodexTranscript(filePath, lines);
			}
			case "aider":
				return parseAiderTranscript(filePath, content);
			case "continue":
				return parseContinueTranscript(filePath, content);
			case "cline":
				return parseClineTranscript(filePath, content);
			case "copilot-chat":
				return parseCopilotChatTranscript(filePath, content);
			case "cursor":
				return parseGenericJsonTranscript(filePath, content, "cursor");
			case "windsurf":
				return parseGenericJsonTranscript(filePath, content, "windsurf");
			case "zed":
				return parseZedTranscript(filePath, content);
			case "amazon-q":
				return parseGenericJsonTranscript(filePath, content, "amazon-q");
			case "warp":
				return parseGenericJsonTranscript(filePath, content, "warp");
			default:
				return null;
		}
	} catch {
		return null;
	}
}

/**
 * Read and parse all recent transcripts from all sources.
 */
export function readAllTranscripts(options?: {
	since?: Date;
	maxFiles?: number;
}): ParsedTranscript[] {
	const discovered = discoverTranscripts(options);
	const transcripts: ParsedTranscript[] = [];

	for (const { source, files } of discovered) {
		for (const file of files) {
			const parsed = parseTranscriptFile(file, source);
			if (parsed && parsed.messages.length > 0) {
				transcripts.push(parsed);
			}
		}
	}

	return transcripts;
}

// ── File Discovery ─────────────────────────────────────────────────────

function collectFiles(
	dir: string,
	files: string[],
	since: Date,
	maxDepth: number,
	extensions: string[],
): void {
	if (maxDepth <= 0) return;
	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				collectFiles(fullPath, files, since, maxDepth - 1, extensions);
			} else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
				try {
					const stat = statSync(fullPath);
					if (stat.mtimeMs >= since.getTime()) {
						files.push(fullPath);
					}
				} catch {
					// skip unreadable files
				}
			}
		}
	} catch {
		// skip unreadable dirs
	}
}

// ── Claude Code Parser ─────────────────────────────────────────────────

function parseClaudeCodeTranscript(filePath: string, lines: string[]): ParsedTranscript {
	const messages: TranscriptMessage[] = [];
	let startTime: string | null = null;
	let endTime: string | null = null;

	for (const line of lines) {
		try {
			const obj = JSON.parse(line);

			const role = mapClaudeRole(obj.type || obj.role);
			if (!role) continue;

			const timestamp = obj.timestamp || obj.ts || null;
			if (timestamp) {
				if (!startTime) startTime = timestamp;
				endTime = timestamp;
			}

			const msg: TranscriptMessage = {
				role,
				text: extractText(obj),
				timestamp,
			};

			if (obj.tool_name || obj.toolName) {
				msg.role = "tool";
				msg.toolName = obj.tool_name || obj.toolName;
				msg.toolInput = obj.tool_input || obj.input || undefined;
			}

			if (Array.isArray(obj.content)) {
				for (const block of obj.content) {
					if (block.type === "tool_use") {
						messages.push({
							role: "tool",
							text: "",
							timestamp,
							toolName: block.name,
							toolInput: block.input,
						});
					}
					if (block.type === "tool_result" && block.is_error) {
						messages.push({
							role: "tool",
							text: typeof block.content === "string" ? block.content : "",
							timestamp,
							isError: true,
						});
					}
					if (block.type === "thinking") {
						messages.push({
							role: "assistant",
							text: "",
							timestamp,
							isThinking: true,
						});
					}
				}
			}

			if (obj.usage) {
				msg.tokenUsage = {
					input: obj.usage.input_tokens || obj.usage.input || 0,
					output: obj.usage.output_tokens || obj.usage.output || 0,
					total: obj.usage.total_tokens || 0,
				};
			}

			if (obj.model) msg.model = obj.model;

			messages.push(msg);
		} catch {
			// skip malformed lines
		}
	}

	return {
		source: "claude-code",
		sessionId: deriveSessionId(filePath),
		filePath,
		messages,
		startTime,
		endTime,
	};
}

// ── OpenClaw Parser ────────────────────────────────────────────────────

function parseOpenClawTranscript(filePath: string, lines: string[]): ParsedTranscript {
	const messages: TranscriptMessage[] = [];
	let startTime: string | null = null;
	let endTime: string | null = null;

	for (const line of lines) {
		try {
			const obj = JSON.parse(line);

			const timestamp = obj.timestamp || obj.ts || obj.time || null;
			if (timestamp) {
				if (!startTime) startTime = timestamp;
				endTime = timestamp;
			}

			const role = mapOpenClawRole(obj.role || obj.type);
			if (!role) continue;

			const msg: TranscriptMessage = {
				role,
				text: extractText(obj),
				timestamp,
			};

			if (obj.toolName || obj.tool_name || obj.function_name) {
				msg.role = "tool";
				msg.toolName = obj.toolName || obj.tool_name || obj.function_name;
				msg.toolInput = obj.toolInput || obj.tool_input || obj.args || undefined;
			}

			if (obj.isError || obj.error) msg.isError = true;
			if (obj.model) msg.model = obj.model;

			if (obj.usage || obj.tokenUsage) {
				const u = obj.usage || obj.tokenUsage;
				msg.tokenUsage = {
					input: u.input_tokens || u.input || u.promptTokens || 0,
					output: u.output_tokens || u.output || u.completionTokens || 0,
					total: u.total_tokens || u.total || u.totalTokens || 0,
				};
			}

			messages.push(msg);
		} catch {
			// skip
		}
	}

	return {
		source: "openclaw",
		sessionId: deriveSessionId(filePath),
		filePath,
		messages,
		startTime,
		endTime,
	};
}

// ── Gemini Parser ──────────────────────────────────────────────────────

function parseGeminiTranscript(filePath: string, lines: string[]): ParsedTranscript {
	const messages: TranscriptMessage[] = [];
	let startTime: string | null = null;
	let endTime: string | null = null;

	for (const line of lines) {
		try {
			const obj = JSON.parse(line);
			const timestamp = obj.timestamp || obj.createTime || null;
			if (timestamp) {
				if (!startTime) startTime = timestamp;
				endTime = timestamp;
			}

			let role: TranscriptMessage["role"] = "user";
			if (obj.role === "model" || obj.role === "assistant") role = "assistant";
			else if (obj.role === "user") role = "user";
			else if (obj.role === "tool" || obj.functionCall) role = "tool";
			else continue;

			const msg: TranscriptMessage = {
				role,
				text: extractText(obj),
				timestamp,
			};

			if (obj.functionCall) {
				msg.role = "tool";
				msg.toolName = obj.functionCall.name;
				msg.toolInput = obj.functionCall.args;
			}

			if (obj.usageMetadata) {
				msg.tokenUsage = {
					input: obj.usageMetadata.promptTokenCount || 0,
					output: obj.usageMetadata.candidatesTokenCount || 0,
					total: obj.usageMetadata.totalTokenCount || 0,
				};
			}

			if (obj.model || obj.modelId) msg.model = obj.model || obj.modelId;

			messages.push(msg);
		} catch {
			// skip
		}
	}

	return {
		source: "gemini",
		sessionId: deriveSessionId(filePath),
		filePath,
		messages,
		startTime,
		endTime,
	};
}

// ── Codex CLI Parser ───────────────────────────────────────────────────
// Codex CLI (OpenAI) stores session transcripts as JSONL under ~/.codex/sessions/
// and a combined history at ~/.codex/history.jsonl
// Format uses OpenAI chat completions structure: {role, content, tool_calls, ...}

function parseCodexTranscript(filePath: string, lines: string[]): ParsedTranscript {
	const messages: TranscriptMessage[] = [];
	let startTime: string | null = null;
	let endTime: string | null = null;

	for (const line of lines) {
		try {
			const obj = JSON.parse(line);

			const timestamp = obj.timestamp || obj.ts || obj.created_at || null;
			if (timestamp) {
				if (!startTime) startTime = timestamp;
				endTime = timestamp;
			}

			// Codex uses OpenAI format: role is "user", "assistant", "system", "tool"
			const role = mapOpenAIRole(obj.role);
			if (!role) continue;

			const msg: TranscriptMessage = {
				role,
				text: extractText(obj),
				timestamp,
			};

			// OpenAI-style tool_calls array
			if (Array.isArray(obj.tool_calls)) {
				for (const tc of obj.tool_calls) {
					const fn = tc.function || tc;
					messages.push({
						role: "tool",
						text: "",
						timestamp,
						toolName: fn.name,
						toolInput: typeof fn.arguments === "string"
							? safeParseJson(fn.arguments)
							: fn.arguments,
					});
				}
			}

			// Tool result messages (role=tool with tool_call_id)
			if (obj.role === "tool" && obj.tool_call_id) {
				msg.toolName = obj.name || undefined;
			}

			if (obj.usage) {
				msg.tokenUsage = {
					input: obj.usage.prompt_tokens || obj.usage.input_tokens || 0,
					output: obj.usage.completion_tokens || obj.usage.output_tokens || 0,
					total: obj.usage.total_tokens || 0,
				};
			}

			if (obj.model) msg.model = obj.model;

			messages.push(msg);
		} catch {
			// skip malformed lines
		}
	}

	return {
		source: "codex",
		sessionId: deriveSessionId(filePath),
		filePath,
		messages,
		startTime,
		endTime,
	};
}

// ── Aider Parser ───────────────────────────────────────────────────────
// Aider stores chat history as markdown in .aider.chat.history.md files
// Format:
//   #### user
//   <user message>
//
//   #### assistant
//   <assistant response>
//
// Messages are separated by #### headers with role names.

function parseAiderTranscript(filePath: string, content: string): ParsedTranscript {
	const messages: TranscriptMessage[] = [];

	// Split on #### headers that indicate role changes
	const sections = content.split(/^####\s+/m).filter((s) => s.trim());

	for (const section of sections) {
		const newlineIdx = section.indexOf("\n");
		if (newlineIdx === -1) continue;

		const header = section.slice(0, newlineIdx).trim().toLowerCase();
		const text = section.slice(newlineIdx + 1).trim();

		let role: TranscriptMessage["role"];
		if (header === "user" || header.startsWith("user")) {
			role = "user";
		} else if (header === "assistant" || header.startsWith("assistant")) {
			role = "assistant";
		} else if (header === "system" || header.startsWith("system")) {
			role = "system";
		} else if (header === "tool" || header.startsWith("tool")) {
			role = "tool";
		} else {
			// Aider sometimes uses model name as header (e.g., "gpt-4o", "claude-3.5-sonnet")
			// Treat unknown headers as assistant messages
			role = "assistant";
		}

		if (text) {
			messages.push({ role, text });
		}
	}

	// Aider doesn't have timestamps in the history file
	// Derive approximate time from file modification date
	let endTime: string | null = null;
	try {
		endTime = statSync(filePath).mtime.toISOString();
	} catch {
		// ignore
	}

	return {
		source: "aider",
		sessionId: deriveSessionId(filePath),
		filePath,
		messages,
		startTime: null,
		endTime,
	};
}

// ── Continue.dev Parser ────────────────────────────────────────────────
// Continue.dev stores sessions as JSON files in ~/.continue/sessions/
// Each file is a JSON object with a "history" array of ChatMessage objects:
// { "sessionId": "...", "title": "...", "history": [{ "role": "user", "content": "..." }, ...] }
// Also supports session-transcripts/ which are markdown exports.

function parseContinueTranscript(filePath: string, content: string): ParsedTranscript {
	const messages: TranscriptMessage[] = [];

	// If it's a markdown transcript, parse as markdown
	if (filePath.endsWith(".md")) {
		return parseMarkdownTranscript(filePath, content, "continue");
	}

	try {
		const data = JSON.parse(content);
		const history = data.history || data.messages || data.steps || [];

		for (const item of history) {
			const role = mapOpenAIRole(item.role);
			if (!role) continue;

			const text = typeof item.content === "string"
				? item.content
				: Array.isArray(item.content)
					? item.content
						.filter((p: Record<string, unknown>) => p.type === "text" || typeof p === "string")
						.map((p: Record<string, unknown>) => typeof p === "string" ? p : p.text || "")
						.join("\n")
					: "";

			const msg: TranscriptMessage = { role, text };

			if (item.timestamp || item.createdAt) {
				msg.timestamp = item.timestamp || item.createdAt;
			}
			if (item.model || item.modelTitle) {
				msg.model = item.model || item.modelTitle;
			}

			messages.push(msg);
		}

		return {
			source: "continue",
			sessionId: data.sessionId || deriveSessionId(filePath),
			filePath,
			messages,
			startTime: data.dateCreated || null,
			endTime: data.dateModified || null,
		};
	} catch {
		return {
			source: "continue",
			sessionId: deriveSessionId(filePath),
			filePath,
			messages: [],
			startTime: null,
			endTime: null,
		};
	}
}

// ── Cline Parser ───────────────────────────────────────────────────────
// Cline stores per-task data under:
//   globalStorage/saoudrizwan.claude-dev/tasks/<task-id>/api_conversation_history.json
// Format: JSON array of { role: "user"|"assistant", content: [{type:"text",text:"..."}] }
// Uses Anthropic message format (content blocks).

function parseClineTranscript(filePath: string, content: string): ParsedTranscript {
	const messages: TranscriptMessage[] = [];

	try {
		const data = JSON.parse(content);
		const items = Array.isArray(data) ? data : (data.messages || data.history || []);

		for (const item of items) {
			let role: TranscriptMessage["role"];
			if (item.role === "user") role = "user";
			else if (item.role === "assistant") role = "assistant";
			else if (item.role === "system") role = "system";
			else continue;

			let text = "";
			if (typeof item.content === "string") {
				text = item.content;
			} else if (Array.isArray(item.content)) {
				// Anthropic-style content blocks
				const textParts: string[] = [];
				for (const block of item.content) {
					if (block.type === "text") {
						textParts.push(block.text || "");
					} else if (block.type === "tool_use") {
						messages.push({
							role: "tool",
							text: "",
							toolName: block.name,
							toolInput: block.input,
						});
					} else if (block.type === "tool_result") {
						const resultText = typeof block.content === "string"
							? block.content
							: Array.isArray(block.content)
								? block.content.filter((b: Record<string, unknown>) => b.type === "text").map((b: Record<string, unknown>) => b.text).join("\n")
								: "";
						messages.push({
							role: "tool",
							text: resultText,
							isError: block.is_error || false,
						});
					}
				}
				text = textParts.join("\n");
			}

			if (text) {
				const msg: TranscriptMessage = { role, text };
				if (item.timestamp) msg.timestamp = item.timestamp;
				if (item.model) msg.model = item.model;
				messages.push(msg);
			}
		}
	} catch {
		// not valid JSON
	}

	return {
		source: "cline",
		sessionId: deriveSessionId(filePath),
		filePath,
		messages,
		startTime: null,
		endTime: null,
	};
}

// ── GitHub Copilot Chat Parser ─────────────────────────────────────────
// Copilot Chat stores conversations in JSON files under globalStorage/github.copilot-chat/
// TODO: Exact format needs verification. Best-effort parser handles common structures:
// - Array of {role, content} messages
// - Object with "conversations" array, each containing "messages"

function parseCopilotChatTranscript(filePath: string, content: string): ParsedTranscript {
	const messages: TranscriptMessage[] = [];

	try {
		const data = JSON.parse(content);

		// Try various known structures
		let items: Array<Record<string, unknown>> = [];

		if (Array.isArray(data)) {
			// Could be array of messages or array of conversations
			if (data.length > 0 && (data[0].role || data[0].content)) {
				items = data;
			} else if (data.length > 0 && data[0].messages) {
				// Array of conversations — take the first one
				items = data[0].messages as Array<Record<string, unknown>>;
			}
		} else if (data.messages) {
			items = data.messages;
		} else if (data.conversations && Array.isArray(data.conversations)) {
			// Flatten all conversations
			for (const conv of data.conversations) {
				if (conv.messages) {
					items.push(...conv.messages);
				}
			}
		}

		for (const item of items) {
			const role = mapOpenAIRole(item.role as string);
			if (!role) continue;

			const msg: TranscriptMessage = {
				role,
				text: typeof item.content === "string" ? item.content : extractText(item),
			};

			if (item.timestamp || item.createdAt) {
				msg.timestamp = (item.timestamp || item.createdAt) as string;
			}

			messages.push(msg);
		}
	} catch {
		// not valid JSON
	}

	return {
		source: "copilot-chat",
		sessionId: deriveSessionId(filePath),
		filePath,
		messages,
		startTime: messages[0]?.timestamp || null,
		endTime: messages[messages.length - 1]?.timestamp || null,
	};
}

// ── Zed AI Parser ──────────────────────────────────────────────────────
// Zed stores assistant conversations as JSON files
// TODO: Verify exact format. Zed assistant panels may use a custom format
// with "messages" array containing {role, content} pairs, or markdown.

function parseZedTranscript(filePath: string, content: string): ParsedTranscript {
	// Zed assistant conversations can be stored as markdown or JSON
	if (filePath.endsWith(".md")) {
		return parseMarkdownTranscript(filePath, content, "zed");
	}

	return parseGenericJsonTranscript(filePath, content, "zed");
}

// ── Generic JSON/JSONL Parser ──────────────────────────────────────────
// Best-effort parser for agents with uncertain formats (Cursor, Windsurf, Amazon Q, Warp)
// Tries common structures: arrays of messages, objects with messages/history/conversations

function parseGenericJsonTranscript(
	filePath: string,
	content: string,
	source: TranscriptSource,
): ParsedTranscript {
	const messages: TranscriptMessage[] = [];

	// Try JSONL first
	if (filePath.endsWith(".jsonl")) {
		const lines = content.split("\n").filter((l) => l.trim());
		for (const line of lines) {
			try {
				const obj = JSON.parse(line);
				const role = mapOpenAIRole(obj.role) || mapClaudeRole(obj.type || obj.role);
				if (!role) continue;
				messages.push({
					role,
					text: extractText(obj),
					timestamp: obj.timestamp || obj.ts || obj.created_at || undefined,
				});
			} catch {
				// skip
			}
		}
	} else {
		// Try JSON
		try {
			const data = JSON.parse(content);
			const items = extractMessageArray(data);
			for (const item of items) {
				const role = mapOpenAIRole(item.role as string);
				if (!role) continue;
				messages.push({
					role,
					text: typeof item.content === "string" ? item.content : extractText(item as Record<string, unknown>),
					timestamp: (item.timestamp || item.ts || item.created_at) as string | undefined,
				});
			}
		} catch {
			// not valid JSON
		}
	}

	return {
		source,
		sessionId: deriveSessionId(filePath),
		filePath,
		messages,
		startTime: messages[0]?.timestamp || null,
		endTime: messages[messages.length - 1]?.timestamp || null,
	};
}

// ── Markdown Transcript Parser ─────────────────────────────────────────
// Generic markdown parser for agents that export/store as markdown
// Handles ## User / ## Assistant or similar patterns

function parseMarkdownTranscript(
	filePath: string,
	content: string,
	source: TranscriptSource,
): ParsedTranscript {
	const messages: TranscriptMessage[] = [];

	// Split on markdown headers that might indicate roles
	const sections = content.split(/^#{1,4}\s+/m).filter((s) => s.trim());

	for (const section of sections) {
		const newlineIdx = section.indexOf("\n");
		if (newlineIdx === -1) continue;

		const header = section.slice(0, newlineIdx).trim().toLowerCase();
		const text = section.slice(newlineIdx + 1).trim();

		let role: TranscriptMessage["role"] | null = null;
		if (/^(user|human|you|prompt)/.test(header)) role = "user";
		else if (/^(assistant|ai|model|response|bot|gpt|claude|gemini)/.test(header)) role = "assistant";
		else if (/^(system)/.test(header)) role = "system";
		else if (/^(tool|function)/.test(header)) role = "tool";

		if (role && text) {
			messages.push({ role, text });
		}
	}

	return {
		source,
		sessionId: deriveSessionId(filePath),
		filePath,
		messages,
		startTime: null,
		endTime: null,
	};
}

// ── Helpers ────────────────────────────────────────────────────────────

function mapClaudeRole(type: string | undefined): TranscriptMessage["role"] | null {
	if (!type) return null;
	switch (type) {
		case "human":
		case "user":
			return "user";
		case "assistant":
		case "ai":
			return "assistant";
		case "system":
			return "system";
		case "tool_use":
		case "tool_result":
		case "tool":
			return "tool";
		default:
			return null;
	}
}

function mapOpenClawRole(type: string | undefined): TranscriptMessage["role"] | null {
	if (!type) return null;
	switch (type) {
		case "user":
		case "human":
			return "user";
		case "assistant":
		case "bot":
		case "ai":
			return "assistant";
		case "system":
			return "system";
		case "tool":
		case "function":
		case "tool_call":
		case "tool_result":
			return "tool";
		default:
			return null;
	}
}

/** Map OpenAI-style roles (used by Codex, Continue, Copilot, and generic parsers) */
function mapOpenAIRole(role: string | undefined): TranscriptMessage["role"] | null {
	if (!role) return null;
	switch (role) {
		case "user":
		case "human":
			return "user";
		case "assistant":
		case "model":
		case "bot":
			return "assistant";
		case "system":
		case "developer":
			return "system";
		case "tool":
		case "function":
			return "tool";
		default:
			return null;
	}
}

function extractText(obj: Record<string, unknown>): string {
	if (typeof obj.text === "string") return obj.text;
	if (typeof obj.content === "string") return obj.content;
	if (typeof obj.message === "string") return obj.message;
	if (Array.isArray(obj.content)) {
		return (obj.content as Array<Record<string, unknown>>)
			.filter((b) => b.type === "text")
			.map((b) => (b.text as string) || "")
			.join("\n");
	}
	if (Array.isArray(obj.parts)) {
		return (obj.parts as Array<Record<string, unknown>>)
			.filter((p) => typeof p.text === "string")
			.map((p) => p.text as string)
			.join("\n");
	}
	return "";
}

/** Try to extract an array of messages from various JSON structures */
function extractMessageArray(data: unknown): Array<Record<string, unknown>> {
	if (Array.isArray(data)) {
		if (data.length > 0 && (data[0].role || data[0].content)) return data;
		if (data.length > 0 && data[0].messages) return data[0].messages;
		return [];
	}
	const obj = data as Record<string, unknown>;
	if (Array.isArray(obj.messages)) return obj.messages as Array<Record<string, unknown>>;
	if (Array.isArray(obj.history)) return obj.history as Array<Record<string, unknown>>;
	if (Array.isArray(obj.conversation)) return obj.conversation as Array<Record<string, unknown>>;
	if (Array.isArray(obj.chat)) return obj.chat as Array<Record<string, unknown>>;
	if (Array.isArray(obj.steps)) return obj.steps as Array<Record<string, unknown>>;
	return [];
}

function safeParseJson(str: string): Record<string, unknown> | undefined {
	try {
		return JSON.parse(str);
	} catch {
		return undefined;
	}
}

function deriveSessionId(filePath: string): string {
	const name = basename(filePath, extname(filePath));
	return name.replace(/^session[-_]?/, "").replace(/[-_]transcript$/, "") || name;
}
