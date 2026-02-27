/**
 * Report Submitter — sends WorkReports to the JobArbiter API
 *
 * Handles auth, error recovery, local queuing, and submission logging.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { WorkReport } from "./analyzer-types.js";

// Read CLI version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
let CLI_VERSION = "0.0.0";
try {
	const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"));
	CLI_VERSION = pkg.version || "0.0.0";
} catch {
	// fallback
}

// ── Types ──────────────────────────────────────────────────────────────

export interface SubmitResult {
	success: boolean;
	reportId?: string;
	error?: string;
	queued?: boolean;
}

interface SubmittedRecord {
	timestamp: string;
	sessionId: string;
	reportId?: string;
	success: boolean;
	error?: string;
}

interface QueuedReport {
	report: WorkReport;
	queuedAt: string;
	attempts: number;
}

// ── Paths ──────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".config", "jobarbiter");
const OBSERVER_DIR = join(CONFIG_DIR, "observer");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const SUBMITTED_FILE = join(OBSERVER_DIR, "submitted-reports.json");
const QUEUE_FILE = join(OBSERVER_DIR, "queued-reports.json");
const ERROR_LOG = join(OBSERVER_DIR, "errors.log");

// ── PII Sanity Check ───────────────────────────────────────────────────

const PII_PATTERNS = [
	/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // email
	/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, // phone
	/\b\d{3}-\d{2}-\d{4}\b/, // SSN
	/\b(sk-|pk-|ghp_|gho_|glpat-|xoxb-|xoxp-)\S{10,}\b/, // API keys
];

function containsPII(text: string): boolean {
	return PII_PATTERNS.some((p) => p.test(text));
}

function sanitizeReport(report: WorkReport): WorkReport {
	// Deep check the rawReportText and evidence strings
	const sanitized = { ...report };

	if (containsPII(sanitized.rawReportText)) {
		sanitized.rawReportText = "[redacted — PII detected]";
	}

	// Check evidence strings
	const evidence = sanitized.qualitativeAssessment.communicationClarity.evidence;
	sanitized.qualitativeAssessment = {
		...sanitized.qualitativeAssessment,
		communicationClarity: {
			...sanitized.qualitativeAssessment.communicationClarity,
			evidence: evidence.map((e) => (containsPII(e) ? "[redacted]" : e)),
		},
	};

	return sanitized;
}

// ── Config Loading ─────────────────────────────────────────────────────

interface MinimalConfig {
	apiKey: string;
	baseUrl: string;
}

function loadAuthConfig(): MinimalConfig | null {
	// Env vars first
	const envKey = process.env.JOBARBITER_API_KEY;
	if (envKey) {
		return {
			apiKey: envKey,
			baseUrl: process.env.JOBARBITER_BASE_URL || "https://jobarbiter-api-production.up.railway.app",
		};
	}

	if (!existsSync(CONFIG_FILE)) return null;

	try {
		const raw = readFileSync(CONFIG_FILE, "utf-8");
		const config = JSON.parse(raw);
		if (!config.apiKey) return null;
		return {
			apiKey: config.apiKey,
			baseUrl: config.baseUrl || "https://jobarbiter-api-production.up.railway.app",
		};
	} catch {
		return null;
	}
}

// ── Submission Logging ─────────────────────────────────────────────────

function logSubmission(record: SubmittedRecord): void {
	try {
		mkdirSync(OBSERVER_DIR, { recursive: true });
		let records: SubmittedRecord[] = [];
		if (existsSync(SUBMITTED_FILE)) {
			records = JSON.parse(readFileSync(SUBMITTED_FILE, "utf-8"));
		}
		records.push(record);
		// Keep last 200
		if (records.length > 200) records = records.slice(-200);
		writeFileSync(SUBMITTED_FILE, JSON.stringify(records, null, 2) + "\n");
	} catch {
		// non-critical
	}
}

function logError(msg: string): void {
	try {
		mkdirSync(OBSERVER_DIR, { recursive: true });
		const line = `[${new Date().toISOString()}] ${msg}\n`;
		appendFileSync(ERROR_LOG, line);
	} catch {
		// truly silent
	}
}

// ── Queue Management ───────────────────────────────────────────────────

function enqueueReport(report: WorkReport): void {
	try {
		mkdirSync(OBSERVER_DIR, { recursive: true });
		let queue: QueuedReport[] = [];
		if (existsSync(QUEUE_FILE)) {
			queue = JSON.parse(readFileSync(QUEUE_FILE, "utf-8"));
		}
		queue.push({ report, queuedAt: new Date().toISOString(), attempts: 0 });
		// Cap at 50 queued
		if (queue.length > 50) queue = queue.slice(-50);
		writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2) + "\n");
	} catch {
		logError("Failed to enqueue report");
	}
}

function loadQueue(): QueuedReport[] {
	try {
		if (!existsSync(QUEUE_FILE)) return [];
		return JSON.parse(readFileSync(QUEUE_FILE, "utf-8"));
	} catch {
		return [];
	}
}

function saveQueue(queue: QueuedReport[]): void {
	try {
		writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2) + "\n");
	} catch {
		// non-critical
	}
}

// ── Version Meta Handling ──────────────────────────────────────────────

interface VersionMeta {
	latestCliVersion: string | null;
	minimumCliVersion: string;
	updateAvailable: boolean;
	changelogUrl: string;
}

const UPDATE_STATUS_FILE = join(CONFIG_DIR, "update-status.json");

function compareSemver(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const diff = (pa[i] || 0) - (pb[i] || 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

function handleVersionMeta(meta: VersionMeta | undefined): void {
	if (!meta) return;

	try {
		// Store update status for other components
		mkdirSync(CONFIG_DIR, { recursive: true });
		writeFileSync(UPDATE_STATUS_FILE, JSON.stringify({
			latestCliVersion: meta.latestCliVersion,
			minimumCliVersion: meta.minimumCliVersion,
			updateAvailable: meta.updateAvailable,
			changelogUrl: meta.changelogUrl,
			currentVersion: CLI_VERSION,
			checkedAt: new Date().toISOString(),
			lastVersionCheck: Date.now(),
		}, null, 2) + "\n");
	} catch {
		// non-critical
	}

	// Only log if not in auto mode (check env or process args)
	const isAuto = process.argv.includes("--auto");

	if (meta.updateAvailable && meta.latestCliVersion) {
		if (!isAuto) {
			console.log(`\n📦 JobArbiter v${meta.latestCliVersion} available. Run 'jobarbiter update' to upgrade.\n`);
		}
	}

	// Warn if current version is below minimum
	if (meta.minimumCliVersion && compareSemver(meta.minimumCliVersion, CLI_VERSION) > 0) {
		console.warn(`\n⚠️  WARNING: Your JobArbiter CLI v${CLI_VERSION} is below the minimum required version v${meta.minimumCliVersion}. Please run 'jobarbiter update' immediately.\n`);
	}
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Submit a WorkReport to the JobArbiter API.
 * Handles auth, PII checks, error recovery, and local logging.
 */
export async function submitWorkReport(report: WorkReport): Promise<SubmitResult> {
	const config = loadAuthConfig();
	if (!config) {
		// Not authenticated — skip silently
		return { success: false, error: "not_authenticated" };
	}

	const sanitized = sanitizeReport(report);

	try {
		const response = await fetch(`${config.baseUrl}/v1/reports/work`, {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${config.apiKey}`,
				"Content-Type": "application/json",
				"User-Agent": `jobarbiter-cli/${CLI_VERSION}`,
				"x-jobarbiter-version": CLI_VERSION,
			},
			body: JSON.stringify(sanitized),
			signal: AbortSignal.timeout(15000),
		});

		if (!response.ok) {
			const body = await response.json().catch(() => ({})) as Record<string, unknown>;
			const errMsg = (body.error as string) || `HTTP ${response.status}`;

			if (response.status === 401 || response.status === 403) {
				logSubmission({ timestamp: new Date().toISOString(), sessionId: report.sessionId, success: false, error: errMsg });
				return { success: false, error: errMsg };
			}

			// Server error or rate limit — queue for retry
			enqueueReport(report);
			logSubmission({ timestamp: new Date().toISOString(), sessionId: report.sessionId, success: false, error: `queued: ${errMsg}` });
			return { success: false, error: errMsg, queued: true };
		}

		const data = await response.json() as Record<string, unknown>;
		const reportId = data.reportId as string | undefined;

		// Handle version update notifications from server
		handleVersionMeta(data.meta as VersionMeta | undefined);

		logSubmission({ timestamp: new Date().toISOString(), sessionId: report.sessionId, reportId, success: true });
		return { success: true, reportId };
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		// Network failure — queue for retry
		enqueueReport(report);
		logError(`Submit failed: ${errMsg}`);
		logSubmission({ timestamp: new Date().toISOString(), sessionId: report.sessionId, success: false, error: `queued: ${errMsg}` });
		return { success: false, error: errMsg, queued: true };
	}
}

/**
 * Retry queued reports that failed previously.
 */
export async function retryQueuedReports(): Promise<{ succeeded: number; failed: number; remaining: number }> {
	const queue = loadQueue();
	if (queue.length === 0) return { succeeded: 0, failed: 0, remaining: 0 };

	const config = loadAuthConfig();
	if (!config) return { succeeded: 0, failed: 0, remaining: queue.length };

	let succeeded = 0;
	let failed = 0;
	const remaining: QueuedReport[] = [];

	for (const item of queue) {
		item.attempts++;
		if (item.attempts > 5) {
			failed++;
			continue; // drop after 5 attempts
		}

		try {
			const result = await submitWorkReport(item.report);
			if (result.success) {
				succeeded++;
			} else if (!result.queued) {
				failed++; // permanent failure (auth etc)
			} else {
				remaining.push(item); // re-queued
			}
		} catch {
			remaining.push(item);
		}
	}

	saveQueue(remaining);
	return { succeeded, failed, remaining: remaining.length };
}
