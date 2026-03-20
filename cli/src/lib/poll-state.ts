/**
 * Poll State Management
 *
 * Read/write ~/.config/jobarbiter/observer/poll-state.json
 * Tracks per-source poll times, known sessions, pause windows,
 * disabled sources, and interval configuration.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ──────────────────────────────────────────────────────────────

export interface PauseWindow {
	start: string; // ISO timestamp
	end: string;   // ISO timestamp
}

export interface PollState {
	version: number;
	lastPoll: Record<string, string>; // source -> ISO timestamp
	knownSessionIds: string[];        // rolling 1000
	pauseWindows: PauseWindow[];
	disabledSources: string[];
	interval: number;                 // seconds
}

// ── Paths ──────────────────────────────────────────────────────────────

const OBSERVER_DIR = join(homedir(), ".config", "jobarbiter", "observer");
const POLL_STATE_FILE = join(OBSERVER_DIR, "poll-state.json");

function defaultPollState(): PollState {
	return {
		version: 1,
		lastPoll: {},
		knownSessionIds: [],
		pauseWindows: [],
		disabledSources: [],
		interval: 7200,
	};
}

// ── Core Functions ─────────────────────────────────────────────────────

export function loadPollState(): PollState {
	try {
		if (!existsSync(POLL_STATE_FILE)) return defaultPollState();
		const raw = readFileSync(POLL_STATE_FILE, "utf-8");
		const data = JSON.parse(raw) as Partial<PollState>;
		return {
			...defaultPollState(),
			...data,
		};
	} catch {
		return defaultPollState();
	}
}

export function savePollState(state: PollState): void {
	mkdirSync(OBSERVER_DIR, { recursive: true });
	writeFileSync(POLL_STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

export function addPauseWindow(start: string, end: string): void {
	const state = loadPollState();
	state.pauseWindows.push({ start, end });
	// Keep last 50 windows
	if (state.pauseWindows.length > 50) {
		state.pauseWindows = state.pauseWindows.slice(-50);
	}
	savePollState(state);
}

export function isInPauseWindow(timestamp: string): boolean {
	const state = loadPollState();
	const ts = new Date(timestamp).getTime();
	return state.pauseWindows.some((w) => {
		const start = new Date(w.start).getTime();
		const end = new Date(w.end).getTime();
		return ts >= start && ts <= end;
	});
}

export function addKnownSession(sessionId: string): void {
	const state = loadPollState();
	if (!state.knownSessionIds.includes(sessionId)) {
		state.knownSessionIds.push(sessionId);
		// Rolling window of 1000
		if (state.knownSessionIds.length > 1000) {
			state.knownSessionIds = state.knownSessionIds.slice(-1000);
		}
		savePollState(state);
	}
}

export function isKnownSession(sessionId: string): boolean {
	const state = loadPollState();
	return state.knownSessionIds.includes(sessionId);
}

export function getDisabledSources(): string[] {
	return loadPollState().disabledSources;
}

export function setDisabledSource(source: string): void {
	const state = loadPollState();
	if (!state.disabledSources.includes(source)) {
		state.disabledSources.push(source);
		savePollState(state);
	}
}

export function removeDisabledSource(source: string): void {
	const state = loadPollState();
	state.disabledSources = state.disabledSources.filter((s) => s !== source);
	savePollState(state);
}
