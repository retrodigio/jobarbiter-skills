/**
 * Provider Key Management Module
 * 
 * Securely manages API keys for AI providers (Anthropic, OpenAI, etc.)
 * Keys are stored locally ONLY and never sent to JobArbiter's servers.
 * Only aggregate usage stats are submitted for proficiency scoring.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ──────────────────────────────────────────────────────────────

export interface ProviderConfig {
	provider: string;       // "anthropic" | "openai" | "google"
	apiKey: string;         // stored locally only
	connectedAt: string;    // ISO timestamp
	lastSync?: string;      // last time usage data was pulled
}

export interface ProvidersFile {
	version: number;
	providers: ProviderConfig[];
}

export interface ValidationResult {
	valid: boolean;
	error?: string;
	summary?: string;  // e.g., "1.2M tokens used this month"
}

// ── Paths ──────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".config", "jobarbiter");
const PROVIDERS_FILE = join(CONFIG_DIR, "providers.json");

export function getProvidersPath(): string {
	return PROVIDERS_FILE;
}

// ── Load / Save ────────────────────────────────────────────────────────

export function loadProviderKeys(): ProviderConfig[] {
	if (!existsSync(PROVIDERS_FILE)) {
		return [];
	}

	try {
		const raw = readFileSync(PROVIDERS_FILE, "utf-8");
		const data = JSON.parse(raw) as ProvidersFile;
		return data.providers || [];
	} catch {
		return [];
	}
}

export function saveProviderKey(provider: string, apiKey: string): void {
	mkdirSync(CONFIG_DIR, { recursive: true });

	const existing = loadProviderKeys();
	
	// Remove any existing entry for this provider
	const filtered = existing.filter((p) => p.provider !== provider);
	
	// Add new entry
	filtered.push({
		provider,
		apiKey,
		connectedAt: new Date().toISOString(),
	});

	const data: ProvidersFile = {
		version: 1,
		providers: filtered,
	};

	writeFileSync(PROVIDERS_FILE, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}

export function removeProviderKey(provider: string): boolean {
	const existing = loadProviderKeys();
	const filtered = existing.filter((p) => p.provider !== provider);
	
	if (filtered.length === existing.length) {
		return false; // Provider not found
	}

	const data: ProvidersFile = {
		version: 1,
		providers: filtered,
	};

	writeFileSync(PROVIDERS_FILE, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
	return true;
}

export function getProviderKey(provider: string): ProviderConfig | null {
	const providers = loadProviderKeys();
	return providers.find((p) => p.provider === provider) || null;
}

// ── Validation ─────────────────────────────────────────────────────────

/**
 * Validate an Anthropic API key by making a test API call.
 * Returns validation result with usage summary if available.
 */
export async function validateAnthropicKey(apiKey: string): Promise<ValidationResult> {
	try {
		const response = await fetch("https://api.anthropic.com/v1/models", {
			method: "GET",
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
			},
		});

		if (response.status === 401) {
			return { valid: false, error: "Invalid API key" };
		}

		if (response.status === 403) {
			return { valid: false, error: "API key doesn't have required permissions" };
		}

		if (!response.ok) {
			return { valid: false, error: `API error: ${response.status}` };
		}

		// Key is valid - we can't get usage from this endpoint, 
		// but we can confirm the key works
		return {
			valid: true,
			summary: "API key validated",
		};
	} catch (err) {
		if (err instanceof Error) {
			return { valid: false, error: `Connection error: ${err.message}` };
		}
		return { valid: false, error: "Unknown error" };
	}
}

/**
 * Validate an OpenAI API key by making a test API call.
 * Returns validation result with usage summary if available.
 */
export async function validateOpenAIKey(apiKey: string): Promise<ValidationResult> {
	try {
		const response = await fetch("https://api.openai.com/v1/models", {
			method: "GET",
			headers: {
				"Authorization": `Bearer ${apiKey}`,
			},
		});

		if (response.status === 401) {
			return { valid: false, error: "Invalid API key" };
		}

		if (response.status === 403) {
			return { valid: false, error: "API key doesn't have required permissions" };
		}

		if (!response.ok) {
			return { valid: false, error: `API error: ${response.status}` };
		}

		// Key is valid
		return {
			valid: true,
			summary: "API key validated",
		};
	} catch (err) {
		if (err instanceof Error) {
			return { valid: false, error: `Connection error: ${err.message}` };
		}
		return { valid: false, error: "Unknown error" };
	}
}

/**
 * Get list of supported providers.
 */
export function getSupportedProviders(): Array<{ id: string; name: string }> {
	return [
		{ id: "anthropic", name: "Anthropic" },
		{ id: "openai", name: "OpenAI" },
	];
}

/**
 * Validate a key for any supported provider.
 */
export async function validateProviderKey(provider: string, apiKey: string): Promise<ValidationResult> {
	switch (provider) {
		case "anthropic":
			return validateAnthropicKey(apiKey);
		case "openai":
			return validateOpenAIKey(apiKey);
		default:
			return { valid: false, error: `Unknown provider: ${provider}` };
	}
}
