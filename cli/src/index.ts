#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig, saveConfig, requireConfig, getConfigPath, type Config } from "./lib/config.js";
import { api, apiUnauthenticated, ApiError } from "./lib/api.js";
import { output, outputList, success, error, setJsonMode } from "./lib/output.js";

const program = new Command();

program
	.name("jobarbiter")
	.description("CLI for JobArbiter — the first AI Proficiency Marketplace")
	.version("0.3.0")
	.option("--json", "Output JSON (machine-readable)")
	.hook("preAction", (cmd) => {
		const opts = cmd.opts();
		if (opts.json) setJsonMode(true);
	});

// ============================================================
// register
// ============================================================

program
	.command("register")
	.description("Register a new account and save API key")
	.requiredOption("--email <email>", "Email address")
	.requiredOption("--type <type>", "Account type: worker or employer")
	.option("--base-url <url>", "API base URL", "https://jobarbiter-api-production.up.railway.app")
	.action(async (opts) => {
		try {
			const userType = opts.type === "seeker" ? "worker" : opts.type;
			if (!["worker", "employer"].includes(userType)) {
				error("Type must be 'worker' or 'employer'");
				process.exit(1);
			}

			// Step 1: Register and request verification code
			const registerData = await apiUnauthenticated(opts.baseUrl, "POST", "/v1/auth/register", {
				email: opts.email,
				userType,
			});

			success(`Verification code sent to ${opts.email} (expires in 15 minutes)`);

			// Step 2: Prompt for verification code
			const code = await promptForCode();
			if (!code) {
				error("Verification cancelled.");
				process.exit(1);
			}

			// Step 3: Verify the code
			const verifyData = await apiUnauthenticated(opts.baseUrl, "POST", "/v1/auth/verify", {
				email: opts.email,
				code: code.trim(),
			});

			// Step 4: Save config with API key
			saveConfig({
				apiKey: verifyData.apiKey as string,
				baseUrl: opts.baseUrl,
				userType: userType as "worker" | "employer",
			});

			success(`Email verified! API key saved to ${getConfigPath()}`);
			console.log(`  Key: ${(verifyData.apiKey as string).slice(0, 20)}... (save this — shown only once)`);
			output({ id: verifyData.id, email: opts.email, userType });
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// verify (standalone verification for existing registrations)
// ============================================================

program
	.command("verify-email")
	.description("Verify email with code (if registration was interrupted)")
	.requiredOption("--email <email>", "Email address")
	.option("--code <code>", "6-digit verification code")
	.option("--base-url <url>", "API base URL", "https://jobarbiter-api-production.up.railway.app")
	.action(async (opts) => {
		try {
			let code = opts.code;
			if (!code) {
				code = await promptForCode();
				if (!code) {
					error("Verification cancelled.");
					process.exit(1);
				}
			}

			const data = await apiUnauthenticated(opts.baseUrl, "POST", "/v1/auth/verify", {
				email: opts.email,
				code: code.trim(),
			});

			// Determine user type from response or default
			const userType = (data.userType as string) || "worker";

			saveConfig({
				apiKey: data.apiKey as string,
				baseUrl: opts.baseUrl,
				userType: userType as "worker" | "employer",
			});

			success(`Email verified! API key saved to ${getConfigPath()}`);
			console.log(`  Key: ${(data.apiKey as string).slice(0, 20)}... (save this — shown only once)`);
			output({ id: data.id, email: opts.email, userType });
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// resend-code
// ============================================================

program
	.command("resend-code")
	.description("Resend verification code to email")
	.requiredOption("--email <email>", "Email address")
	.option("--base-url <url>", "API base URL", "https://jobarbiter-api-production.up.railway.app")
	.action(async (opts) => {
		try {
			const data = await apiUnauthenticated(opts.baseUrl, "POST", "/v1/auth/resend-code", {
				email: opts.email,
			});

			success("If this email is registered and unverified, a new code has been sent.");
			console.log("  Use: jobarbiter verify --email " + opts.email);
		} catch (e) {
			handleError(e);
		}
	});

/**
 * Prompt user for verification code via stdin
 */
async function promptForCode(): Promise<string | null> {
	const readline = await import("node:readline");
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question("\nEnter verification code: ", (answer) => {
			rl.close();
			resolve(answer || null);
		});
	});
}

// ============================================================
// status
// ============================================================

program
	.command("status")
	.description("Check connection and account status")
	.action(async () => {
		try {
			const config = requireConfig();
			const health = await api(config, "GET", "/health");
			const profile = await api(config, "GET", "/v1/profile").catch(() => null);

			output({
				connected: true,
				service: health.service,
				version: health.version,
				userType: config.userType,
				baseUrl: config.baseUrl,
				hasProfile: !!profile,
				compositeScore: (profile as Record<string, unknown>)?.compositeScore || null,
				primaryTrack: (profile as Record<string, unknown>)?.primaryTrack || null,
				configPath: getConfigPath(),
			});
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// profile (worker commands)
// ============================================================

const profile = program.command("profile").description("Manage your AI proficiency profile");

profile
	.command("show")
	.description("Show your current proficiency profile")
	.action(async () => {
		try {
			const config = requireConfig();
			const data = await api(config, "GET", "/v1/profile");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

profile
	.command("create")
	.description("Create or update your proficiency profile")
	.option("--bio <text>", "Professional bio / summary")
	.option("--domains <list>", "Comma-separated domains: software-engineering,data-analytics,content,operations")
	.option("--tools <json>", 'Tools JSON: {"models":["claude","gpt-4"],"agents":["cursor","claude-code"]}')
	.option("--compensation-min <n>", "Minimum compensation", parseInt)
	.option("--compensation-max <n>", "Maximum compensation", parseInt)
	.option("--currency <code>", "Compensation currency", "USD")
	.option("--open-to <types>", "Comma-separated: full-time,fractional,project,advisory")
	.option("--remote <pref>", "Remote preference: remote|hybrid|onsite|any")
	.option("--actively-seeking", "Mark as actively seeking opportunities")
	.option("--not-seeking", "Mark as not actively seeking")
	.action(async (opts) => {
		try {
			const config = requireConfig();
			const body: Record<string, unknown> = {};

			if (opts.bio) body.bio = opts.bio;
			if (opts.domains) body.domains = opts.domains.split(",").map((s: string) => s.trim());
			if (opts.tools) body.tools = JSON.parse(opts.tools);
			if (opts.compensationMin) body.compensationMin = opts.compensationMin;
			if (opts.compensationMax) body.compensationMax = opts.compensationMax;
			if (opts.currency) body.compensationCurrency = opts.currency;
			if (opts.openTo) body.openTo = opts.openTo.split(",").map((s: string) => s.trim());
			if (opts.remote) body.remotePreference = opts.remote;
			if (opts.activelySeeking) body.activelySeeking = true;
			if (opts.notSeeking) body.activelySeeking = false;

			const data = await api(config, "POST", "/v1/profile", body);
			success("Profile created/updated. Embedding generated for matching.");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

profile
	.command("score")
	.description("Show detailed proficiency score breakdown (6 dimensions)")
	.action(async () => {
		try {
			const config = requireConfig();
			const data = await api(config, "GET", "/v1/profile/scores");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

profile
	.command("delete")
	.description("Delete your profile (GDPR)")
	.action(async () => {
		try {
			const config = requireConfig();
			const data = await api(config, "DELETE", "/v1/profile");
			success("Profile and all associated data deleted.");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// git (connect GitHub for analysis)
// ============================================================

const git = program.command("git").description("Connect and analyze git repositories");

git
	.command("connect")
	.description("Connect a GitHub/GitLab account for AI-assisted contribution analysis")
	.requiredOption("--provider <provider>", "Provider: github|gitlab|bitbucket", "github")
	.requiredOption("--username <username>", "Git username")
	.option("--token <token>", "Access token (or set GITHUB_TOKEN env)")
	.action(async (opts) => {
		try {
			const config = requireConfig();
			const token = opts.token || process.env.GITHUB_TOKEN || process.env.GITLAB_TOKEN;
			
			const data = await api(config, "POST", "/v1/attestations/git/connect", {
				provider: opts.provider,
				username: opts.username,
				accessToken: token,
			});
			success(`Git connected: ${opts.provider}/${opts.username}. Analysis queued.`);
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

git
	.command("analysis")
	.description("Show git analysis results (AI-assisted contribution detection)")
	.action(async () => {
		try {
			const config = requireConfig();
			const data = await api(config, "GET", "/v1/attestations/git/analysis");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// attest (agent attestation)
// ============================================================

program
	.command("attest")
	.description("Submit an agent attestation for AI proficiency")
	.requiredOption("--agent <name>", "Agent identifier (e.g., openclaw, cursor, claude-code)")
	.option("--version <version>", "Agent version")
	.option("--start <date>", "Observation start date (ISO 8601)")
	.option("--end <date>", "Observation end date (ISO 8601)")
	.option("--hours <n>", "Total observation hours", parseFloat)
	.option("--type <type>", "Attestation type: behavioral|capability|history", "behavioral")
	.requiredOption("--capabilities <json>", 'Capabilities JSON: [{"skill":"multi-agent-orchestration","level":"advanced","confidence":0.85,"evidence":"..."}]')
	.option("--patterns <json>", 'Patterns JSON: {"orchestrationComplexity":4,"toolDiversity":6,"outputVelocity":0.85,"qualitySignals":0.8}')
	.option("--signature <sig>", "Cryptographic signature")
	.action(async (opts) => {
		try {
			const config = requireConfig();
			
			const observationPeriod = {
				start: opts.start || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
				end: opts.end || new Date().toISOString(),
				totalHours: opts.hours || 100,
			};

			const capabilities = JSON.parse(opts.capabilities);
			const patterns = opts.patterns ? JSON.parse(opts.patterns) : {
				orchestrationComplexity: 3,
				toolDiversity: 4,
				outputVelocity: 0.7,
				qualitySignals: 0.7,
			};

			const data = await api(config, "POST", "/v1/attestations", {
				agentIdentifier: opts.agent,
				agentVersion: opts.version,
				observationPeriod,
				attestationType: opts.type,
				capabilities,
				patterns,
				signature: opts.signature,
			});

			success("Agent attestation submitted. Proficiency scores updated.");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// credentials (on-chain proficiency credentials)
// ============================================================

const credentials = program.command("credentials").description("Manage on-chain proficiency credentials");

credentials
	.command("list")
	.description("List your minted credentials")
	.action(async () => {
		try {
			const config = requireConfig();
			const data = await api(config, "GET", "/v1/credentials");
			outputList((data.credentials || []) as Array<Record<string, unknown>>, "Credentials");
		} catch (e) {
			handleError(e);
		}
	});

credentials
	.command("mint")
	.description("Mint your proficiency as an on-chain credential ($25 via x402)")
	.option("--type <type>", "Credential type: proficiency|track|milestone", "proficiency")
	.action(async () => {
		try {
			const config = requireConfig();
			const data = await api(config, "POST", "/v1/credentials/mint", {
				credentialType: "proficiency",
			});
			success("Credential minted! Immutable record created on Base chain.");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

credentials
	.command("show <id>")
	.description("Show credential details")
	.action(async (id) => {
		try {
			const config = requireConfig();
			const data = await api(config, "GET", `/v1/credentials/${id}`);
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// opportunities (worker: browse; employer: manage)
// ============================================================

const opportunities = program.command("opportunities").description("Browse or manage opportunities");

opportunities
	.command("list")
	.description("List matched opportunities (workers) or your posted opportunities (employers)")
	.action(async () => {
		try {
			const config = requireConfig();
			
			if (config.userType === "employer") {
				const data = await api(config, "GET", "/v1/opportunities");
				outputList((data.opportunities || []) as Array<Record<string, unknown>>, "Your Opportunities");
			} else {
				// Workers see matches
				const data = await api(config, "GET", "/v1/matches");
				const matches = (data.matches || []) as Array<Record<string, unknown>>;
				outputList(matches.map((m) => ({
					matchId: m.matchId,
					score: m.score,
					recommendation: m.recommendation,
					status: m.status,
					title: (m.opportunity as Record<string, unknown>)?.title,
					type: (m.opportunity as Record<string, unknown>)?.opportunityType,
					compensation: formatCompensation((m.opportunity as Record<string, unknown>)?.compensation as Record<string, unknown>),
					remote: ((m.opportunity as Record<string, unknown>)?.context as Record<string, unknown>)?.remote,
				})), "Matched Opportunities");
			}
		} catch (e) {
			handleError(e);
		}
	});

opportunities
	.command("show <id>")
	.description("Show opportunity or match details")
	.action(async (id) => {
		try {
			const config = requireConfig();
			
			if (config.userType === "employer") {
				const data = await api(config, "GET", `/v1/opportunities/${id}`);
				output(data);
			} else {
				// Workers view match details
				const data = await api(config, "GET", `/v1/matches/${id}`);
				output(data);
			}
		} catch (e) {
			handleError(e);
		}
	});

opportunities
	.command("create")
	.description("Create a new opportunity (employers only)")
	.requiredOption("--title <title>", "Opportunity title")
	.requiredOption("--description <desc>", "What this person will do")
	.option("--type <type>", "Type: full-time|fractional|project|advisory|trial", "full-time")
	.option("--track <track>", "Primary track required: orchestrator|systemsBuilder|domainTranslator")
	.option("--min-score <n>", "Minimum proficiency score (0-1000)", parseInt)
	.option("--required-tools <list>", "Comma-separated required tools")
	.option("--preferred-tools <list>", "Comma-separated preferred tools")
	.option("--history-min <months>", "Minimum history depth (e.g., 12-months)")
	.option("--compensation-min <n>", "Min compensation", parseInt)
	.option("--compensation-max <n>", "Max compensation", parseInt)
	.option("--currency <code>", "Currency", "USD")
	.option("--structure <type>", "Compensation structure: salary|hourly|project|equity")
	.option("--team-size <n>", "Team size", parseInt)
	.option("--token-budget <level>", "Token budget: low|medium|high|unlimited")
	.option("--autonomy <level>", "Autonomy level: low|medium|high")
	.option("--remote", "Remote position", true)
	.option("--onsite", "Onsite position")
	.option("--location <loc>", "Location/timezone")
	.action(async (opts) => {
		try {
			const config = requireConfig();
			
			if (config.userType !== "employer") {
				error("Only employers can create opportunities. Register with --type employer.");
				process.exit(1);
			}

			const requirements: Record<string, unknown> = {};
			if (opts.track) requirements.primaryTrack = opts.track;
			if (opts.minScore) requirements.minimumScore = opts.minScore;
			if (opts.requiredTools || opts.preferredTools) {
				requirements.toolFluency = {
					required: opts.requiredTools ? opts.requiredTools.split(",").map((s: string) => s.trim()) : [],
					preferred: opts.preferredTools ? opts.preferredTools.split(",").map((s: string) => s.trim()) : [],
				};
			}
			if (opts.historyMin) {
				requirements.historyDepth = { minimum: opts.historyMin };
			}

			const body: Record<string, unknown> = {
				title: opts.title,
				description: opts.description,
				opportunityType: opts.type,
				requirements,
				compensationMin: opts.compensationMin,
				compensationMax: opts.compensationMax,
				compensationCurrency: opts.currency,
				compensationStructure: opts.structure,
				teamSize: opts.teamSize,
				tokenBudget: opts.tokenBudget,
				autonomy: opts.autonomy,
				remote: opts.onsite ? false : true,
				location: opts.location,
			};

			const data = await api(config, "POST", "/v1/opportunities", body);
			success(`Opportunity created: "${opts.title}". Now matching against proficiency profiles.`);
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

opportunities
	.command("update <id>")
	.description("Update an opportunity (employers only)")
	.option("--title <title>", "New title")
	.option("--description <desc>", "New description")
	.option("--status <status>", "Status: active|paused|filled|closed")
	.action(async (id, opts) => {
		try {
			const config = requireConfig();
			const body: Record<string, unknown> = {};
			if (opts.title) body.title = opts.title;
			if (opts.description) body.description = opts.description;
			if (opts.status) body.status = opts.status;

			const data = await api(config, "PUT", `/v1/opportunities/${id}`, body);
			success("Opportunity updated.");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

opportunities
	.command("close <id>")
	.description("Close an opportunity (employers only)")
	.action(async (id) => {
		try {
			const config = requireConfig();
			const data = await api(config, "DELETE", `/v1/opportunities/${id}`);
			success("Opportunity closed.");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

opportunities
	.command("matches <id>")
	.description("Get matched candidate profiles for an opportunity ($50 via x402, employers only)")
	.action(async (id) => {
		try {
			const config = requireConfig();
			const data = await api(config, "GET", `/v1/opportunities/${id}/matches`);
			outputList((data.matches || []) as Array<Record<string, unknown>>, "Matched Candidates");
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// interest (express/decline interest in matches)
// ============================================================

const interest = program.command("interest").description("Express or decline interest in matches");

interest
	.command("express <matchId>")
	.description("Express interest in a match")
	.action(async (matchId) => {
		try {
			const config = requireConfig();
			const data = await api(config, "POST", `/v1/matches/${matchId}/interest`);

			if (data.mutualInterest) {
				success("MUTUAL INTEREST! Both sides are interested. You can now create an introduction.");
			} else {
				success(`Interest expressed. Status: ${data.status}`);
			}
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

interest
	.command("decline <matchId>")
	.description("Decline a match")
	.option("--reason <reason>", "Reason for declining")
	.action(async (matchId, opts) => {
		try {
			const config = requireConfig();
			const body: Record<string, unknown> = {};
			if (opts.reason) body.reason = opts.reason;

			const data = await api(config, "POST", `/v1/matches/${matchId}/decline`, body);
			success("Match declined.");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// search (employer search for candidates)
// ============================================================

program
	.command("search")
	.description("Search for candidates by proficiency criteria ($50 via x402, employers only)")
	.option("--track <track>", "Primary track: orchestrator|systemsBuilder|domainTranslator")
	.option("--min-score <n>", "Minimum composite score", parseInt)
	.option("--tools <list>", "Comma-separated tools required")
	.option("--history-min <months>", "Minimum history depth in months", parseInt)
	.action(async (opts) => {
		try {
			const config = requireConfig();
			
			// Note: This uses the opportunities matches endpoint
			// A dedicated search endpoint would be POST /v1/employer/search
			// For now, guide users to create an opportunity and view matches
			error("Direct search not yet implemented. Create an opportunity to find matching candidates:");
			console.log("  jobarbiter opportunities create --title 'Search' --description 'Looking for...' --track orchestrator --min-score 600");
			console.log("  jobarbiter opportunities matches <id>");
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// unlock (employer unlocks full profile)
// ============================================================

program
	.command("unlock <matchId>")
	.description("Unlock a candidate's full profile ($250 via x402, employers only)")
	.action(async (matchId) => {
		try {
			const config = requireConfig();
			const data = await api(config, "GET", `/v1/matches/${matchId}/full-profile`);
			success("Full profile unlocked.");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// introduce (create introduction on mutual interest)
// ============================================================

program
	.command("introduce <matchId>")
	.description("Create an introduction on mutual interest ($2,500 via x402)")
	.action(async (matchId) => {
		try {
			const config = requireConfig();
			const data = await api(config, "POST", "/v1/introductions", {
				matchId,
			});
			success("Introduction created! Contact information exchanged.");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// introductions (list/view introductions)
// ============================================================

const intro = program.command("intro").description("Manage introductions");

intro
	.command("list")
	.description("List your introductions")
	.action(async () => {
		try {
			const config = requireConfig();
			const data = await api(config, "GET", "/v1/introductions");
			outputList(
				(data.introductions || []) as Array<Record<string, unknown>>,
				"Introductions",
			);
		} catch (e) {
			handleError(e);
		}
	});

intro
	.command("show <id>")
	.description("Show introduction details")
	.action(async (id) => {
		try {
			const config = requireConfig();
			const data = await api(config, "GET", `/v1/introductions/${id}`);
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// webhook
// ============================================================

program
	.command("webhook <url>")
	.description("Set webhook URL for real-time notifications")
	.action(async (url) => {
		try {
			const config = requireConfig();
			const data = await api(config, "PATCH", "/v1/auth/webhook", {
				webhookUrl: url,
			});
			success(`Webhook set: ${url}`);
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// verify
// ============================================================

const verify = program.command("identity").description("Identity verification (GitHub, LinkedIn, domain)");

verify
	.command("linkedin <url>")
	.description("Submit LinkedIn profile for verification")
	.action(async (url) => {
		try {
			const config = requireConfig();
			const data = await api(config, "POST", "/v1/verification/linkedin", {
				linkedinUrl: url,
			});
			success("LinkedIn verification queued.");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

verify
	.command("github <username>")
	.description("Submit GitHub username for verification")
	.action(async (username) => {
		try {
			const config = requireConfig();
			const data = await api(config, "POST", "/v1/verification/github", {
				githubUsername: username,
			});
			success("GitHub verification queued.");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// tokens (sync token usage)
// ============================================================

program
	.command("tokens")
	.description("Sync token usage data from AI providers")
	.requiredOption("--provider <provider>", "Provider: anthropic|openai|google")
	.requiredOption("--start <date>", "Period start (YYYY-MM-DD)")
	.requiredOption("--end <date>", "Period end (YYYY-MM-DD)")
	.option("--input-tokens <n>", "Input tokens", parseInt)
	.option("--output-tokens <n>", "Output tokens", parseInt)
	.option("--total-tokens <n>", "Total tokens", parseInt)
	.option("--cost <n>", "Estimated cost USD", parseFloat)
	.option("--models <json>", "Model usage breakdown JSON")
	.action(async (opts) => {
		try {
			const config = requireConfig();
			const data = await api(config, "POST", "/v1/attestations/tokens/sync", {
				provider: opts.provider,
				periodStart: opts.start,
				periodEnd: opts.end,
				inputTokens: opts.inputTokens,
				outputTokens: opts.outputTokens,
				totalTokens: opts.totalTokens,
				estimatedCostUsd: opts.cost,
				modelUsage: opts.models ? JSON.parse(opts.models) : undefined,
			});
			success("Token usage synced. Proficiency scores updated.");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// Helpers
// ============================================================

function handleError(e: unknown): void {
	if (e instanceof ApiError) {
		if (e.status === 402) {
			error(`Payment required: ${e.body.error || "x402 USDC payment needed"}. Configure an x402-compatible wallet.`);
		} else if (e.status === 404) {
			error(`Not found: ${e.body.error || "Resource does not exist"}`);
		} else if (e.status === 403) {
			error(`Access denied: ${e.body.error || "You don't have permission for this action"}`);
		} else {
			error(`${e.status}: ${e.message}`);
		}
	} else if (e instanceof Error) {
		error(e.message);
	} else {
		error(String(e));
	}
	process.exit(1);
}

function formatCompensation(comp: Record<string, unknown> | undefined): string {
	if (!comp) return "Not listed";
	const min = comp.min as number;
	const max = comp.max as number;
	const cur = comp.currency as string || "USD";
	if (min && max) return `${cur} ${min.toLocaleString()}-${max.toLocaleString()}`;
	if (min) return `${cur} ${min.toLocaleString()}+`;
	if (max) return `${cur} up to ${max.toLocaleString()}`;
	return "Not listed";
}

program.parse();
