/**
 * JobArbiter Observer — OpenClaw Plugin
 *
 * Single-hook observer: fires on `session_end`, reads the session
 * transcript, extracts proficiency signals, writes to observations.json.
 *
 * Consistent with how every other observer works:
 *   - Claude Code → Stop hook → read transcript
 *   - Codex → agent-turn-complete → read session data
 *   - Gemini → SessionEnd → read session data
 *   - OpenClaw → session_end → read transcript (this plugin)
 *
 * Async fire-and-forget. Errors logged, never thrown. Zero impact on
 * session performance.
 *
 * Writes to ~/.config/jobarbiter/observer/observations.json (same format
 * as the CLI hook observers for Claude Code, Cursor, Codex, etc.)
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  appendFileSync,
} from "node:fs";
import { join, extname } from "node:path";
import { homedir } from "node:os";

// ── Constants ──────────────────────────────────────────────────────────

const OBSERVER_DIR = join(homedir(), ".config", "jobarbiter", "observer");
const OBSERVATIONS_FILE = join(OBSERVER_DIR, "observations.json");
const PAUSED_FILE = join(OBSERVER_DIR, "PAUSED");
const ERROR_LOG = join(OBSERVER_DIR, "errors.log");
const MAX_SESSION_BUFFER = 500;

// OpenClaw transcript directories (same as transcript-reader.ts)
const TRANSCRIPT_DIRS = [
  join(homedir(), ".openclaw", "transcripts"),
  join(homedir(), ".clawdbot", "transcripts"),
];

// ── Helpers ────────────────────────────────────────────────────────────

function isPaused(): boolean {
  try {
    if (!existsSync(PAUSED_FILE)) return false;
    const raw = readFileSync(PAUSED_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (data.expiresAt) {
      return Date.now() < new Date(data.expiresAt).getTime();
    }
    return true;
  } catch {
    return false;
  }
}

function logError(msg: string): void {
  try {
    mkdirSync(OBSERVER_DIR, { recursive: true });
    appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // truly silent
  }
}

function ensureObserverDir(): void {
  mkdirSync(OBSERVER_DIR, { recursive: true });
  if (!existsSync(OBSERVATIONS_FILE)) {
    writeFileSync(
      OBSERVATIONS_FILE,
      JSON.stringify(
        {
          version: 1,
          installedAt: new Date().toISOString(),
          agents: {},
          sessions: [],
          accumulated: {
            totalSessions: 0,
            totalTokens: 0,
            toolCounts: {},
            domainSignals: [],
            lastSubmitted: null,
          },
        },
        null,
        2,
      ) + "\n",
    );
  }
}

// ── Transcript Discovery ───────────────────────────────────────────────

/**
 * Find the most recently modified transcript file for a given session.
 * OpenClaw transcripts are JSONL files in ~/.openclaw/transcripts/.
 * If we have a sessionKey from the event, try to match it to a filename.
 * Otherwise, grab the most recently modified file.
 */
function findTranscriptFile(sessionKey?: string): string | null {
  for (const dir of TRANSCRIPT_DIRS) {
    if (!existsSync(dir)) continue;

    try {
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => ({
          name: f,
          path: join(dir, f),
          mtime: statSync(join(dir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length === 0) continue;

      // If we have a sessionKey, try to find a matching file
      if (sessionKey) {
        const match = files.find(
          (f) =>
            f.name.includes(sessionKey) ||
            f.name.replace(extname(f.name), "") === sessionKey,
        );
        if (match) return match.path;
      }

      // Fall back to most recently modified file
      // Only if it was modified in the last 5 minutes (likely the active session)
      const recent = files[0];
      if (recent && Date.now() - recent.mtime < 5 * 60 * 1000) {
        return recent.path;
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ── Transcript Parsing & Signal Extraction ─────────────────────────────

interface ExtractedSignals {
  toolsUsed: string[];
  toolCallCount: number;
  fileExtensions: string[];
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  thinkingBlocks: number;
  tokenUsage: { input: number; output: number; total: number } | null;
  modelsUsed: string[];
  orchestration: {
    subAgentSpawns: number;
    maxToolChainLength: number;
    toolSequenceCount: number;
    avgSequenceLength: number;
    compactionCount: number;
  };
}

function extractSignalsFromTranscript(filePath: string): ExtractedSignals | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    if (lines.length === 0) return null;

    const toolsUsed: string[] = [];
    const fileExtensions: string[] = [];
    const modelsUsed = new Set<string>();
    let toolCallCount = 0;
    let messageCount = 0;
    let userMessageCount = 0;
    let assistantMessageCount = 0;
    let thinkingBlocks = 0;
    let tokenInput = 0;
    let tokenOutput = 0;
    let tokenTotal = 0;
    let subAgentSpawns = 0;
    let compactionCount = 0;

    // Tool chain tracking
    let currentChain = 0;
    let maxChain = 0;
    const toolSequences: string[][] = [];
    let currentSequence: string[] = [];
    let lastRole = "";

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const role = obj.role || obj.type || "";

        // Count messages by role
        if (role === "user" || role === "human") {
          messageCount++;
          userMessageCount++;
          // User message breaks tool chains
          if (currentChain > maxChain) maxChain = currentChain;
          if (currentSequence.length > 0) {
            toolSequences.push([...currentSequence]);
            currentSequence = [];
          }
          currentChain = 0;
          lastRole = "user";
        } else if (role === "assistant" || role === "bot" || role === "ai") {
          messageCount++;
          assistantMessageCount++;
          lastRole = "assistant";
        }

        // Tool calls (various formats OpenClaw uses)
        const toolName =
          obj.toolName || obj.tool_name || obj.function_name || null;
        if (toolName) {
          toolsUsed.push(toolName);
          toolCallCount++;
          currentChain++;
          currentSequence.push(toolName);

          // Detect sub-agent spawns
          if (
            toolName === "sessions_spawn" ||
            toolName === "subagents" ||
            toolName === "sessions_send"
          ) {
            subAgentSpawns++;
          }
        }

        // Tool calls in content blocks
        if (Array.isArray(obj.content)) {
          for (const block of obj.content) {
            if (block.type === "tool_use" && block.name) {
              toolsUsed.push(block.name);
              toolCallCount++;
              currentChain++;
              currentSequence.push(block.name);
              if (
                ["sessions_spawn", "subagents", "sessions_send"].includes(
                  block.name,
                )
              ) {
                subAgentSpawns++;
              }
            }
            if (block.type === "thinking") {
              thinkingBlocks++;
            }
          }
        }

        // File extensions from tool args
        const args =
          obj.toolInput || obj.tool_input || obj.args || obj.input || {};
        if (args && typeof args === "object") {
          const fp =
            (args as Record<string, string>).file_path ||
            (args as Record<string, string>).filePath ||
            (args as Record<string, string>).path ||
            (args as Record<string, string>).filename ||
            "";
          if (fp) {
            const match = fp.match(/\.([a-zA-Z0-9]+)$/);
            if (match) fileExtensions.push(`.${match[1].toLowerCase()}`);
          }
        }

        // Token usage
        const usage = obj.usage || obj.tokenUsage;
        if (usage) {
          tokenInput +=
            usage.input_tokens || usage.input || usage.promptTokens || 0;
          tokenOutput +=
            usage.output_tokens || usage.output || usage.completionTokens || 0;
          tokenTotal +=
            usage.total_tokens || usage.total || usage.totalTokens || 0;
        }

        // Model
        if (obj.model) modelsUsed.add(obj.model);

        // Compaction markers
        if (
          obj.type === "compaction" ||
          obj.event === "compaction" ||
          (typeof obj.text === "string" &&
            obj.text.includes("context compaction"))
        ) {
          compactionCount++;
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Finalize last chain
    if (currentChain > maxChain) maxChain = currentChain;
    if (currentSequence.length > 0) {
      toolSequences.push([...currentSequence]);
    }

    // Skip empty sessions
    if (toolCallCount === 0 && messageCount === 0 && tokenTotal === 0) {
      return null;
    }

    return {
      toolsUsed: [...new Set(toolsUsed)],
      toolCallCount,
      fileExtensions: [...new Set(fileExtensions)],
      messageCount,
      userMessageCount,
      assistantMessageCount,
      thinkingBlocks,
      tokenUsage:
        tokenTotal > 0
          ? { input: tokenInput, output: tokenOutput, total: tokenTotal }
          : null,
      modelsUsed: [...modelsUsed],
      orchestration: {
        subAgentSpawns,
        maxToolChainLength: maxChain,
        toolSequenceCount: toolSequences.length,
        avgSequenceLength:
          toolSequences.length > 0
            ? toolSequences.reduce((s, seq) => s + seq.length, 0) /
              toolSequences.length
            : 0,
        compactionCount,
      },
    };
  } catch (err) {
    logError(
      `Transcript parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// ── Write Observation ──────────────────────────────────────────────────

function appendObservation(
  signals: ExtractedSignals,
  sessionId: string,
  sessionKey: string,
  transcriptPath: string,
): void {
  try {
    ensureObserverDir();
    const raw = readFileSync(OBSERVATIONS_FILE, "utf-8");
    const data = JSON.parse(raw);

    const observation = {
      timestamp: new Date().toISOString(),
      agent: "openclaw",
      sessionId,
      sessionKey,
      transcriptPath,
      source: "hook" as const,
      signals,
    };

    data.sessions.push(observation);
    data.accumulated.totalSessions++;

    for (const tool of signals.toolsUsed) {
      data.accumulated.toolCounts[tool] =
        (data.accumulated.toolCounts[tool] || 0) + 1;
    }
    if (signals.tokenUsage) {
      data.accumulated.totalTokens += signals.tokenUsage.total || 0;
    }

    // Rolling window
    if (data.sessions.length > MAX_SESSION_BUFFER) {
      data.sessions = data.sessions.slice(-MAX_SESSION_BUFFER);
    }

    writeFileSync(OBSERVATIONS_FILE, JSON.stringify(data, null, 2) + "\n");
  } catch (err) {
    logError(
      `Write observation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── Plugin Entry ───────────────────────────────────────────────────────

export default definePluginEntry({
  id: "jobarbiter-observer",
  name: "JobArbiter Observer",
  description:
    "Proficiency signal observer for JobArbiter — fires on session_end, reads transcript, extracts signals",

  register(api) {
    // Single hook: session_end
    // When a session ends, find its transcript, parse it, extract signals.
    api.on("session_end" as never, async (event: Record<string, unknown>) => {
      try {
        if (isPaused()) return;

        const sessionKey =
          (event.sessionKey as string) ||
          (event.sessionId as string) ||
          (event.session_id as string) ||
          "unknown";
        const sessionId =
          (event.sessionId as string) || sessionKey;

        // Find the transcript file for this session
        const transcriptPath = findTranscriptFile(sessionKey);
        if (!transcriptPath) return; // No transcript found, nothing to observe

        // Parse transcript and extract signals
        const signals = extractSignalsFromTranscript(transcriptPath);
        if (!signals) return; // Empty or unparseable

        // Write observation
        appendObservation(signals, sessionId, sessionKey, transcriptPath);
      } catch (err) {
        logError(
          `session_end handler: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  },
});
