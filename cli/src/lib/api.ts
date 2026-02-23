import type { Config } from "./config.js";

export class ApiError extends Error {
	constructor(
		public status: number,
		public body: Record<string, unknown>,
	) {
		super(body.error as string || `HTTP ${status}`);
	}
}

export async function api(
	config: Config,
	method: string,
	path: string,
	body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const url = `${config.baseUrl}${path}`;

	const headers: Record<string, string> = {
		"Authorization": `Bearer ${config.apiKey}`,
		"Content-Type": "application/json",
		"User-Agent": "jobarbiter-cli/0.1.0",
	};

	const response = await fetch(url, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});

	const data = await response.json() as Record<string, unknown>;

	if (!response.ok) {
		throw new ApiError(response.status, data);
	}

	return data;
}

export async function apiUnauthenticated(
	baseUrl: string,
	method: string,
	path: string,
	body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const url = `${baseUrl}${path}`;

	const response = await fetch(url, {
		method,
		headers: { "Content-Type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	});

	const data = await response.json() as Record<string, unknown>;

	if (!response.ok) {
		throw new ApiError(response.status, data);
	}

	return data;
}
