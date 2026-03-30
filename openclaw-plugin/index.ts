/**
 * JobArbiter Observer — OpenClaw Plugin
 *
 * Real-time proficiency signal extraction via OpenClaw lifecycle hooks.
 * Replaces the 2-hour transcript poller with immediate event capture.
 *
 * Hooks used:
 *   - session_start / session_end — session lifecycle tracking
 *   - agent_end — final message list after agent completes a turn
 *   - after_tool_call — real-time tool usage signals
 *   - message_received — inbound user message tracking
 *   - message_sent — outbound response tracking
 *   - before_compaction / after_compaction — context management signals
 *
 * All handlers are async fire-and-forget. Errors are caught and logged
 * to ~/.config/jobarbiter/observer/errors.log — never thrown back to
 * OpenClaw. Session performance is unaffected.
 *
 * Writes to ~/.config/jobarbiter/observer/observations.json (same format
 * as the CLI hook observers for Claude Code, Cursor, Codex, etc.)
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Constants ──────────────────────────────────────────────────────────

const OBSERVER_DIR = join(homedir(), ".config", "jobarbiter", "observer");
const OBSERVATIONS_FILE = join(OBSERVER_DIR, "observations.json");
const PAUSED_FILE = join(OBSERVER_DIR, "PAUSED");
const ERROR_LOG = join(OBSERVER_DIR, "errors.log");
const MAX_SESSION_BUFFER = 500;
const FLUSH_INTERVAL_MS = 30_000; // 30s default

// ── In-Memory Accumulator ──────────────────────────────────────────────

interface SessionAccumulator {
  sessionId: string;
  sessionKey: string;
  startedAt: string;
  toolsUsed: string[];
  toolCallCount: number;
  fileExtensions: string[];
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  thinkingBlocks: number;
  tokenUsage: { input: number; output: number; total: number };
  modelsUsed: Set<string>;
  subAgentSpawns: number;
  compactionCount: number;
  /** Longest chain of sequential tool calls without user intervention */
  maxToolChainLength: number;
  /** Current tool chain being tracked */
  currentToolChain: number;
  /** Unique tool sequences observed (for orchestration complexity) */
  toolSequences: string[][];
  /** Current tool sequence being built */
  currentSequence: string[];
}

/** Active sessions being observed */
const activeSessions = new Map<string, SessionAccumulator>();

/** Pending observations to flush to disk */
let pendingObservations: Array<Record<string, unknown>> = [];

/** Flush timer handle */
let flushTimer: ReturnType<typeof setInterval> | null = null;

// ── Helpers ────────────────────────────────────────────────────────────

function isPaused(): boolean {
  try {
    if (!existsSync(PAUSED_FILE)) return false;
    const raw = readFileSync(PAUSED_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (data.expiresAt) {
      return Date.now() < new Date(data.expiresAt).getTime();
    }
    return true; // paused indefinitely
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

function getOrCreateSession(event: Record<string, unknown>): SessionAccumulator {
  const key =
    (event.sessionKey as string) ||
    (event.sessionId as string) ||
    (event.session_id as string) ||
    "unknown";

  let session = activeSessions.get(key);
  if (!session) {
    session = {
      sessionId: (event.sessionId as string) || key,
      sessionKey: key,
      startedAt: new Date().toISOString(),
      toolsUsed: [],
      toolCallCount: 0,
      fileExtensions: [],
      messageCount: 0,
      userMessageCount: 0,
      assistantMessageCount: 0,
      thinkingBlocks: 0,
      tokenUsage: { input: 0, output: 0, total: 0 },
      modelsUsed: new Set(),
      subAgentSpawns: 0,
      compactionCount: 0,
      maxToolChainLength: 0,
      currentToolChain: 0,
      toolSequences: [],
      currentSequence: [],
    };
    activeSessions.set(key, session);
  }
  return session;
}

function extractFileExtension(args: Record<string, unknown>): string | null {
  const filePath =
    (args.file_path as string) ||
    (args.filePath as string) ||
    (args.path as string) ||
    (args.filename as string) ||
    "";
  if (!filePath) return null;
  const match = filePath.match(/\.([a-zA-Z0-9]+)$/);
  return match ? `.${match[1].toLowerCase()}` : null;
}

// ── Flush to Disk ──────────────────────────────────────────────────────

function flushToDisk(): void {
  if (pendingObservations.length === 0) return;
  if (isPaused()) {
    pendingObservations = [];
    return;
  }

  try {
    ensureObserverDir();
    const raw = readFileSync(OBSERVATIONS_FILE, "utf-8");
    const data = JSON.parse(raw);

    for (const obs of pendingObservations) {
      data.sessions.push(obs);
      data.accumulated.totalSessions++;

      const tools = (obs.signals as Record<string, unknown>)?.toolsUsed;
      if (Array.isArray(tools)) {
        for (const tool of tools) {
          data.accumulated.toolCounts[tool] =
            (data.accumulated.toolCounts[tool] || 0) + 1;
        }
      }

      const tokenUsage = (obs.signals as Record<string, unknown>)?.tokenUsage;
      if (tokenUsage && typeof tokenUsage === "object") {
        data.accumulated.totalTokens +=
          (tokenUsage as Record<string, number>).total || 0;
      }
    }

    // Rolling window
    if (data.sessions.length > MAX_SESSION_BUFFER) {
      data.sessions = data.sessions.slice(-MAX_SESSION_BUFFER);
    }

    writeFileSync(OBSERVATIONS_FILE, JSON.stringify(data, null, 2) + "\n");
    pendingObservations = [];
  } catch (err) {
    logError(`Flush failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function finalizeSession(key: string): void {
  const session = activeSessions.get(key);
  if (!session) return;

  // Finalize the current tool sequence if any
  if (session.currentSequence.length > 0) {
    session.toolSequences.push([...session.currentSequence]);
  }

  const observation = {
    timestamp: new Date().toISOString(),
    agent: "openclaw",
    sessionId: session.sessionId,
    sessionKey: session.sessionKey,
    startedAt: session.startedAt,
    source: "hook" as const, // distinguishes from poller-sourced data
    signals: {
      toolsUsed: [...new Set(session.toolsUsed)],
      toolCallCount: session.toolCallCount,
      fileExtensions: [...new Set(session.fileExtensions)],
      messageCount: session.messageCount,
      userMessageCount: session.userMessageCount,
      assistantMessageCount: session.assistantMessageCount,
      thinkingBlocks: session.thinkingBlocks,
      tokenUsage:
        session.tokenUsage.total > 0 ? session.tokenUsage : null,
      modelsUsed: [...session.modelsUsed],
      // OpenClaw-specific orchestration signals
      orchestration: {
        subAgentSpawns: session.subAgentSpawns,
        compactionCount: session.compactionCount,
        maxToolChainLength: session.maxToolChainLength,
        toolSequenceCount: session.toolSequences.length,
        // Average tools per sequence (orchestration complexity proxy)
        avgSequenceLength:
          session.toolSequences.length > 0
            ? session.toolSequences.reduce((s, seq) => s + seq.length, 0) /
              session.toolSequences.length
            : 0,
      },
    },
  };

  // Only record if we have meaningful data
  if (
    session.toolCallCount > 0 ||
    session.messageCount > 0 ||
    session.tokenUsage.total > 0
  ) {
    pendingObservations.push(observation);
  }

  activeSessions.delete(key);
}

// ── Plugin Entry ───────────────────────────────────────────────────────

export default definePluginEntry({
  id: "jobarbiter-observer",
  name: "JobArbiter Observer",
  description:
    "Real-time proficiency signal observer for JobArbiter AI Proficiency Marketplace",

  register(api) {
    // Start flush timer
    flushTimer = setInterval(flushToDisk, FLUSH_INTERVAL_MS);
    // Don't let the timer keep the process alive
    if (flushTimer.unref) flushTimer.unref();

    // ── session_start ────────────────────────────────────────────────
    api.on("session_start" as never, async (event: Record<string, unknown>) => {
      try {
        if (isPaused()) return;
        getOrCreateSession(event);
      } catch (err) {
        logError(`session_start: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // ── session_end ──────────────────────────────────────────────────
    api.on("session_end" as never, async (event: Record<string, unknown>) => {
      try {
        if (isPaused()) return;
        const key =
          (event.sessionKey as string) ||
          (event.sessionId as string) ||
          "unknown";
        finalizeSession(key);
        // Flush immediately on session end (don't wait for timer)
        flushToDisk();
      } catch (err) {
        logError(`session_end: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // ── agent_end ────────────────────────────────────────────────────
    // Fires after agent completes a turn — gives us the final message
    // list and token usage for that turn.
    api.on("agent_end" as never, async (event: Record<string, unknown>) => {
      try {
        if (isPaused()) return;
        const session = getOrCreateSession(event);

        // Extract token usage from the event
        const usage = event.usage as Record<string, number> | undefined;
        if (usage) {
          session.tokenUsage.input += usage.input_tokens || usage.input || usage.promptTokens || 0;
          session.tokenUsage.output += usage.output_tokens || usage.output || usage.completionTokens || 0;
          session.tokenUsage.total += usage.total_tokens || usage.total || usage.totalTokens || 0;
        }

        // Extract model info
        const model = event.model as string | undefined;
        if (model) session.modelsUsed.add(model);

        // Reset current tool chain (user interaction boundary)
        if (session.currentToolChain > session.maxToolChainLength) {
          session.maxToolChainLength = session.currentToolChain;
        }
        if (session.currentSequence.length > 0) {
          session.toolSequences.push([...session.currentSequence]);
          session.currentSequence = [];
        }
        session.currentToolChain = 0;
      } catch (err) {
        logError(`agent_end: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // ── after_tool_call ──────────────────────────────────────────────
    // Real-time tool usage tracking — the richest signal source.
    api.on("after_tool_call" as never, async (event: Record<string, unknown>) => {
      try {
        if (isPaused()) return;
        const session = getOrCreateSession(event);

        const toolName =
          (event.toolName as string) ||
          (event.tool_name as string) ||
          (event.name as string) ||
          "unknown";

        session.toolsUsed.push(toolName);
        session.toolCallCount++;
        session.currentToolChain++;
        session.currentSequence.push(toolName);

        // Extract file extensions from tool args
        const args =
          (event.toolInput as Record<string, unknown>) ||
          (event.input as Record<string, unknown>) ||
          (event.params as Record<string, unknown>) ||
          {};
        const ext = extractFileExtension(args);
        if (ext) session.fileExtensions.push(ext);

        // Detect sub-agent spawns (orchestration complexity)
        if (
          toolName === "sessions_spawn" ||
          toolName === "subagents" ||
          toolName === "sessions_send"
        ) {
          session.subAgentSpawns++;
        }
      } catch (err) {
        logError(`after_tool_call: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // ── message_received ─────────────────────────────────────────────
    api.on("message_received" as never, async (event: Record<string, unknown>) => {
      try {
        if (isPaused()) return;
        const session = getOrCreateSession(event);
        session.messageCount++;
        session.userMessageCount++;

        // User message breaks tool chains
        if (session.currentToolChain > session.maxToolChainLength) {
          session.maxToolChainLength = session.currentToolChain;
        }
        if (session.currentSequence.length > 0) {
          session.toolSequences.push([...session.currentSequence]);
          session.currentSequence = [];
        }
        session.currentToolChain = 0;
      } catch (err) {
        logError(`message_received: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // ── message_sent ─────────────────────────────────────────────────
    api.on("message_sent" as never, async (event: Record<string, unknown>) => {
      try {
        if (isPaused()) return;
        const session = getOrCreateSession(event);
        session.messageCount++;
        session.assistantMessageCount++;
      } catch (err) {
        logError(`message_sent: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // ── before_compaction / after_compaction ──────────────────────────
    // Compaction events tell us about context management — a user who
    // hits compaction frequently is doing longer, more complex sessions.
    api.on("after_compaction" as never, async (event: Record<string, unknown>) => {
      try {
        if (isPaused()) return;
        const session = getOrCreateSession(event);
        session.compactionCount++;
      } catch (err) {
        logError(`after_compaction: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // ── gateway_stop ─────────────────────────────────────────────────
    // Final flush when gateway shuts down — finalize all active sessions.
    api.on("gateway_stop" as never, async () => {
      try {
        // Finalize all active sessions
        for (const key of [...activeSessions.keys()]) {
          finalizeSession(key);
        }
        flushToDisk();

        // Clean up timer
        if (flushTimer) {
          clearInterval(flushTimer);
          flushTimer = null;
        }
      } catch (err) {
        logError(`gateway_stop: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  },
});
