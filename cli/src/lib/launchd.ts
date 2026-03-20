/**
 * LaunchAgent Management for macOS
 *
 * Manages the ai.jobarbiter.observer LaunchAgent for periodic transcript polling.
 * Generates plist, writes to ~/Library/LaunchAgents/, manages via launchctl.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

// ── Constants ──────────────────────────────────────────────────────────

const LABEL = "ai.jobarbiter.observer";
const LAUNCH_AGENTS_DIR = join(homedir(), "Library", "LaunchAgents");
const PLIST_PATH = join(LAUNCH_AGENTS_DIR, `${LABEL}.plist`);
const OBSERVER_DIR = join(homedir(), ".config", "jobarbiter", "observer");
const LOG_PATH = join(OBSERVER_DIR, "poll.log");

// ── Types ──────────────────────────────────────────────────────────────

export interface DaemonStatus {
	installed: boolean;
	loaded: boolean;
	interval: number | null;
	plistPath: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

function resolveJobarbiterPath(): string {
	// Try to find the jobarbiter binary
	try {
		const path = execSync("command -v jobarbiter", { encoding: "utf-8", timeout: 3000 }).trim();
		if (path) return path;
	} catch {
		// Fall through
	}

	// Fallback: use process.execPath with the dist path
	// This covers the case where jobarbiter is run via node directly
	return process.execPath;
}

function generatePlist(intervalSeconds: number): string {
	const binaryPath = resolveJobarbiterPath();

	// If the binary is node itself, we need to figure out the script path
	const isNodeBinary = binaryPath.includes("node") || binaryPath.includes("bun");
	let programArgs: string;

	if (isNodeBinary) {
		// Find the actual CLI entry point
		const cliPath = join(__dirname, "..", "index.js");
		programArgs = `    <string>${binaryPath}</string>
    <string>${cliPath}</string>
    <string>observe</string>
    <string>poll</string>`;
	} else {
		programArgs = `    <string>${binaryPath}</string>
    <string>observe</string>
    <string>poll</string>`;
	}

	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>Nice</key>
  <integer>10</integer>
</dict>
</plist>
`;
}

function isLoaded(): boolean {
	try {
		const output = execSync(`launchctl list 2>/dev/null`, { encoding: "utf-8", timeout: 5000 });
		return output.includes(LABEL);
	} catch {
		return false;
	}
}

// ── Public API ─────────────────────────────────────────────────────────

export function installDaemon(intervalSeconds = 7200): void {
	mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
	mkdirSync(OBSERVER_DIR, { recursive: true });

	// Unload existing if present
	if (isLoaded()) {
		try {
			execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { timeout: 5000 });
		} catch {
			// May not be loaded
		}
	}

	// Write plist
	const plist = generatePlist(intervalSeconds);
	writeFileSync(PLIST_PATH, plist);

	// Load
	try {
		execSync(`launchctl load "${PLIST_PATH}"`, { timeout: 5000 });
	} catch (err) {
		throw new Error(`Failed to load LaunchAgent: ${err instanceof Error ? err.message : String(err)}`);
	}
}

export function uninstallDaemon(): void {
	// Unload
	if (isLoaded()) {
		try {
			execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { timeout: 5000 });
		} catch {
			// Best effort
		}
	}

	// Delete plist
	if (existsSync(PLIST_PATH)) {
		try {
			unlinkSync(PLIST_PATH);
		} catch {
			// Best effort
		}
	}
}

export function getDaemonStatus(): DaemonStatus {
	const installed = existsSync(PLIST_PATH);
	const loaded = isLoaded();

	let interval: number | null = null;
	if (installed) {
		try {
			const content = readFileSync(PLIST_PATH, "utf-8");
			const match = content.match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/);
			if (match) {
				interval = parseInt(match[1], 10);
			}
		} catch {
			// Best effort
		}
	}

	return {
		installed,
		loaded,
		interval,
		plistPath: PLIST_PATH,
	};
}

export function reloadDaemon(): void {
	if (!existsSync(PLIST_PATH)) {
		throw new Error("Daemon not installed. Run 'jobarbiter observe daemon install' first.");
	}

	try {
		execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { timeout: 5000 });
	} catch {
		// May not be loaded
	}

	try {
		execSync(`launchctl load "${PLIST_PATH}"`, { timeout: 5000 });
	} catch (err) {
		throw new Error(`Failed to reload daemon: ${err instanceof Error ? err.message : String(err)}`);
	}
}
