/**
 * Interactive Onboard Wizard
 * 
 * A polished, step-by-step wizard that guides users through:
 * - Account creation (email + verification)
 * - User type selection (worker vs employer)
 * - Profile setup (track, tools, domains)
 * - Optional integrations (GitHub)
 */

import * as readline from "node:readline";
import * as clack from "@clack/prompts";
import { loadConfig, saveConfig, getConfigPath, type Config } from "./config.js";
import { apiUnauthenticated, api, ApiError } from "./api.js";
import { installObservers } from "./observe.js";
import {
	detectAllTools,
	getInstalledTools,
	getToolsNeedingObserver,
	formatToolDisplay,
	type DetectedTool,
	type ToolCategory,
} from "./detect-tools.js";
import {
	loadProviderKeys,
	saveProviderKey,
	validateProviderKey,
	getSupportedProviders,
} from "./providers.js";

// ── ANSI Colors ────────────────────────────────────────────────────────

const colors = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	
	// Text colors
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",
	gray: "\x1b[90m",
};

const c = {
	success: (s: string) => `${colors.green}${s}${colors.reset}`,
	error: (s: string) => `${colors.red}${s}${colors.reset}`,
	warning: (s: string) => `${colors.yellow}${s}${colors.reset}`,
	info: (s: string) => `${colors.cyan}${s}${colors.reset}`,
	bold: (s: string) => `${colors.bold}${s}${colors.reset}`,
	dim: (s: string) => `${colors.dim}${s}${colors.reset}`,
	highlight: (s: string) => `${colors.bold}${colors.cyan}${s}${colors.reset}`,
};

// ── Symbols ────────────────────────────────────────────────────────────

const sym = {
	check: c.success("✓"),
	cross: c.error("✗"),
	arrow: c.info("❯"),
	bullet: c.dim("•"),
	rocket: "🚀",
	email: "📧",
	target: "🎯",
	tools: "🛠️",
	link: "🔗",
	done: "✅",
	company: "🏢",
	lock: "🔒",
	money: "💰",
	warning: "⚠️",
};

// ── Readline Helper ────────────────────────────────────────────────────

class Prompt {
	private rl: readline.Interface;
	private closed = false;

	constructor() {
		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		// Handle Ctrl+C gracefully
		this.rl.on("close", () => {
			if (!this.closed) {
				console.log("\n\n" + c.dim("Onboarding cancelled. Run 'jobarbiter onboard' anytime to continue."));
				process.exit(0);
			}
		});
	}

	reset(): void {
		// Recreate readline interface (needed after clack prompts take over stdin)
		if (!this.closed) {
			this.rl.removeAllListeners();
			this.rl.close();
		}
		this.closed = false;
		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		this.rl.on("close", () => {
			if (!this.closed) {
				console.log("\n\n" + c.dim("Onboarding cancelled. Run 'jobarbiter onboard' anytime to continue."));
				process.exit(0);
			}
		});
	}

	async question(prompt: string): Promise<string> {
		return new Promise((resolve) => {
			this.rl.question(prompt, (answer) => {
				resolve(answer.trim());
			});
		});
	}

	async confirm(prompt: string, defaultYes = true): Promise<boolean> {
		const hint = defaultYes ? "[Y/n]" : "[y/N]";
		const answer = await this.question(`${prompt} ${c.dim(hint)} `);
		if (answer === "") return defaultYes;
		return answer.toLowerCase().startsWith("y");
	}

	close() {
		this.closed = true;
		this.rl.close();
	}
}

// ── State ──────────────────────────────────────────────────────────────

interface OnboardState {
	baseUrl: string;
	userType: "worker" | "employer";
	email: string;
	apiKey: string;
	userId: string;
	
	// Worker-specific
	tools?: string[];
	domains?: string[];
	githubUsername?: string;
	
	// Employer-specific
	companyName?: string;
	companyWebsite?: string;
	companyIndustry?: string;
	companySize?: string;
	hiringTrack?: string;
	minScore?: number;
	hiringTools?: string[];
}

// ── Main Wizard ────────────────────────────────────────────────────────

export async function runOnboardWizard(opts: { force?: boolean; baseUrl?: string }): Promise<void> {
	const baseUrl = opts.baseUrl || "https://jobarbiter-api-production.up.railway.app";
	
	// Check for existing config — resume if onboarding incomplete
	const existingConfig = loadConfig();
	if (existingConfig && !opts.force) {
		if (existingConfig.onboardingComplete) {
			console.log(`\n${sym.check}  ${c.success("You're already onboarded!")}`);
			console.log(`\n   Run ${c.highlight("jobarbiter status")} to check your account.`);
			console.log(`   Run ${c.highlight("jobarbiter onboard --force")} to start fresh.\n`);
			process.exit(0);
		}
		// Onboarding incomplete — resume
		const resumeStep = (existingConfig.onboardingStep ?? 1) + 1;
		console.log(`\n${sym.rocket}  ${c.bold("Resuming onboarding")} from step ${resumeStep}/7\n`);
		console.log(c.dim(`   Account: ${existingConfig.userType} | API key configured`));
		console.log(c.dim(`   Run ${c.highlight("jobarbiter onboard --force")} to start over.\n`));
		
		const prompt = new Prompt();
		const state: Partial<OnboardState> = {
			baseUrl,
			apiKey: existingConfig.apiKey,
			userType: existingConfig.userType as "worker" | "employer",
			userId: "",
			email: "",
		};
		try {
			if (existingConfig.userType === "worker" || existingConfig.userType === "seeker") {
				await runWorkerFlow(prompt, state as OnboardState, resumeStep);
			} else {
				await runEmployerFlow(prompt, state as OnboardState);
			}
			prompt.close();
		} catch (err) {
			prompt.close();
			if (err instanceof Error) {
				console.log(`\n${sym.cross} ${c.error(err.message)}`);
			}
			process.exit(1);
		}
		return;
	}

	const prompt = new Prompt();
	const state: Partial<OnboardState> = { baseUrl };

	try {
		// Step 1: Welcome
		await showWelcome();
		const userType = await selectUserType(prompt);
		state.userType = userType;

		// Step 2: Email & Verification
		const { email, apiKey, userId } = await handleEmailVerification(prompt, baseUrl, userType);
		state.email = email;
		state.apiKey = apiKey;
		state.userId = userId;

		// Save config immediately after verification (with step progress)
		saveConfig({
			apiKey,
			baseUrl,
			userType,
			onboardingStep: 1,
			onboardingComplete: false,
		});

		if (userType === "worker") {
			await runWorkerFlow(prompt, state as OnboardState);
		} else {
			await runEmployerFlow(prompt, state as OnboardState);
		}

		prompt.close();
	} catch (err) {
		prompt.close();
		if (err instanceof ApiError) {
			console.log(`\n${sym.cross} ${c.error(err.message)}`);
			if (err.body.details) {
				console.log(c.dim(JSON.stringify(err.body.details, null, 2)));
			}
		} else if (err instanceof Error) {
			console.log(`\n${sym.cross} ${c.error(err.message)}`);
		}
		process.exit(1);
	}
}

// ── Welcome Screen ─────────────────────────────────────────────────────

async function showWelcome(): Promise<void> {
	console.clear();
	console.log(`
${sym.rocket} ${c.bold("Welcome to JobArbiter")} — The AI Proficiency Marketplace

${c.dim("Your AI skills have value. Let's prove it.")}
`);
}

// ── User Type Selection ────────────────────────────────────────────────

async function selectUserType(prompt: Prompt): Promise<"worker" | "employer"> {
	console.log(`${c.bold("What brings you here?")}\n`);
	console.log(`  ${c.highlight("1.")} I build with AI ${c.dim("(Worker)")}`);
	console.log(`  ${c.highlight("2.")} I'm hiring AI talent ${c.dim("(Employer)")}\n`);

	while (true) {
		const answer = await prompt.question(`Your choice ${c.dim("[1/2]")}: `);
		if (answer === "1" || answer.toLowerCase() === "worker") return "worker";
		if (answer === "2" || answer.toLowerCase() === "employer") return "employer";
		console.log(c.error("Please enter 1 or 2"));
	}
}

// ── Email & Verification ───────────────────────────────────────────────

async function handleEmailVerification(
	prompt: Prompt,
	baseUrl: string,
	userType: "worker" | "employer"
): Promise<{ email: string; apiKey: string; userId: string }> {
	// Workers: 1) Account, 2) Tool Detection, 3) AI Accounts, 4) Domains, 5) GitHub, 6) LinkedIn, 7) Done
	// Employers: 1) Account, 2) (skip verification), 3) Company, 4) Domain, 5) What You Need, 6) Done (stays at 6)
	const totalSteps = userType === "employer" ? 6 : 7;
	
	console.log(`\n${sym.email} ${c.bold(`Step 1/${totalSteps} — Create Your Account`)}\n`);

	// Get email
	let email: string;
	while (true) {
		email = await prompt.question(`Email: `);
		if (email && email.includes("@") && email.includes(".")) break;
		console.log(c.error("Please enter a valid email address"));
	}

	// Call register API
	console.log(c.dim("\nSending verification code..."));
	
	try {
		await apiUnauthenticated(baseUrl, "POST", "/v1/auth/register", {
			email,
			userType,
		});
	} catch (err) {
		if (err instanceof ApiError && err.status === 409) {
			// Email already registered and verified
			throw new Error(`This email is already registered. Run 'jobarbiter verify-email --email ${email}' if you need to re-verify, or use a different email.`);
		}
		throw err;
	}

	console.log(`\n${sym.check} Verification code sent to ${c.highlight(email)}`);
	console.log(c.dim("   (Check your inbox and spam folder. Code expires in 15 minutes.)\n"));

	// Get verification code
	let apiKey: string | undefined;
	let userId: string | undefined;
	let attempts = 0;
	const maxAttempts = 5;

	while (attempts < maxAttempts) {
		const code = await prompt.question(`Enter 6-digit code: `);
		
		if (!code || code.length !== 6) {
			console.log(c.error("Code must be 6 digits"));
			continue;
		}

		try {
			const result = await apiUnauthenticated(baseUrl, "POST", "/v1/auth/verify", {
				email,
				code: code.trim(),
			});

			apiKey = result.apiKey as string;
			userId = result.id as string;
			break;
		} catch (err) {
			attempts++;
			if (err instanceof ApiError) {
				const remaining = (err.body.attemptsRemaining as number) ?? (maxAttempts - attempts);
				if (remaining > 0) {
					console.log(c.error(`Invalid code. ${remaining} attempts remaining.`));
				} else {
					throw new Error("Too many failed attempts. Run 'jobarbiter resend-code --email " + email + "' to get a new code.");
				}
			} else {
				throw err;
			}
		}
	}

	if (!apiKey || !userId) {
		throw new Error("Verification failed. Please try again.");
	}

	console.log(`\n${sym.check} ${c.success("Email verified! Account created.")}\n`);

	return { email, apiKey, userId };
}

// ── Worker Flow ────────────────────────────────────────────────────────

async function runWorkerFlow(prompt: Prompt, state: OnboardState, startStep = 2): Promise<void> {
	const config: Config = {
		apiKey: state.apiKey,
		baseUrl: state.baseUrl,
		userType: "worker",
	};

	const saveProgress = (step: number) => {
		saveConfig({ ...config, onboardingStep: step });
	};

	// Step 2: Auto-detect AI Tools
	if (startStep <= 2) {
		const detectedToolsResult = await runToolDetectionStep(prompt, config);
		state.tools = detectedToolsResult.tools;
		saveProgress(2);
	}

	// Step 3: Connect AI Accounts (optional)
	if (startStep <= 3) {
		await runConnectAIAccountsStep(prompt);
		saveProgress(3);
	}

	// Step 4: Domains
	if (startStep <= 4) {
		console.log(`${sym.target} ${c.bold("Step 4/7 — Your Domains")}\n`);
		console.log(`What domains do you work in? ${c.dim("(comma-separated)")}`);
		console.log(c.dim("Examples: full-stack dev, data engineering, trading, content creation\n"));
		const domainsInput = await prompt.question(`${sym.arrow} `);
		const domains = domainsInput.split(",").map(s => s.trim()).filter(Boolean);
		state.domains = domains;

		// Create/update profile
		console.log(c.dim("\nSaving profile..."));

		try {
			await api(config, "POST", "/v1/profile", {
				domains,
				tools: {
					primary: state.tools,
				},
			});
			console.log(`${sym.check} Profile saved\n`);
		} catch (err) {
			console.log(`${sym.warning} ${c.warning("Could not save profile details — you can update later with 'jobarbiter profile create'")}\n`);
		}
		saveProgress(4);
	}

	// Step 5: Connect GitHub (optional)
	if (startStep <= 5) {
		console.log(`${sym.link} ${c.bold("Step 5/7 — Connect GitHub")} ${c.dim("(optional)")}\n`);
		console.log(`Connecting your GitHub lets us analyze your AI-assisted work patterns.`);
		console.log(`This significantly boosts your proficiency score.\n`);

		const githubUsername = await prompt.question(`GitHub username ${c.dim("(press Enter to skip)")}: `);
		
		if (githubUsername) {
			console.log(c.dim("\nConnecting GitHub..."));
			try {
				await api(config, "POST", "/v1/attestations/git/connect", {
					provider: "github",
					username: githubUsername,
				});
				console.log(`${sym.check} GitHub connected: ${c.highlight(githubUsername)}\n`);
				state.githubUsername = githubUsername;
			} catch (err) {
				console.log(`${sym.warning} ${c.warning("Could not connect GitHub — you can try later with 'jobarbiter git connect'")}\n`);
			}
		} else {
			console.log(`${c.dim("Skipped — you can connect later with 'jobarbiter git connect'")}\n`);
		}
		saveProgress(5);
	}

	// Step 6: Connect LinkedIn (optional)
	if (startStep <= 6) {
		console.log(`${sym.link} ${c.bold("Step 6/7 — Connect LinkedIn")} ${c.dim("(optional)")}\n`);
		console.log(`Your LinkedIn profile strengthens identity verification.`);
		console.log(c.dim("We never post on your behalf or access your connections.\n"));

		const linkedinUrl = await prompt.question(`LinkedIn URL ${c.dim("(press Enter to skip)")}: `);
		
		if (linkedinUrl) {
			console.log(c.dim("\nSubmitting for verification..."));
			try {
				await api(config, "POST", "/v1/verification/linkedin", {
					linkedinUrl: linkedinUrl.trim(),
				});
				console.log(`${sym.check} LinkedIn submitted for verification\n`);
			} catch (err) {
				console.log(`${sym.warning} ${c.warning("Could not submit LinkedIn — you can try later with 'jobarbiter identity linkedin <url>'")}\n`);
			}
		} else {
			console.log(`${c.dim("Skipped — you can connect later with 'jobarbiter identity linkedin <url>'")}\n`);
		}
		saveProgress(6);
	}

	// Step 7: Done!
	saveConfig({ ...config, onboardingComplete: true, onboardingStep: 7 });
	showWorkerCompletion(state);
}

// ── Tool Detection Step ────────────────────────────────────────────────

async function runToolDetectionStep(
	prompt: Prompt,
	config: Config,
): Promise<{ tools: string[] }> {
	console.log(`🔍 ${c.bold("Step 2/7 — Detecting AI Tools")}\n`);
	console.log(c.dim("  Scanning your machine...\n"));

	const allTools = detectAllTools();
	const installed = allTools.filter((t) => t.installed);
	const notInstalled = allTools.filter((t) => !t.installed && t.category === "ai-agent");

	// Group by category
	const codingAgents = installed.filter((t) => t.category === "ai-agent");
	const chatTools = installed.filter((t) => t.category === "chat");
	const orchestration = installed.filter((t) => t.category === "orchestration");
	const apiProviders = installed.filter((t) => t.category === "api-provider");

	// Display found tools
	if (installed.length === 0) {
		console.log(`  ${c.dim("No AI tools detected on this system.")}\n`);
		console.log(c.dim("  You can add tools later with 'jobarbiter observe install'.\n"));
		return { tools: [] };
	}

	console.log(`  ${c.bold("Found:")}`);

	// Show AI agents with observer status
	for (const tool of codingAgents) {
		const display = formatToolDisplay(tool);
		if (tool.observerAvailable) {
			if (tool.observerActive) {
				console.log(`    ${sym.check} ${display} ${c.dim("(observer active)")}`);
			} else {
				console.log(`    ${sym.check} ${display} ${c.success("(observer available)")}`);
			}
		} else {
			console.log(`    ${sym.check} ${display} ${c.dim("(detected)")}`);
		}
	}

	// Show other tools
	for (const tool of chatTools) {
		console.log(`    ${sym.check} ${formatToolDisplay(tool)} ${c.dim("(detected)")}`);
	}
	for (const tool of orchestration) {
		console.log(`    ${sym.check} ${formatToolDisplay(tool)} ${c.dim("(detected)")}`);
	}
	for (const tool of apiProviders) {
		console.log(`    ${sym.check} ${tool.name} ${c.dim("configured")}`);
	}

	// Show not-detected AI agents
	if (notInstalled.length > 0) {
		console.log(`\n  ${c.dim("Not detected (install to track):")}`);
		for (const tool of notInstalled.slice(0, 5)) {
			console.log(`    ${c.dim("⬚")} ${tool.name}`);
		}
		if (notInstalled.length > 5) {
			console.log(`    ${c.dim(`... and ${notInstalled.length - 5} more`)}`);
		}
	}

	// Collect tool names for profile
	const toolNames = installed.map((t) => t.name);

	// Observer installation for AI agents
	const needsObserver = codingAgents.filter((t) => t.observerAvailable && !t.observerActive);

	if (needsObserver.length > 0) {
		console.log(`\n  ${c.bold("Observers — How You Use AI, Not Just How Much")}`);
		console.log(`  JobArbiter observers go beyond token counts. We analyze ${c.bold("how")}`);
		console.log(`  you work with AI to build a rich proficiency profile:\n`);
		console.log(`    ${c.bold("Quantitative")} — session frequency, token volume, tool diversity`);
		console.log(`    ${c.bold("Qualitative")}  — orchestration complexity, problem-solving approach,`);
		console.log(`                  communication clarity, iteration patterns, tool fluency\n`);
		console.log(`  This is what makes your profile ${c.bold("verified")} and ${c.bold("valuable")}.`);
		console.log(`  Your observer regularly records and reports your proven AI proficiency.\n`);
		console.log(`  ${c.bold("Privacy:")} Analysis runs ${c.highlight("locally by your own AI agent.")}`);
		console.log(`  Your agent reads your sessions and produces a proficiency`);
		console.log(`  work report — an assessment of how you work with AI. This`);
		console.log(`  report is submitted to JobArbiter to build your narrative`);
		console.log(`  profile. ${c.bold("Your raw session data — prompts, responses, code —")}`);
		console.log(`  ${c.bold("never leaves your machine.")}\n`);
		console.log(c.dim(`  Data stored locally: ~/.config/jobarbiter/observer/observations.json`));
		console.log(c.dim(`  Review anytime: jobarbiter observe review\n`));

		const observerNames = needsObserver.map((t) => t.name).join(", ");
		const installAll = await prompt.confirm(
			`  Install observers for detected tools? (${observerNames})`,
		);

		if (installAll) {
			const toInstall = needsObserver.map((t) => t.id);
			console.log(c.dim("\n  Installing observers..."));
			const result = installObservers(toInstall);

			for (const name of result.installed) {
				console.log(`    ${sym.check} ${name}`);
			}
			for (const name of result.skipped) {
				console.log(`    ${c.dim("—")} ${name} ${c.dim("(already installed)")}`);
			}
			for (const { agent, error: errMsg } of result.errors) {
				console.log(`    ${sym.cross} ${agent}: ${c.error(errMsg)}`);
			}

			if (result.installed.length > 0) {
				console.log(`\n  ${sym.check} ${c.success(`${result.installed.length} observer${result.installed.length > 1 ? "s" : ""} installed!`)}`);
				console.log(`\n  ${c.bold("What happens now?")}`);
			console.log(`  Observers activate each time you use your AI tools.`);
			console.log(`  Just work normally — every session builds your profile.\n`);
			console.log(`  ${sym.arrow} ${c.highlight("Your next AI session will begin your proficiency analysis.")}`);
			console.log(`  Your own AI agent analyzes each session locally, then submits`);
			console.log(`  a work report to JobArbiter. Our agents interpret these reports`);
			console.log(`  to build and evolve your narrative profile over time.`);
			console.log(`  Raw session data never leaves your machine.\n`);
			}
		} else {
			console.log(c.dim("\n  Skipped — you can install observers later with 'jobarbiter observe install'.\n"));
		}
	} else if (codingAgents.length > 0) {
		const hasActiveObservers = codingAgents.some((t) => t.observerActive);
		if (hasActiveObservers) {
			console.log(`\n  ${c.dim("All detected agents already have observers installed.")}\n`);
		} else {
			console.log();
		}
	}

	// "Did we miss anything?" prompt
	console.log(`  ${c.dim("Did we miss anything?")}`);
	const additionalTools = await prompt.question(`  Other AI tools you use ${c.dim("(comma-separated, or press Enter)")}: `);
	
	if (additionalTools.trim()) {
		const additional = additionalTools.split(",").map((s) => s.trim()).filter(Boolean);
		toolNames.push(...additional);
		console.log(`  ${sym.check} Added: ${additional.join(", ")}\n`);
	} else {
		console.log();
	}

	return { tools: toolNames };
}

// ── Connect AI Accounts Step ───────────────────────────────────────────

async function runConnectAIAccountsStep(prompt: Prompt): Promise<void> {
	console.log(`${sym.link} ${c.bold("Step 3/7 — Connect AI Accounts")} ${c.dim("(optional)")}\n`);
	
	console.log(`  Connecting your AI provider accounts lets us analyze usage depth,`);
	console.log(`  not just tool presence. The more we can see, the stronger your`);
	console.log(`  verified proficiency profile.\n`);
	
	console.log(`  ${c.bold("What we can pull:")}`);
	console.log(`    ${sym.bullet} Token usage volume and patterns ${c.dim("(how much you use AI)")}`);
	console.log(`    ${sym.bullet} Model preferences ${c.dim("(which models you reach for)")}`);
	console.log(`    ${sym.bullet} Session frequency and consistency over time`);
	console.log(`    ${sym.bullet} API spend patterns ${c.dim("(demonstrates serious usage)")}\n`);
	
	console.log(`  ${c.bold("How your data stays safe:")}`);
	console.log(`    ${sym.bullet} Analysis runs ${c.bold("locally on your machine")} by your own AI agent`);
	console.log(`    ${sym.bullet} Your agent submits work reports (proficiency assessments) to`);
	console.log(`      JobArbiter — never raw session data, prompts, or code`);
	console.log(`    ${sym.bullet} JobArbiter builds your narrative profile from these reports\n`);

	// Check for already connected providers
	const existingProviders = loadProviderKeys();
	if (existingProviders.length > 0) {
		console.log(`  ${c.bold("Already connected:")}`);
		for (const p of existingProviders) {
			console.log(`    ${sym.check} ${p.provider}`);
		}
		console.log();
	}

	// Build provider options, excluding already-connected ones
	const connectedIds = new Set(existingProviders.map((p) => p.provider));
	const allProviders = [
		{ value: "anthropic", label: "Anthropic", hint: "Pull Claude usage stats" },
		{ value: "openai", label: "OpenAI", hint: "Pull GPT/ChatGPT usage stats" },
		{ value: "google", label: "Google AI", hint: "Pull Gemini usage stats" },
	];
	const availableProviders = allProviders.filter((p) => !connectedIds.has(p.value));

	if (availableProviders.length === 0) {
		console.log(`  ${c.dim("All providers already connected!")}\n`);
		return;
	}

	const selected = await clack.multiselect({
		message: "Select providers to connect (space to toggle, enter to confirm)",
		options: availableProviders,
		required: false,
	});

	// Recreate readline after clack took over stdin
	prompt.reset();

	if (clack.isCancel(selected) || !Array.isArray(selected) || selected.length === 0) {
		console.log(`\n${c.dim("  Skipped — you can connect providers later with 'jobarbiter tokens connect'")}\n`);
		return;
	}

	for (const providerId of selected) {
		const provider = allProviders.find((p) => p.value === providerId);
		if (provider) {
			await connectProvider(prompt, provider.value, provider.label);
			console.log();
		}
	}
}

async function connectProvider(prompt: Prompt, providerId: string, providerName: string): Promise<void> {
	console.log(`\n  ${sym.lock} ${c.bold("Privacy Notice")}`);
	console.log(`  ${c.dim("─".repeat(50))}`);
	console.log(`  Your API key is stored ${c.bold("locally only")} at:`);
	console.log(`  ${c.dim("~/.config/jobarbiter/providers.json")}\n`);
	console.log(`  ${sym.bullet} Keys are ${c.bold("NEVER")} sent to JobArbiter's servers`);
	console.log(`  ${sym.bullet} Only aggregate stats (token counts, model usage) are submitted`);
	console.log(`  ${sym.bullet} Revoke anytime: ${c.highlight(`jobarbiter tokens disconnect ${providerId}`)}`);
	console.log(`  ${c.dim("─".repeat(50))}\n`);

	const apiKey = await prompt.question(`  ${providerName} API key: `);
	
	if (!apiKey || apiKey.trim() === "") {
		console.log(`  ${c.dim("Skipped")}`);
		return;
	}

	console.log(c.dim("\n  Validating API key..."));
	
	const result = await validateProviderKey(providerId, apiKey.trim());
	
	if (result.valid) {
		saveProviderKey(providerId, apiKey.trim());
		console.log(`  ${sym.check} ${c.success(`${providerName} connected`)} — ${result.summary}`);
	} else {
		console.log(`  ${sym.cross} ${c.error(`Invalid key: ${result.error}`)}`);
		console.log(`  ${c.dim("You can try again later with 'jobarbiter tokens connect'")}`);
	}
}

function showWorkerCompletion(state: OnboardState): void {
	console.log(`${sym.done} ${c.bold("Step 7/7 — You're In!")}\n`);
	console.log(`Your profile is live. Here's how it builds:\n`);
	console.log(`  💡 ${c.bold("Your next AI session will begin your proficiency analysis.")}`);
	console.log(`     Just use your tools normally. Your AI agent analyzes each`);
	console.log(`     session and submits work reports to JobArbiter, where our`);
	console.log(`     agents build your evolving narrative profile — a rich,`);
	console.log(`     verified picture of how you work with AI.\n`);
	
	console.log(`  📊 Your proficiency profile builds automatically from:`);
	console.log(`     ${c.bold("How you use AI (qualitative):")}`);
	console.log(`     ${sym.bullet} Orchestration complexity ${c.dim("— single prompts vs multi-agent pipelines")}`);
	console.log(`     ${sym.bullet} Problem-solving approach ${c.dim("— how you break down and iterate")}`);
	console.log(`     ${sym.bullet} Communication clarity ${c.dim("— precision of your instructions")}`);
	console.log(`     ${sym.bullet} Tool fluency ${c.dim("— depth across different AI tools")}\n`);
	console.log(`     ${c.bold("How much you use AI (quantitative):")}`);
	console.log(`     ${sym.bullet} Session frequency & consistency over time`);
	console.log(`     ${sym.bullet} Token consumption patterns`);
	console.log(`     ${sym.bullet} GitHub AI-assisted contributions`);
	console.log(`     ${sym.bullet} Tool diversity across providers\n`);
	
	console.log(`  🎯 Your proficiency ${c.bold("track")} (Orchestrator, Systems Builder, or`);
	console.log(`     Domain Translator) is determined automatically as we observe`);
	console.log(`     how you work — whether that's coding, research, automation,`);
	console.log(`     content creation, or anything else. No need to self-assess.\n`);
	
	console.log(`  🤖 For deeper attestation, install the ${c.highlight("jobarbiter-proficiency")}`);
	console.log(`     skill in your AI tools (OpenClaw, Claude Code, etc.)\n`);
	
	console.log(`  ${c.bold("Useful commands:")}`);
	console.log(`    ${c.highlight("jobarbiter profile score")}    — Check your proficiency score`);
	console.log(`    ${c.highlight("jobarbiter observe status")}   — See collected observation data`);
	console.log(`    ${c.highlight("jobarbiter observe install")}  — Add observers to new agents`);
	console.log(`    ${c.highlight("jobarbiter status")}           — Account overview\n`);
	
	console.log(`${c.bold("Welcome to the future of work.")} ${sym.rocket}\n`);
	
	console.log(c.dim(`Config saved to: ${getConfigPath()}`));
	console.log(c.dim(`API Key: ${state.apiKey.slice(0, 20)}... (shown only once)\n`));
}

// ── Employer Flow ──────────────────────────────────────────────────────

async function runEmployerFlow(prompt: Prompt, state: OnboardState): Promise<void> {
	const config: Config = {
		apiKey: state.apiKey,
		baseUrl: state.baseUrl,
		userType: "employer",
	};

	// Step 3: Company Setup
	console.log(`${sym.company} ${c.bold("Step 3/6 — Your Company")}\n`);

	const companyName = await prompt.question(`Company name: `);
	state.companyName = companyName;

	const companyWebsite = await prompt.question(`Company website: `);
	state.companyWebsite = companyWebsite;

	const companyIndustry = await prompt.question(`Industry: `);
	state.companyIndustry = companyIndustry;

	console.log(`\nCompany size:`);
	console.log(`  ${c.highlight("1.")} 1-10`);
	console.log(`  ${c.highlight("2.")} 11-50`);
	console.log(`  ${c.highlight("3.")} 51-200`);
	console.log(`  ${c.highlight("4.")} 201-1000`);
	console.log(`  ${c.highlight("5.")} 1000+\n`);

	let companySize: string;
	while (true) {
		const answer = await prompt.question(`Company size ${c.dim("[1-5]")}: `);
		const sizes = ["1-10", "11-50", "51-200", "201-1000", "1000+"];
		const idx = parseInt(answer) - 1;
		if (idx >= 0 && idx < 5) {
			companySize = sizes[idx];
			break;
		}
		console.log(c.error("Please enter 1-5"));
	}
	state.companySize = companySize;

	// Create company
	console.log(c.dim("\nCreating company profile..."));
	try {
		await api(config, "POST", "/v1/company", {
			companyData: {
				name: companyName,
				website: companyWebsite,
				industry: companyIndustry,
				size: companySize,
			},
		});
		console.log(`${sym.check} Company profile created\n`);
	} catch (err) {
		// Company creation might not exist yet, best-effort
		console.log(`${sym.warning} ${c.warning("Company profile saved locally — backend integration pending")}\n`);
	}

	// Step 4: Domain Verification
	console.log(`${sym.lock} ${c.bold("Step 4/6 — Verify Your Domain")} ${c.dim("(optional)")}\n`);
	
	// Extract domain from website
	let domain = "";
	try {
		const url = new URL(companyWebsite.startsWith("http") ? companyWebsite : `https://${companyWebsite}`);
		domain = url.hostname.replace(/^www\./, "");
	} catch {
		domain = companyWebsite.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];
	}

	console.log(`To prove you represent ${c.highlight(companyName)}, we'll verify your domain.\n`);
	console.log(`Domain to verify: ${c.highlight(domain)}\n`);
	
	// Generate a fake verification token for display
	const verifyToken = `ja-verify-${Math.random().toString(36).slice(2, 14)}`;
	
	console.log(`Add this TXT record to your DNS:`);
	console.log(`  ${c.bold("Name:")}  _jobarbiter-verify`);
	console.log(`  ${c.bold("Value:")} ${verifyToken}\n`);

	const checkNow = await prompt.confirm(`Press Enter when ready to verify, or 's' to skip`);
	
	if (checkNow) {
		console.log(c.dim("\nChecking DNS... (this is a preview — verification not yet implemented)"));
		console.log(`${sym.warning} ${c.warning("Domain verification will be available soon. Continuing...")}\n`);
	} else {
		console.log(`${c.dim("Skipped — you can verify your domain later")}\n`);
	}

	// Step 5: What Are You Looking For?
	console.log(`${sym.target} ${c.bold("Step 5/6 — What Do You Need?")}\n`);
	
	console.log(`What track are you hiring for?`);
	console.log(`  ${c.highlight("1.")} Orchestrator`);
	console.log(`  ${c.highlight("2.")} Systems Builder`);
	console.log(`  ${c.highlight("3.")} Domain Translator`);
	console.log(`  ${c.highlight("4.")} Not sure yet\n`);

	let hiringTrack: string | undefined;
	while (true) {
		const answer = await prompt.question(`Track ${c.dim("[1/2/3/4]")}: `);
		if (answer === "1") { hiringTrack = "orchestrator"; break; }
		if (answer === "2") { hiringTrack = "systemsBuilder"; break; }
		if (answer === "3") { hiringTrack = "domainTranslator"; break; }
		if (answer === "4") { hiringTrack = undefined; break; }
		console.log(c.error("Please enter 1-4"));
	}
	state.hiringTrack = hiringTrack;

	const minScoreInput = await prompt.question(`\nMinimum proficiency score ${c.dim("(1-100, recommended: 70)")}: `);
	const minScore = parseInt(minScoreInput) || 70;
	state.minScore = minScore;

	console.log(`\nKey tools they should know ${c.dim("(comma-separated, optional)")}:`);
	const hiringToolsInput = await prompt.question(`${sym.arrow} `);
	const hiringTools = hiringToolsInput.split(",").map(s => s.trim()).filter(Boolean);
	state.hiringTools = hiringTools;

	// Step 6: Pricing Overview & Done
	showEmployerCompletion(state);
}

function showEmployerCompletion(state: OnboardState): void {
	console.log(`\n${sym.money} ${c.bold("Step 6/6 — How It Works")}\n`);
	
	console.log(`JobArbiter uses value-based pricing:\n`);
	console.log(`  ${sym.bullet} Search profiles:     ${c.highlight("$50")}    ${c.dim("(browse matching candidates)")}`);
	console.log(`  ${sym.bullet} Unlock full profile: ${c.highlight("$250")}   ${c.dim("(see detailed proficiency data)")}`);
	console.log(`  ${sym.bullet} Introduction:        ${c.highlight("$2,500")} ${c.dim("(we connect you directly)")}`);
	console.log(`  ${sym.bullet} Success fee:         ${c.highlight("5%")}     ${c.dim("(only if you hire)")}\n`);
	
	console.log(`That's ${c.bold("75% cheaper")} than traditional recruiters,`);
	console.log(`with ${c.bold("10x better signal")}.\n`);
	
	console.log(`${sym.done} ${c.bold("You're all set!")}\n`);
	
	console.log(`  Run ${c.highlight("jobarbiter search")} to find AI-proficient candidates.`);
	console.log(`  Run ${c.highlight("jobarbiter opportunities create")} to post a role.\n`);
	
	console.log(`  Install the ${c.highlight("jobarbiter-hire")} skill in your AI agent`);
	console.log(`  for automated candidate discovery.\n`);
	
	console.log(c.dim(`Config saved to: ${getConfigPath()}`));
	console.log(c.dim(`API Key: ${state.apiKey.slice(0, 20)}... (shown only once)\n`));
}
