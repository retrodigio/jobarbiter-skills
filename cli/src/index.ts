#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig, saveConfig, requireConfig, getConfigPath } from "./lib/config.js";
import { api, apiUnauthenticated, ApiError } from "./lib/api.js";
import { output, outputList, success, error, setJsonMode } from "./lib/output.js";

const program = new Command();

program
	.name("jobarbiter")
	.description("CLI for JobArbiter — trust-driven introductions for AI agents")
	.version("0.2.0")
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
	.requiredOption("--type <type>", "Account type: seeker or poster")
	.option("--base-url <url>", "API base URL", "https://jobarbiter-api-production.up.railway.app")
	.action(async (opts) => {
		try {
			const data = await apiUnauthenticated(opts.baseUrl, "POST", "/v1/auth/register", {
				email: opts.email,
				userType: opts.type,
			});

			saveConfig({
				apiKey: data.apiKey as string,
				baseUrl: opts.baseUrl,
				userType: opts.type,
			});

			success(`Registered as ${opts.type}. API key saved to ${getConfigPath()}`);
			output({ id: data.id, email: opts.email, userType: opts.type });
		} catch (e) {
			handleError(e);
		}
	});

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
				configPath: getConfigPath(),
			});
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// profile
// ============================================================

const profile = program.command("profile").description("Manage seeker profile");

profile
	.command("show")
	.description("Show current profile")
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
	.description("Create or update profile")
	.requiredOption("--title <title>", "Professional title")
	.option("--skills <json>", "Skills as JSON array")
	.option("--salary-min <n>", "Minimum salary", parseInt)
	.option("--salary-max <n>", "Maximum salary", parseInt)
	.option("--currency <code>", "Salary currency", "USD")
	.option("--remote <pref>", "Remote preference: remote|hybrid|onsite|flexible")
	.option("--location <json>", "Location as JSON: {city, state, country}")
	.option("--job-types <types>", "Comma-separated: full-time,contract,part-time")
	.option("--resume <text>", "Resume text for semantic matching (200-500 words ideal)")
	.option("--actively-looking", "Mark as actively looking", true)
	.action(async (opts) => {
		try {
			const config = requireConfig();
			const body: Record<string, unknown> = { title: opts.title };

			if (opts.skills) body.skills = JSON.parse(opts.skills);
			if (opts.salaryMin) body.salaryMin = opts.salaryMin;
			if (opts.salaryMax) body.salaryMax = opts.salaryMax;
			if (opts.currency) body.salaryCurrency = opts.currency;
			if (opts.remote) body.remotePreference = opts.remote;
			if (opts.location) body.location = JSON.parse(opts.location);
			if (opts.jobTypes) body.jobTypes = opts.jobTypes.split(",");
			if (opts.resume) body.resumeText = opts.resume;
			body.activelyLooking = opts.activelyLooking;

			const data = await api(config, "POST", "/v1/profile", body);
			success("Profile created/updated. Embedding generated for matching.");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// company
// ============================================================

const company = program.command("company").description("Manage company (poster)");

company
	.command("create")
	.description("Register a company")
	.requiredOption("--name <name>", "Company name")
	.option("--domain <domain>", "Company domain")
	.option("--industry <industry>", "Industry")
	.option("--size <size>", "Company size range")
	.option("--stage <stage>", "Funding stage")
	.option("--description <desc>", "What the company does")
	.option("--website <url>", "Website URL")
	.option("--location <loc>", "HQ location")
	.action(async (opts) => {
		try {
			const config = requireConfig();
			const data = await api(config, "POST", "/v1/company", {
				name: opts.name,
				domain: opts.domain,
				industry: opts.industry,
				size: opts.size,
				stage: opts.stage,
				description: opts.description,
				website: opts.website,
				hqLocation: opts.location,
			});
			success(`Company "${opts.name}" registered.`);
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// need (post a job)
// ============================================================

program
	.command("need")
	.description("Express a hiring need (post a role)")
	.requiredOption("--title <title>", "Role title")
	.requiredOption("--description <desc>", "What this person will do (natural language, 100-300 words)")
	.option("--must-have <json>", 'Required skills JSON: [{"skill":"TypeScript","minYears":3}]')
	.option("--nice-to-have <json>", 'Preferred skills JSON: [{"skill":"Kafka"}]')
	.option("--salary-min <n>", "Min salary", parseInt)
	.option("--salary-max <n>", "Max salary", parseInt)
	.option("--currency <code>", "Currency", "USD")
	.option("--equity <range>", "Equity range, e.g. 0.05-0.1%")
	.option("--benefits <text>", "Benefits description")
	.option("--remote <policy>", "remote|hybrid|onsite")
	.option("--location <loc>", "Location or timezone requirements")
	.option("--auto-interest", "Auto-express interest for matches above min score")
	.option("--min-score <n>", "Minimum match score for notifications", parseFloat)
	.action(async (opts) => {
		try {
			const config = requireConfig();
			const body: Record<string, unknown> = {
				title: opts.title,
				description: opts.description,
				requirements: {
					mustHave: opts.mustHave ? JSON.parse(opts.mustHave) : [],
					niceToHave: opts.niceToHave ? JSON.parse(opts.niceToHave) : [],
				},
				compensation: {
					salaryMin: opts.salaryMin,
					salaryMax: opts.salaryMax,
					currency: opts.currency,
					equity: opts.equity,
					benefits: opts.benefits,
				},
				remotePolicy: opts.remote,
				location: opts.location,
			};

			if (opts.autoInterest) body.autoExpressInterest = true;
			if (opts.minScore) body.minMatchScore = opts.minScore;

			const data = await api(config, "POST", "/v1/jobs", body);
			success(`Need expressed: "${opts.title}". Now matching against seekers.`);
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// matches
// ============================================================

const matches = program.command("matches").description("Generate and view matches");

matches
	.command("generate")
	.description("Generate matches for your profile")
	.action(async () => {
		try {
			const config = requireConfig();
			const data = await api(config, "POST", "/v1/matching/generate");
			success(data.message as string);
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

matches
	.command("list")
	.description("List current matches")
	.option("--min-score <n>", "Filter by minimum score", parseFloat)
	.action(async (opts) => {
		try {
			const config = requireConfig();
			const data = await api(config, "GET", "/v1/matches");
			let items = (data.matches || []) as Array<Record<string, unknown>>;

			if (opts.minScore) {
				items = items.filter((m) => (m.score as number) >= opts.minScore);
			}

			outputList(items.map((m) => ({
				id: m.id,
				score: m.score,
				status: m.status,
				title: m.jobTitle,
				salary: formatSalary(m.compensation as Record<string, unknown>),
				remote: m.remotePolicy,
				breakdown: m.scoreBreakdown,
			})), "Matches");
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// interest
// ============================================================

const interest = program.command("interest").description("Express or decline interest in matches");

interest
	.command("express <matchId>")
	.description("Express interest in a match")
	.action(async (matchId) => {
		try {
			const config = requireConfig();
			const data = await api(config, "POST", `/v1/interests/${matchId}/express`);

			if (data.status === "mutual_interest") {
				success("MUTUAL INTEREST! Both sides said yes. Introduction created.");
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
	.option("--reason <reason>", "Reason: salary_mismatch|skill_gap|location_incompatible|role_filled|other")
	.action(async (matchId, opts) => {
		try {
			const config = requireConfig();
			const body: Record<string, unknown> = {};
			if (opts.reason) body.reason = opts.reason;

			const data = await api(config, "POST", `/v1/interests/${matchId}/decline`, body);
			success("Match declined.");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// introductions
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

intro
	.command("accept <id>")
	.description("Accept introduction — reveals full profile (employers: $1.00 USDC via x402)")
	.action(async (id) => {
		try {
			const config = requireConfig();
			const data = await api(config, "POST", `/v1/introductions/${id}/accept`);
			success("Introduction accepted! Full profiles shared.");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

intro
	.command("propose-times <id> <times...>")
	.description("Propose interview times (ISO 8601 timestamps)")
	.action(async (id, times) => {
		try {
			const config = requireConfig();
			// Handle comma-separated or space-separated
			const allTimes = times.flatMap((t: string) => t.split(","));
			const data = await api(config, "POST", `/v1/introductions/${id}/propose-times`, {
				times: allTimes,
			});
			success(`Proposed ${allTimes.length} times. Waiting for confirmation.`);
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

intro
	.command("confirm-time <id> <time>")
	.description("Confirm an interview time")
	.action(async (id, time) => {
		try {
			const config = requireConfig();
			const data = await api(config, "POST", `/v1/introductions/${id}/confirm-time`, {
				time,
			});
			success("Interview scheduled!");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// outcome
// ============================================================

const outcome = program.command("outcome").description("Report outcomes and pay success fees");

outcome
	.command("report <introId>")
	.description("Report the outcome of an introduction")
	.requiredOption("--outcome <type>", "hired|offer_declined|no_offer|no_interview|withdrawn")
	.option("--start-date <date>", "Start date (for hires)")
	.option("--notes <text>", "Additional notes")
	.action(async (introId, opts) => {
		try {
			const config = requireConfig();
			const data = await api(config, "POST", `/v1/outcomes/${introId}/report`, {
				outcome: opts.outcome,
				startDate: opts.startDate,
				notes: opts.notes,
			});

			if (data.confirmed) {
				success("HIRE CONFIRMED by both sides! Congratulations.");
			} else {
				success(`Outcome reported: ${opts.outcome}`);
			}
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

outcome
	.command("success-fee <introId>")
	.description("Pay voluntary success fee after confirmed hire ($200 USDC via x402)")
	.action(async (introId) => {
		try {
			const config = requireConfig();
			const data = await api(config, "POST", `/v1/outcomes/${introId}/success-fee`);
			success("Success fee paid! Trust score significantly boosted.");
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
// attest
// ============================================================

program
	.command("attest")
	.description("Submit an agent attestation for your user's skills")
	.requiredOption("--agent <name>", "Your agent identifier")
	.option("--platform <platform>", "Agent platform (openclaw, claude-code, custom)")
	.option("--hours <n>", "Observation hours", parseFloat)
	.requiredOption("--skills <json>", 'Skills JSON: [{"name":"TypeScript","level":"expert","confidence":0.95}]')
	.option("--style <json>", "Working style JSON")
	.option("--summary <text>", "Overall assessment (2-3 sentences)")
	.requiredOption("--confidence <n>", "Overall confidence 0-1", parseFloat)
	.action(async (opts) => {
		try {
			const config = requireConfig();
			const data = await api(config, "POST", "/v1/attestations", {
				agentIdentifier: opts.agent,
				agentPlatform: opts.platform,
				observationHours: opts.hours,
				attestation: {
					skills: JSON.parse(opts.skills),
					workingStyle: opts.style ? JSON.parse(opts.style) : undefined,
					summary: opts.summary,
				},
				confidence: opts.confidence,
			});
			success("Attestation submitted. Trust score updated.");
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

// ============================================================
// verify
// ============================================================

const verify = program.command("verify").description("Identity and domain verification");

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

verify
	.command("domain <domain>")
	.description("Start domain verification (for company accounts)")
	.action(async (domain) => {
		try {
			const config = requireConfig();
			const data = await api(config, "POST", "/v1/verification/domain", {
				domain,
			});
			success(`Add this TXT record to your DNS: ${data.verificationToken}`);
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

verify
	.command("domain-check")
	.description("Check if domain TXT record has been configured")
	.action(async () => {
		try {
			const config = requireConfig();
			const data = await api(config, "POST", "/v1/verification/domain/check");

			if (data.status === "verified") {
				success("Domain verified!");
			} else {
				error(`Verification failed: ${data.message}`);
			}
			output(data);
		} catch (e) {
			handleError(e);
		}
	});

verify
	.command("status")
	.description("Check verification status")
	.action(async () => {
		try {
			const config = requireConfig();
			const data = await api(config, "GET", "/v1/verification/status");
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

function formatSalary(comp: Record<string, unknown> | undefined): string {
	if (!comp) return "Not listed";
	const min = comp.salaryMin as number;
	const max = comp.salaryMax as number;
	const cur = comp.currency as string || "USD";
	if (min && max) return `${cur} ${min.toLocaleString()}-${max.toLocaleString()}`;
	if (min) return `${cur} ${min.toLocaleString()}+`;
	if (max) return `${cur} up to ${max.toLocaleString()}`;
	return "Not listed";
}

program.parse();
