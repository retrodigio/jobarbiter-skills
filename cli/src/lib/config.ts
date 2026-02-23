import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Config {
	apiKey: string;
	baseUrl: string;
	userType: "seeker" | "poster";
}

const CONFIG_DIR = join(homedir(), ".config", "jobarbiter");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function getConfigPath(): string {
	return CONFIG_FILE;
}

export function loadConfig(): Config | null {
	// Environment variables override file config
	const envKey = process.env.JOBARBITER_API_KEY;
	const envUrl = process.env.JOBARBITER_BASE_URL;
	const envType = process.env.JOBARBITER_USER_TYPE as "seeker" | "poster" | undefined;

	if (envKey) {
		return {
			apiKey: envKey,
			baseUrl: envUrl || "https://jobarbiter-api-production.up.railway.app",
			userType: envType || "seeker",
		};
	}

	if (!existsSync(CONFIG_FILE)) return null;

	try {
		const raw = readFileSync(CONFIG_FILE, "utf-8");
		return JSON.parse(raw) as Config;
	} catch {
		return null;
	}
}

export function saveConfig(config: Config): void {
	mkdirSync(CONFIG_DIR, { recursive: true });
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function requireConfig(): Config {
	const config = loadConfig();
	if (!config) {
		console.error("Not configured. Run: jobarbiter register --email YOUR_EMAIL --type seeker");
		console.error("Or set JOBARBITER_API_KEY environment variable.");
		process.exit(1);
	}
	return config;
}
