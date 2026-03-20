/**
 * Uninstall Module
 *
 * Clean removal of all JobArbiter components:
 * observers, daemon, hooks, and optionally data/config.
 */

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { detectAgents, removeObservers } from "./observe.js";
import { uninstallDaemon } from "./launchd.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface UninstallOptions {
	keepData?: boolean;
	keepConfig?: boolean;
	force?: boolean;
}

export interface UninstallResult {
	observersRemoved: string[];
	daemonUninstalled: boolean;
	hooksDeleted: boolean;
	dataDeleted: boolean;
	configDeleted: boolean;
	errors: string[];
}

// ── Paths ──────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".config", "jobarbiter");
const OBSERVER_DIR = join(CONFIG_DIR, "observer");
const HOOKS_DIR = join(OBSERVER_DIR, "hooks");

// ── Main Function ──────────────────────────────────────────────────────

export function uninstallAll(options: UninstallOptions = {}): UninstallResult {
	const result: UninstallResult = {
		observersRemoved: [],
		daemonUninstalled: false,
		hooksDeleted: false,
		dataDeleted: false,
		configDeleted: false,
		errors: [],
	};

	// 1. Remove observers from all agents
	try {
		const agents = detectAgents();
		const withHooks = agents.filter((a) => a.hookInstalled);
		if (withHooks.length > 0) {
			const removeResult = removeObservers(withHooks.map((a) => a.id));
			result.observersRemoved = removeResult.removed;
		}
	} catch (err) {
		result.errors.push(`Failed to remove observers: ${err instanceof Error ? err.message : String(err)}`);
	}

	// 2. Uninstall launchd daemon
	try {
		uninstallDaemon();
		result.daemonUninstalled = true;
	} catch (err) {
		result.errors.push(`Failed to uninstall daemon: ${err instanceof Error ? err.message : String(err)}`);
	}

	// 3. Delete observer hooks directory
	try {
		if (existsSync(HOOKS_DIR)) {
			rmSync(HOOKS_DIR, { recursive: true, force: true });
			result.hooksDeleted = true;
		}
	} catch (err) {
		result.errors.push(`Failed to delete hooks: ${err instanceof Error ? err.message : String(err)}`);
	}

	// 4. Optionally delete observation data
	if (!options.keepData) {
		try {
			if (existsSync(OBSERVER_DIR)) {
				rmSync(OBSERVER_DIR, { recursive: true, force: true });
				result.dataDeleted = true;
			}
		} catch (err) {
			result.errors.push(`Failed to delete observer data: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	// 5. Optionally delete config
	if (!options.keepConfig) {
		try {
			if (existsSync(CONFIG_DIR)) {
				rmSync(CONFIG_DIR, { recursive: true, force: true });
				result.configDeleted = true;
			}
		} catch (err) {
			result.errors.push(`Failed to delete config: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	return result;
}
