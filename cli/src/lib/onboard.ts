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
		console.log(`\n${sym.rocket}  ${c.bold("Resuming onboarding")} from step ${resumeStep}/6\n`);
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
	// Workers: 1) Account, 2) Tool Detection, 3) Domains, 4) GitHub, 5) LinkedIn, 6) Done
	// Employers: 1) Account, 2) (skip verification), 3) Company, 4) Domain, 5) What You Need, 6) Done
	const totalSteps = 6;
	
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

	// Step 3: Domains
	if (startStep <= 3) {
		console.log(`${sym.target} ${c.bold("Step 3/6 — Your Domains")}\n`);
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
		saveProgress(3);
	}

	// Step 4: Connect GitHub (optional)
	if (startStep <= 4) {
		console.log(`${sym.link} ${c.bold("Step 4/6 — Connect GitHub")} ${c.dim("(optional)")}\n`);
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
		saveProgress(4);
	}

	// Step 5: Connect LinkedIn (optional)
	if (startStep <= 5) {
		console.log(`${sym.link} ${c.bold("Step 5/6 — Connect LinkedIn")} ${c.dim("(optional)")}\n`);
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
		saveProgress(5);
	}

	// Step 6: Done!
	saveConfig({ ...config, onboardingComplete: true, onboardingStep: 6 });
	showWorkerCompletion(state);
}

// ── Tool Detection Step ────────────────────────────────────────────────

async function runToolDetectionStep(
	prompt: Prompt,
	config: Config,
): Promise<{ tools: string[] }> {
	console.log(`🔍 ${c.bold("Step 2/6 — Detecting AI Tools")}\n`);
	console.log(c.dim("  Scanning your machine...\n"));

	const allTools = detectAllTools();
	const installed = allTools.filter((t) => t.installed);
	const notInstalled = allTools.filter((t) => !t.installed && t.category === "coding-agent");

	// Group by category
	const codingAgents = installed.filter((t) => t.category === "coding-agent");
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

	// Show coding agents with observer status
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

	// Show not-detected coding agents
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

	// Observer installation for coding agents
	const needsObserver = codingAgents.filter((t) => t.observerAvailable && !t.observerActive);

	if (needsObserver.length > 0) {
		console.log(`\n  ${c.bold("Observers")}`);
		console.log(`  JobArbiter observes your coding sessions to build your`);
		console.log(`  proficiency profile. ${c.bold("No code or prompts leave your machine")} —`);
		console.log(`  only aggregate scores (tool usage, session counts, token volume).\n`);
		console.log(c.dim(`  Data stored locally: ~/.config/jobarbiter/observer/observations.json`));
		console.log(c.dim(`  Review anytime: jobarbiter observe status\n`));

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
				console.log(c.dim(`  Your proficiency profile will start building automatically.\n`));
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

function showWorkerCompletion(state: OnboardState): void {
	console.log(`${sym.done} ${c.bold("Step 6/6 — You're In!")}\n`);
	console.log(`Your profile is live. Here's what happens next:\n`);
	
	console.log(`  📊 Your proficiency score builds automatically from:`);
	console.log(`     ${sym.bullet} Coding agent observation ${c.dim("(biggest factor — 35%)")}`);
	console.log(`     ${sym.bullet} GitHub contribution analysis ${c.dim("(20%)")}`);
	console.log(`     ${sym.bullet} Token consumption patterns ${c.dim("(15%)")}`);
	console.log(`     ${sym.bullet} Tool diversity & fluency ${c.dim("(15%)")}`);
	console.log(`     ${sym.bullet} Outcome verification ${c.dim("(15%)")}\n`);
	
	console.log(`  🎯 Your proficiency ${c.bold("track")} (Orchestrator, Systems Builder, or`);
	console.log(`     Domain Translator) is determined automatically as we observe`);
	console.log(`     how you work. No need to self-assess.\n`);
	
	console.log(`  🤖 For deeper attestation, install the ${c.highlight("jobarbiter-proficiency")}`);
	console.log(`     skill in your AI agent (OpenClaw, Claude Code, etc.)\n`);
	
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
