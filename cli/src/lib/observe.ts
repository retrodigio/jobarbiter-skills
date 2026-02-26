/**
 * JobArbiter Observer — Hook installer for AI tools
 *
 * Installs observation hooks that extract proficiency signals from
 * session transcripts. Uses detect-tools.ts for agent detection.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getObservableTools, type DetectedTool } from "./detect-tools.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface DetectedAgent {
	id: string;
	name: string;
	configDir: string;
	hookFormat: "claude" | "cursor" | "opencode" | "codex" | "gemini";
	installed: boolean;
	hookInstalled: boolean;
}

interface HookConfig {
	[key: string]: unknown;
}

// ── Agent Config Directories ───────────────────────────────────────────

const AGENT_CONFIG_DIRS: Record<string, string> = {
	"claude-code": join(homedir(), ".claude"),
	"cursor": join(homedir(), ".cursor"),
	"opencode": join(homedir(), ".config", "opencode"),
	"codex": join(homedir(), ".codex"),
	"gemini": join(homedir(), ".gemini"),
};

const AGENT_HOOK_FORMATS: Record<string, "claude" | "cursor" | "opencode" | "codex" | "gemini"> = {
	"claude-code": "claude",
	"cursor": "cursor",
	"opencode": "opencode",
	"codex": "codex",
	"gemini": "gemini",
};

/**
 * Detect agents that support observation.
 * Uses the shared detect-tools module for detection.
 */
export function detectAgents(): DetectedAgent[] {
	const observableTools = getObservableTools();
	
	return observableTools.map((tool) => ({
		id: tool.id,
		name: tool.name,
		configDir: AGENT_CONFIG_DIRS[tool.id] || tool.configDir || "",
		hookFormat: AGENT_HOOK_FORMATS[tool.id] || "claude",
		installed: tool.installed,
		hookInstalled: tool.observerActive,
	}));
}

// ── Observer Data Directory ────────────────────────────────────────────

const OBSERVER_DIR = join(homedir(), ".config", "jobarbiter", "observer");
const OBSERVATIONS_FILE = join(OBSERVER_DIR, "observations.json");
const HOOKS_DIR = join(OBSERVER_DIR, "hooks");

function ensureObserverDirs(): void {
	mkdirSync(OBSERVER_DIR, { recursive: true });
	mkdirSync(HOOKS_DIR, { recursive: true });

	// Initialize observations file if missing
	if (!existsSync(OBSERVATIONS_FILE)) {
		writeFileSync(
			OBSERVATIONS_FILE,
			JSON.stringify(
				{
					version: 1,
					installedAt: new Date().toISOString(),
					agents: {},
					sessions: [],
					accumulated: {
						totalSessions: 0,
						totalTokens: 0,
						toolCounts: {},
						domainSignals: [],
						lastSubmitted: null,
					},
				},
				null,
				2,
			) + "\n",
		);
	}
}

// ── Core Observer Script ───────────────────────────────────────────────

/**
 * The universal observer script. Runs as a hook in any AI agent.
 * Reads session transcript data from stdin (JSON), extracts proficiency
 * signals, and appends them to the local observations file.
 *
 * This is written as a standalone shell script so it has zero dependencies
 * and works regardless of the user's Node.js setup.
 */
function getObserverScript(): string {
	return `#!/usr/bin/env node
/**
 * JobArbiter Observer Hook
 * Extracts proficiency signals from AI tool sessions.
 * 
 * Reads JSON from stdin, writes observations to:
 *   ~/.config/jobarbiter/observer/observations.json
 *
 * Signals extracted:
 *   - Tool names and frequencies (tool fluency)
 *   - Session duration and message counts (output velocity)
 *   - File types worked on (domain application)
 *   - Token usage when available (token throughput)
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const OBSERVATIONS_FILE = path.join(
  os.homedir(), ".config", "jobarbiter", "observer", "observations.json"
);

// Read stdin
let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const observation = extractSignals(data);
    if (observation) appendObservation(observation);
  } catch (err) {
    // Silent failure — never block the AI tool
    fs.appendFileSync(
      path.join(os.homedir(), ".config", "jobarbiter", "observer", "errors.log"),
      \`[\${new Date().toISOString()}] \${err.message}\\n\`
    );
  }
  process.exit(0);
});

function extractSignals(data) {
  const observation = {
    timestamp: new Date().toISOString(),
    agent: process.env.JOBARBITER_AGENT || detectAgent(),
    sessionId: data.sessionId || data.session_id || data.thread_id || data.id || null,
    signals: {
      toolsUsed: [],
      fileExtensions: [],
      messageCount: 0,
      thinkingBlocks: 0,
      tokenUsage: null,
      duration: null,
    },
  };

  // Claude Code / Cursor: stop hook provides session info
  if (data.transcript || data.messages) {
    const messages = data.transcript || data.messages || [];
    observation.signals.messageCount = messages.length;

    for (const msg of messages) {
      // Extract tool calls
      if (msg.tool_name || msg.toolName) {
        observation.signals.toolsUsed.push(msg.tool_name || msg.toolName);
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          observation.signals.toolsUsed.push(tc.name || tc.function?.name);
        }
      }

      // Extract file extensions from tool args
      const args = msg.tool_input || msg.args || msg.tool_calls?.[0]?.input || {};
      const filePath = args.file_path || args.filePath || args.path || args.filename || "";
      if (filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext) observation.signals.fileExtensions.push(ext);
      }

      // Count thinking blocks
      if (msg.type === "thinking" || msg.role === "thinking") {
        observation.signals.thinkingBlocks++;
      }

      // Token usage
      if (msg.usage) {
        if (!observation.signals.tokenUsage) {
          observation.signals.tokenUsage = { input: 0, output: 0, total: 0 };
        }
        observation.signals.tokenUsage.input += msg.usage.input_tokens || msg.usage.input || 0;
        observation.signals.tokenUsage.output += msg.usage.output_tokens || msg.usage.output || 0;
        observation.signals.tokenUsage.total += msg.usage.total_tokens || msg.usage.totalTokens || 0;
      }
    }
  }

  // Codex: notification format
  if (data.type === "agent-turn-complete") {
    observation.signals.messageCount = (data["input-messages"] || []).length;
  }

  // Gemini: AfterAgent / SessionEnd
  if (data.toolResults || data.toolCalls) {
    const tools = data.toolCalls || data.toolResults || [];
    for (const t of tools) {
      observation.signals.toolsUsed.push(t.name || t.toolName);
    }
  }

  // Deduplicate
  observation.signals.toolsUsed = [...new Set(observation.signals.toolsUsed.filter(Boolean))];
  observation.signals.fileExtensions = [...new Set(observation.signals.fileExtensions.filter(Boolean))];

  // Skip empty observations
  if (
    observation.signals.toolsUsed.length === 0 &&
    observation.signals.messageCount === 0 &&
    !observation.signals.tokenUsage
  ) {
    return null;
  }

  return observation;
}

function detectAgent() {
  // Detect from environment or parent process
  if (process.env.CLAUDE_CODE) return "claude-code";
  if (process.env.CURSOR_SESSION) return "cursor";
  if (process.env.CODEX_HOME) return "codex";
  if (process.env.GEMINI_PROJECT_DIR) return "gemini";
  return "unknown";
}

function appendObservation(obs) {
  try {
    const raw = fs.readFileSync(OBSERVATIONS_FILE, "utf-8");
    const data = JSON.parse(raw);
    data.sessions.push(obs);
    data.accumulated.totalSessions++;

    // Update tool counts
    for (const tool of obs.signals.toolsUsed) {
      data.accumulated.toolCounts[tool] = (data.accumulated.toolCounts[tool] || 0) + 1;
    }

    // Update token totals
    if (obs.signals.tokenUsage) {
      data.accumulated.totalTokens += obs.signals.tokenUsage.total || 0;
    }

    // Keep only last 500 detailed sessions (rolling window)
    if (data.sessions.length > 500) {
      data.sessions = data.sessions.slice(-500);
    }

    fs.writeFileSync(OBSERVATIONS_FILE, JSON.stringify(data, null, 2) + "\\n");
  } catch (err) {
    // If file is corrupted, start fresh
    fs.writeFileSync(OBSERVATIONS_FILE, JSON.stringify({
      version: 1,
      sessions: [obs],
      accumulated: {
        totalSessions: 1,
        totalTokens: obs.signals.tokenUsage?.total || 0,
        toolCounts: Object.fromEntries(obs.signals.toolsUsed.map(t => [t, 1])),
        domainSignals: [],
        lastSubmitted: null,
      },
    }, null, 2) + "\\n");
  }
}
`;
}

// ── Hook Installers ────────────────────────────────────────────────────

function writeObserverScript(): string {
	ensureObserverDirs();
	const scriptPath = join(HOOKS_DIR, "observer.js");
	writeFileSync(scriptPath, getObserverScript());
	chmodSync(scriptPath, 0o755);
	return scriptPath;
}

/**
 * Install hook for Claude Code (~/.claude/hooks.json)
 * Uses the Stop event to observe after each session turn.
 */
function installClaudeCodeHook(configDir: string, scriptPath: string): void {
	const hookFile = join(configDir, "hooks.json");
	let config: HookConfig = {};

	if (existsSync(hookFile)) {
		try {
			config = JSON.parse(readFileSync(hookFile, "utf-8"));
		} catch {
			config = {};
		}
	}

	// Ensure hooks object exists
	if (!config.hooks) config.hooks = {};
	const hooks = config.hooks as Record<string, unknown[]>;

	// Add to Stop event (don't duplicate)
	if (!hooks.Stop) hooks.Stop = [];
	const stopHooks = hooks.Stop as Array<{ command: string; timeout?: number }>;

	if (!stopHooks.some((h) => h.command?.includes("jobarbiter"))) {
		stopHooks.push({
			command: `node ${scriptPath}`,
			timeout: 10,
		});
	}

	mkdirSync(configDir, { recursive: true });
	writeFileSync(hookFile, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Install hook for Cursor (~/.cursor/hooks.json)
 * Same JSON format as Claude Code — uses stop event.
 */
function installCursorHook(configDir: string, scriptPath: string): void {
	const hookFile = join(configDir, "hooks.json");
	let config: HookConfig = {};

	if (existsSync(hookFile)) {
		try {
			config = JSON.parse(readFileSync(hookFile, "utf-8"));
		} catch {
			config = {};
		}
	}

	if (!config.version) config.version = 1;
	if (!config.hooks) config.hooks = {};
	const hooks = config.hooks as Record<string, unknown[]>;

	// Use stop event
	if (!hooks.stop) hooks.stop = [];
	const stopHooks = hooks.stop as Array<{ command: string; timeout?: number }>;

	if (!stopHooks.some((h) => h.command?.includes("jobarbiter"))) {
		stopHooks.push({
			command: `node ${scriptPath}`,
			timeout: 10,
		});
	}

	mkdirSync(configDir, { recursive: true });
	writeFileSync(hookFile, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Install plugin for OpenCode (~/.config/opencode/plugins/)
 * OpenCode uses JS/TS plugin modules, not JSON config.
 */
function installOpenCodeHook(configDir: string, scriptPath: string): void {
	const pluginDir = join(configDir, "plugins");
	mkdirSync(pluginDir, { recursive: true });

	const pluginCode = `// JobArbiter Observer Plugin for OpenCode
// Observes session activity and extracts proficiency signals.

const { execSync } = require("child_process");
const { readFileSync } = require("fs");

exports.JobArbiterObserver = async ({ project, client, $, directory }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle" || event.type === "session.updated") {
        try {
          const sessionData = JSON.stringify({
            sessionId: event.sessionId || "unknown",
            agent: "opencode",
            messages: event.messages || [],
          });
          execSync(\`echo '\${sessionData.replace(/'/g, "'\\"'\\"\\'")}'  | node ${scriptPath}\`, {
            stdio: "ignore",
            timeout: 10000,
            env: { ...process.env, JOBARBITER_AGENT: "opencode" },
          });
        } catch {
          // Silent failure
        }
      }
    },
    "tool.execute.after": async (input, output) => {
      // Track individual tool executions for richer signal
      try {
        const toolData = JSON.stringify({
          agent: "opencode",
          messages: [{
            tool_name: input.tool,
            args: output.args || {},
          }],
        });
        execSync(\`echo '\${toolData.replace(/'/g, "'\\"'\\"\\'")}'  | node ${scriptPath}\`, {
          stdio: "ignore",
          timeout: 5000,
          env: { ...process.env, JOBARBITER_AGENT: "opencode" },
        });
      } catch {
        // Silent failure
      }
    },
  };
};
`;

	writeFileSync(join(pluginDir, "jobarbiter-observer.js"), pluginCode);
}

/**
 * Install notification handler for Codex CLI (~/.codex/config.toml)
 * Codex uses a `notify` config key that runs an external program.
 */
function installCodexHook(configDir: string, scriptPath: string): void {
	const configFile = join(configDir, "config.toml");

	// Create a wrapper script that converts Codex's CLI arg format to stdin
	const wrapperPath = join(HOOKS_DIR, "codex-wrapper.sh");
	writeFileSync(
		wrapperPath,
		`#!/bin/bash
# JobArbiter Observer wrapper for Codex CLI
# Codex passes JSON as $1, our observer reads stdin
echo "$1" | JOBARBITER_AGENT=codex node ${scriptPath}
`,
	);
	chmodSync(wrapperPath, 0o755);

	mkdirSync(configDir, { recursive: true });

	let config = "";
	if (existsSync(configFile)) {
		config = readFileSync(configFile, "utf-8");
	}

	// Add notify line if not present
	if (!config.includes("jobarbiter")) {
		// Check if there's already a notify line
		if (config.includes("notify")) {
			// Don't overwrite existing notify — append comment
			config += `\n# JobArbiter observer: add this to your notify script:\n# ${wrapperPath} "$1"\n`;
		} else {
			config += `\n# JobArbiter observer\nnotify = "${wrapperPath}"\n`;
		}
		writeFileSync(configFile, config);
	}
}

/**
 * Install hook for Gemini CLI (~/.gemini/settings.json)
 * Uses SessionEnd event.
 */
function installGeminiHook(configDir: string, scriptPath: string): void {
	const settingsFile = join(configDir, "settings.json");
	let settings: HookConfig = {};

	if (existsSync(settingsFile)) {
		try {
			settings = JSON.parse(readFileSync(settingsFile, "utf-8"));
		} catch {
			settings = {};
		}
	}

	if (!settings.hooks) settings.hooks = {};
	const hooks = settings.hooks as Record<string, unknown[]>;

	// Add SessionEnd hook
	if (!hooks.SessionEnd) hooks.SessionEnd = [];
	const sessionEndHooks = hooks.SessionEnd as Array<{
		matcher: string;
		hooks: Array<{ name: string; type: string; command: string; timeout: number }>;
	}>;

	if (!sessionEndHooks.some((h) => h.hooks?.some((hh) => hh.command?.includes("jobarbiter")))) {
		sessionEndHooks.push({
			matcher: "*",
			hooks: [
				{
					name: "jobarbiter-observer",
					type: "command",
					command: `node ${scriptPath}`,
					timeout: 10000,
				},
			],
		});
	}

	mkdirSync(configDir, { recursive: true });
	writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");
}

// ── Public API ─────────────────────────────────────────────────────────

// ── Agent Name Mapping ─────────────────────────────────────────────────

const AGENT_NAMES: Record<string, string> = {
	"claude-code": "Claude Code",
	"cursor": "Cursor",
	"opencode": "OpenCode",
	"codex": "Codex CLI",
	"gemini": "Gemini CLI",
};

/**
 * Check if observer hook is installed for an agent.
 */
function isHookInstalled(agentId: string, configDir: string, format: string): boolean {
	try {
		switch (format) {
			case "claude":
			case "cursor": {
				const hookFile = join(configDir, "hooks.json");
				if (!existsSync(hookFile)) return false;
				const content = readFileSync(hookFile, "utf-8");
				return content.includes("jobarbiter");
			}
			case "opencode": {
				const pluginDir = join(configDir, "plugins");
				return existsSync(join(pluginDir, "jobarbiter-observer.js"));
			}
			case "codex": {
				const configFile = join(configDir, "config.toml");
				if (!existsSync(configFile)) return false;
				const content = readFileSync(configFile, "utf-8");
				return content.includes("jobarbiter");
			}
			case "gemini": {
				const settingsFile = join(configDir, "settings.json");
				if (!existsSync(settingsFile)) return false;
				const content = readFileSync(settingsFile, "utf-8");
				return content.includes("jobarbiter");
			}
			default:
				return false;
		}
	} catch {
		return false;
	}
}

/**
 * Install observer hooks for the specified agents.
 * Returns a summary of what was installed.
 */
export function installObservers(
	agentIds: string[],
): { installed: string[]; skipped: string[]; errors: Array<{ agent: string; error: string }> } {
	const scriptPath = writeObserverScript();
	const result = {
		installed: [] as string[],
		skipped: [] as string[],
		errors: [] as Array<{ agent: string; error: string }>,
	};

	for (const agentId of agentIds) {
		const configDir = AGENT_CONFIG_DIRS[agentId];
		const hookFormat = AGENT_HOOK_FORMATS[agentId];
		const agentName = AGENT_NAMES[agentId] || agentId;

		if (!configDir || !hookFormat) {
			result.errors.push({ agent: agentId, error: "Unknown agent" });
			continue;
		}

		// Check if already installed
		if (isHookInstalled(agentId, configDir, hookFormat)) {
			result.skipped.push(agentName);
			continue;
		}

		try {
			switch (hookFormat) {
				case "claude":
					installClaudeCodeHook(configDir, scriptPath);
					break;
				case "cursor":
					installCursorHook(configDir, scriptPath);
					break;
				case "opencode":
					installOpenCodeHook(configDir, scriptPath);
					break;
				case "codex":
					installCodexHook(configDir, scriptPath);
					break;
				case "gemini":
					installGeminiHook(configDir, scriptPath);
					break;
			}
			result.installed.push(agentName);
		} catch (err) {
			result.errors.push({
				agent: agentName,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return result;
}

/**
 * Remove observer hooks for the specified agents.
 */
export function removeObservers(agentIds: string[]): { removed: string[]; notFound: string[] } {
	const result = { removed: [] as string[], notFound: [] as string[] };

	for (const agentId of agentIds) {
		const configDir = AGENT_CONFIG_DIRS[agentId];
		const hookFormat = AGENT_HOOK_FORMATS[agentId];
		const agentName = AGENT_NAMES[agentId] || agentId;

		if (!configDir || !hookFormat) {
			result.notFound.push(agentId);
			continue;
		}

		try {
			switch (hookFormat) {
				case "claude":
				case "cursor": {
					const hookFile = join(configDir, "hooks.json");
					if (existsSync(hookFile)) {
						const config = JSON.parse(readFileSync(hookFile, "utf-8"));
						for (const [key, hooks] of Object.entries(config.hooks || {})) {
							if (Array.isArray(hooks)) {
								(config.hooks as Record<string, unknown[]>)[key] = hooks.filter(
									(h: unknown) => !JSON.stringify(h).includes("jobarbiter"),
								);
							}
						}
						writeFileSync(hookFile, JSON.stringify(config, null, 2) + "\n");
						result.removed.push(agentName);
					} else {
						result.notFound.push(agentName);
					}
					break;
				}
				case "opencode": {
					const pluginFile = join(configDir, "plugins", "jobarbiter-observer.js");
					if (existsSync(pluginFile)) {
						unlinkSync(pluginFile);
						result.removed.push(agentName);
					} else {
						result.notFound.push(agentName);
					}
					break;
				}
				case "codex": {
					const configFile = join(configDir, "config.toml");
					if (existsSync(configFile)) {
						let content = readFileSync(configFile, "utf-8");
						content = content
							.split("\n")
							.filter((line) => !line.includes("jobarbiter"))
							.join("\n");
						writeFileSync(configFile, content);
						result.removed.push(agentName);
					} else {
						result.notFound.push(agentName);
					}
					break;
				}
				case "gemini": {
					const settingsFile = join(configDir, "settings.json");
					if (existsSync(settingsFile)) {
						const settings = JSON.parse(readFileSync(settingsFile, "utf-8"));
						for (const [key, hookGroups] of Object.entries(settings.hooks || {})) {
							if (Array.isArray(hookGroups)) {
								(settings.hooks as Record<string, unknown[]>)[key] = hookGroups.filter(
									(g: unknown) => !JSON.stringify(g).includes("jobarbiter"),
								);
							}
						}
						writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");
						result.removed.push(agentName);
					} else {
						result.notFound.push(agentName);
					}
					break;
				}
			}
		} catch {
			result.notFound.push(agentName);
		}
	}

	return result;
}

/**
 * Get observation status — what's been accumulated locally.
 */
export function getObservationStatus(): {
	hasData: boolean;
	totalSessions: number;
	totalTokens: number;
	topTools: Array<{ tool: string; count: number }>;
	agents: string[];
	lastSubmitted: string | null;
} {
	ensureObserverDirs();

	try {
		const raw = readFileSync(OBSERVATIONS_FILE, "utf-8");
		const data = JSON.parse(raw);

		const topTools = Object.entries(data.accumulated?.toolCounts || {})
			.map(([tool, count]) => ({ tool, count: count as number }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 10);

		const agents = [
			...new Set(
				(data.sessions || []).map((s: { agent: string }) => s.agent).filter(Boolean),
			),
		] as string[];

		return {
			hasData: (data.accumulated?.totalSessions || 0) > 0,
			totalSessions: data.accumulated?.totalSessions || 0,
			totalTokens: data.accumulated?.totalTokens || 0,
			topTools,
			agents,
			lastSubmitted: data.accumulated?.lastSubmitted || null,
		};
	} catch {
		return {
			hasData: false,
			totalSessions: 0,
			totalTokens: 0,
			topTools: [],
			agents: [],
			lastSubmitted: null,
		};
	}
}
