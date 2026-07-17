import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Bot, Braces, Check, ChevronRight, CircleAlert, Clock3, FileCode2, MemoryStick, Moon, Play, ShieldCheck, Sun, X } from "lucide-react";
import { api, type ActionItem, type AuditItem, type ConnectorItem, type EventItem, type ForgeItem, type MemoryItem, type RunItem } from "./api";
import { applyTheme, getInitialTheme, persistTheme, type Theme } from "./theme";

type DashboardState = { events: EventItem[]; actions: ActionItem[]; runs: RunItem[]; audit: AuditItem[]; memory: MemoryItem[]; connectors: ConnectorItem[]; forges: ForgeItem[] };
const initial: DashboardState = { events: [], actions: [], runs: [], audit: [], memory: [], connectors: [], forges: [] };

function relative(value: string): string { return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round((new Date(value).getTime() - Date.now()) / 60_000), "minute"); }
function providerColor(provider: string): string { return provider === "github" ? "provider-github" : provider === "linear" ? "provider-linear" : "provider-sentry"; }

export default function App() {
  const [state, setState] = useState<DashboardState>(initial);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string>();
  const [forgePrompt, setForgePrompt] = useState("Connect Linear to GitHub and prepare a pull request when a high-priority issue is ready.");
  const [selectedAction, setSelectedAction] = useState<ActionItem>();
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  const refresh = useCallback(async () => {
    try {
      const [events, actions, runs, audit, memory, connectors, forges] = await Promise.all([api.events(), api.actions(), api.runs(), api.audit(), api.memory(), api.connectors(), api.forges()]);
      setState({ events, actions, runs, audit, memory, connectors, forges });
    } catch {
      setNotice("Control plane unavailable. Start `pnpm dev` to connect the console.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 5000); return () => window.clearInterval(timer); }, [refresh]);

  const pending = useMemo(() => state.actions.filter((action) => action.status === "pending"), [state.actions]);
  const runDemo = async (provider: "github" | "linear" | "sentry") => { setNotice(`Receiving ${provider} event…`); await api.demo(provider); await refresh(); setNotice(`${provider.charAt(0).toUpperCase()}${provider.slice(1)} event processed. Review the pending proposal.`); };
  const decideAction = async (approved: boolean) => { if (!selectedAction) return; await api.decideAction(selectedAction.id, approved); setSelectedAction(undefined); await refresh(); setNotice(approved ? "Action approved and recorded in the audit trail." : "Action rejected. No write was performed."); };
  const forge = async () => { const job = await api.forge(forgePrompt); await refresh(); setNotice(job.status === "validated" ? "Connector draft validated. Review its requested scopes before approval." : "Forge draft was blocked by the security scanner."); };
  const decideForge = async (id: string, approved: boolean) => { await api.decideForge(id, approved); await refresh(); setNotice(approved ? "Connector artifact approved. Installation remains a separate local action." : "Connector draft rejected."); };
  const changeTheme = (nextTheme: Theme) => { applyTheme(nextTheme); persistTheme(nextTheme); setTheme(nextTheme); };

  return <main className="console-shell min-h-screen">
    <div className="console-ambient fixed inset-0 -z-10" />
    <header className="mx-auto flex max-w-[1540px] items-center justify-between px-6 py-5 lg:px-10">
      <div className="flex items-center gap-3"><div className="brand-mark grid h-10 w-10 place-items-center rounded-xl"><Activity size={21} /></div><div><h1 className="font-semibold tracking-tight">EventForge</h1><p className="brand-subtitle text-xs">Autonomous engineering operations</p></div></div>
      <div className="flex shrink-0 items-center gap-2 text-sm sm:gap-3"><span className="online-status hidden sm:inline-flex sm:items-center sm:gap-2"><span className="online-indicator h-1.5 w-1.5 rounded-full" /> Control plane online</span><ThemeControl theme={theme} onChange={changeTheme} /><button className="quiet-button refresh-button hidden sm:inline-flex" onClick={() => void refresh()}>Refresh</button></div>
    </header>
    <section className="mx-auto max-w-[1540px] px-6 pb-10 lg:px-10">
      <div className="hero-panel mb-6 flex flex-col gap-4 rounded-2xl p-5 md:flex-row md:items-end md:justify-between">
        <div><p className="eyebrow mb-1 text-xs font-medium uppercase tracking-[.18em]">Operations command center</p><h2 className="max-w-2xl text-2xl font-semibold tracking-tight md:text-3xl">Every autonomous action remains visible, scoped, and reviewable.</h2></div>
        <div className="flex flex-wrap gap-2"><button className="action-button" onClick={() => void runDemo("github")}><Play size={15} /> Run GitHub CI demo</button><button className="quiet-button" onClick={() => void runDemo("linear")}>Linear event</button><button className="quiet-button" onClick={() => void runDemo("sentry")}>Sentry alert</button></div>
      </div>
      {notice && <div role="status" className="notice mb-5 flex items-center gap-2 rounded-lg px-4 py-3 text-sm"><ShieldCheck size={17} /> {notice}</div>}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<Activity />} label="Events received" value={state.events.length} detail="verified, demo & custom" color="cyan" />
        <Metric icon={<Bot />} label="Agent investigations" value={state.runs.length} detail={`${state.runs.filter((run) => run.status === "waiting_for_approval").length} waiting for review`} color="violet" />
        <Metric icon={<ShieldCheck />} label="Approval queue" value={pending.length} detail="writes require human decision" color="amber" />
        <Metric icon={<MemoryStick />} label="Scoped memories" value={state.memory.length} detail="project-private context" color="emerald" />
      </section>
      <section className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_.9fr]">
        <Panel title="Live event feed" icon={<Activity size={17} />} action={<span className="muted-text text-xs">Auto-refreshes every 5s</span>}>
          <div className="feed-list divide-y">{state.events.length === 0 && <Empty text={loading ? "Loading control plane…" : "No events yet — run a demo to begin."} />}{state.events.slice(0, 7).map((event) => <div key={event.id} className="flex items-center gap-3 py-3.5"><span className={`provider-badge rounded-md px-2 py-1 text-xs font-medium ${providerColor(event.provider)}`}>{event.provider}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{event.topic} <span className="muted-text font-normal">· {event.signatureStatus}</span></p><p className="muted-text mt-0.5 text-xs">{Object.keys(event.payload).length} normalized fields · secrets redacted</p></div><span className="muted-text text-xs">{relative(event.receivedAt)}</span></div>)}</div>
        </Panel>
        <Panel title="Connector health" icon={<Braces size={17} />}><div className="space-y-2.5">{state.connectors.map((connector) => <div key={connector.provider} className="soft-card flex items-center justify-between rounded-lg px-3.5 py-3"><div><p className="text-sm capitalize">{connector.provider}</p><p className="muted-text mt-0.5 text-xs">{connector.capabilities.join(" · ")}</p></div><span className={`status-pill ${connector.status === "configured" ? "status-ready" : "status-demo"}`}>{connector.status}</span></div>)}</div></Panel>
      </section>
      <section className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Panel title="Approval queue" icon={<ShieldCheck size={17} />} action={<span className="warning-label text-xs">Default: approval required</span>}>
          <div className="space-y-3">{pending.length === 0 && <Empty text="No pending writes. EventForge will never auto-approve a new workflow." />}{pending.map((action) => <button key={action.id} className="approval-row group flex w-full items-center gap-3 rounded-xl p-4 text-left" onClick={() => setSelectedAction(action)}><CircleAlert size={19} className="shrink-0" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{action.title}</p><p className="muted-text mt-1 text-xs">{action.type.replaceAll("_", " ")} · {action.requiredCapabilities.join(", ")}</p></div><ChevronRight size={18} className="approval-chevron shrink-0" /></button>)}</div>
        </Panel>
        <Panel title="Agent run log" icon={<Bot size={17} />}><div className="space-y-3">{state.runs.length === 0 && <Empty text="Investigations will appear here with resumable Codex thread IDs." />}{state.runs.slice(0, 4).map((run) => <div key={run.id} className="soft-card rounded-lg p-3.5"><div className="mb-2 flex items-center justify-between"><span className="status-pill status-demo">{run.status.replaceAll("_", " ")}</span><span className="muted-text text-xs">{relative(run.startedAt)}</span></div><p className="secondary-text line-clamp-2 text-sm leading-5">{run.summary ?? "Starting investigation…"}</p>{run.threadId && <p className="thread-id mt-2 truncate font-mono text-[11px]">Codex thread · {run.threadId}</p>}</div>)}</div></Panel>
      </section>
      <section className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <Panel title="Forge Studio" icon={<FileCode2 size={17} />} action={<span className="muted-text text-xs">Isolated draft · explicit install</span>}>
          <label className="sr-only" htmlFor="forge-prompt">Connector request</label><textarea id="forge-prompt" value={forgePrompt} onChange={(event) => setForgePrompt(event.target.value)} className="forge-input min-h-24 w-full resize-y rounded-xl p-3.5 text-sm leading-6" />
          <div className="mt-3 flex items-center justify-between gap-3"><p className="muted-text text-xs leading-5">Forge validates code and scopes first. Generated connectors never hot-load automatically.</p><button className="action-button shrink-0" onClick={() => void forge()}><Braces size={15} /> Forge draft</button></div>
          <div className="mt-4 space-y-2">{state.forges.slice(0, 2).map((forge) => <div key={forge.id} className="soft-card rounded-lg p-3"><div className="flex gap-2"><FileCode2 size={16} className="forge-icon mt-0.5" /><div className="min-w-0 flex-1"><p className="truncate text-sm">{forge.prompt}</p><p className="muted-text mt-1 text-xs">Scopes: {forge.requestedScopes.join(", ")}</p></div><span className="status-pill status-ready">{forge.status}</span></div>{forge.status === "validated" && <div className="mt-3 flex justify-end gap-2"><button className="quiet-button text-xs" onClick={() => void decideForge(forge.id, false)}>Reject</button><button className="quiet-button approval-button text-xs" onClick={() => void decideForge(forge.id, true)}>Approve artifact</button></div>}</div>)}</div>
        </Panel>
        <Panel title="Memory & audit trail" icon={<Clock3 size={17} />}><div className="space-y-3">{state.audit.length === 0 && <Empty text="Audit entries appear for every event, run, forge, and approval." />}{state.audit.slice(0, 5).map((entry) => <div key={entry.id} className="flex gap-3"><div className="audit-dot mt-1.5 h-2 w-2 shrink-0 rounded-full" /><div><p className="secondary-text text-sm leading-5">{entry.message}</p><p className="dim-text mt-1 text-xs">{entry.kind.replaceAll("_", " ")} · {relative(entry.createdAt)}</p></div></div>)}</div></Panel>
      </section>
    </section>
    {selectedAction && <ApprovalDialog action={selectedAction} onClose={() => setSelectedAction(undefined)} onDecide={decideAction} />}
  </main>;
}

function ThemeControl({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) { return <div className="theme-control" role="group" aria-label="Color theme"><button type="button" className="theme-choice" aria-label="Use light theme" aria-pressed={theme === "light"} onClick={() => onChange("light")}><Sun size={15} /><span className="hidden sm:inline">Light</span></button><button type="button" className="theme-choice" aria-label="Use dark theme" aria-pressed={theme === "dark"} onClick={() => onChange("dark")}><Moon size={15} /><span className="hidden sm:inline">Dark</span></button></div>; }
function Metric({ icon, label, value, detail, color }: { icon: React.ReactNode; label: string; value: number; detail: string; color: "cyan" | "violet" | "amber" | "emerald" }) { return <div className="metric-card rounded-xl p-4"><div className={`metric-icon metric-${color} mb-7 inline-flex rounded-lg p-2`}>{icon}</div><p className="text-2xl font-semibold tracking-tight">{value}</p><p className="secondary-text mt-1 text-sm">{label}</p><p className="dim-text mt-1 text-xs">{detail}</p></div>; }
function Panel({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) { return <section className="panel rounded-2xl p-5"><div className="mb-4 flex items-center justify-between"><h3 className="panel-title flex items-center gap-2 text-sm font-medium">{icon}{title}</h3>{action}</div>{children}</section>; }
function Empty({ text }: { text: string }) { return <div className="empty-state rounded-lg px-4 py-7 text-center text-sm">{text}</div>; }
function ApprovalDialog({ action, onClose, onDecide }: { action: ActionItem; onClose: () => void; onDecide: (approved: boolean) => void }) { return <div className="dialog-backdrop fixed inset-0 z-20 grid place-items-center p-5"><section role="dialog" aria-modal="true" aria-labelledby="approval-title" className="dialog-panel w-full max-w-2xl rounded-2xl p-6 shadow-2xl"><div className="flex items-start justify-between gap-5"><div><p className="warning-label mb-2 text-xs font-medium uppercase tracking-[.18em]">Approval required</p><h2 id="approval-title" className="text-xl font-semibold">{action.title}</h2><p className="muted-text mt-2 text-sm">This action has not been executed. Review its proposed capabilities and diff before deciding.</p></div><button aria-label="Close" className="icon-button" onClick={onClose}><X /></button></div><div className="mt-5 grid gap-4 md:grid-cols-2"><div className="dialog-detail rounded-lg p-4"><p className="dim-text text-xs uppercase tracking-wider">Requested capabilities</p><p className="secondary-text mt-2 text-sm">{action.requiredCapabilities.join(", ")}</p></div><div className="dialog-detail rounded-lg p-4"><p className="dim-text text-xs uppercase tracking-wider">Risk assessment</p><p className="warning-label mt-2 text-sm capitalize">{action.risk} risk</p></div></div><pre className="dialog-diff secondary-text mt-4 max-h-56 overflow-auto rounded-lg p-4 text-xs leading-5">{action.diff ?? "No code diff supplied."}</pre><div className="mt-6 flex justify-end gap-3"><button className="quiet-button" onClick={() => onDecide(false)}><X size={15} /> Reject</button><button className="action-button" onClick={() => onDecide(true)}><Check size={15} /> Approve action</button></div></section></div>; }
