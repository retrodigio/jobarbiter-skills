/**
 * Transcript Poller
 *
 * Core polling logic that discovers and processes new transcripts
 * from AI tools that don't support hooks (aider, goose, letta, etc.).
 * Uses existing discoverTranscripts() and parseTranscriptFile() from
 * transcript-reader.ts.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { discoverTranscripts, parseTranscriptFile } from "./transcript-reader.js";
import { type TranscriptSource } from "./analyzer-types.js";
import { detectAllTools } from "./detect-tools.js";
import { isPaused } from "./privacy-pause.js";
import {
	loadPollState,
	savePollState,
	addKnownSession,
	isKnownSession,
	isInPauseWindow,
} from "./poll-state.js";
import { analyzeSession } from "./session-analyzer.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface PollResult {
	sourcesPolled: string[];
	newSessions: number;
	skippedPaused: number;
	skippedDuplicate: number;
	errors: string[];
}

interface PollOptions {
	dryRun?: boolean;
	source?: string;
	verbose?: boolean;
	since?: Date;
}

// ── Paths ──────────────────────────────────────────────────────────────

const OBSERVER_DIR = join(homedir(), ".config", "jobarbiter", "observer");
const OBSERVATIONS_FILE = join(OBSERVER_DIR, "observations.json");

// ── Source-to-tool mapping ─────────────────────────────────────────────

const POLLER_SOURCES: TranscriptSource[] = [
	"aider", "goose", "letta", "zed", "amazon-q",
	"claude-code", "cursor", "codex", "gemini", "opencode",
	"continue", "cline", "copilot-chat", "windsurf", "openclaw", "warp", "idx",
];

// ── Main Entry Point ───────────────────────────────────────────────────

export async function pollAllSources(options?: PollOptions): Promise<PollResult> {
	const result: PollResult = {
		sourcesPolled: [],
		newSessions: 0,
		skippedPaused: 0,
		skippedDuplicate: 0,
		errors: [],
	};

	// Check pause state first
	if (isPaused()) {
		if (options?.verbose) {
			result.errors.push("Observation is paused — skipping poll");
		}
		return result;
	}

	const state = loadPollState();

	// Determine which sources to poll
	let sourcesToPoll: TranscriptSource[];
	if (options?.source) {
		if (!POLLER_SOURCES.includes(options.source as TranscriptSource)) {
			result.errors.push(`Unknown source: ${options.source}`);
			return result;
		}
		sourcesToPoll = [options.source as TranscriptSource];
	} else {
		// Filter to installed + not disabled
		const allTools = detectAllTools();
		const installedToolIds = new Set(allTools.filter((t) => t.installed).map((t) => t.id));
		const disabledSet = new Set(state.disabledSources);

		sourcesToPoll = POLLER_SOURCES.filter((source) => {
			// Map source names to tool IDs (most are the same)
			const toolId = sourceToToolId(source);
			return installedToolIds.has(toolId) && !disabledSet.has(source);
		});
	}

	if (sourcesToPoll.length === 0) {
		if (options?.verbose) {
			result.errors.push("No sources to poll (none installed or all disabled)");
		}
		return result;
	}

	// Discover all transcripts, then filter to sources we want
	const oldestSince = sourcesToPoll.reduce((oldest, source) => {
		const sourceDate = options?.since || (state.lastPoll[source]
			? new Date(state.lastPoll[source])
			: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
		return sourceDate < oldest ? sourceDate : oldest;
	}, new Date());

	const allDiscovered = discoverTranscripts({
		since: oldestSince,
		maxFiles: 50,
	});

	const sourcesToPollSet = new Set<string>(sourcesToPoll);

	for (const entry of allDiscovered) {
		const source = entry.source;
		if (!sourcesToPollSet.has(source)) continue;

		result.sourcesPolled.push(source);

		for (const file of entry.files) {
			try {
				const transcript = parseTranscriptFile(file, source);
				if (!transcript || transcript.messages.length < 3) continue;

				const sessionId = transcript.sessionId;

				// Dedup check
				if (isKnownSession(sessionId)) {
					result.skippedDuplicate++;
					continue;
				}

				// Pause window check
				if (transcript.startTime && isInPauseWindow(transcript.startTime)) {
					result.skippedPaused++;
					continue;
				}

				if (options?.dryRun) {
					result.newSessions++;
					if (options.verbose) {
						console.log(`  [dry-run] Would process: ${source}/${sessionId} (${transcript.messages.length} messages)`);
					}
					continue;
				}

				// Analyze and extract signals
				const report = analyzeSession(transcript);
				const observation = {
					timestamp: new Date().toISOString(),
					agent: source,
					sessionId,
					source: "poller",
					signals: {
						toolsUsed: report.qualitativeAssessment.toolFluency.toolsUsed,
						fileExtensions: report.qualitativeAssessment.domainExpertise.domains,
						messageCount: report.quantitativeMetrics.messageCount,
						thinkingBlocks: report.quantitativeMetrics.thinkingBlocks,
						tokenUsage: report.quantitativeMetrics.tokenCount > 0
							? { total: report.quantitativeMetrics.tokenCount }
							: null,
						duration: report.quantitativeMetrics.sessionDurationMinutes > 0
							? report.quantitativeMetrics.sessionDurationMinutes
							: null,
					},
				};

				appendObservation(observation);
				addKnownSession(sessionId);
				result.newSessions++;

				if (options?.verbose) {
					console.log(`  Processed: ${source}/${sessionId} (${transcript.messages.length} messages)`);
				}
			} catch (err) {
				result.errors.push(`${source}/${file}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		// Update last poll time for this source
		state.lastPoll[source] = new Date().toISOString();
	}

	// Save updated poll state
	savePollState(state);

	return result;
}

// ── Helpers ────────────────────────────────────────────────────────────

function sourceToToolId(source: TranscriptSource): string {
	const mapping: Record<string, string> = {
		"zed": "zed-ai",
		"amazon-q": "amazon-q",
		"copilot-chat": "copilot-chat",
		"warp": "warp-ai",
	};
	return mapping[source] || source;
}

function appendObservation(obs: Record<string, unknown>): void {
	mkdirSync(OBSERVER_DIR, { recursive: true });

	try {
		let data: Record<string, unknown>;
		if (existsSync(OBSERVATIONS_FILE)) {
			data = JSON.parse(readFileSync(OBSERVATIONS_FILE, "utf-8"));
		} else {
			data = {
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
			};
		}

		const sessions = data.sessions as Array<Record<string, unknown>>;
		sessions.push(obs);

		const accumulated = data.accumulated as Record<string, unknown>;
		accumulated.totalSessions = ((accumulated.totalSessions as number) || 0) + 1;

		// Update tool counts
		const signals = obs.signals as Record<string, unknown>;
		const toolsUsed = (signals.toolsUsed || []) as string[];
		const toolCounts = accumulated.toolCounts as Record<string, number>;
		for (const tool of toolsUsed) {
			toolCounts[tool] = (toolCounts[tool] || 0) + 1;
		}

		// Update token totals
		const tokenUsage = signals.tokenUsage as Record<string, number> | null;
		if (tokenUsage?.total) {
			accumulated.totalTokens = ((accumulated.totalTokens as number) || 0) + tokenUsage.total;
		}

		// Rolling window of 500 sessions
		if (sessions.length > 500) {
			data.sessions = sessions.slice(-500);
		}

		writeFileSync(OBSERVATIONS_FILE, JSON.stringify(data, null, 2) + "\n");
	} catch {
		// If file is corrupted, start fresh
		const freshData = {
			version: 1,
			installedAt: new Date().toISOString(),
			agents: {},
			sessions: [obs],
			accumulated: {
				totalSessions: 1,
				totalTokens: 0,
				toolCounts: {},
				domainSignals: [],
				lastSubmitted: null,
			},
		};
		writeFileSync(OBSERVATIONS_FILE, JSON.stringify(freshData, null, 2) + "\n");
	}
}
