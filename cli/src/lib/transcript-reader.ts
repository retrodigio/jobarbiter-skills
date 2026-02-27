/**
 * Transcript Reader — reads and parses session transcripts from AI tools
 *
 * Supports:
 * - Claude Code: ~/.claude/projects/ (JSONL session files)
 * - OpenClaw: ~/.openclaw/transcripts/ or ~/.clawdbot/transcripts/ (JSONL)
 * - Gemini CLI: ~/.gemini/ (TBD format)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { homedir } from "node:os";
import type { ParsedTranscript, TranscriptMessage, TranscriptSource } from "./analyzer-types.js";

// ── Source Directories ─────────────────────────────────────────────────

const TRANSCRIPT_SOURCES: Array<{ source: TranscriptSource; dirs: string[] }> = [
	{
		source: "claude-code",
		dirs: [join(homedir(), ".claude", "projects")],
	},
	{
		source: "openclaw",
		dirs: [
			join(homedir(), ".openclaw", "transcripts"),
			join(homedir(), ".clawdbot", "transcripts"),
		],
	},
	{
		source: "gemini",
		dirs: [join(homedir(), ".gemini", "sessions")],
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

	for (const { source, dirs } of TRANSCRIPT_SOURCES) {
		const files: string[] = [];
		for (const dir of dirs) {
			if (!existsSync(dir)) continue;
			collectJsonlFiles(dir, files, since, 3); // max depth 3
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
		const lines = content.split("\n").filter((l) => l.trim());

		switch (source) {
			case "claude-code":
				return parseClaudeCodeTranscript(filePath, lines);
			case "openclaw":
				return parseOpenClawTranscript(filePath, lines);
			case "gemini":
				return parseGeminiTranscript(filePath, lines);
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

function collectJsonlFiles(dir: string, files: string[], since: Date, maxDepth: number): void {
	if (maxDepth <= 0) return;
	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				collectJsonlFiles(fullPath, files, since, maxDepth - 1);
			} else if (entry.isFile() && (entry.name.endsWith(".jsonl") || entry.name.endsWith(".json"))) {
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

			// Claude Code JSONL has various message types
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

			// Tool calls
			if (obj.tool_name || obj.toolName) {
				msg.role = "tool";
				msg.toolName = obj.tool_name || obj.toolName;
				msg.toolInput = obj.tool_input || obj.input || undefined;
			}

			// Content blocks with tool_use
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

			// Token usage
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

			// Tool calls in OpenClaw format
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

function extractText(obj: Record<string, unknown>): string {
	if (typeof obj.text === "string") return obj.text;
	if (typeof obj.content === "string") return obj.content;
	if (typeof obj.message === "string") return obj.message;
	if (Array.isArray(obj.content)) {
		return obj.content
			.filter((b: Record<string, unknown>) => b.type === "text")
			.map((b: Record<string, unknown>) => b.text || "")
			.join("\n");
	}
	if (Array.isArray(obj.parts)) {
		return obj.parts
			.filter((p: Record<string, unknown>) => typeof p.text === "string")
			.map((p: Record<string, unknown>) => p.text)
			.join("\n");
	}
	return "";
}

function deriveSessionId(filePath: string): string {
	const name = basename(filePath, extname(filePath));
	// Remove common prefixes/suffixes, return a clean ID
	return name.replace(/^session[-_]?/, "").replace(/[-_]transcript$/, "") || name;
}
