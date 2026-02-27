/**
 * Analysis Pipeline — connects Observer → Analyzer → Submitter
 *
 * Provides both automatic (fire-and-forget from observer) and manual entry points.
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { discoverTranscripts, parseTranscriptFile, readAllTranscripts } from "./transcript-reader.js";
import { analyzeSession, analyzeMultipleSessions } from "./session-analyzer.js";
import { submitWorkReport, retryQueuedReports } from "./report-submitter.js";
import type { WorkReport, ParsedTranscript } from "./analyzer-types.js";

const OBSERVER_DIR = join(homedir(), ".config", "jobarbiter", "observer");
const ERROR_LOG = join(OBSERVER_DIR, "errors.log");
const CONFIG_FILE = join(homedir(), ".config", "jobarbiter", "config.json");

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
 * Run the full pipeline for recent transcripts (fire-and-forget from observer).
 * Non-blocking: catches all errors internally.
 */
export async function runAutoPipeline(): Promise<void> {
	try {
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
