/**
 * Analysis Pipeline — connects Observer → Analyzer → Submitter
 *
 * Provides both automatic (fire-and-forget from observer) and manual entry points.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { discoverTranscripts, parseTranscriptFile, readAllTranscripts } from "./transcript-reader.js";
import { analyzeSession, analyzeMultipleSessions } from "./session-analyzer.js";
import { submitWorkReport, retryQueuedReports } from "./report-submitter.js";
import type { WorkReport, ParsedTranscript } from "./analyzer-types.js";

const CONFIG_DIR = join(homedir(), ".config", "jobarbiter");
const OBSERVER_DIR = join(CONFIG_DIR, "observer");
const ERROR_LOG = join(OBSERVER_DIR, "errors.log");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const UPDATE_STATUS_FILE = join(CONFIG_DIR, "update-status.json");
const VERSION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

function logError(msg: string): void {
	try {
		mkdirSync(OBSERVER_DIR, { recursive: true });
		appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] ${msg}\n`);
	} catch {
		// silent
	}
}

function isAnalyzeEnabled(): boolean {
	try {
		if (!existsSync(CONFIG_FILE)) return true; // default on
		const config = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
		return config.analyzeAndReport !== false;
	} catch {
		return true;
	}
}

/**
 * Periodic version check — queries npm registry at most once per 24h.
 */
async function checkVersionPeriodically(): Promise<void> {
	try {
		let status: Record<string, unknown> = {};
		if (existsSync(UPDATE_STATUS_FILE)) {
			status = JSON.parse(readFileSync(UPDATE_STATUS_FILE, "utf-8"));
		}

		const lastCheck = (status.lastVersionCheck as number) || 0;
		if (Date.now() - lastCheck < VERSION_CHECK_INTERVAL_MS) return;

		const res = await fetch("https://registry.npmjs.org/jobarbiter/latest", {
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) return;

		const data = (await res.json()) as { version?: string };
		if (!data.version) return;

		// Read current version
		const { dirname } = await import("node:path");
		const { fileURLToPath } = await import("node:url");
		const __dirname = dirname(fileURLToPath(import.meta.url));
		let currentVersion = "0.0.0";
		try {
			const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"));
			currentVersion = pkg.version || "0.0.0";
		} catch { /* fallback */ }

		const pa = data.version.split(".").map(Number);
		const pb = currentVersion.split(".").map(Number);
		let updateAvailable = false;
		for (let i = 0; i < 3; i++) {
			const diff = (pa[i] || 0) - (pb[i] || 0);
			if (diff > 0) { updateAvailable = true; break; }
			if (diff < 0) break;
		}

		mkdirSync(CONFIG_DIR, { recursive: true });
		writeFileSync(UPDATE_STATUS_FILE, JSON.stringify({
			...status,
			latestCliVersion: data.version,
			currentVersion,
			updateAvailable,
			lastVersionCheck: Date.now(),
			checkedAt: new Date().toISOString(),
		}, null, 2) + "\n");
	} catch {
		// non-critical
	}
}

/**
 * Run the full pipeline for recent transcripts (fire-and-forget from observer).
 * Non-blocking: catches all errors internally.
 */
export async function runAutoPipeline(): Promise<void> {
	try {
		// Lightweight daily version check
		await checkVersionPeriodically();

		if (!isAnalyzeEnabled()) return;

		// Find transcripts from last 2 hours
		const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
		const transcripts = readAllTranscripts({ since, maxFiles: 5 });

		if (transcripts.length === 0) return;

		// Analyze the most recent transcript
		const latest = transcripts[0];
		const report = analyzeSession(latest);

		// Skip empty/trivial sessions
		if (report.quantitativeMetrics.messageCount < 3) return;

		await submitWorkReport(report);

		// Also retry any queued reports
		await retryQueuedReports();
	} catch (err) {
		logError(`Auto pipeline error: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * Analyze a specific session file (manual mode).
 */
export function analyzeFile(filePath: string): WorkReport | null {
	// Detect source from path
	const source = filePath.includes(".claude") ? "claude-code"
		: filePath.includes(".openclaw") || filePath.includes(".clawdbot") ? "openclaw"
		: filePath.includes(".gemini") ? "gemini"
		: "claude-code"; // default

	const transcript = parseTranscriptFile(filePath, source);
	if (!transcript || transcript.messages.length === 0) return null;

	return analyzeSession(transcript);
}

/**
 * Analyze recent sessions and optionally submit.
 */
export async function analyzeRecent(options?: {
	dryRun?: boolean;
	maxFiles?: number;
	since?: Date;
}): Promise<{ reports: WorkReport[]; submitted: number; errors: string[] }> {
	const since = options?.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
	const maxFiles = options?.maxFiles ?? 20;
	const dryRun = options?.dryRun ?? false;

	const transcripts = readAllTranscripts({ since, maxFiles });
	const reports: WorkReport[] = [];
	const errors: string[] = [];
	let submitted = 0;

	for (const transcript of transcripts) {
		try {
			const report = analyzeSession(transcript);
			if (report.quantitativeMetrics.messageCount < 3) continue;
			reports.push(report);

			if (!dryRun) {
				const result = await submitWorkReport(report);
				if (result.success) submitted++;
				else if (result.error && result.error !== "not_authenticated") {
					errors.push(`${transcript.sessionId}: ${result.error}`);
				}
			}
		} catch (err) {
			errors.push(`${transcript.sessionId}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	return { reports, submitted, errors };
}
