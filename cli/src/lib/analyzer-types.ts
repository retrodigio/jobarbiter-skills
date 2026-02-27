/**
 * Types for the Qualitative Session Analyzer
 */

// ── Transcript Types ───────────────────────────────────────────────────

export type TranscriptSource =
	| "claude-code"
	| "openclaw"
	| "gemini"
	| "codex"
	| "aider"
	| "continue"
	| "cline"
	| "copilot-chat"
	| "cursor"
	| "windsurf"
	| "zed"
	| "amazon-q"
	| "warp";

export interface TranscriptMessage {
	role: "user" | "assistant" | "system" | "tool";
	text: string;
	timestamp?: string;
	toolName?: string;
	toolInput?: Record<string, unknown>;
	toolResult?: string;
	tokenUsage?: { input?: number; output?: number; total?: number };
	model?: string;
	isThinking?: boolean;
	isError?: boolean;
}

export interface ParsedTranscript {
	source: TranscriptSource;
	sessionId: string;
	filePath: string;
	messages: TranscriptMessage[];
	startTime: string | null;
	endTime: string | null;
}

// ── Work Report Types ──────────────────────────────────────────────────

export interface WorkReport {
	agentIdentifier: string;
	agentVersion: string;
	sessionId: string;
	reportType: "session_analysis" | "periodic_summary" | "historical_analysis";
	qualitativeAssessment: {
		communicationClarity: { score: number; evidence: string[] };
		orchestrationApproach: { score: number; patterns: string[]; complexity: string };
		problemSolving: { score: number; approach: string; iterationDepth: number };
		toolFluency: { score: number; toolsUsed: string[]; depth: Record<string, string> };
		domainExpertise: { domains: string[]; depth: Record<string, string> };
	};
	quantitativeMetrics: {
		tokenCount: number;
		sessionDurationMinutes: number;
		toolCallCount: number;
		messageCount: number;
		thinkingBlocks: number;
		modelsUsed: string[];
	};
	projectContext: {
		name: string;
		description: string;
		techStack: string[];
		scope: string;
	};
	observationPeriod: { start: string; end: string; durationMinutes: number };
	rawReportText: string;
}

// ── Analysis Intermediate Types ────────────────────────────────────────

export interface CommunicationSignals {
	avgPromptLength: number;
	maxPromptLength: number;
	hasStructuredPrompts: number; // count of prompts with bullets/headers/code blocks
	hasContextProviding: number; // count of prompts that provide context/constraints
	hasExamples: number; // count of prompts with examples
	totalUserMessages: number;
}

export interface OrchestrationSignals {
	toolSequences: string[][]; // sequences of tool calls
	uniqueToolsPerTurn: number[];
	thinkingBlockCount: number;
	hasParallelToolUse: boolean;
	hasMultiAgent: boolean;
	maxToolChainLength: number;
}

export interface ProblemSolvingSignals {
	errorRetryPairs: number; // count of error → retry sequences
	totalIterationRounds: number;
	hasSystematicDebugging: boolean; // evidence of reading errors, checking logs, etc.
	hasSubproblemDecomposition: boolean;
	refinementDepth: number; // avg iterations per task
}

export interface ToolFluencySignals {
	uniqueTools: string[];
	toolUsageCounts: Record<string, number>;
	advancedFeatures: Record<string, string[]>; // tool → advanced features used
}

export interface DomainSignals {
	fileExtensions: string[];
	techKeywords: string[];
	frameworkSignals: string[];
	projectType: string;
}
