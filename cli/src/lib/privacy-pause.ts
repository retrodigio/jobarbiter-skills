/**
 * Privacy Pause Management
 *
 * Manages the PAUSED sentinel file at ~/.config/jobarbiter/observer/PAUSED
 * When paused, all observation hooks and pollers exit immediately.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { addPauseWindow, loadPollState, type PauseWindow } from "./poll-state.js";

// ── Paths ──────────────────────────────────────────────────────────────

const OBSERVER_DIR = join(homedir(), ".config", "jobarbiter", "observer");
const PAUSED_FILE = join(OBSERVER_DIR, "PAUSED");
const OBSERVATIONS_FILE = join(OBSERVER_DIR, "observations.json");

// ── Types ──────────────────────────────────────────────────────────────

interface PausedData {
	pausedAt: string;
	expiresAt: string | null;
}

export interface PauseStatus {
	paused: boolean;
	pausedAt: string | null;
	expiresAt: string | null;
	pauseWindows: PauseWindow[];
}

// ── Functions ──────────────────────────────────────────────────────────

export function pauseObservation(expiresAt?: Date): void {
	mkdirSync(OBSERVER_DIR, { recursive: true });
	const data: PausedData = {
		pausedAt: new Date().toISOString(),
		expiresAt: expiresAt ? expiresAt.toISOString() : null,
	};
	writeFileSync(PAUSED_FILE, JSON.stringify(data, null, 2) + "\n");
}

export function resumeObservation(): void {
	if (!existsSync(PAUSED_FILE)) return;

	// Read pause data to record pause window
	try {
		const raw = readFileSync(PAUSED_FILE, "utf-8");
		const data = JSON.parse(raw) as PausedData;
		const now = new Date().toISOString();
		addPauseWindow(data.pausedAt, now);
	} catch {
		// Best effort
	}

	// Remove PAUSED file
	try {
		unlinkSync(PAUSED_FILE);
	} catch {
		// Already removed
	}

	// Sweep observations.json for entries that leaked during pause
	sweepLeakedObservations();
}

export function isPaused(): boolean {
	if (!existsSync(PAUSED_FILE)) return false;

	try {
		const raw = readFileSync(PAUSED_FILE, "utf-8");
		const data = JSON.parse(raw) as PausedData;

		// Check if expired
		if (data.expiresAt) {
			const expiresAt = new Date(data.expiresAt).getTime();
			if (Date.now() >= expiresAt) {
				// Auto-resume: expired
				autoResume(data);
				return false;
			}
		}

		return true;
	} catch {
		return false;
	}
}

export function getPauseStatus(): PauseStatus {
	const state = loadPollState();
	const result: PauseStatus = {
		paused: false,
		pausedAt: null,
		expiresAt: null,
		pauseWindows: state.pauseWindows,
	};

	if (!existsSync(PAUSED_FILE)) return result;

	try {
		const raw = readFileSync(PAUSED_FILE, "utf-8");
		const data = JSON.parse(raw) as PausedData;

		// Check for expiry
		if (data.expiresAt) {
			const expiresAt = new Date(data.expiresAt).getTime();
			if (Date.now() >= expiresAt) {
				autoResume(data);
				return result;
			}
		}

		result.paused = true;
		result.pausedAt = data.pausedAt;
		result.expiresAt = data.expiresAt;
	} catch {
		// Corrupted PAUSED file
	}

	return result;
}

// ── Internal Helpers ───────────────────────────────────────────────────

function autoResume(data: PausedData): void {
	const now = new Date().toISOString();
	addPauseWindow(data.pausedAt, data.expiresAt || now);

	try {
		unlinkSync(PAUSED_FILE);
	} catch {
		// Already removed
	}

	sweepLeakedObservations();
}

function sweepLeakedObservations(): void {
	if (!existsSync(OBSERVATIONS_FILE)) return;

	try {
		const raw = readFileSync(OBSERVATIONS_FILE, "utf-8");
		const data = JSON.parse(raw);
		if (!Array.isArray(data.sessions)) return;

		const state = loadPollState();
		const originalCount = data.sessions.length;

		data.sessions = data.sessions.filter((session: { timestamp?: string }) => {
			if (!session.timestamp) return true;
			const ts = new Date(session.timestamp).getTime();
			return !state.pauseWindows.some((w) => {
				const start = new Date(w.start).getTime();
				const end = new Date(w.end).getTime();
				return ts >= start && ts <= end;
			});
		});

		if (data.sessions.length !== originalCount) {
			writeFileSync(OBSERVATIONS_FILE, JSON.stringify(data, null, 2) + "\n");
		}
	} catch {
		// Best effort
	}
}
