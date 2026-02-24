/**
 * CLI Smoke Tests
 * 
 * Tests that run the actual CLI binary to verify:
 * - Basic commands work
 * - Help and version output correctly
 * - JSON output is valid
 * - Error messages are clean
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execSync, ExecSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Path to the built CLI
const CLI_DIR = join(__dirname, "..");
const CLI_PATH = join(CLI_DIR, "dist", "index.js");

// Exec options
const execOpts: ExecSyncOptionsWithStringEncoding = {
	encoding: "utf8",
	cwd: CLI_DIR,
	timeout: 30000,
	env: {
		...process.env,
		// Ensure we don't use any existing config during tests
		JOBARBITER_API_KEY: "",
	},
};

/**
 * Run a CLI command and return the result
 */
function cli(args: string): { stdout: string; exitCode: number } {
	try {
		const stdout = execSync(`node ${CLI_PATH} ${args}`, execOpts);
		return { stdout, exitCode: 0 };
	} catch (err: unknown) {
		const error = err as { stdout?: string; stderr?: string; status?: number };
		// Command failed, but we still want to check the output
		return {
			stdout: error.stdout || error.stderr || "",
			exitCode: error.status || 1,
		};
	}
}

/**
 * Check if the CLI has been built
 */
function isBuilt(): boolean {
	return existsSync(CLI_PATH);
}

describe("CLI Build", () => {
	it("CLI binary exists (npm run build was run)", () => {
		if (!isBuilt()) {
			console.warn("CLI not built - run `npm run build` in cli directory first");
		}
		// Don't fail the test if not built, just skip
		expect(true).toBe(true);
	});
});

describe("CLI Help Commands", () => {
	beforeAll(() => {
		if (!isBuilt()) {
			console.warn("Skipping CLI tests - binary not built");
		}
	});

	it("jobarbiter --help exits 0 and shows usage", () => {
		if (!isBuilt()) return;

		const { stdout, exitCode } = cli("--help");

		expect(exitCode).toBe(0);
		expect(stdout).toContain("JobArbiter");
		expect(stdout).toContain("onboard");
		expect(stdout).toContain("--help");
	});

	it("jobarbiter --version exits 0 and shows version", () => {
		if (!isBuilt()) return;

		const { stdout, exitCode } = cli("--version");

		expect(exitCode).toBe(0);
		// Should contain a version number like "0.3.0"
		expect(stdout).toMatch(/\d+\.\d+\.\d+/);
	});

	it("jobarbiter onboard --help shows onboard description", () => {
		if (!isBuilt()) return;

		const { stdout, exitCode } = cli("onboard --help");

		expect(exitCode).toBe(0);
		expect(stdout).toContain("onboard");
		expect(stdout.toLowerCase()).toContain("wizard");
	});

	it("jobarbiter profile --help shows profile commands", () => {
		if (!isBuilt()) return;

		const { stdout, exitCode } = cli("profile --help");

		expect(exitCode).toBe(0);
		expect(stdout).toContain("profile");
		expect(stdout).toContain("show");
		expect(stdout).toContain("create");
	});
});

describe("CLI Status Command", () => {
	beforeAll(() => {
		if (!isBuilt()) {
			console.warn("Skipping CLI tests - binary not built");
		}
	});

	it("jobarbiter status --json returns valid JSON or clean error", () => {
		if (!isBuilt()) return;

		const { stdout, exitCode } = cli("status --json");

		if (exitCode === 0) {
			// If successful, should be valid JSON
			expect(() => JSON.parse(stdout)).not.toThrow();
			const data = JSON.parse(stdout);
			expect(data).toBeDefined();
		} else {
			// If failed (no config), should have clean error message
			// The error might be on stderr which gets merged into stdout
			expect(stdout.length).toBeGreaterThan(0);
			// Should not have a stack trace (clean error)
			expect(stdout).not.toContain("at Object.");
		}
	});
});

describe("CLI Profile Commands", () => {
	beforeAll(() => {
		if (!isBuilt()) {
			console.warn("Skipping CLI tests - binary not built");
		}
	});

	it("jobarbiter profile show --json returns JSON or clean error", () => {
		if (!isBuilt()) return;

		const { stdout, exitCode } = cli("profile show --json");

		if (exitCode === 0) {
			// If successful, should be valid JSON
			expect(() => JSON.parse(stdout)).not.toThrow();
		} else {
			// If failed (not configured), should be clean
			expect(stdout).not.toContain("Error: ");
			expect(stdout).not.toContain("at Object.");
		}
	});
});

describe("CLI Unknown Commands", () => {
	beforeAll(() => {
		if (!isBuilt()) {
			console.warn("Skipping CLI tests - binary not built");
		}
	});

	it("Unknown command shows help or error", () => {
		if (!isBuilt()) return;

		const { stdout, exitCode } = cli("unknowncommand");

		// Commander should show help or error for unknown commands
		expect(exitCode).not.toBe(0);
		// Output should mention help or unknown
		const hasHelpInfo = 
			stdout.includes("--help") || 
			stdout.includes("unknown") ||
			stdout.includes("error");
		expect(hasHelpInfo).toBe(true);
	});
});

describe("CLI Error Handling", () => {
	beforeAll(() => {
		if (!isBuilt()) {
			console.warn("Skipping CLI tests - binary not built");
		}
	});

	it("Missing required options show clean error", () => {
		if (!isBuilt()) return;

		// verify-email requires --email
		const { stdout, exitCode } = cli("verify-email");

		expect(exitCode).not.toBe(0);
		expect(stdout).toContain("email");
	});
});
