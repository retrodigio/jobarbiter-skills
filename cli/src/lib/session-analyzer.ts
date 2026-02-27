/**
 * Qualitative Session Analyzer
 *
 * Deterministic heuristic analysis of AI session transcripts.
 * Produces a structured WorkReport with qualitative and quantitative dimensions.
 *
 * PRIVACY: Never includes raw prompts, file contents, variable names, or secrets.
 * All evidence is anonymized into pattern descriptions.
 */

import type {
	ParsedTranscript,
	TranscriptMessage,
	WorkReport,
	CommunicationSignals,
	OrchestrationSignals,
	ProblemSolvingSignals,
	ToolFluencySignals,
	DomainSignals,
} from "./analyzer-types.js";

const AGENT_VERSION = "0.3.10";

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Analyze a single session transcript and produce a WorkReport.
 */
export function analyzeSession(transcript: ParsedTranscript): WorkReport {
	const userMessages = transcript.messages.filter((m) => m.role === "user");
	const assistantMessages = transcript.messages.filter((m) => m.role === "assistant");
	const toolMessages = transcript.messages.filter((m) => m.role === "tool");

	const commSignals = analyzeCommunication(userMessages);
	const orchSignals = analyzeOrchestration(transcript.messages);
	const psSignals = analyzeProblemSolving(transcript.messages);
	const tfSignals = analyzeToolFluency(toolMessages);
	const domainSignals = analyzeDomain(transcript.messages);
	const quantitative = extractQuantitativeMetrics(transcript);
	const projectCtx = extractProjectContext(domainSignals);

	const commScore = scoreCommunication(commSignals);
	const orchScore = scoreOrchestration(orchSignals);
	const psScore = scoreProblemSolving(psSignals);
	const tfScore = scoreToolFluency(tfSignals);

	const orchComplexity = classifyOrchestrationComplexity(orchSignals);

	const start = transcript.startTime || new Date().toISOString();
	const end = transcript.endTime || new Date().toISOString();
	const durationMinutes = computeDurationMinutes(start, end);

	const report: WorkReport = {
		agentIdentifier: `jobarbiter-analyzer-${transcript.source}`,
		agentVersion: AGENT_VERSION,
		sessionId: transcript.sessionId,
		reportType: "session_analysis",
		qualitativeAssessment: {
			communicationClarity: {
				score: commScore,
				evidence: buildCommunicationEvidence(commSignals),
			},
			orchestrationApproach: {
				score: orchScore,
				patterns: buildOrchestrationPatterns(orchSignals),
				complexity: orchComplexity,
			},
			problemSolving: {
				score: psScore,
				approach: classifyProblemSolvingApproach(psSignals),
				iterationDepth: psSignals.refinementDepth,
			},
			toolFluency: {
				score: tfScore,
				toolsUsed: tfSignals.uniqueTools,
				depth: buildToolDepth(tfSignals),
			},
			domainExpertise: {
				domains: domainSignals.frameworkSignals.length > 0
					? inferDomains(domainSignals)
					: inferDomainsFromExtensions(domainSignals),
				depth: buildDomainDepth(domainSignals),
			},
		},
		quantitativeMetrics: {
			...quantitative,
			sessionDurationMinutes: durationMinutes,
		},
		projectContext: projectCtx,
		observationPeriod: { start, end, durationMinutes },
		rawReportText: "", // filled below
	};

	report.rawReportText = generateNarrative(report);
	return report;
}

/**
 * Analyze multiple transcripts and produce a summary report.
 */
export function analyzeMultipleSessions(transcripts: ParsedTranscript[]): WorkReport {
	if (transcripts.length === 0) {
		return emptyReport();
	}
	if (transcripts.length === 1) {
		return analyzeSession(transcripts[0]);
	}

	// Analyze each, then aggregate
	const reports = transcripts.map(analyzeSession);

	const avgScore = (accessor: (r: WorkReport) => number) =>
		Math.round(reports.reduce((sum, r) => sum + accessor(r), 0) / reports.length);

	const allTools = [...new Set(reports.flatMap((r) => r.qualitativeAssessment.toolFluency.toolsUsed))];
	const allDomains = [...new Set(reports.flatMap((r) => r.qualitativeAssessment.domainExpertise.domains))];
	const allPatterns = [...new Set(reports.flatMap((r) => r.qualitativeAssessment.orchestrationApproach.patterns))];
	const allEvidence = [...new Set(reports.flatMap((r) => r.qualitativeAssessment.communicationClarity.evidence))].slice(0, 10);
	const allModels = [...new Set(reports.flatMap((r) => r.quantitativeMetrics.modelsUsed))];

	// Merge tool depth
	const mergedToolDepth: Record<string, string> = {};
	for (const r of reports) {
		for (const [tool, depth] of Object.entries(r.qualitativeAssessment.toolFluency.depth)) {
			const existing = mergedToolDepth[tool];
			if (!existing || depthRank(depth) > depthRank(existing)) {
				mergedToolDepth[tool] = depth;
			}
		}
	}

	// Merge domain depth
	const mergedDomainDepth: Record<string, string> = {};
	for (const r of reports) {
		for (const [domain, depth] of Object.entries(r.qualitativeAssessment.domainExpertise.depth)) {
			const existing = mergedDomainDepth[domain];
			if (!existing || depthRank(depth) > depthRank(existing)) {
				mergedDomainDepth[domain] = depth;
			}
		}
	}

	// Find highest orchestration complexity
	const complexities = reports.map((r) => r.qualitativeAssessment.orchestrationApproach.complexity);
	const bestComplexity = complexities.sort((a, b) => complexityRank(b) - complexityRank(a))[0] || "single_prompt";

	const starts = reports.map((r) => r.observationPeriod.start).sort();
	const ends = reports.map((r) => r.observationPeriod.end).sort();
	const totalDuration = reports.reduce((sum, r) => sum + r.observationPeriod.durationMinutes, 0);

	// Aggregate tech stacks
	const allTechStack = [...new Set(reports.flatMap((r) => r.projectContext.techStack))];

	const avgIterationDepth = Math.round(
		reports.reduce((sum, r) => sum + r.qualitativeAssessment.problemSolving.iterationDepth, 0) / reports.length,
	);

	const summary: WorkReport = {
		agentIdentifier: `jobarbiter-analyzer-summary`,
		agentVersion: AGENT_VERSION,
		sessionId: `summary-${reports.length}-sessions`,
		reportType: "periodic_summary",
		qualitativeAssessment: {
			communicationClarity: {
				score: avgScore((r) => r.qualitativeAssessment.communicationClarity.score),
				evidence: allEvidence,
			},
			orchestrationApproach: {
				score: avgScore((r) => r.qualitativeAssessment.orchestrationApproach.score),
				patterns: allPatterns.slice(0, 10),
				complexity: bestComplexity,
			},
			problemSolving: {
				score: avgScore((r) => r.qualitativeAssessment.problemSolving.score),
				approach: classifyAggregateApproach(reports),
				iterationDepth: avgIterationDepth,
			},
			toolFluency: {
				score: avgScore((r) => r.qualitativeAssessment.toolFluency.score),
				toolsUsed: allTools,
				depth: mergedToolDepth,
			},
			domainExpertise: {
				domains: allDomains,
				depth: mergedDomainDepth,
			},
		},
		quantitativeMetrics: {
			tokenCount: reports.reduce((sum, r) => sum + r.quantitativeMetrics.tokenCount, 0),
			sessionDurationMinutes: totalDuration,
			toolCallCount: reports.reduce((sum, r) => sum + r.quantitativeMetrics.toolCallCount, 0),
			messageCount: reports.reduce((sum, r) => sum + r.quantitativeMetrics.messageCount, 0),
			thinkingBlocks: reports.reduce((sum, r) => sum + r.quantitativeMetrics.thinkingBlocks, 0),
			modelsUsed: allModels,
		},
		projectContext: {
			name: "Multiple sessions",
			description: `Analysis of ${reports.length} sessions across ${allDomains.join(", ") || "various"} domains`,
			techStack: allTechStack,
			scope: reports.length > 5 ? "large" : reports.length > 2 ? "medium" : "small",
		},
		observationPeriod: {
			start: starts[0] || new Date().toISOString(),
			end: ends[ends.length - 1] || new Date().toISOString(),
			durationMinutes: totalDuration,
		},
		rawReportText: "",
	};

	summary.rawReportText = generateNarrative(summary);
	return summary;
}

// ── Communication Analysis ─────────────────────────────────────────────

function analyzeCommunication(userMessages: TranscriptMessage[]): CommunicationSignals {
	if (userMessages.length === 0) {
		return { avgPromptLength: 0, maxPromptLength: 0, hasStructuredPrompts: 0, hasContextProviding: 0, hasExamples: 0, totalUserMessages: 0 };
	}

	const lengths = userMessages.map((m) => m.text.length);
	const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
	const maxLen = Math.max(...lengths);

	let structured = 0;
	let contextProviding = 0;
	let examples = 0;

	for (const msg of userMessages) {
		const text = msg.text;
		// Structured: has bullets, numbered lists, headers, or code blocks
		if (/[-*•]\s/.test(text) || /^\d+\.\s/m.test(text) || /^#{1,3}\s/m.test(text) || /```/.test(text)) {
			structured++;
		}
		// Context-providing: mentions constraints, requirements, or provides background
		if (/\b(context|constraint|requirement|must|should|ensure|given that|assuming|note that)\b/i.test(text)) {
			contextProviding++;
		}
		// Examples: provides example input/output
		if (/\b(example|for instance|e\.g\.|such as|like this|sample)\b/i.test(text) || /```[\s\S]*```/.test(text)) {
			examples++;
		}
	}

	return {
		avgPromptLength: Math.round(avgLen),
		maxPromptLength: maxLen,
		hasStructuredPrompts: structured,
		hasContextProviding: contextProviding,
		hasExamples: examples,
		totalUserMessages: userMessages.length,
	};
}

function scoreCommunication(signals: CommunicationSignals): number {
	if (signals.totalUserMessages === 0) return 0;

	let score = 30; // baseline

	// Prompt length: too short (under 20 chars avg) or too long (over 5000) are suboptimal
	if (signals.avgPromptLength >= 50 && signals.avgPromptLength <= 2000) score += 15;
	else if (signals.avgPromptLength >= 20 && signals.avgPromptLength <= 5000) score += 8;

	// Structured prompts ratio
	const structuredRatio = signals.hasStructuredPrompts / signals.totalUserMessages;
	score += Math.round(structuredRatio * 25);

	// Context-providing ratio
	const contextRatio = signals.hasContextProviding / signals.totalUserMessages;
	score += Math.round(contextRatio * 15);

	// Examples ratio
	const exampleRatio = signals.hasExamples / signals.totalUserMessages;
	score += Math.round(exampleRatio * 15);

	return clamp(score, 0, 100);
}

function buildCommunicationEvidence(signals: CommunicationSignals): string[] {
	const evidence: string[] = [];
	if (signals.totalUserMessages === 0) return ["No user messages detected"];

	evidence.push(`${signals.totalUserMessages} user messages with average length ${signals.avgPromptLength} chars`);

	if (signals.hasStructuredPrompts > 0) {
		const pct = Math.round((signals.hasStructuredPrompts / signals.totalUserMessages) * 100);
		evidence.push(`${pct}% of prompts used structured formatting (bullets, headers, code blocks)`);
	}
	if (signals.hasContextProviding > 0) {
		evidence.push(`${signals.hasContextProviding} prompts included explicit constraints or context`);
	}
	if (signals.hasExamples > 0) {
		evidence.push(`${signals.hasExamples} prompts included examples or sample formats`);
	}
	if (signals.avgPromptLength < 30) {
		evidence.push("Prompts were very brief — minimal context provided");
	}

	return evidence;
}

// ── Orchestration Analysis ─────────────────────────────────────────────

function analyzeOrchestration(messages: TranscriptMessage[]): OrchestrationSignals {
	const toolSequences: string[][] = [];
	let currentSeq: string[] = [];
	let thinkingBlocks = 0;
	let hasMultiAgent = false;
	const toolsPerTurn: number[] = [];
	let turnTools = 0;

	for (const msg of messages) {
		if (msg.isThinking) {
			thinkingBlocks++;
		}
		if (msg.role === "tool" && msg.toolName) {
			currentSeq.push(msg.toolName);
			turnTools++;
			// Multi-agent signals
			if (/subagent|spawn|delegate|orchestrat/i.test(msg.toolName)) {
				hasMultiAgent = true;
			}
		} else if (msg.role === "user") {
			// New user turn — flush sequence
			if (currentSeq.length > 0) {
				toolSequences.push(currentSeq);
				currentSeq = [];
			}
			if (turnTools > 0) {
				toolsPerTurn.push(turnTools);
				turnTools = 0;
			}
		}
	}
	if (currentSeq.length > 0) toolSequences.push(currentSeq);
	if (turnTools > 0) toolsPerTurn.push(turnTools);

	const maxChain = toolSequences.reduce((max, seq) => Math.max(max, seq.length), 0);

	// Detect parallel tool use: multiple different tools in same sequence without user intervention
	const hasParallel = toolSequences.some((seq) => {
		const unique = new Set(seq);
		return unique.size > 1 && seq.length >= 3;
	});

	return {
		toolSequences,
		uniqueToolsPerTurn: toolsPerTurn,
		thinkingBlockCount: thinkingBlocks,
		hasParallelToolUse: hasParallel,
		hasMultiAgent,
		maxToolChainLength: maxChain,
	};
}

function classifyOrchestrationComplexity(signals: OrchestrationSignals): string {
	if (signals.hasMultiAgent) return "multi_agent";
	if (signals.maxToolChainLength >= 10 && signals.hasParallelToolUse) return "pipeline";
	if (signals.toolSequences.length > 0 && signals.maxToolChainLength >= 3) return "multi_tool";
	if (signals.toolSequences.length > 1) return "iterative";
	return "single_prompt";
}

function scoreOrchestration(signals: OrchestrationSignals): number {
	let score = 20;

	// Tool chain length
	if (signals.maxToolChainLength >= 5) score += 20;
	else if (signals.maxToolChainLength >= 3) score += 12;
	else if (signals.maxToolChainLength >= 1) score += 5;

	// Thinking blocks usage
	if (signals.thinkingBlockCount >= 3) score += 15;
	else if (signals.thinkingBlockCount >= 1) score += 8;

	// Parallel tool use
	if (signals.hasParallelToolUse) score += 15;

	// Multi-agent
	if (signals.hasMultiAgent) score += 20;

	// Multiple sequences (iterative work)
	if (signals.toolSequences.length >= 5) score += 10;
	else if (signals.toolSequences.length >= 2) score += 5;

	return clamp(score, 0, 100);
}

function buildOrchestrationPatterns(signals: OrchestrationSignals): string[] {
	const patterns: string[] = [];

	if (signals.toolSequences.length > 0) {
		patterns.push(`${signals.toolSequences.length} tool call sequences detected`);
	}
	if (signals.maxToolChainLength > 1) {
		patterns.push(`Longest tool chain: ${signals.maxToolChainLength} calls`);
	}
	if (signals.thinkingBlockCount > 0) {
		patterns.push(`${signals.thinkingBlockCount} thinking/reasoning blocks used`);
	}
	if (signals.hasParallelToolUse) {
		patterns.push("Parallel tool usage detected within turns");
	}
	if (signals.hasMultiAgent) {
		patterns.push("Multi-agent or subagent coordination detected");
	}

	return patterns;
}

// ── Problem-Solving Analysis ───────────────────────────────────────────

function analyzeProblemSolving(messages: TranscriptMessage[]): ProblemSolvingSignals {
	let errorRetryPairs = 0;
	let lastWasError = false;
	let iterationRounds = 0;
	let hasSystematicDebugging = false;
	let hasSubproblemDecomp = false;

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];

		// Track error → retry patterns
		if (msg.isError || (msg.role === "tool" && /error|fail|exception|traceback/i.test(msg.text))) {
			lastWasError = true;
		} else if (lastWasError && msg.role === "user") {
			errorRetryPairs++;
			lastWasError = false;

			// Check if the retry is systematic
			const text = msg.text.toLowerCase();
			if (/\b(log|error|stack|debug|trace|print|inspect|check)\b/.test(text)) {
				hasSystematicDebugging = true;
			}
		} else if (msg.role === "user") {
			lastWasError = false;
		}

		// Iteration rounds: count user messages after the first
		if (msg.role === "user" && i > 0) {
			iterationRounds++;
		}

		// Subproblem decomposition: user breaks work into steps
		if (msg.role === "user") {
			const text = msg.text.toLowerCase();
			if (/\b(first|step \d|then|next|after that|part \d|phase)\b/.test(text)) {
				hasSubproblemDecomp = true;
			}
		}
	}

	const userMsgCount = messages.filter((m) => m.role === "user").length;
	const refinementDepth = userMsgCount > 1 ? Math.round(iterationRounds / Math.max(1, errorRetryPairs || 1)) : 0;

	return {
		errorRetryPairs,
		totalIterationRounds: iterationRounds,
		hasSystematicDebugging,
		hasSubproblemDecomposition: hasSubproblemDecomp,
		refinementDepth: Math.min(refinementDepth, 20),
	};
}

function scoreProblemSolving(signals: ProblemSolvingSignals): number {
	let score = 30;

	// Systematic debugging (vs random retries)
	if (signals.hasSystematicDebugging) score += 20;

	// Subproblem decomposition
	if (signals.hasSubproblemDecomposition) score += 20;

	// Error recovery: having errors and recovering is good
	if (signals.errorRetryPairs >= 1 && signals.errorRetryPairs <= 10) score += 15;

	// Iteration depth: some iteration is good, too much may indicate thrashing
	if (signals.refinementDepth >= 2 && signals.refinementDepth <= 8) score += 15;
	else if (signals.refinementDepth >= 1) score += 8;

	return clamp(score, 0, 100);
}

function classifyProblemSolvingApproach(signals: ProblemSolvingSignals): string {
	if (signals.hasSubproblemDecomposition && signals.hasSystematicDebugging) return "systematic_decomposition";
	if (signals.hasSystematicDebugging) return "systematic_debugging";
	if (signals.hasSubproblemDecomposition) return "decomposition";
	if (signals.errorRetryPairs > 3) return "trial_and_error";
	if (signals.totalIterationRounds > 5) return "iterative_refinement";
	return "direct";
}

function classifyAggregateApproach(reports: WorkReport[]): string {
	const approaches = reports.map((r) => r.qualitativeAssessment.problemSolving.approach);
	// Return most common
	const counts: Record<string, number> = {};
	for (const a of approaches) counts[a] = (counts[a] || 0) + 1;
	return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "direct";
}

// ── Tool Fluency Analysis ──────────────────────────────────────────────

function analyzeToolFluency(toolMessages: TranscriptMessage[]): ToolFluencySignals {
	const toolCounts: Record<string, number> = {};
	const advancedFeatures: Record<string, string[]> = {};

	for (const msg of toolMessages) {
		if (!msg.toolName) continue;
		const tool = msg.toolName;
		toolCounts[tool] = (toolCounts[tool] || 0) + 1;

		// Detect advanced feature usage
		if (!advancedFeatures[tool]) advancedFeatures[tool] = [];
		const features = detectAdvancedFeatures(tool, msg.toolInput);
		for (const f of features) {
			if (!advancedFeatures[tool].includes(f)) {
				advancedFeatures[tool].push(f);
			}
		}
	}

	return {
		uniqueTools: Object.keys(toolCounts),
		toolUsageCounts: toolCounts,
		advancedFeatures,
	};
}

function detectAdvancedFeatures(tool: string, input?: Record<string, unknown>): string[] {
	const features: string[] = [];
	if (!input) return features;

	// Generic advanced feature detection
	const inputStr = JSON.stringify(input).toLowerCase();

	if (/regex|regexp|pattern/.test(inputStr)) features.push("regex_patterns");
	if (/recursive|glob|\*\*/.test(inputStr)) features.push("recursive_operations");
	if (/pipe|chain|stream/.test(inputStr)) features.push("data_piping");
	if (/parallel|concurrent|async/.test(inputStr)) features.push("parallel_execution");
	if (/template|scaffold|generate/.test(inputStr)) features.push("code_generation");

	// Tool-specific
	const toolLower = tool.toLowerCase();
	if (toolLower.includes("exec") || toolLower.includes("bash") || toolLower.includes("shell")) {
		if (/\|/.test(inputStr)) features.push("shell_piping");
		if (/&&|\|\|/.test(inputStr)) features.push("command_chaining");
	}
	if (toolLower.includes("edit") || toolLower.includes("write")) {
		features.push("file_modification");
	}
	if (toolLower.includes("search") || toolLower.includes("grep") || toolLower.includes("find")) {
		features.push("code_search");
	}
	if (toolLower.includes("browser") || toolLower.includes("web")) {
		features.push("web_automation");
	}

	return features;
}

function scoreToolFluency(signals: ToolFluencySignals): number {
	let score = 15;

	const toolCount = signals.uniqueTools.length;

	// Breadth
	if (toolCount >= 8) score += 25;
	else if (toolCount >= 5) score += 18;
	else if (toolCount >= 3) score += 12;
	else if (toolCount >= 1) score += 5;

	// Depth: advanced features
	const totalAdvanced = Object.values(signals.advancedFeatures).reduce((sum, f) => sum + f.length, 0);
	if (totalAdvanced >= 5) score += 25;
	else if (totalAdvanced >= 3) score += 15;
	else if (totalAdvanced >= 1) score += 8;

	// Usage frequency: higher counts suggest fluency
	const totalUses = Object.values(signals.toolUsageCounts).reduce((a, b) => a + b, 0);
	if (totalUses >= 30) score += 20;
	else if (totalUses >= 15) score += 12;
	else if (totalUses >= 5) score += 5;

	// Tool diversity in usage (not just one tool dominating)
	if (toolCount > 1) {
		const maxUse = Math.max(...Object.values(signals.toolUsageCounts));
		const diversityRatio = 1 - maxUse / Math.max(totalUses, 1);
		score += Math.round(diversityRatio * 15);
	}

	return clamp(score, 0, 100);
}

function buildToolDepth(signals: ToolFluencySignals): Record<string, string> {
	const depth: Record<string, string> = {};
	for (const tool of signals.uniqueTools) {
		const count = signals.toolUsageCounts[tool] || 0;
		const advanced = signals.advancedFeatures[tool]?.length || 0;
		if (advanced >= 2 || count >= 10) depth[tool] = "advanced";
		else if (count >= 3 || advanced >= 1) depth[tool] = "intermediate";
		else depth[tool] = "basic";
	}
	return depth;
}

// ── Domain Analysis ────────────────────────────────────────────────────

const DOMAIN_KEYWORDS: Record<string, string[]> = {
	"web-development": ["react", "vue", "angular", "nextjs", "express", "html", "css", "tailwind", "webpack", "vite", "dom", "api", "rest", "graphql", "http", "fetch", "cors"],
	"backend": ["server", "database", "sql", "postgres", "mongo", "redis", "api", "endpoint", "middleware", "auth", "jwt", "oauth"],
	"data-science": ["pandas", "numpy", "matplotlib", "jupyter", "sklearn", "tensorflow", "pytorch", "dataset", "model", "training"],
	"devops": ["docker", "kubernetes", "ci/cd", "pipeline", "deploy", "terraform", "ansible", "nginx", "aws", "gcp", "azure", "helm"],
	"mobile": ["ios", "android", "react-native", "flutter", "swift", "kotlin", "xcode"],
	"systems": ["rust", "c++", "kernel", "memory", "thread", "mutex", "socket", "binary", "compiler"],
	"writing": ["blog", "article", "document", "content", "draft", "edit", "publish", "copy", "prose"],
	"research": ["paper", "citation", "study", "analysis", "hypothesis", "experiment", "literature"],
};

const EXTENSION_TO_DOMAIN: Record<string, string> = {
	".tsx": "web-development", ".jsx": "web-development", ".vue": "web-development", ".svelte": "web-development",
	".css": "web-development", ".scss": "web-development", ".html": "web-development",
	".py": "data-science", ".ipynb": "data-science",
	".rs": "systems", ".cpp": "systems", ".c": "systems", ".h": "systems",
	".swift": "mobile", ".kt": "mobile",
	".tf": "devops", ".yml": "devops", ".yaml": "devops", ".Dockerfile": "devops",
	".md": "writing", ".mdx": "writing",
	".ts": "backend", ".js": "backend", ".go": "backend", ".java": "backend",
	".sql": "backend",
};

function analyzeDomain(messages: TranscriptMessage[]): DomainSignals {
	const fileExtensions: Set<string> = new Set();
	const techKeywords: Set<string> = new Set();
	const frameworkSignals: Set<string> = new Set();

	for (const msg of messages) {
		// Extract file extensions from tool inputs (anonymized)
		if (msg.toolInput) {
			const inputStr = JSON.stringify(msg.toolInput);
			const extMatches = inputStr.match(/\.[a-z]{1,10}\b/gi);
			if (extMatches) {
				for (const ext of extMatches) {
					const lower = ext.toLowerCase();
					if (EXTENSION_TO_DOMAIN[lower]) fileExtensions.add(lower);
				}
			}
		}

		// Scan text for tech keywords (don't store the actual text)
		const text = (msg.text || "").toLowerCase();
		for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
			for (const kw of keywords) {
				if (text.includes(kw)) {
					techKeywords.add(kw);
					frameworkSignals.add(domain);
				}
			}
		}
	}

	return {
		fileExtensions: [...fileExtensions],
		techKeywords: [...techKeywords],
		frameworkSignals: [...frameworkSignals],
		projectType: inferProjectType(messages),
	};
}

function inferProjectType(messages: TranscriptMessage[]): string {
	const allText = messages.map((m) => m.text).join(" ").toLowerCase();

	if (/\b(new project|scaffold|bootstrap|init|create.*app|greenfield)\b/.test(allText)) return "greenfield";
	if (/\b(bug|fix|patch|hotfix|regression|broken)\b/.test(allText)) return "debugging";
	if (/\b(refactor|migrate|upgrade|modernize|rewrite)\b/.test(allText)) return "maintenance";
	if (/\b(architect|design|plan|rfc|proposal|system design)\b/.test(allText)) return "architecture";
	if (/\b(test|spec|coverage|e2e|unit test|integration test)\b/.test(allText)) return "testing";
	return "general";
}

function inferDomains(signals: DomainSignals): string[] {
	return [...new Set(signals.frameworkSignals)];
}

function inferDomainsFromExtensions(signals: DomainSignals): string[] {
	const domains = new Set<string>();
	for (const ext of signals.fileExtensions) {
		const domain = EXTENSION_TO_DOMAIN[ext];
		if (domain) domains.add(domain);
	}
	return [...domains];
}

function buildDomainDepth(signals: DomainSignals): Record<string, string> {
	const depth: Record<string, string> = {};
	const domainKeywordCounts: Record<string, number> = {};

	for (const kw of signals.techKeywords) {
		for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
			if (keywords.includes(kw)) {
				domainKeywordCounts[domain] = (domainKeywordCounts[domain] || 0) + 1;
			}
		}
	}

	for (const [domain, count] of Object.entries(domainKeywordCounts)) {
		if (count >= 5) depth[domain] = "deep";
		else if (count >= 2) depth[domain] = "working";
		else depth[domain] = "surface";
	}

	return depth;
}

// ── Quantitative Metrics ───────────────────────────────────────────────

function extractQuantitativeMetrics(transcript: ParsedTranscript): Omit<WorkReport["quantitativeMetrics"], "sessionDurationMinutes"> {
	let tokenCount = 0;
	let toolCallCount = 0;
	let thinkingBlocks = 0;
	const modelsUsed = new Set<string>();

	for (const msg of transcript.messages) {
		if (msg.tokenUsage) {
			tokenCount += msg.tokenUsage.total || (msg.tokenUsage.input || 0) + (msg.tokenUsage.output || 0);
		}
		if (msg.role === "tool" && msg.toolName) toolCallCount++;
		if (msg.isThinking) thinkingBlocks++;
		if (msg.model) modelsUsed.add(msg.model);
	}

	return {
		tokenCount,
		toolCallCount,
		messageCount: transcript.messages.length,
		thinkingBlocks,
		modelsUsed: [...modelsUsed],
	};
}

// ── Project Context ────────────────────────────────────────────────────

function extractProjectContext(domainSignals: DomainSignals): WorkReport["projectContext"] {
	const domains = domainSignals.frameworkSignals.length > 0
		? [...domainSignals.frameworkSignals]
		: inferDomainsFromExtensions(domainSignals);

	const description = domains.length > 0
		? `${capitalize(domainSignals.projectType)} work in ${domains.join(", ")}`
		: `${capitalize(domainSignals.projectType)} development session`;

	// Build tech stack from keywords (anonymized)
	const techStack = domainSignals.techKeywords.slice(0, 10);

	const scope = techStack.length >= 5 ? "complex" : techStack.length >= 2 ? "moderate" : "simple";

	return {
		name: `${capitalize(domainSignals.projectType)} project`,
		description,
		techStack,
		scope,
	};
}

// ── Narrative Generation ───────────────────────────────────────────────

function generateNarrative(report: WorkReport): string {
	const lines: string[] = [];
	const qa = report.qualitativeAssessment;
	const qm = report.quantitativeMetrics;

	lines.push(`Session Analysis Report (${report.reportType})`);
	lines.push(`Session: ${report.sessionId}`);
	lines.push(`Duration: ${report.observationPeriod.durationMinutes} minutes`);
	lines.push(`Messages: ${qm.messageCount}, Tool calls: ${qm.toolCallCount}, Tokens: ${qm.tokenCount}`);
	lines.push("");

	lines.push(`Communication Clarity: ${qa.communicationClarity.score}/100`);
	for (const e of qa.communicationClarity.evidence) lines.push(`  - ${e}`);
	lines.push("");

	lines.push(`Orchestration: ${qa.orchestrationApproach.score}/100 (${qa.orchestrationApproach.complexity})`);
	for (const p of qa.orchestrationApproach.patterns) lines.push(`  - ${p}`);
	lines.push("");

	lines.push(`Problem Solving: ${qa.problemSolving.score}/100 (${qa.problemSolving.approach})`);
	lines.push(`  Iteration depth: ${qa.problemSolving.iterationDepth}`);
	lines.push("");

	lines.push(`Tool Fluency: ${qa.toolFluency.score}/100`);
	lines.push(`  Tools: ${qa.toolFluency.toolsUsed.join(", ") || "none detected"}`);
	for (const [tool, depth] of Object.entries(qa.toolFluency.depth)) {
		lines.push(`  ${tool}: ${depth}`);
	}
	lines.push("");

	lines.push(`Domains: ${qa.domainExpertise.domains.join(", ") || "undetected"}`);
	lines.push(`Project: ${report.projectContext.description}`);
	lines.push(`Tech Stack: ${report.projectContext.techStack.join(", ") || "undetected"}`);

	if (qm.modelsUsed.length > 0) {
		lines.push(`Models: ${qm.modelsUsed.join(", ")}`);
	}

	return lines.join("\n");
}

// ── Utilities ──────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function computeDurationMinutes(start: string, end: string): number {
	try {
		const s = new Date(start).getTime();
		const e = new Date(end).getTime();
		if (isNaN(s) || isNaN(e)) return 0;
		return Math.max(0, Math.round((e - s) / 60000));
	} catch {
		return 0;
	}
}

function depthRank(depth: string): number {
	switch (depth) {
		case "advanced": case "deep": return 3;
		case "intermediate": case "working": return 2;
		case "basic": case "surface": return 1;
		default: return 0;
	}
}

function complexityRank(c: string): number {
	switch (c) {
		case "pipeline": return 5;
		case "multi_agent": return 4;
		case "multi_tool": return 3;
		case "iterative": return 2;
		case "single_prompt": return 1;
		default: return 0;
	}
}

function emptyReport(): WorkReport {
	const now = new Date().toISOString();
	return {
		agentIdentifier: "jobarbiter-analyzer",
		agentVersion: AGENT_VERSION,
		sessionId: "empty",
		reportType: "session_analysis",
		qualitativeAssessment: {
			communicationClarity: { score: 0, evidence: ["No data"] },
			orchestrationApproach: { score: 0, patterns: [], complexity: "single_prompt" },
			problemSolving: { score: 0, approach: "direct", iterationDepth: 0 },
			toolFluency: { score: 0, toolsUsed: [], depth: {} },
			domainExpertise: { domains: [], depth: {} },
		},
		quantitativeMetrics: {
			tokenCount: 0, sessionDurationMinutes: 0, toolCallCount: 0,
			messageCount: 0, thinkingBlocks: 0, modelsUsed: [],
		},
		projectContext: { name: "Unknown", description: "No session data", techStack: [], scope: "none" },
		observationPeriod: { start: now, end: now, durationMinutes: 0 },
		rawReportText: "No session data available for analysis.",
	};
}
