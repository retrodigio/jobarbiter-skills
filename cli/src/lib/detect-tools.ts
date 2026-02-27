/**
 * AI Tool Detection Module
 * 
 * Comprehensive detection of AI tools installed on the user's system.
 * Checks binaries in PATH, config directories, VS Code extensions,
 * pip/npm packages, macOS apps, and environment variables.
 * 
 * Never logs or stores API key values — only checks for existence.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { execSync } from "node:child_process";

// ── Types ──────────────────────────────────────────────────────────────

export type ToolCategory = "ai-agent" | "chat" | "orchestration" | "api-provider";

export interface DetectedTool {
	id: string;
	name: string;
	category: ToolCategory;
	installed: boolean;
	version?: string;
	configDir?: string;
	observerAvailable: boolean;
	observerActive: boolean;
}

interface ToolDefinition {
	id: string;
	name: string;
	category: ToolCategory;
	binary?: string;
	configDir?: string;
	macApp?: string;
	vscodeExtension?: string;
	cursorExtension?: string;
	pipPackage?: string;
	npmPackage?: string;
	envVars?: string[];
	observerAvailable: boolean;
}

// ── Tool Definitions ───────────────────────────────────────────────────

const TOOL_DEFINITIONS: ToolDefinition[] = [
	// AI AI Agents
	{
		id: "claude-code",
		name: "Claude Code",
		category: "ai-agent",
		binary: "claude",
		configDir: join(homedir(), ".claude"),
		observerAvailable: true,
	},
	{
		id: "cursor",
		name: "Cursor",
		category: "ai-agent",
		binary: "cursor",
		configDir: join(homedir(), ".cursor"),
		macApp: "/Applications/Cursor.app",
		observerAvailable: true,
	},
	{
		id: "github-copilot",
		name: "GitHub Copilot",
		category: "ai-agent",
		configDir: join(homedir(), ".config", "github-copilot"),
		vscodeExtension: "github.copilot",
		cursorExtension: "github.copilot",
		observerAvailable: false,
	},
	{
		id: "codex",
		name: "Codex CLI",
		category: "ai-agent",
		binary: "codex",
		configDir: join(homedir(), ".codex"),
		observerAvailable: true,
	},
	{
		id: "opencode",
		name: "OpenCode",
		category: "ai-agent",
		binary: "opencode",
		configDir: join(homedir(), ".config", "opencode"),
		observerAvailable: true,
	},
	{
		id: "aider",
		name: "Aider",
		category: "ai-agent",
		binary: "aider",
		configDir: join(homedir(), ".aider"),
		pipPackage: "aider-chat",
		observerAvailable: false,
	},
	{
		id: "continue",
		name: "Continue",
		category: "ai-agent",
		vscodeExtension: "continue.continue",
		cursorExtension: "continue.continue",
		observerAvailable: false,
	},
	{
		id: "cline",
		name: "Cline",
		category: "ai-agent",
		vscodeExtension: "saoudrizwan.claude-dev",
		cursorExtension: "saoudrizwan.claude-dev",
		observerAvailable: false,
	},
	{
		id: "windsurf",
		name: "Windsurf",
		category: "ai-agent",
		binary: "windsurf",
		macApp: "/Applications/Windsurf.app",
		observerAvailable: false,
	},
	{
		id: "copilot-chat",
		name: "GitHub Copilot Chat",
		category: "ai-agent",
		vscodeExtension: "github.copilot-chat",
		cursorExtension: "github.copilot-chat",
		observerAvailable: false,
	},
	{
		id: "zed-ai",
		name: "Zed AI",
		category: "ai-agent",
		macApp: "/Applications/Zed.app",
		configDir: join(homedir(), platform() === "darwin" ? "Library/Application Support/Zed" : ".config/zed"),
		observerAvailable: false,
	},
	{
		id: "amazon-q",
		name: "Amazon Q Developer CLI",
		category: "ai-agent",
		binary: "q",
		configDir: join(homedir(), ".aws", "amazonq"),
		observerAvailable: false,
	},
	{
		id: "warp-ai",
		name: "Warp AI",
		category: "chat",
		macApp: "/Applications/Warp.app",
		configDir: join(homedir(), "Library", "Application Support", "dev.warp.Warp-Stable"),
		observerAvailable: false,
	},
	{
		id: "letta",
		name: "Letta Code",
		category: "ai-agent",
		binary: "letta",
		configDir: join(homedir(), ".letta"),
		pipPackage: "letta",
		observerAvailable: false,
	},
	{
		id: "goose",
		name: "Goose",
		category: "ai-agent",
		binary: "goose",
		configDir: join(homedir(), ".config", "goose"),
		observerAvailable: false,
	},
	{
		id: "idx",
		name: "Google IDX",
		category: "ai-agent",
		// IDX is cloud-based; no local binary. Detect via config dir if any local cache exists.
		configDir: join(homedir(), ".idx"),
		observerAvailable: false,
	},
	{
		id: "gemini",
		name: "Gemini CLI",
		category: "ai-agent",
		binary: "gemini",
		configDir: join(homedir(), ".gemini"),
		observerAvailable: true,
	},

	// AI Chat/Desktop
	{
		id: "chatgpt-desktop",
		name: "ChatGPT Desktop",
		category: "chat",
		macApp: "/Applications/ChatGPT.app",
		observerAvailable: false,
	},
	{
		id: "claude-desktop",
		name: "Claude Desktop",
		category: "chat",
		macApp: "/Applications/Claude.app",
		observerAvailable: false,
	},
	{
		id: "ollama",
		name: "Ollama",
		category: "chat",
		binary: "ollama",
		configDir: join(homedir(), ".ollama"),
		observerAvailable: false,
	},

	// AI Orchestration
	{
		id: "openclaw",
		name: "OpenClaw",
		category: "orchestration",
		binary: "openclaw",
		configDir: join(homedir(), ".openclaw"),
		observerAvailable: false,
	},
	{
		id: "langchain",
		name: "LangChain",
		category: "orchestration",
		pipPackage: "langchain",
		observerAvailable: false,
	},
	{
		id: "crewai",
		name: "CrewAI",
		category: "orchestration",
		pipPackage: "crewai",
		observerAvailable: false,
	},

	// API Providers (detected via env vars)
	{
		id: "anthropic-api",
		name: "Anthropic API",
		category: "api-provider",
		envVars: ["ANTHROPIC_API_KEY"],
		observerAvailable: false,
	},
	{
		id: "openai-api",
		name: "OpenAI API",
		category: "api-provider",
		envVars: ["OPENAI_API_KEY"],
		observerAvailable: false,
	},
	{
		id: "google-api",
		name: "Google AI API",
		category: "api-provider",
		envVars: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
		observerAvailable: false,
	},
	{
		id: "groq-api",
		name: "Groq API",
		category: "api-provider",
		envVars: ["GROQ_API_KEY"],
		observerAvailable: false,
	},
	{
		id: "mistral-api",
		name: "Mistral API",
		category: "api-provider",
		envVars: ["MISTRAL_API_KEY"],
		observerAvailable: false,
	},
];

// ── Detection Helpers ──────────────────────────────────────────────────

function binExists(name: string): boolean {
	try {
		execSync(`command -v ${name}`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function getBinVersion(name: string): string | undefined {
	// Only try --version since -v and "version" can start interactive modes
	// for some tools (gemini, openclaw)
	try {
		const output = execSync(`${name} --version 2>/dev/null`, {
			encoding: "utf-8",
			timeout: 3000,
		}).trim();
		// Extract version number (e.g., "1.0.16", "v2.1.0")
		const match = output.match(/v?(\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.-]+)?)/);
		if (match) return match[1];
		return undefined;
	} catch {
		return undefined;
	}
}

function macAppExists(appPath: string): boolean {
	if (platform() !== "darwin") return false;
	return existsSync(appPath);
}

let vscodeExtensionsCache: string[] | null = null;
function getVSCodeExtensions(): string[] {
	if (vscodeExtensionsCache !== null) return vscodeExtensionsCache;
	
	try {
		const output = execSync("code --list-extensions 2>/dev/null", {
			encoding: "utf-8",
			timeout: 10000,
		});
		vscodeExtensionsCache = output.trim().toLowerCase().split("\n").filter(Boolean);
		return vscodeExtensionsCache;
	} catch {
		vscodeExtensionsCache = [];
		return [];
	}
}

let cursorExtensionsCache: string[] | null = null;
function getCursorExtensions(): string[] {
	if (cursorExtensionsCache !== null) return cursorExtensionsCache;
	
	try {
		// Cursor uses same extension format as VS Code
		const output = execSync("cursor --list-extensions 2>/dev/null", {
			encoding: "utf-8",
			timeout: 10000,
		});
		cursorExtensionsCache = output.trim().toLowerCase().split("\n").filter(Boolean);
		return cursorExtensionsCache;
	} catch {
		cursorExtensionsCache = [];
		return [];
	}
}

let pipPackagesCache: Set<string> | null = null;
function getPipPackages(): Set<string> {
	if (pipPackagesCache !== null) return pipPackagesCache;
	
	try {
		const output = execSync("pip list --format=freeze 2>/dev/null", {
			encoding: "utf-8",
			timeout: 10000,
		});
		const packages = new Set<string>();
		for (const line of output.split("\n")) {
			const match = line.match(/^([^=]+)==/);
			if (match) packages.add(match[1].toLowerCase());
		}
		pipPackagesCache = packages;
		return packages;
	} catch {
		// Try pip3 as fallback
		try {
			const output = execSync("pip3 list --format=freeze 2>/dev/null", {
				encoding: "utf-8",
				timeout: 10000,
			});
			const packages = new Set<string>();
			for (const line of output.split("\n")) {
				const match = line.match(/^([^=]+)==/);
				if (match) packages.add(match[1].toLowerCase());
			}
			pipPackagesCache = packages;
			return packages;
		} catch {
			pipPackagesCache = new Set();
			return new Set();
		}
	}
}

let npmPackagesCache: Set<string> | null = null;
function getNpmGlobalPackages(): Set<string> {
	if (npmPackagesCache !== null) return npmPackagesCache;
	
	try {
		const output = execSync("npm list -g --depth=0 --json 2>/dev/null", {
			encoding: "utf-8",
			timeout: 10000,
		});
		const data = JSON.parse(output);
		npmPackagesCache = new Set(Object.keys(data.dependencies || {}).map(s => s.toLowerCase()));
		return npmPackagesCache;
	} catch {
		npmPackagesCache = new Set();
		return new Set();
	}
}

function hasEnvVar(varNames: string[]): boolean {
	return varNames.some((name) => !!process.env[name]);
}

// ── Observer Detection ─────────────────────────────────────────────────

function isObserverInstalled(toolId: string, configDir?: string): boolean {
	if (!configDir) return false;
	
	try {
		switch (toolId) {
			case "claude-code":
			case "cursor": {
				const hookFile = join(configDir, "hooks.json");
				if (!existsSync(hookFile)) return false;
				const { readFileSync } = require("node:fs");
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
				const { readFileSync } = require("node:fs");
				const content = readFileSync(configFile, "utf-8");
				return content.includes("jobarbiter");
			}
			case "gemini": {
				const settingsFile = join(configDir, "settings.json");
				if (!existsSync(settingsFile)) return false;
				const { readFileSync } = require("node:fs");
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

// ── Main Detection Function ────────────────────────────────────────────

/**
 * Detect all AI tools on the system.
 * Returns a list of tools with installation status, version info,
 * and observer availability.
 */
export function detectAllTools(): DetectedTool[] {
	const results: DetectedTool[] = [];

	for (const def of TOOL_DEFINITIONS) {
		let installed = false;
		let version: string | undefined;
		let configDir: string | undefined = def.configDir;

		// Check binary in PATH
		if (def.binary && binExists(def.binary)) {
			installed = true;
			version = getBinVersion(def.binary);
		}

		// Check config directory
		if (!installed && def.configDir && existsSync(def.configDir)) {
			installed = true;
		}

		// Check macOS app
		if (!installed && def.macApp && macAppExists(def.macApp)) {
			installed = true;
		}

		// Check VS Code extension
		if (!installed && def.vscodeExtension) {
			const extensions = getVSCodeExtensions();
			if (extensions.includes(def.vscodeExtension.toLowerCase())) {
				installed = true;
			}
		}

		// Check Cursor extension
		if (!installed && def.cursorExtension) {
			const extensions = getCursorExtensions();
			if (extensions.includes(def.cursorExtension.toLowerCase())) {
				installed = true;
			}
		}

		// Check pip package
		if (!installed && def.pipPackage) {
			const packages = getPipPackages();
			if (packages.has(def.pipPackage.toLowerCase())) {
				installed = true;
			}
		}

		// Check npm package
		if (!installed && def.npmPackage) {
			const packages = getNpmGlobalPackages();
			if (packages.has(def.npmPackage.toLowerCase())) {
				installed = true;
			}
		}

		// Check environment variables (for API providers)
		if (!installed && def.envVars && def.envVars.length > 0) {
			if (hasEnvVar(def.envVars)) {
				installed = true;
			}
		}

		// Check if observer is installed (only if tool is installed and observer is available)
		const observerActive = installed && def.observerAvailable
			? isObserverInstalled(def.id, configDir)
			: false;

		results.push({
			id: def.id,
			name: def.name,
			category: def.category,
			installed,
			version,
			configDir: installed ? configDir : undefined,
			observerAvailable: def.observerAvailable,
			observerActive,
		});
	}

	return results;
}

/**
 * Get only installed tools.
 */
export function getInstalledTools(): DetectedTool[] {
	return detectAllTools().filter((t) => t.installed);
}

/**
 * Get tools by category.
 */
export function getToolsByCategory(category: ToolCategory): DetectedTool[] {
	return detectAllTools().filter((t) => t.category === category);
}

/**
 * Get tools that have observers available.
 */
export function getObservableTools(): DetectedTool[] {
	return detectAllTools().filter((t) => t.installed && t.observerAvailable);
}

/**
 * Get tools that need observer installation.
 */
export function getToolsNeedingObserver(): DetectedTool[] {
	return detectAllTools().filter(
		(t) => t.installed && t.observerAvailable && !t.observerActive
	);
}

/**
 * Format display name for a tool (includes version if available).
 */
export function formatToolDisplay(tool: DetectedTool): string {
	let display = tool.name;
	if (tool.version) {
		display += ` v${tool.version}`;
	}
	return display;
}
