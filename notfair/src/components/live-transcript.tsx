"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit3,
  FileText,
  Globe,
  Loader2,
  StopCircle,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Markdown } from "@/components/markdown";
import { brandDomain } from "@/components/mcp-icon";
import { RunningDot } from "@/components/running-dot";
import {
  WorkingIndicator,
  type WorkingMood,
  type WorkingPhase,
} from "@/components/working-indicator";
import { SlashCommandPopover } from "@/components/slash-command-popover";
import { cn } from "@/lib/utils";
import {
  executeLocalSlashCommand,
  filterSlashCommands,
  parseSlashMessage,
  type SlashCommand,
} from "@/lib/slash-commands";
import type { TranscriptEvent } from "@/server/sessions/transcript-tail";
import { projectHref } from "@/lib/project-href";

const POLL_INTERVAL_MS = 2_000;

/**
 * Content signature for cross-writer dedup. The id-based set in
 * seenEventIdsRef catches in-channel dups (e.g. polling racing itself);
 * this catches dups WHEN the same logical event arrives via different
 * channels with different ids — e.g. the shadow transcript stream gave
 * us an assistant turn during the run, and the eventual transcript
 * flush gives us the same turn with a fresh UUID at session-end.
 *
 * Signature keys are intentionally narrow: text body for messages
 * (case-insensitive trim collapses whitespace differences from the
 * shadow vs. final renders), tool_call_id for tool rows (those are
 * unique per invocation regardless of the writer).
 */
function eventSignature(e: TranscriptEvent): string {
  switch (e.kind) {
    case "user_message":
    case "assistant_text":
      return `${e.kind}|${e.body.trim()}`;
    case "tool_call":
    case "tool_result":
      return `${e.kind}|${e.tool_call_id}`;
    default:
      return `${e.kind}|${e.id}`;
  }
}

/**
 * Minimum catalog shape the chat needs to render an MCP server's brand icon
 * next to its tool calls. Mirrors `McpSpec` from `mcp-catalog.ts` — we
 * accept the broader type but only use these fields here.
 */
export type McpCatalogEntryLite = {
  key: string;
  display_name: string;
  resource_url: string;
};

type Props = {
  projectSlug: string;
  agentSlug: string;
  agentDisplayName: string;
  /** Thread label (the URL half of the (agent, label) session key). */
  threadId: string;
  /** Server-rendered initial slice of the transcript. */
  initialEvents: TranscriptEvent[];
  /** Byte offset *after* `initialEvents` — polls start from here. */
  initialCursor: number;
  /**
   * When true, disables the composer. This does not imply that a turn is
   * still running; read-only transcript views also disable the composer.
   */
  composerDisabled?: boolean;
  /**
   * Optional explanation shown inside a disabled composer. Read-only
   * transcript views use this instead of claiming the agent is working.
   */
  disabledComposerPlaceholder?: string;
  /** Keep a static terminal status visible in read-only transcript views. */
  showCompletedStatus?: boolean;
  /**
   * Set when the agent's task is parked in `blocked` (e.g., waiting on a
   * pending approval). Replaces the "thinking…" / "wrapping up…" indicator
   * — those imply forward motion, but a blocked task is dormant by design.
   */
  blockedReason?: string;
  /**
   * When set, on each successful poll we call this so the parent can
   * react to transcript growth (e.g., trigger router.refresh to refetch
   * statuses). Returning true tells us to stop background polling.
   */
  /**
   * MCP servers known to this project. The chat uses this to (a) detect
   * when a tool call belongs to an MCP server (vs. a shell / built-in
   * tool) and (b) render the server's brand favicon next to the call.
   * Optional — when omitted, MCP tool calls fall back to the generic
   * Wrench icon.
   */
  mcpCatalog?: McpCatalogEntryLite[];
  /**
   * Rendered at the very top of the scrollable log, above the first
   * event — scrolling the history to the top reveals it. The task
   * workspace passes the always-expanded brief card here so the brief
   * scrolls with the conversation instead of eating header space.
   */
  leadingContent?: React.ReactNode;
  /**
   * Models the composer's selector offers for this project's harness.
   * The option marked `is_default` names the model used when no override
   * flag is sent. Omitted/empty = no selector rendered.
   */
  modelOptions?: Array<{ value: string; label: string; is_default?: boolean }>;
};

export function LiveTranscript({
  projectSlug,
  agentSlug,
  agentDisplayName,
  threadId,
  initialEvents,
  initialCursor,
  composerDisabled = false,
  disabledComposerPlaceholder,
  showCompletedStatus = false,
  blockedReason,
  mcpCatalog,
  leadingContent,
  modelOptions = [],
}: Props) {
  const router = useRouter();
  const [events, setEvents] = useState<TranscriptEvent[]>(initialEvents);

  // Composer model override. "" = harness default (no flag). Persisted
  // per project+agent in localStorage; loaded after mount so SSR and the
  // first client render agree (no hydration mismatch).
  const modelStorageKey = `NotFair:model:${projectSlug}:${agentSlug}`;
  const [model, setModel] = useState("");
  useEffect(() => {
    const stored = window.localStorage.getItem(modelStorageKey);
    if (stored && modelOptions.some((m) => m.value === stored)) {
      setModel(stored);
    }
    // modelOptions is a fresh array per render from the server page —
    // key its identity by content to avoid effect churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelStorageKey, JSON.stringify(modelOptions)]);
  function onPickModel(value: string) {
    setModel(value);
    if (value) window.localStorage.setItem(modelStorageKey, value);
    else window.localStorage.removeItem(modelStorageKey);
  }
  const defaultModelLabel =
    modelOptions.find((option) => option.is_default)?.label ?? "Default";
  const selectedModelLabel =
    modelOptions.find((option) => option.value === model)?.label ??
    defaultModelLabel;
  const [cursor, setCursor] = useState(initialCursor);
  const [input, setInput] = useState("");
  const [sendingChat, setSendingChat] = useState(false);
  /**
   * Wallclock when the current turn started, in ms. Drives the "elapsed"
   * counter in WorkingStatus during the gap between hitting send and the
   * agent's first transcript event landing — without this, elapsed reflects
   * the *previous* turn's last event timestamp (often minutes/hours stale).
   * Cleared once the new user_message lands and rendering catches up.
   */
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Slash command autocomplete: open while input starts with "/" and the
  // user is still composing the command name (no space yet). After they
  // pick or type a space, the popover closes.
  const slashQuery = input.startsWith("/") && !input.includes(" ") ? input : null;
  const slashOpen = slashQuery !== null && !sendingChat && !composerDisabled;
  const slashMatches = useMemo<SlashCommand[]>(
    () => (slashOpen ? filterSlashCommands(slashQuery!) : []),
    [slashOpen, slashQuery],
  );
  const safeSlashIndex =
    slashMatches.length === 0
      ? 0
      : Math.min(slashIndex, slashMatches.length - 1);

  function insertSlashCommand(cmd: SlashCommand) {
    // Catalog `name` is the command without the leading slash ("new", "clear").
    // Insert ends with a trailing space so the popover closes — a second
    // Enter then submits.
    const insert = cmd.insert ?? `/${cmd.name} `;
    setInput(insert);
    setSlashIndex(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(insert.length, insert.length);
      }
    });
  }

  // Multiline auto-grow: track the content height (capped by max-h-52 via
  // CSS) so the composer expands as the user types and snaps back when the
  // input clears (send, escape, slash insert).
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [input]);

  // Optimistic state for the active /api/chat send. Rendered after committed
  // events so the user sees their message + the streaming response before
  // polling materializes them from the DB. Cleared once polling catches up.
  const [pendingUserMsg, setPendingUserMsg] = useState<string | null>(null);
  const [pendingAssistant, setPendingAssistant] = useState("");
  const [pendingTools, setPendingTools] = useState<ToolEntry[]>([]);
  const [pendingError, setPendingError] = useState<string | null>(null);
  /**
   * Most recent harness lifecycle phase for the in-flight turn (run.start,
   * run.warming, etc.). Surfaced in the "thinking…" indicator so a long
   * wait before the first model token at least shows forward motion.
   * Cleared when the turn ends.
   */
  const [pendingLifecycle, setPendingLifecycle] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * Ids of every transcript event we've already committed to state. Acts as
   * a dedupe set for poll-result merging: two `pollOnce` calls can fire
   * with the same `cursor` closure before React commits the next
   * offset (e.g. the post-stream catch-up poll racing the background
   * polling effect), so both fetches would return the same event slice and
   * we'd end up with duplicate React keys. Lives in a ref so the dedupe
   * is synchronous — `setEvents(prev => …)` updater functions don't run
   * until React's next commit, so they can't be used to derive the count
   * we return from `pollOnce`.
   */
  const seenEventIdsRef = useRef<Set<string>>(
    new Set(initialEvents.map((e) => e.id)),
  );

  /**
   * Content signatures we've already rendered, for cross-writer dedup.
   * The id-based set above can't catch the case where the SAME logical
   * message arrives twice via different paths with different ids — the
   * server-side-kickoff path writes a shadow transcript (ids like
   * `shadow-<uuid>`), and the poll later returns the DB copy of the
   * session.jsonl at session-end with FRESH UUIDs. Without a content
   * key, every assistant turn and tool call would render twice. Keyed by
   * the semantic identity: text body for messages, tool_call_id for
   * tool rows. Pure ref so React doesn't see it.
   */
  const seenSignaturesRef = useRef<Set<string>>(
    new Set(initialEvents.map(eventSignature)),
  );

  // ── Auto-scroll: only when the user is already near the bottom. ─────
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight);
    stickyBottomRef.current = remaining < 96;
  }
  useLayoutEffect(() => {
    if (!stickyBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events, sendingChat, pendingAssistant, pendingTools, pendingUserMsg]);

  // ── Live tail polling. ─────────────────────────────────────────────
  const pollOnce = useCallback(async () => {
    try {
      // Pass projectSlug explicitly: the API route would otherwise fall back
      // to the active-project cookie, which can lag the URL on first paint
      // after a project switch or direct deep-link.
      const url = `/api/agents/${agentSlug}/threads/${threadId}/transcript?offset=${cursor}&project=${encodeURIComponent(projectSlug)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return { newEvents: 0 };
      const data = (await res.json()) as {
        events: TranscriptEvent[];
        cursor: number;
      };
      // Dedupe against both id (in-channel races) and content signature
      // (cross-channel dups, e.g. live stream vs. poll). Rationale on the
      // refs' declarations.
      const fresh = data.events.filter((e) => {
        if (seenEventIdsRef.current.has(e.id)) return false;
        const sig = eventSignature(e);
        if (seenSignaturesRef.current.has(sig)) return false;
        return true;
      });
      for (const e of fresh) {
        seenEventIdsRef.current.add(e.id);
        seenSignaturesRef.current.add(eventSignature(e));
      }
      if (fresh.length > 0) {
        setEvents((prev) => [...prev, ...fresh]);
        // Clear pending state: the DB now has the canonical events so the
        // optimistic placeholders are no longer needed.
        setPendingUserMsg(null);
        setPendingAssistant("");
        setPendingTools([]);
        setPendingError(null);
        setPendingLifecycle(null);
      }
      if (data.cursor !== cursor) setCursor(data.cursor);
      return { newEvents: fresh.length };
    } catch {
      return { newEvents: 0 };
    }
  }, [agentSlug, cursor, projectSlug, threadId]);

  // Poll faster only during an active send. A disabled composer can also
  // mean "read-only history," which should not be treated as live work.
  const pollIntervalMs = sendingChat ? 800 : POLL_INTERVAL_MS;

  // Background polling: runs while mounted, paused during an active send so
  // we don't double-render content we're already streaming via SSE.
  useEffect(() => {
    if (sendingChat) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      await pollOnce();
      if (cancelled) return;
      timer = setTimeout(tick, pollIntervalMs);
    };
    timer = setTimeout(tick, pollIntervalMs);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pollIntervalMs, pollOnce, sendingChat]);

  // ── Live re-attach: SSE bridge to the shadow-transcript stream. ─────
  // The DB poll can lag a fast-streaming turn, so polling
  // sees nothing mid-turn. Both server-side task kickoffs and /api/chat
  // tee their gateway events to a live stream — this bridge tails that
  // file so a tab switching back to a thread mid-run picks up the stream
  // instead of staring at a frozen transcript until the turn flushes.
  //
  // The bridge runs on every thread mount, not just tasks. The shadow
  // file may not exist (idle thread) or exist-but-be-idle (run already
  // finished); both cases are no-ops on the server. Same dedup set as
  // polling, so events that later land in the DB don't
  // double-render.
  //
  // Skipped during an active /api/chat send — that path already streams
  // its own deltas; layering re-attach on top would just duplicate work.
  useEffect(() => {
    // Comprehensive client-side trace for the SSE re-attach. Prefix
    // [live-bridge] mirrors the server-side logs so a browser-console +
    // dev-server pair shows the full path. Toggle off in prod later.
    const log = (...args: unknown[]) =>
      console.log("[live-bridge]", ...args);
    if (sendingChat) {
      log("skip: sendingChat=true (/api/chat path owns streaming)", {
        threadId,
      });
      return;
    }
    if (typeof EventSource === "undefined") {
      log("skip: no EventSource in env (jsdom test)");
      return;
    }
    const url = `/api/agents/${agentSlug}/threads/${threadId}/live?project=${encodeURIComponent(projectSlug)}`;
    log("opening", { url });
    const es = new EventSource(url);
    es.addEventListener("open", () => log("opened"));
    es.addEventListener("ready", (e: MessageEvent) => log("ready", e.data));
    es.addEventListener("transcript", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { events: TranscriptEvent[] };
        if (!Array.isArray(data.events)) {
          log("transcript payload not an array", data);
          return;
        }
        const fresh = data.events.filter((ev) => {
          if (seenEventIdsRef.current.has(ev.id)) return false;
          const sig = eventSignature(ev);
          if (seenSignaturesRef.current.has(sig)) return false;
          return true;
        });
        log("transcript", {
          incoming: data.events.length,
          fresh: fresh.length,
        });
        for (const ev of fresh) {
          seenEventIdsRef.current.add(ev.id);
          seenSignaturesRef.current.add(eventSignature(ev));
        }
        if (fresh.length > 0) {
          setEvents((prev) => [...prev, ...fresh]);
          setPendingUserMsg(null);
          setPendingAssistant("");
          setPendingTools([]);
          setPendingError(null);
          setPendingLifecycle(null);
        }
      } catch (err) {
        log("transcript parse error", err);
      }
    });
    es.addEventListener("error", (e) => {
      log("error", { readyState: es.readyState, event: e });
    });
    return () => {
      log("closing", { threadId });
      es.close();
    };
  }, [agentSlug, projectSlug, sendingChat, threadId]);

  // ── Send: optimistic user message + SSE-driven streaming reply. ─────
  const send = useCallback(
    async (overrideText?: string, opts: { hidden?: boolean } = {}) => {
      const usingOverride = typeof overrideText === "string";
      const text = (usingOverride ? overrideText : input).trim();
      if (!text || sendingChat) return;

      // Local slash commands intercept the send. Skip when the message
      // was sent programmatically (overrides are always real prompts).
      const parsed = usingOverride ? null : parseSlashMessage(text);
      if (parsed) {
        const action = executeLocalSlashCommand(parsed.command, parsed.args);
        if (action) {
          setInput("");
          switch (action.kind) {
            case "clear":
              setEvents([]);
              setCursor(0);
              toast.info(
                "Local view cleared. Full transcript is still on disk; the next agent reply will repopulate.",
              );
              return;
            case "stop":
              abortRef.current?.abort();
              return;
            case "set-model": {
              // Same store the selector next to Send uses.
              const wanted = action.value.toLowerCase();
              const names = [
                `${defaultModelLabel} (default)`,
                ...modelOptions.map((m) => m.label),
              ].join(", ");
              if (!wanted) {
                toast.message("Model", {
                  description: `Current: ${
                    selectedModelLabel
                  }. Options: ${names}.`,
                });
                return;
              }
              if (wanted === "default") {
                onPickModel("");
                toast.success(`Model reset to ${defaultModelLabel}.`);
                return;
              }
              const match = modelOptions.find(
                (m) =>
                  m.value.toLowerCase() === wanted ||
                  m.label.toLowerCase() === wanted,
              );
              if (!match) {
                toast.error(`Unknown model '${action.value}'. Options: ${names}.`);
                return;
              }
              onPickModel(match.value);
              toast.success(`Model set to ${match.label}.`);
              return;
            }
            case "help":
              toast.message("Slash commands", { description: action.content });
              return;
          }
        }
      }

      if (!usingOverride) setInput("");
      setSendingChat(true);
      setTurnStartedAt(Date.now());
      setPendingUserMsg(opts.hidden ? null : text);
      setPendingAssistant("");
      setPendingTools([]);
      setPendingError(null);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            agent: agentSlug,
            project: projectSlug,
            thread: threadId,
            ...(model ? { model } : {}),
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error((await res.text()) || `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const raw of events) {
            handleSseEvent(raw, {
              onText: (chunk) => setPendingAssistant((s) => s + chunk),
              onTool: (evt) => {
                setPendingTools((prev) =>
                  upsertToolEntry(prev, evt),
                );
              },
              onError: (msg) => setPendingError(msg),
              onLifecycle: (phase) => setPendingLifecycle(phase),
              onMeta: (meta) => {
                if (process.env.NODE_ENV !== "production") {
                  // eslint-disable-next-line no-console
                  console.log(
                    `[chat-perf] turn start agent=${meta.agent} session=${meta.session_id} message_chars=${meta.message_chars}${meta.is_kickoff ? " (kickoff)" : ""}`,
                  );
                }
              },
              onPerf: (marks) => {
                if (process.env.NODE_ENV !== "production") {
                  // eslint-disable-next-line no-console
                  console.groupCollapsed(
                    `[chat-perf] turn complete (${marks.length} marks)`,
                  );
                  // eslint-disable-next-line no-console
                  console.table(
                    marks.map((m) => ({
                      name: m.name,
                      "at (ms)": Math.round(m.at),
                      "Δ (ms)": Math.round(m.delta),
                    })),
                  );
                  // eslint-disable-next-line no-console
                  console.groupEnd();
                }
              },
            });
          }
        }
        // Stream closed. Give the writer a moment to flush, then
        // pull the committed events. pollOnce clears pending state when it
        // returns new events; if it returns nothing yet, the regular
        // polling effect picks it up on the next tick.
        await new Promise((r) => setTimeout(r, 400));
        const { newEvents } = await pollOnce();
        if (newEvents === 0) {
          // Re-try once more shortly. Avoids the case where the writer is
          // slow to flush and the user briefly sees pending state with no
          // backing rows.
          setTimeout(() => {
            void pollOnce();
          }, 1200);
        }
      } catch (err) {
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        if (!isAbort) {
          const msg = err instanceof Error ? err.message : String(err);
          setPendingError(msg);
          toast.error(msg);
        }
      } finally {
        setSendingChat(false);
        setTurnStartedAt(null);
        setPendingLifecycle(null);
        abortRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onPickModel is
    // stable in behavior (writes localStorage + state); modelOptions is a
    // fresh array from the server component each render.
    [agentSlug, input, model, modelOptions, pollOnce, projectSlug, router, sendingChat, threadId],
  );

  const rendered = useMemo(() => collapseEvents(events), [events]);
  const transcriptEnded = events.some(
    (e) => e.kind === "lifecycle" && e.phase === "done",
  );
  // Keep the indicator at the bottom of the transcript throughout a live
  // turn. Read-only logs can opt into a static completed status, but merely
  // disabling the composer must never manufacture a forever-running state.
  //
  // (Earlier we hid the indicator once anything pending was rendered.
  // That made the chat read as "stuck" the moment streaming started —
  // there was no longer any active animation to telegraph "I'm still
  // working.")
  const showThinking =
    sendingChat ||
    Boolean(blockedReason) ||
    (showCompletedStatus && transcriptEnded);

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
        role="log"
        aria-live="polite"
      >
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          {leadingContent}
          {rendered.length === 0 &&
          !pendingUserMsg &&
          !sendingChat &&
          !composerDisabled &&
          !blockedReason ? (
            <TranscriptEmptyState agentDisplayName={agentDisplayName} />
          ) : (
            <ol className="space-y-4">
              {rendered.map((item) => (
                <li key={item.key}>
                  <RenderItem item={item} mcpCatalog={mcpCatalog} />
                </li>
              ))}
              {pendingUserMsg && (
                <li>
                  <UserBubble body={pendingUserMsg} />
                </li>
              )}
              {pendingTools.length > 0 && (
                <li>
                  <ToolGroup tools={pendingTools} mcpCatalog={mcpCatalog} />
                </li>
              )}
              {pendingAssistant && (
                <li>
                  <AssistantText body={pendingAssistant} />
                </li>
              )}
              {pendingError && (
                <li>
                  <ErrorRow agentDisplayName={agentDisplayName} body={pendingError} />
                </li>
              )}
              {showThinking && (
                <li>
                  {blockedReason ? (
                    <BlockedStatus reason={blockedReason} />
                  ) : (
                    <LiveWorkingIndicator
                      agentDisplayName={agentDisplayName}
                      events={events}
                      turnStartedAt={turnStartedAt}
                      lifecyclePhase={pendingLifecycle}
                      pendingTools={pendingTools}
                      hasPendingAssistant={pendingAssistant.length > 0}
                    />
                  )}
                </li>
              )}
            </ol>
          )}
        </div>
      </div>

      <div className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="relative mx-auto w-full max-w-3xl px-6 py-3">
          {slashOpen && (
            <SlashCommandPopover
              commands={slashMatches}
              selectedIndex={safeSlashIndex}
              onSelect={insertSlashCommand}
              onHover={setSlashIndex}
            />
          )}
          {/* Codex-style composer: one rounded well, borderless multiline
              textarea on top, a toolbar row below with only the circular
              send button. */}
          <form
            className="rounded-2xl border border-border/60 bg-card shadow-[var(--notfair-shadow)] transition-shadow focus-within:ring-1 focus-within:ring-ring"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setSlashIndex(0);
              }}
              onKeyDown={(e) => {
                // Slash autocomplete: arrow keys cycle, Tab/Enter insert.
                if (slashOpen && slashMatches.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSlashIndex((i) => (i + 1) % slashMatches.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashIndex(
                      (i) =>
                        (i - 1 + slashMatches.length) % slashMatches.length,
                    );
                    return;
                  }
                  if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                    e.preventDefault();
                    const picked = slashMatches[safeSlashIndex];
                    if (picked) insertSlashCommand(picked);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setInput("");
                    setSlashIndex(0);
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={composerDisabled}
              placeholder={
                composerDisabled
                  ? disabledComposerPlaceholder ??
                    "The agent is working — the transcript updates live"
                  : blockedReason
                    ? "Reply — the agent will see your message"
                    : "Message this goal's agent…  (type / for commands)"
              }
              rows={1}
              className="block max-h-52 w-full resize-none bg-transparent px-4 pt-3.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <div className="flex items-center justify-end gap-1.5 px-2.5 pb-2.5 pt-1.5">
              {/* Model picker sits right next to the send button (Codex
                  placement): quiet "<model> ⌄" text trigger, dropdown of
                  every available model opening above the composer. */}
              {modelOptions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Model"
                      disabled={composerDisabled || sendingChat}
                      className="inline-flex max-w-44 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="truncate">
                        {selectedModelLabel}
                      </span>
                      <ChevronDown className="size-3 shrink-0" aria-hidden />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top">
                    <DropdownMenuRadioGroup
                      value={model}
                      onValueChange={onPickModel}
                    >
                      <DropdownMenuRadioItem value="">
                        {defaultModelLabel} (default)
                      </DropdownMenuRadioItem>
                      {modelOptions.map((m) => (
                        <DropdownMenuRadioItem key={m.value} value={m.value}>
                          {m.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {sendingChat ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => abortRef.current?.abort()}
                  className="size-9 rounded-full"
                  aria-label="Stop"
                >
                  <StopCircle className="size-4" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  disabled={composerDisabled || !input.trim()}
                  className="size-9 rounded-full"
                  aria-label="Send"
                >
                  <ArrowUp className="size-4" />
                </Button>
              )}
            </div>
          </form>
          {(sendingChat || !composerDisabled) && (
            <p className="pt-1.5 text-center text-[10px] text-muted-foreground">
              {sendingChat ? (
                <span className="inline-flex items-center gap-1.5">
                  <RunningDot size="sm" aria-label="" />
                  Streaming — click stop to abort
                </span>
              ) : (
                <>Enter to send · Shift+Enter for newline</>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SSE plumbing for the active send ────────────────────────────────────

type SseToolEvent = {
  phase: "start" | "update" | "result";
  tool_call_id: string;
  name: string;
  label?: string;
};

type SsePerfMark = { name: string; at: number; delta: number };
type SseMeta = {
  message_chars?: number;
  is_kickoff?: boolean;
  agent?: string;
  session_id?: string;
};

function handleSseEvent(
  raw: string,
  handlers: {
    onText: (chunk: string) => void;
    onTool: (evt: SseToolEvent) => void;
    onError: (msg: string) => void;
    onLifecycle?: (phase: string) => void;
    onMeta?: (meta: SseMeta) => void;
    onPerf?: (marks: SsePerfMark[]) => void;
  },
) {
  const lines = raw.split("\n");
  const evtLine = lines.find((l) => l.startsWith("event: "));
  const dataLine = lines.find((l) => l.startsWith("data: "));
  if (!evtLine || !dataLine) return;
  const evt = evtLine.slice("event: ".length);
  let data: unknown;
  try {
    data = JSON.parse(dataLine.slice("data: ".length));
  } catch {
    return;
  }
  if (evt === "text") {
    const chunk = (data as { chunk?: string }).chunk;
    if (typeof chunk === "string") handlers.onText(chunk);
    return;
  }
  if (evt === "tool") {
    handlers.onTool(data as SseToolEvent);
    return;
  }
  if (evt === "lifecycle") {
    const phase = (data as { phase?: string }).phase;
    if (typeof phase === "string" && handlers.onLifecycle) {
      handlers.onLifecycle(phase);
    }
    return;
  }
  if (evt === "meta") {
    if (handlers.onMeta) handlers.onMeta(data as SseMeta);
    return;
  }
  if (evt === "perf") {
    const marks = (data as { marks?: SsePerfMark[] }).marks;
    if (Array.isArray(marks) && handlers.onPerf) handlers.onPerf(marks);
    return;
  }
  if (evt === "error") {
    const msg = (data as { message?: string }).message ?? "unknown error";
    handlers.onError(msg);
    return;
  }
}

function upsertToolEntry(prev: ToolEntry[], evt: SseToolEvent): ToolEntry[] {
  const idx = prev.findIndex((t) => t.toolCallId === evt.tool_call_id);
  if (idx < 0) {
    return [
      ...prev,
      {
        toolCallId: evt.tool_call_id,
        name: evt.name,
        label: evt.label ?? null,
        result: null,
        ok: true,
        done: evt.phase === "result",
      },
    ];
  }
  const next = prev.slice();
  const existing = next[idx]!;
  next[idx] = {
    ...existing,
    name: evt.name,
    label: evt.label ?? existing.label,
    done: evt.phase === "result" ? true : existing.done,
  };
  return next;
}

// ── Rendering helpers ──────────────────────────────────────────────────

type ToolEntry = {
  toolCallId: string;
  name: string;
  label: string | null;
  result: string | null;
  ok: boolean;
  done: boolean;
};

type RenderedItem =
  | { kind: "user_message"; key: string; body: string; system?: boolean }
  | { kind: "assistant_text"; key: string; body: string }
  | { kind: "tool_group"; key: string; tools: ToolEntry[] }
  | { kind: "system_unknown"; key: string; raw_type: string };

/**
 * The transcript stores `toolCall` and `toolResult` as separate parts,
 * sometimes interleaved across multiple message rows in one turn. We:
 *   1. Pair calls with their later results by tool_call_id so each tool
 *      renders as one logical entry (spinner → check).
 *   2. Group runs of contiguous tool entries (no assistant_text or
 *      user_message between them) into a single collapsible "tool_group".
 *      Mirrors Claude.ai's pattern — one card per cluster, summary shows
 *      the most recent tool name, expand to see all of them.
 */
function collapseEvents(events: TranscriptEvent[]): RenderedItem[] {
  type Step =
    | { tag: "tool"; key: string; entry: ToolEntry }
    | { tag: "msg"; item: RenderedItem };
  const steps: Step[] = [];
  const callIndex = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "tool_call") {
      callIndex.set(e.tool_call_id, steps.length);
      steps.push({
        tag: "tool",
        key: e.id,
        entry: {
          toolCallId: e.tool_call_id,
          name: e.name,
          label: e.label,
          result: null,
          ok: true,
          done: false,
        },
      });
      continue;
    }
    if (e.kind === "tool_result") {
      const idx = callIndex.get(e.tool_call_id);
      const step = idx != null ? steps[idx] : null;
      if (step && step.tag === "tool") {
        step.entry = {
          ...step.entry,
          result: e.summary,
          ok: e.ok,
          done: true,
        };
        continue;
      }
      steps.push({
        tag: "tool",
        key: e.id,
        entry: {
          toolCallId: e.tool_call_id,
          name: e.name,
          label: null,
          result: e.summary,
          ok: e.ok,
          done: true,
        },
      });
      continue;
    }
    if (e.kind === "user_message") {
      steps.push({
        tag: "msg",
        item: { kind: "user_message", key: e.id, body: e.body, system: e.system },
      });
      continue;
    }
    if (e.kind === "assistant_text") {
      steps.push({
        tag: "msg",
        item: { kind: "assistant_text", key: e.id, body: e.body },
      });
      continue;
    }
    if (e.kind === "unknown") {
      steps.push({
        tag: "msg",
        item: { kind: "system_unknown", key: e.id, raw_type: e.raw_type },
      });
      continue;
    }
  }
  const out: RenderedItem[] = [];
  let buffer: ToolEntry[] = [];
  let bufferKey: string | null = null;
  const flush = () => {
    if (buffer.length === 0) return;
    out.push({ kind: "tool_group", key: `tg:${bufferKey}`, tools: buffer });
    buffer = [];
    bufferKey = null;
  };
  for (const step of steps) {
    if (step.tag === "tool") {
      if (bufferKey === null) bufferKey = step.key;
      buffer.push(step.entry);
    } else {
      flush();
      out.push(step.item);
    }
  }
  flush();
  return out;
}

function RenderItem({
  item,
  mcpCatalog,
}: {
  item: RenderedItem;
  mcpCatalog?: McpCatalogEntryLite[];
}) {
  if (item.kind === "user_message") {
    // Platform-generated briefs (goal intake kickoff, tick briefs) are
    // not something the user typed — render a compact system line so the
    // chat reads as "the agent got to work", not "who wrote this?".
    if (item.system) {
      const label = item.body.startsWith("[TICK]")
        ? "Heartbeat tick — brief delivered to the agent"
        : item.body.startsWith("[INTAKE]")
          ? "Goal created — your ambition was handed to the agent"
          : "Scheduled brief delivered to the agent";
      return (
        <div className="flex justify-center">
          <span className="rounded-full bg-[hsl(var(--notfair-surface-2))] px-3 py-1 text-[11.5px] text-[hsl(var(--notfair-ink-4))]">
            {label}
          </span>
        </div>
      );
    }
    return <UserBubble body={item.body} />;
  }
  if (item.kind === "assistant_text") {
    return <AssistantText body={item.body} />;
  }
  if (item.kind === "tool_group") {
    return <ToolGroup tools={item.tools} mcpCatalog={mcpCatalog} />;
  }
  return null;
}

function UserBubble({ body }: { body: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-[6px] bg-muted px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words">
        {body}
      </div>
    </div>
  );
}

function AssistantText({ body }: { body: string }) {
  // Goal side effects now go through MCP tool calls, not
  // pseudo-XML blocks. We render the assistant's prose as-is.
  if (body.trim() === "") return null;
  return (
    <div className="text-sm leading-relaxed">
      <Markdown>{body}</Markdown>
    </div>
  );
}

function ToolGroup({
  tools,
  mcpCatalog,
}: {
  tools: ToolEntry[];
  mcpCatalog?: McpCatalogEntryLite[];
}) {
  const inFlightCount = tools.filter((t) => !t.done).length;
  const isLive = inFlightCount > 0;
  const headline =
    tools.find((t) => !t.done) ?? tools[tools.length - 1] ?? null;
  // Group status reflects the FINAL outcome, not "any error ever". When the
  // agent retried a failed call and the retry succeeded, the user sees
  // green — only expanding the card reveals the intermediate stumble.
  // Matches Claude.ai's pattern of grading by "did this turn ultimately
  // work" rather than punishing every recoverable hiccup.
  const lastDone = [...tools].reverse().find((t) => t.done);
  const hasError = !!(lastDone && !lastDone.ok);
  const intent = headline
    ? humanizeTool(headline.name, headline.label)
    : { verb: "Tool call" };
  const headMcp = headline ? matchMcpServerKey(headline.name, mcpCatalog) : null;
  const HeadIcon = headline ? iconForTool(headline.name) : Wrench;
  const StatusIcon = isLive
    ? Loader2
    : hasError
      ? AlertCircle
      : CheckCircle2;
  const statusClass = isLive
    ? "text-muted-foreground motion-safe:animate-spin"
    : hasError
      ? "text-destructive"
      : "text-[hsl(var(--notfair-accent))]";

  return (
    <details
      key={isLive ? "live" : "done"}
      open={isLive}
      className="group rounded-[10px] bg-card shadow-[var(--notfair-shadow-sm)]"
    >
      <summary
        className={cn(
          "flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs",
          "rounded-[10px] hover:bg-[hsl(var(--notfair-hover))] [&::-webkit-details-marker]:hidden",
        )}
      >
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <StatusIcon className={cn("size-3.5 shrink-0", statusClass)} />
        {headMcp ? (
          <ToolBrandFavicon
            resourceUrl={headMcp.resource_url}
            alt={headMcp.display_name}
          />
        ) : (
          <HeadIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="font-mono text-[12px] font-medium text-foreground">
          {intent.verb}
        </span>
        {intent.target && (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {intent.target}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
          {isLive ? (
            <span className="inline-flex items-center gap-1.5">
              <RunningDot size="sm" aria-label="" />
              {tools.length === 1
                ? "working"
                : `${tools.length} steps · ${inFlightCount} live`}
            </span>
          ) : tools.length === 1 ? (
            <>1 step</>
          ) : (
            <>{tools.length} steps</>
          )}
        </span>
      </summary>
      <div className="space-y-2 bg-[hsl(var(--notfair-surface-2))/0.45] px-3 py-2">
        {tools.map((t) => (
          <ToolRow key={t.toolCallId} entry={t} mcpCatalog={mcpCatalog} />
        ))}
      </div>
    </details>
  );
}

function ToolRow({
  entry,
  mcpCatalog,
}: {
  entry: ToolEntry;
  mcpCatalog?: McpCatalogEntryLite[];
}) {
  const intent = humanizeTool(entry.name, entry.label);
  const mcp = matchMcpServerKey(entry.name, mcpCatalog);
  const Icon = iconForTool(entry.name);
  const StatusIcon = entry.done
    ? entry.ok
      ? CheckCircle2
      : AlertCircle
    : Loader2;
  const statusClass = entry.done
    ? entry.ok
      ? "text-[hsl(var(--notfair-accent))]"
      : "text-destructive"
    : "text-muted-foreground motion-safe:animate-spin";
  // Show the raw command/label only when it actually adds information —
  // i.e. it's not redundant with the intent target the header already
  // surfaces (path/url/etc.). Keeps simple tool rows tight while still
  // exposing shell command lines and other raw invocations in full.
  const showRawLabel =
    !!entry.label &&
    entry.label.trim() !== "" &&
    entry.label.trim() !== intent.target?.trim();
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <StatusIcon className={cn("size-3.5 shrink-0", statusClass)} />
        {mcp ? (
          <ToolBrandFavicon
            resourceUrl={mcp.resource_url}
            alt={mcp.display_name}
          />
        ) : (
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="font-mono text-[12px] font-medium text-foreground">
          {intent.verb}
        </span>
        {intent.target && (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {intent.target}
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
          {formatToolName(entry.name)}
        </span>
      </div>
      {showRawLabel && (
        <pre className="ml-6 max-h-40 overflow-auto rounded bg-muted/60 px-2 py-1 font-mono text-[10.5px] leading-snug text-foreground/80 whitespace-pre-wrap break-all">
          {entry.label}
        </pre>
      )}
      {entry.done && entry.result && (
        <div className="ml-6 font-mono text-[11px] text-muted-foreground/90">
          <span className="text-[10px] uppercase tracking-[0.18em]">
            {entry.ok ? "→ result" : "→ error"}
          </span>{" "}
          <span className="break-words">{entry.result}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Tiny inline favicon for an MCP tool row — sized to fit the same 3.5
 * grid slot as the lucide icons next to it, so MCP and built-in tools
 * align cleanly in the same column. Re-implements the brand-favicon
 * fetch instead of using `<McpIcon>` directly because that component
 * always wraps the image in a 9-unit muted square — too chunky for
 * inline rendering in a dense tool row.
 */
function ToolBrandFavicon({
  resourceUrl,
  alt,
}: {
  resourceUrl: string;
  alt: string;
}) {
  const [errored, setErrored] = useState(false);
  let host: string | null = null;
  try {
    host = new URL(resourceUrl).hostname;
  } catch {
    host = null;
  }
  const brand = host ? brandDomain(host) : null;
  if (!brand || errored) {
    return <Wrench className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${brand}&size=16`}
      alt={alt}
      width={14}
      height={14}
      className="size-3.5 shrink-0 rounded-[3px]"
      referrerPolicy="no-referrer"
      onError={() => setErrored(true)}
    />
  );
}

/**
 * Replaces WorkingStatus when the task is parked in `blocked`. The agent
 * isn't currently running — it's dormant until the gating condition (most
 * often a pending approval) resolves. Showing "thinking…" or "wrapping
 * up…" here misleads the user into thinking work is still happening.
 */
function BlockedStatus({ reason }: { reason: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-md bg-[hsl(var(--notfair-warn-soft))] px-3 py-2 text-xs">
      <span
        className="mt-1 inline-block size-2 shrink-0 rounded-full bg-amber-500"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-amber-900 dark:text-amber-200">
          Paused — {reason}
        </div>
        <div className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-300/70">
          The agent will resume automatically when the gating condition
          resolves. You can also reply below to give context or answer a
          question.
        </div>
      </div>
    </div>
  );
}

/**
 * LiveWorkingIndicator — the bottom-anchored "agent is working" card.
 *
 * Wraps the presentational WorkingIndicator with the project-specific
 * logic: derive headline/subtitle/mood/phases from a mix of SSE-leading
 * pending state and DB-trailing committed events, then drive the
 * 1Hz elapsed counter. Kept inside live-transcript so the derivation
 * has the full union of TranscriptEvent + ToolEntry types in scope
 * without exporting either across the module boundary.
 *
 * Replaces the old WorkingStatus that paired a small cyan ✳ with
 * cycling verbs (Pondering / Cogitating / Effervescing …). The new
 * indicator carries the same information in a denser, more vivid
 * layout — see working-indicator.tsx for the visual treatment.
 */
function LiveWorkingIndicator({
  agentDisplayName,
  events,
  turnStartedAt,
  lifecyclePhase,
  pendingTools,
  hasPendingAssistant,
}: {
  agentDisplayName: string;
  events: TranscriptEvent[];
  turnStartedAt: number | null;
  lifecyclePhase?: string | null;
  pendingTools?: ToolEntry[];
  hasPendingAssistant?: boolean;
}) {
  const [now, setNow] = useState<number>(() => Date.now());
  const visiblyEnded =
    events.some((e) => e.kind === "lifecycle" && e.phase === "done") &&
    !pendingTools?.some((t) => !t.done) &&
    !hasPendingAssistant;
  useEffect(() => {
    if (visiblyEnded) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [visiblyEnded]);

  const view = deriveWorkingView({
    agentDisplayName,
    events,
    lifecyclePhase: lifecyclePhase ?? null,
    pendingTools: pendingTools ?? [],
    hasPendingAssistant: hasPendingAssistant ?? false,
    // The indicator must only reflect the current turn — without this
    // filter, the trajectory chips show every tool call from the chat's
    // entire history (e.g. a fresh "hi" lit up runScript / runScript /
    // listConnectedAccounts from prior audit turns).
    turnStartedAt,
    now,
  });

  // Anchor elapsed to whichever is later: the turn-start wallclock the
  // composer recorded, or the last event's timestamp. Keeps the counter
  // honest during the SSE-only window where events are still empty.
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const anchorTs = (() => {
    const lastTs = lastEvent?.ts ?? null;
    if (turnStartedAt && lastTs) return Math.max(turnStartedAt, lastTs);
    return turnStartedAt ?? lastTs;
  })();
  const elapsedMs =
    view.mood !== "ended" && anchorTs != null
      ? Math.max(0, now - anchorTs)
      : null;

  return (
    <WorkingIndicator
      agentDisplayName={agentDisplayName}
      headline={view.headline}
      subtitle={view.subtitle}
      phases={view.phases}
      mood={view.mood}
      elapsedMs={elapsedMs}
    />
  );
}

type WorkingView = {
  headline: string;
  subtitle: string | null;
  phases: WorkingPhase[];
  mood: WorkingMood;
};

/**
 * Build the visible state for the working indicator from the current
 * SSE pending state + committed transcript events.
 *
 * Precedence (most-specific first):
 *   1. An SSE-pending tool start that hasn't reported a result → that's
 *      the active phase, mood "tool".
 *   2. An SSE-pending assistant text stream → mood "writing".
 *   3. No events yet (pre-first-token kickoff wait) → mood "waiting"
 *      with the gateway lifecycle hint as subtitle.
 *   4. A committed in-flight tool_call → mood "tool" (polling caught up
 *      before the SSE state did, e.g. on rejoin from another tab).
 *   5. Last committed event is a tool_result → mood "waiting".
 *   6. Last committed event is assistant_text → mood "wrapping" while the
 *      message is fresh; once it goes stale (WRAPPING_STALE_MS) the agent
 *      is mid-work on its next step, not wrapping — mood "waiting" with
 *      an honest "quiet for Xm" subtitle.
 *
 * Phases are derived from BOTH sources so the trajectory chips include
 * recent SSE tools the DB hasn't seen yet, then dedupe by tool name.
 */
function deriveWorkingView(input: {
  agentDisplayName: string;
  events: TranscriptEvent[];
  lifecyclePhase: string | null;
  pendingTools: ToolEntry[];
  hasPendingAssistant: boolean;
  /**
   * Wallclock when the current turn started. We use it to scope the
   * trajectory chips (and the in-flight tool detection) to the active
   * turn — events from earlier turns in the same thread don't belong
   * in "what is the agent doing right now?".
   */
  turnStartedAt: number | null;
  /** Current wallclock (the caller's 1Hz tick) for staleness checks. */
  now: number;
}): WorkingView {
  const { agentDisplayName, events, lifecyclePhase, pendingTools, hasPendingAssistant, turnStartedAt, now } = input;
  // Only consider events from the current turn. Anything older is part
  // of the persistent transcript above this card, not the live status.
  const turnEvents =
    turnStartedAt != null
      ? events.filter((e) => e.ts >= turnStartedAt)
      : events;
  // Turn-ended signal: the harness emits a `final` event when its run
  // completes; transcript-tail surfaces it as `{ kind: "lifecycle",
  // phase: "done" }`. Once we've seen it, the agent has stopped producing
  // tokens. Keep the trajectory chips, but switch every live affordance
  // to the static completed presentation.
  const turnEnded = turnEvents.some(
    (e) => e.kind === "lifecycle" && e.phase === "done",
  );
  const lastEvent = turnEvents.length > 0 ? turnEvents[turnEvents.length - 1] : null;
  const pendingInFlightTool = pendingTools.find((t) => !t.done) ?? null;
  const inFlightCommittedToolCall: Extract<
    TranscriptEvent,
    { kind: "tool_call" }
  > | null = (() => {
    if (!lastEvent || lastEvent.kind !== "tool_call") return null;
    const matched = turnEvents.some(
      (e) => e.kind === "tool_result" && e.tool_call_id === lastEvent.tool_call_id,
    );
    return matched ? null : lastEvent;
  })();
  const phases = buildPhases(turnEvents, pendingTools);

  // Highest precedence: the harness has emitted its normal final event.
  // This is a completed turn, not a parked task and not an error.
  if (turnEnded && !pendingInFlightTool && !hasPendingAssistant) {
    return {
      headline: "Turn complete",
      subtitle: null,
      phases,
      mood: "ended",
    };
  }

  if (pendingInFlightTool) {
    const intent = humanizeTool(pendingInFlightTool.name, pendingInFlightTool.label);
    return {
      headline: intent.verb,
      subtitle: intent.target ?? pendingInFlightTool.label ?? null,
      phases,
      mood: "tool",
    };
  }
  if (hasPendingAssistant) {
    return {
      headline: "Writing the response",
      subtitle: subtitleForLastTool(pendingTools, turnEvents),
      phases,
      mood: "writing",
    };
  }
  // Between-tools window: SSE has seen at least one tool finish this
  // turn but the model hasn't started the next thing yet (no in-flight
  // pending tool, no streaming text, no fresh transcript event because Codex
  // buffers the file until end-of-turn). Without this branch we'd fall
  // through to "Starting", which is wrong — the agent IS thinking, just
  // about its next move. Surface the last tool so the user has context.
  if (pendingTools.length > 0) {
    const lastDone = [...pendingTools].reverse().find((t) => t.done);
    return {
      headline: "Thinking",
      subtitle: lastDone
        ? `${humanizeTool(lastDone.name, lastDone.label).verb} ${lastDone.ok ? "✓" : "failed"} — picking next step`
        : null,
      phases,
      mood: "waiting",
    };
  }
  if (!lastEvent || lastEvent.kind === "user_message" || lastEvent.kind === "unknown") {
    // The gateway lifecycle phase IS the status when it arrives — showing
    // "Starting" with a "Calling the model" subtitle stacked two
    // contradictory descriptions of the same moment. Promote whichever
    // signal we have to the headline; the generic "Starting" only fires
    // before any lifecycle event lands.
    const lifecycleSummary = lifecyclePhase
      ? humanLifecyclePhase(lifecyclePhase)
      : null;
    return {
      headline: lifecycleSummary ?? "Starting",
      subtitle: null,
      phases,
      mood: "waiting",
    };
  }
  if (inFlightCommittedToolCall) {
    const intent = humanizeTool(
      inFlightCommittedToolCall.name,
      inFlightCommittedToolCall.label,
    );
    return {
      headline: intent.verb,
      subtitle: intent.target ?? inFlightCommittedToolCall.label ?? null,
      phases,
      mood: "tool",
    };
  }
  if (lastEvent.kind === "tool_result") {
    const verb = humanizeTool(lastEvent.name, null).verb;
    return {
      headline: "Thinking",
      subtitle: lastEvent.ok
        ? `${verb} ✓ — picking next step`
        : `${verb} failed — retrying`,
      phases,
      mood: "waiting",
    };
  }
  // assistant_text. "Wrapping up" is only true for the brief gap between
  // the closing message and the turn's `final` event (sub-second on
  // Codex, a few seconds on Claude Code). Codex delivers whole messages
  // BETWEEN work phases and then goes silent — no deltas, no tool events
  // — while it reasons toward its next tool call, so an intermediate
  // narration message left "Wrapping up" spinning for many minutes and
  // read as hung. Once the message goes stale, say what's actually
  // happening: the agent is still mid-turn and has been quiet for a while.
  if (now - lastEvent.ts > WRAPPING_STALE_MS) {
    return {
      headline: "Still working",
      subtitle: `quiet for ${formatQuietFor(now - lastEvent.ts)} — progress updates from this harness can be sparse`,
      phases,
      mood: "waiting",
    };
  }
  return {
    headline: "Wrapping up",
    subtitle: subtitleForLastTool(pendingTools, events),
    phases,
    mood: "wrapping",
  };
}

/**
 * How long the last assistant message may sit as the newest event before
 * "Wrapping up" stops being a credible description of the turn. Past
 * this, the agent is demonstrably NOT wrapping up — it's working silently
 * toward its next step (Codex emits nothing while reasoning).
 */
const WRAPPING_STALE_MS = 30_000;

function formatQuietFor(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 90) return `${sec}s`;
  return `${Math.floor(sec / 60)}m`;
}

function subtitleForLastTool(
  pendingTools: ToolEntry[],
  events: TranscriptEvent[],
): string | null {
  const lastDonePending = [...pendingTools].reverse().find((t) => t.done);
  if (lastDonePending) {
    const verb = humanizeTool(lastDonePending.name, lastDonePending.label).verb;
    return `${verb} ${lastDonePending.ok ? "✓" : "failed"}`;
  }
  const lastDoneCommitted = [...events]
    .reverse()
    .find((e): e is Extract<TranscriptEvent, { kind: "tool_result" }> =>
      e.kind === "tool_result",
    );
  if (lastDoneCommitted) {
    const verb = humanizeTool(lastDoneCommitted.name, null).verb;
    return `${verb} ${lastDoneCommitted.ok ? "✓" : "failed"}`;
  }
  return null;
}

/**
 * Build the trajectory pills shown in the indicator. Order:
 *   1. Committed tools (in order, deduped by tool_call_id).
 *   2. SSE-pending tools not yet in the committed list.
 * The last entry is the "active" one. Done entries get a check, the
 * active one gets the mood-colored ring + wrench glyph.
 */
function buildPhases(
  events: TranscriptEvent[],
  pendingTools: ToolEntry[],
): WorkingPhase[] {
  const seen = new Set<string>();
  const phases: WorkingPhase[] = [];

  // Walk committed events to build phases in order. Capture the `label`
  // from the tool_call (where it lives) so the phase chip's intent
  // matches what the inline ToolGroup row shows — without it, shell
  // commands collapse to "Ran shell command" in the trajectory.
  const committedById = new Map<
    string,
    { name: string; label: string | null; done: boolean; ok: boolean }
  >();
  for (const e of events) {
    if (e.kind === "tool_call") {
      committedById.set(e.tool_call_id, {
        name: e.name,
        label: e.label,
        done: false,
        ok: true,
      });
    } else if (e.kind === "tool_result") {
      const prev = committedById.get(e.tool_call_id);
      if (prev) {
        prev.done = true;
        prev.ok = e.ok;
      } else {
        committedById.set(e.tool_call_id, {
          name: e.name,
          label: null,
          done: true,
          ok: e.ok,
        });
      }
    }
  }
  for (const [id, t] of committedById) {
    seen.add(id);
    phases.push({
      id,
      label: humanizeTool(t.name, t.label).verb,
      state: !t.done ? "active" : t.ok ? "done" : "failed",
    });
  }

  // Then any SSE-pending tools the committed list doesn't have yet.
  for (const t of pendingTools) {
    if (seen.has(t.toolCallId)) continue;
    const intent = humanizeTool(t.name, t.label);
    phases.push({
      id: t.toolCallId,
      label: intent.verb,
      state: !t.done ? "active" : t.ok ? "done" : "failed",
      detail: intent.target ?? t.label ?? null,
    });
  }

  // If multiple phases are flagged "active" (shouldn't happen, but defend),
  // demote all but the last so the visual stays clear.
  let lastActive = -1;
  for (let i = 0; i < phases.length; i++) {
    if (phases[i]!.state === "active") lastActive = i;
  }
  return phases.map((p, i) =>
    p.state === "active" && i !== lastActive ? { ...p, state: "done" } : p,
  );
}

/**
 * Translate a harness stream lifecycle phase into a short
 * user-facing label. We don't try to enumerate every possible phase —
 * unknown values fall through to a generic "starting up…" so a future
 * gateway protocol bump doesn't render a blank status. Used by the
 * pre-first-event branch of WorkingStatus (the ~15s pause where the
 * model is parsing the system prompt and brief).
 */
function humanLifecyclePhase(phase: string): string {
  const p = phase.toLowerCase();
  // Capitalized + no trailing ellipsis — these strings are used as the
  // indicator's headline now, alongside "Calling runScript" / "Thinking"
  // / "Writing the response". BreathingDots after the headline handles
  // the "…" affordance.
  if (p.includes("warming") || p.includes("warmup")) return "Warming up";
  if (p.includes("compact")) return "Compacting context";
  if (p === "start" || p.endsWith(".start") || p.includes("run.start"))
    return "Calling the model";
  if (p.includes("end") || p.includes("complete")) return "Finishing up";
  return "Starting up";
}

/**
 * Strip the project-slug prefix and the namespace path so the user sees
 * the bare action name. Tools come in two conventions:
 *   `<mcp>.action`             → e.g. `notfair.runScript`
 *   `<project>-<mcp>__action`  → e.g. `demo1-notfair-googleads__runScript`
 * Both should render as just the action. Falls back to the input untouched.
 */
function formatToolName(name: string): string {
  if (!name) return name;
  // Codex names can nest both separators (`notfair_<slug>__notfair_goals.propose_target`)
  // — strip namespaces for BOTH, keeping only the action.
  let out = name;
  for (const sep of ["__", "."]) {
    const idx = out.lastIndexOf(sep);
    if (idx >= 0) {
      const tail = out.slice(idx + sep.length);
      if (tail) out = tail;
    }
  }
  return out;
}

/**
 * Human-readable intent for a tool call, used wherever we'd otherwise
 * surface a raw command line or namespaced tool identifier in the chat.
 *
 * Two layers:
 *   1. Shell-flavored names (`shell`, `bash`, `exec`, Claude's `Bash`):
 *      unwrap the standard `bash -lc "..."` wrapper, look at the leading
 *      binary, map common ones to verb phrases (`rg` → "Searched files",
 *      `git status` → "Ran git status", …). Falls back to `Ran <bin>`.
 *   2. Built-in coding tools (Read, Write, Edit, fetch, …) and MCP tool
 *      names (`runScript`, `mcp__notfair__listAdAccounts`, …) get a
 *      tailored verb based on the tool name, with the label surfaced as
 *      the target detail (file path, URL, or short label string).
 *
 * The returned `verb` is what the collapsed tool group shows; `target`
 * is the optional second-half detail truncated by the row's CSS. The
 * raw command/label still lives in the expanded body so power users can
 * see exactly what ran.
 */
type ToolIntent = { verb: string; target?: string };

function humanizeTool(name: string, label: string | null): ToolIntent {
  const n = (name ?? "").toLowerCase();
  // Shell / exec — Codex (`shell`) and Claude Code (`Bash` / `bash` / `exec`).
  // Also catches the legacy transcript rows the v0.4.2 parser left behind:
  // old codex `command_execution` items stored the raw command's first
  // line as BOTH name and label, so we sniff the name/label for the
  // characteristic shell wrapper (`bash -lc "…"`, leading `/bin/zsh`,
  // etc.) and route them through the shell humanizer too.
  if (n === "shell" || n === "bash" || n === "exec" || looksLikeShellInvocation(name) || looksLikeShellInvocation(label ?? "")) {
    // Prefer the label when present (newer events store the command
    // there); fall back to the name for pre-fix rows where the command
    // was written into the name field.
    const cmdSource =
      label && label.trim().length > 0 ? label : name ?? "";
    return humanizeShellCommand(cmdSource);
  }
  // File reads.
  if (n === "read" || n === "cat" || n === "open") {
    return { verb: "Read file", target: label ? shortenPathish(label) : undefined };
  }
  // File writes / edits.
  if (n === "write") return { verb: "Wrote file", target: label ? shortenPathish(label) : undefined };
  if (n === "edit" || n === "patch")
    return { verb: "Edited file", target: label ? shortenPathish(label) : undefined };
  // Web.
  if (n === "fetch" || n === "webfetch" || n.includes("http"))
    return { verb: "Fetched URL", target: label ?? undefined };
  if (n === "websearch" || n === "search" || n === "google")
    return { verb: "Searched the web", target: label ?? undefined };
  // MCP / generic tool — strip namespace prefixes and pretty-print the action.
  const action = formatToolName(name);
  return {
    verb: `Called ${prettifyToolAction(action)}`,
    target: label ?? undefined,
  };
}

const SHELL_WRAPPER_RE =
  /^(?:[/\w.-]+\/)?(?:zsh|bash|sh|dash|ksh)\s+(?:-[A-Za-z]*c|-c)\s+(['"])([\s\S]*)\1\s*$/;

/**
 * Heuristic for "this string is a shell command, not a tool identifier."
 * Used to rescue transcript rows from before v0.4.3, where the codex
 * parser stored the raw command's first line as the tool `name`. Those
 * rows were rendering with the catch-all "Called …" verb, often
 * truncated to garbage like `Called md"` after `formatToolName` split
 * on the trailing `.md"`. Conservative — only matches recognizable
 * shell prefixes, command separators in non-trivial strings, or
 * leading `/usr/bin`-style binary paths. Returns false on empty / short
 * tokens so real MCP tool names like `runScript` don't get misrouted.
 */
function looksLikeShellInvocation(s: string): boolean {
  if (!s) return false;
  const t = s.trim();
  if (t.length < 3) return false;
  // Standard `bash -lc "..."`-style wrappers.
  if (/^(?:[/\w.-]+\/)?(?:zsh|bash|sh|dash|ksh)\s+(?:-[A-Za-z]*c|-c)\b/.test(t))
    return true;
  // Leading absolute binary path (e.g. `/usr/bin/find`, `/bin/ls`).
  if (/^\/(?:usr\/|bin\/|opt\/|sbin\/)/.test(t)) return true;
  // Contains shell metacharacters in a way that's incompatible with any
  // sane tool identifier — pipes, redirects, quoted args, command
  // chains. Combined with a length guard above this skips short
  // identifiers but catches multi-token command lines.
  if (/\s\|\s|\s&&\s|\s>>?\s|^["']|["']\s|\s["']/.test(t)) return true;
  return false;
}

function unwrapShellWrapper(cmd: string): string {
  const m = cmd.trim().match(SHELL_WRAPPER_RE);
  if (m) return m[2]!.trim();
  return cmd.trim();
}

function humanizeShellCommand(rawCmd: string): ToolIntent {
  const inner = unwrapShellWrapper(rawCmd);
  if (!inner) return { verb: "Ran shell command" };
  // Take the leading effective command (before pipes / && / ;). Stops short
  // of full shell parsing — good enough for the leading-verb mapping.
  const lead = inner.split(/\s*(?:[|&;]|\|\|)\s*/)[0]!.trim();
  const tokens = lead.split(/\s+/);
  const head = (tokens[0] ?? "").toLowerCase();
  const sub = tokens[1] ?? "";
  const firstLine = inner.split("\n")[0]!;
  const targetForExpand = firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
  switch (head) {
    case "pwd":
      return { verb: "Checked working directory" };
    case "ls":
      return { verb: "Listed files", target: extractPathArg(tokens) };
    case "find":
      return { verb: "Searched the filesystem", target: extractPathArg(tokens) };
    case "rg":
    case "grep":
    case "ag":
    case "ack":
      return {
        verb: "Searched files",
        target: extractQuotedToken(inner) ?? extractPathArg(tokens),
      };
    case "cat":
    case "head":
    case "tail":
    case "less":
    case "more":
    case "bat":
      return { verb: "Read file", target: extractPathArg(tokens) };
    case "git": {
      if (!sub) return { verb: "Ran git", target: targetForExpand };
      return { verb: `Ran git ${sub}` };
    }
    case "npm":
    case "pnpm":
    case "yarn":
    case "bun": {
      if (sub === "test" || sub === "t") return { verb: "Ran tests" };
      if (sub === "install" || sub === "add" || sub === "i")
        return { verb: "Installed packages" };
      if (sub === "run") {
        const script = tokens[2];
        return { verb: script ? `Ran ${head} ${script}` : `Ran ${head}` };
      }
      return { verb: sub ? `Ran ${head} ${sub}` : `Ran ${head}` };
    }
    case "node":
    case "python":
    case "python3":
    case "tsx":
    case "deno":
    case "ts-node":
      return { verb: "Ran script", target: extractPathArg(tokens) };
    case "curl":
    case "wget":
    case "http":
      return { verb: "Fetched URL", target: extractUrl(inner) };
    case "mkdir":
      return { verb: "Created directory", target: extractPathArg(tokens) };
    case "touch":
      return { verb: "Created file", target: extractPathArg(tokens) };
    case "rm":
      return { verb: "Removed file(s)", target: extractPathArg(tokens) };
    case "mv":
      return { verb: "Moved file" };
    case "cp":
      return { verb: "Copied file" };
    case "sed":
    case "awk":
      return { verb: "Edited text", target: extractPathArg(tokens) };
    case "which":
    case "type":
    case "whereis":
      return { verb: "Located binary", target: tokens[1] };
    case "echo":
    case "printf":
      return { verb: "Printed text" };
    case "make":
      return { verb: sub ? `Ran make ${sub}` : "Ran make" };
    case "docker":
      return { verb: sub ? `Ran docker ${sub}` : "Ran docker" };
    case "kubectl":
      return { verb: sub ? `Ran kubectl ${sub}` : "Ran kubectl" };
    case "gh":
      return { verb: sub ? `Ran gh ${sub}` : "Ran gh" };
    case "":
      return { verb: "Ran shell command" };
    default:
      return { verb: `Ran ${head}`, target: targetForExpand };
  }
}

function extractPathArg(tokens: string[]): string | undefined {
  // Last token that isn't a flag and isn't the leading binary.
  for (let i = tokens.length - 1; i >= 1; i--) {
    const t = tokens[i]!;
    if (!t.startsWith("-") && !/^[<>|&]+$/.test(t)) {
      return shortenPathish(t.replace(/^['"]|['"]$/g, ""));
    }
  }
  return undefined;
}

function extractUrl(inner: string): string | undefined {
  const m = inner.match(/https?:\/\/[^\s'"]+/);
  return m?.[0];
}

function extractQuotedToken(inner: string): string | undefined {
  const m = inner.match(/['"]([^'"\n]{1,80})['"]/);
  if (!m) return undefined;
  return `"${m[1]}"`;
}

function shortenPathish(p: string): string {
  if (!p) return p;
  // Don't compress URLs.
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  const segs = p.split("/").filter(Boolean);
  if (segs.length <= 2) return p;
  return `…/${segs.slice(-2).join("/")}`;
}

/**
 * Map a tool action like `listAdAccounts` to a human-readable phrase
 * (`list ad accounts`). Splits on camelCase and snake_case boundaries
 * and lowercases — leaves single-word actions like `runScript` alone
 * after the split. Returns the action unchanged when there's nothing
 * to split.
 */
function prettifyToolAction(action: string): string {
  if (!action) return action;
  const withSpaces = action
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!withSpaces) return action;
  // Don't lowercase one-token names so single identifiers like "runScript"
  // (already split to "run Script") read naturally as "run Script"; we
  // only lowercase the tail to keep proper capitalization of the leading
  // verb the model chose.
  return withSpaces.charAt(0).toLowerCase() + withSpaces.slice(1).toLowerCase();
}

/**
 * Walk the MCP catalog looking for a server key that matches the tool
 * name's namespace prefix. The two harnesses use different schemes:
 *
 *   - **Claude Code**: `mcp__<serverKey>__<tool>`  (e.g. `mcp__NotFair-GoogleAds__createCampaign`)
 *   - **Codex**:       `notfair_<projectSlug>__<serverNameUnderscored>__<tool>`
 *
 * We match by normalizing both sides to lowercase + collapsing `-` and
 * `_` so `NotFair-GoogleAds`, `notfair_googleads`, and `notfair-googleads`
 * all collide on the same catalog entry. Returns null when the tool
 * name doesn't carry a recognizable MCP prefix or the prefix isn't in
 * the catalog (e.g. an unprovisioned server, or a non-MCP built-in).
 */
function matchMcpServerKey(
  toolName: string,
  catalog: McpCatalogEntryLite[] | undefined,
): McpCatalogEntryLite | null {
  if (!toolName || !catalog || catalog.length === 0) return null;
  const candidates: string[] = [];
  // Claude Code: mcp__<serverKey>__<tool>
  const claude = toolName.match(/^mcp__([^_].*?)__/);
  if (claude?.[1]) candidates.push(claude[1]);
  // Codex MCP, namespaced + tool suffix:
  //   notfair_<projectSlug>__<serverNameUnderscored>__<tool>
  const codexUnderscored = toolName.match(
    /^notfair_[A-Za-z0-9_]+?__([A-Za-z0-9_]+?)__/,
  );
  if (codexUnderscored?.[1]) candidates.push(codexUnderscored[1]);
  // Codex MCP via the `<server>.<tool>` shape this parser uses for
  // `mcp_tool_call` items. The server is the FULL namespaced config key
  // (e.g. `notfair_demo__notfair_googleads`), so peel the leading
  // `notfair_<projectSlug>__` prefix off too — the catalog stores the
  // bare server key.
  const dot = toolName.match(/^([A-Za-z0-9_-]+)\./);
  if (dot?.[1]) {
    candidates.push(dot[1]);
    const tail = dot[1].match(/^notfair_[A-Za-z0-9_]+?__(.+)$/);
    if (tail?.[1]) candidates.push(tail[1]);
  }
  if (candidates.length === 0) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, "");
  for (const cand of candidates) {
    const target = norm(cand);
    const hit = catalog.find((c) => norm(c.key) === target);
    if (hit) return hit;
  }
  return null;
}

function ErrorRow({
  agentDisplayName,
  body,
}: {
  agentDisplayName: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-destructive">
          Couldn&rsquo;t reach {agentDisplayName}.
        </div>
        <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap break-words">
          {body}
        </div>
      </div>
    </div>
  );
}

function TranscriptEmptyState({
  agentDisplayName,
}: {
  agentDisplayName: string;
}) {
  return (
    <div className="py-12 text-center text-sm text-muted-foreground">
      No messages yet. Tell this goal&rsquo;s agent what you need below.
    </div>
  );
}

function iconForTool(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n === "exec" || n === "shell" || n === "bash" || n.includes("bash"))
    return Terminal;
  if (n === "read" || n === "cat" || n === "open" || n.includes("read"))
    return FileText;
  if (n === "write" || n === "edit" || n === "patch") return Edit3;
  if (n === "fetch" || n.includes("http") || n.includes("web")) return Globe;
  return Wrench;
}
