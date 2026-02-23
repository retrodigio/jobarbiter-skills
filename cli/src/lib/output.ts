/**
 * Output formatting — JSON for agents, readable for humans
 */

let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
	jsonMode = enabled;
}

export function output(data: Record<string, unknown>): void {
	if (jsonMode) {
		console.log(JSON.stringify(data, null, 2));
	} else {
		printReadable(data);
	}
}

export function outputList(items: Array<Record<string, unknown>>, title?: string): void {
	if (jsonMode) {
		console.log(JSON.stringify(items, null, 2));
		return;
	}

	if (title) console.log(`\n${title} (${items.length})\n${"─".repeat(40)}`);

	if (items.length === 0) {
		console.log("  (none)");
		return;
	}

	for (const item of items) {
		printReadable(item);
		console.log("");
	}
}

export function success(message: string): void {
	if (jsonMode) {
		console.log(JSON.stringify({ status: "ok", message }));
	} else {
		console.log(`✓ ${message}`);
	}
}

export function error(message: string): void {
	if (jsonMode) {
		console.error(JSON.stringify({ status: "error", error: message }));
	} else {
		console.error(`✗ ${message}`);
	}
}

function printReadable(data: Record<string, unknown>, indent = 0): void {
	const pad = "  ".repeat(indent);
	for (const [key, value] of Object.entries(data)) {
		if (key === "ai_disclosure") continue; // skip noise in human output
		if (value === null || value === undefined) continue;

		if (typeof value === "object" && !Array.isArray(value)) {
			console.log(`${pad}${formatKey(key)}:`);
			printReadable(value as Record<string, unknown>, indent + 1);
		} else if (Array.isArray(value)) {
			if (value.length === 0) continue;
			if (typeof value[0] === "string") {
				console.log(`${pad}${formatKey(key)}: ${value.join(", ")}`);
			} else {
				console.log(`${pad}${formatKey(key)}:`);
				for (const item of value) {
					if (typeof item === "object") {
						printReadable(item as Record<string, unknown>, indent + 1);
						console.log("");
					} else {
						console.log(`${pad}  - ${item}`);
					}
				}
			}
		} else {
			console.log(`${pad}${formatKey(key)}: ${value}`);
		}
	}
}

function formatKey(key: string): string {
	return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim();
}
