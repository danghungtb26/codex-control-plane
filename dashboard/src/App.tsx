import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fetchTaskEvents, fetchTasks } from "./api";
import type { DashboardEvent, DashboardTask } from "./types";

const shortSha = (sha?: string) => (sha ? sha.slice(0, 10) : "—");
const shortThread = (threadId: string) => `${threadId.slice(0, 8)}…${threadId.slice(-5)}`;

const statusClasses: Record<string, string> = {
  running: "border-sky-400/25 bg-sky-400/10 text-sky-300",
  completed: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  failed: "border-rose-400/25 bg-rose-400/10 text-rose-300",
  interrupted: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  cancelled: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  idle: "border-slate-500/25 bg-slate-500/10 text-slate-400",
};

const statusDot: Record<string, string> = {
  running: "bg-sky-400",
  completed: "bg-emerald-400",
  failed: "bg-rose-400",
  interrupted: "bg-amber-400",
  cancelled: "bg-amber-400",
  idle: "bg-slate-500",
};

const StatusBadge = ({ status }: { status: string }) => {
  const running = status === "running";
  const dotClass = statusDot[status] ?? statusDot.idle;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${statusClasses[status] ?? statusClasses.idle}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {running ? <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${dotClass}`} /> : null}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotClass}`} />
      </span>
      {status}
    </span>
  );
};

const GithubLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <a
    className="rounded-md border border-slate-700 bg-slate-900/70 px-2 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
    href={href}
    target="_blank"
    rel="noreferrer"
  >
    {children}
  </a>
);

const UserMessage = ({ event, historical = false }: { event: DashboardEvent; historical?: boolean }) => {
  const time = new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const text = historical ? event.text : event.request || `/${event.action}`;

  return (
    <article className="rounded-2xl border border-indigo-400/20 bg-indigo-400/5 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
          You{!historical && event.action ? ` · ${event.action}` : ""}
        </span>
        <span className="text-[11px] text-slate-500">{time}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">{text}</p>
    </article>
  );
};

const ToolSpinner = () => (
  <span className="relative h-3.5 w-3.5 shrink-0 rounded-full border border-sky-300/30 border-t-sky-300 animate-spin" />
);

const TranscriptEvent = ({ event, activeTool = false }: { event: DashboardEvent; activeTool?: boolean }) => {
  const time = new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (event.type === "task.started") return <UserMessage event={event} />;
  if (event.type === "user.message") return <UserMessage event={event} historical />;

  if (event.type === "agent.message") {
    return (
      <article className="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
            {event.toolName || "Codex"}
          </span>
          <span className="text-[11px] text-slate-500">{time}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">{event.text}</p>
      </article>
    );
  }

  if (event.type === "tool.started" || event.type === "tool.completed") {
    return (
      <details
        className={`group rounded-xl border px-4 py-3 transition-all duration-300 ${
          activeTool
            ? "border-sky-400/25 bg-sky-400/[0.04] shadow-[0_0_30px_rgba(56,189,248,.05)]"
            : "border-slate-800 bg-slate-950/60"
        }`}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs text-slate-400">
          <span className="flex min-w-0 items-center gap-2 truncate font-mono">
            {activeTool ? <ToolSpinner /> : <span className="text-emerald-400/70">✓</span>}
            <span className="truncate">{event.toolName || "Codex tool"}</span>
            {activeTool ? (
              <span className="rounded-full bg-sky-400/10 px-1.5 py-0.5 font-sans text-[10px] font-medium text-sky-300">
                running
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-[11px] text-slate-600">{time}</span>
        </summary>
        {event.detail ? (
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap border-t border-slate-800 pt-3 text-[11px] leading-5 text-slate-500">
            {event.detail}
          </pre>
        ) : null}
      </details>
    );
  }

  if (event.type === "turn.completed") {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={event.status || "completed"} />
          {event.commitBefore || event.commitAfter ? (
            <span>
              commit <span className="font-mono text-slate-300">{shortSha(event.commitBefore)}</span> →{" "}
              <span className="font-mono text-slate-300">{shortSha(event.commitAfter)}</span>
            </span>
          ) : null}
          <span className="ml-auto text-[11px] text-slate-600">{time}</span>
        </div>
        {event.summary ? <p className="mt-2 leading-5 text-slate-300">{event.summary}</p> : null}
      </div>
    );
  }

  if (event.type === "task.failed" || event.type === "codex.error") {
    return (
      <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 px-4 py-3 text-xs text-rose-200">
        <div className="mb-1 font-semibold">{event.type === "task.failed" ? "Task failed" : "Codex error"}</div>
        <pre className="whitespace-pre-wrap font-sans leading-5 text-rose-200/80">{event.text}</pre>
      </div>
    );
  }

  if (event.type === "turn.started") {
    return (
      <div className="flex items-center gap-2 px-1 text-[11px] text-slate-600">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400/70" />
        Turn {event.turnId ? event.turnId.slice(0, 12) : ""} started · {time}
      </div>
    );
  }

  return null;
};

const WorkingIndicator = () => (
  <div className="flex items-center gap-3 rounded-2xl border border-sky-400/15 bg-sky-400/[0.035] px-4 py-3 text-xs text-sky-200/80">
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-50" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-400" />
    </span>
    <span>Codex is working</span>
    <span className="flex items-end gap-1" aria-hidden="true">
      <span className="h-1 w-1 animate-bounce rounded-full bg-sky-300 [animation-delay:-0.3s]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-sky-300 [animation-delay:-0.15s]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-sky-300" />
    </span>
  </div>
);

export default function App() {
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [liveText, setLiveText] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [followingTail, setFollowingTail] = useState(true);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const followTailRef = useRef(true);

  const reloadTasks = useCallback(async () => {
    try {
      const next = await fetchTasks();
      setTasks(next);
      setError("");
      setSelectedThreadId((current) => current || next[0]?.threadId || "");
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }, []);

  useEffect(() => {
    void reloadTasks();
  }, [reloadTasks]);

  useEffect(() => {
    setLiveText({});
    followTailRef.current = true;
    setFollowingTail(true);

    if (!selectedThreadId) {
      setEvents([]);
      return;
    }

    let active = true;
    void fetchTaskEvents(selectedThreadId)
      .then((next) => {
        if (active) setEvents(next);
      })
      .catch((nextError) => setError((nextError as Error).message));

    return () => {
      active = false;
    };
  }, [selectedThreadId]);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.addEventListener("connected", () => setConnected(true));
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as DashboardEvent;

      if (event.type === "agent.delta") {
        if (event.threadId === selectedThreadId && event.text) {
          const key = `${event.turnId ?? "turn"}:${event.itemId ?? "agent"}`;
          setLiveText((current) => ({ ...current, [key]: `${current[key] ?? ""}${event.text}` }));
        }
        return;
      }

      if (event.threadId === selectedThreadId) {
        setEvents((current) => (current.some((item) => item.id === event.id) ? current : [...current, event]));

        if (event.type === "agent.message") {
          setLiveText((current) => {
            const next = { ...current };
            const exactKey = `${event.turnId ?? "turn"}:${event.itemId ?? "agent"}`;
            delete next[exactKey];
            if (!event.itemId && event.turnId) {
              for (const key of Object.keys(next)) {
                if (key.startsWith(`${event.turnId}:`)) delete next[key];
              }
            }
            return next;
          });
        }
      }

      void reloadTasks();
    };

    return () => source.close();
  }, [reloadTasks, selectedThreadId]);

  const filteredTasks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return tasks;

    return tasks.filter((task) =>
      [
        task.repo,
        task.threadId,
        task.action,
        task.request,
        task.issueNumber ? `issue ${task.issueNumber}` : "",
        ...task.prNumbers.map((number) => `pr ${number}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [search, tasks]);

  const selected = tasks.find((task) => task.threadId === selectedThreadId);
  const liveEntries = Object.entries(liveText).filter(([, text]) => text.trim());

  const activeToolIds = useMemo(() => {
    const active = new Set<string>();
    for (const event of events) {
      if (!event.itemId) continue;
      if (event.type === "tool.started") active.add(event.itemId);
      if (event.type === "tool.completed") active.delete(event.itemId);
    }
    return active;
  }, [events]);

  const visibleEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          event.type !== "tool.started" ||
          !event.itemId ||
          activeToolIds.has(event.itemId),
      ),
    [activeToolIds, events],
  );

  const hasActiveTool = activeToolIds.size > 0;

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
    const node = transcriptRef.current;
    if (!node) return;
    followTailRef.current = true;
    setFollowingTail(true);
    node.scrollTo({ top: node.scrollHeight, behavior });
  }, []);

  const handleTranscriptScroll = useCallback(() => {
    const node = transcriptRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    const nearBottom = distanceFromBottom < 120;
    followTailRef.current = nearBottom;
    setFollowingTail(nearBottom);
  }, []);

  useLayoutEffect(() => {
    if (!followTailRef.current) return;
    const frame = requestAnimationFrame(() => scrollToLatest("auto"));
    return () => cancelAnimationFrame(frame);
  }, [events, liveText, scrollToLatest, selectedThreadId]);

  return (
    <div className="min-h-screen text-slate-200">
      <header className="border-b border-slate-800/80 bg-slate-950/80 px-5 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
          <div>
            <h1 className="text-base font-semibold text-white">Codex Control Plane</h1>
            <p className="mt-0.5 text-xs text-slate-500">Tasks, durable threads and live Codex activity</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="relative flex h-2 w-2">
              {connected ? (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
              ) : null}
              <span className={`relative h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`} />
            </span>
            {connected ? "Live" : "Reconnecting"}
          </div>
        </div>
      </header>

      <main className="mx-auto grid h-[calc(100vh-73px)] max-w-[1600px] grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-slate-800/80 bg-slate-950/35">
          <div className="border-b border-slate-800/80 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Tasks</span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">{tasks.length}</span>
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search issue, PR, task…"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-slate-600"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {filteredTasks.map((task) => {
              const active = task.threadId === selectedThreadId;
              const running = task.status === "running";

              return (
                <button
                  key={task.threadId}
                  onClick={() => setSelectedThreadId(task.threadId)}
                  className={`mb-1.5 w-full rounded-xl border p-3 text-left transition-all duration-300 ${
                    active
                      ? running
                        ? "border-sky-400/30 bg-sky-400/[0.055] shadow-[0_0_26px_rgba(56,189,248,.05)]"
                        : "border-slate-600 bg-slate-800/80 shadow-lg shadow-black/10"
                      : running
                        ? "border-sky-400/10 bg-sky-400/[0.025] hover:border-sky-400/20"
                        : "border-transparent bg-transparent hover:border-slate-800 hover:bg-slate-900/60"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium text-slate-100">
                      {task.issueNumber
                        ? `Issue #${task.issueNumber}`
                        : task.prNumbers[0]
                          ? `PR #${task.prNumbers[0]}`
                          : "Bound thread"}
                    </div>
                    <StatusBadge status={task.status} />
                  </div>
                  <div className="truncate text-xs text-slate-500">{task.repo}</div>
                  {task.request ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">{task.request}</p> : null}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                    {task.action ? <span className="rounded bg-slate-900 px-1.5 py-0.5">{task.action}</span> : null}
                    {task.prNumbers.map((number) => (
                      <span key={number} className="rounded bg-slate-900 px-1.5 py-0.5">
                        PR #{number}
                      </span>
                    ))}
                    {running ? (
                      <span className="ml-auto flex items-center gap-1 text-sky-300/80">
                        <span className="h-1 w-1 animate-pulse rounded-full bg-sky-300" /> working
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
            {!filteredTasks.length ? <div className="p-6 text-center text-xs text-slate-600">No tasks found.</div> : null}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col">
          {selected ? (
            <>
              <div className="border-b border-slate-800/80 bg-slate-950/25 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <StatusBadge status={selected.status} />
                      {selected.action ? <span className="text-xs font-medium text-slate-400">{selected.action}</span> : null}
                      {selected.status === "running" ? (
                        <span className="flex items-center gap-1.5 text-[11px] text-sky-300/70">
                          <span className="h-1 w-1 animate-bounce rounded-full bg-sky-300" />
                          activity streaming
                        </span>
                      ) : null}
                    </div>
                    <h2 className="truncate text-lg font-semibold text-white">
                      {selected.issueNumber ? `Issue #${selected.issueNumber}` : "Codex thread"}
                      {selected.prNumbers.length
                        ? ` → PR ${selected.prNumbers.map((number) => `#${number}`).join(", ")}`
                        : ""}
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>{selected.repo}</span>
                      <span className="font-mono" title={selected.threadId}>
                        {shortThread(selected.threadId)}
                      </span>
                      <span>
                        commit {shortSha(selected.commitBefore)} → {shortSha(selected.commitAfter)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selected.issueNumber ? (
                      <GithubLink href={`https://github.com/${selected.repo}/issues/${selected.issueNumber}`}>
                        Issue #{selected.issueNumber} ↗
                      </GithubLink>
                    ) : null}
                    {selected.prNumbers.map((number) => (
                      <GithubLink key={number} href={`https://github.com/${selected.repo}/pull/${number}`}>
                        PR #{number} ↗
                      </GithubLink>
                    ))}
                  </div>
                </div>
                {selected.summary ? (
                  <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-400">{selected.summary}</p>
                ) : null}
              </div>

              <div className="relative min-h-0 flex-1">
                <div
                  ref={transcriptRef}
                  onScroll={handleTranscriptScroll}
                  className="h-full overflow-y-auto"
                  aria-live="polite"
                >
                  <div className="mx-auto flex max-w-4xl flex-col gap-3 p-5 pb-12">
                    {visibleEvents.map((event) => (
                      <TranscriptEvent
                        key={event.id}
                        event={event}
                        activeTool={event.type === "tool.started" && Boolean(event.itemId && activeToolIds.has(event.itemId))}
                      />
                    ))}

                    {liveEntries.map(([key, text]) => (
                      <article
                        key={key}
                        className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 shadow-[0_0_30px_rgba(16,185,129,.04)] transition-shadow"
                      >
                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                            <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          </span>
                          Codex · live
                        </div>
                        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">
                          {text}
                          <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-emerald-400 align-middle" />
                        </p>
                      </article>
                    ))}

                    {selected.status === "running" && !liveEntries.length && !hasActiveTool ? <WorkingIndicator /> : null}

                    {!events.length && !liveEntries.length && selected.status !== "running" ? (
                      <div className="rounded-2xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-600">
                        No transcript is available for this thread yet. New activity will appear here in realtime.
                      </div>
                    ) : null}
                  </div>
                </div>

                {!followingTail ? (
                  <button
                    type="button"
                    onClick={() => scrollToLatest("smooth")}
                    className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-slate-700 bg-slate-900/95 px-3 py-1.5 text-xs font-medium text-slate-200 shadow-xl shadow-black/30 backdrop-blur transition hover:border-sky-400/40 hover:text-white"
                  >
                    ↓ Latest
                    {selected.status === "running" ? <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" /> : null}
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-10 text-sm text-slate-600">
              Select a task to inspect its conversation.
            </div>
          )}
        </section>
      </main>

      {error ? (
        <div className="fixed bottom-4 right-4 max-w-md rounded-xl border border-rose-400/20 bg-rose-950/90 px-4 py-3 text-xs text-rose-200 shadow-2xl">
          Dashboard API error: {error}
        </div>
      ) : null}
    </div>
  );
}
