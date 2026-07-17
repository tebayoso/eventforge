import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, Bot, Braces, Check, ChevronRight, CircleAlert, Clock3, FileCode2, GitPullRequest, MemoryStick, Play, ShieldCheck, X } from "lucide-react";
import { api, type ActionItem, type AuditItem, type ConnectorItem, type EventItem, type ForgeItem, type MemoryItem, type RunItem } from "./api";

type DashboardState = { events: EventItem[]; actions: ActionItem[]; runs: RunItem[]; audit: AuditItem[]; memory: MemoryItem[]; connectors: ConnectorItem[]; forges: ForgeItem[] };
const initial: DashboardState = { events: [], actions: [], runs: [], audit: [], memory: [], connectors: [], forges: [] };

function relative(value: string): string { return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round((new Date(value).getTime() - Date.now()) / 60_000), "minute"); }
function providerColor(provider: string): string { return provider === "github" ? "bg-violet-400/15 text-violet-200" : provider === "linear" ? "bg-blue-400/15 text-blue-200" : "bg-orange-400/15 text-orange-200"; }

export default function App() {
  const [state, setState] = useState<DashboardState>(initial);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string>();
  const [forgePrompt, setForgePrompt] = useState("Connect Linear to GitHub and prepare a pull request when a high-priority issue is ready.");
  const [selectedAction, setSelectedAction] = useState<ActionItem>();

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

  return <main className="min-h-screen bg-[#080b14] text-slate-100 selection:bg-cyan-400/30">
    <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_15%_-10%,rgba(34,211,238,.18),transparent_27%),radial-gradient(circle_at_80%_0%,rgba(139,92,246,.14),transparent_22%)]" />
    <header className="mx-auto flex max-w-[1540px] items-center justify-between px-6 py-5 lg:px-10">
      <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-300 to-violet-500 shadow-lg shadow-cyan-500/20"><Activity size={21} className="text-slate-950" /></div><div><h1 className="font-semibold tracking-tight">EventForge</h1><p className="text-xs text-slate-500">Autonomous engineering operations</p></div></div>
      <div className="flex items-center gap-3 text-sm"><span className="hidden rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-emerald-300 sm:inline-flex sm:items-center sm:gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Control plane online</span><button className="rounded-lg border border-white/10 px-3 py-2 text-slate-300 hover:bg-white/5" onClick={() => void refresh()}>Refresh</button></div>
    </header>
    <section className="mx-auto max-w-[1540px] px-6 pb-10 lg:px-10">
      <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-white/8 bg-white/[.035] p-5 backdrop-blur md:flex-row md:items-end md:justify-between">
        <div><p className="mb-1 text-xs font-medium uppercase tracking-[.18em] text-cyan-300">Operations command center</p><h2 className="max-w-2xl text-2xl font-semibold tracking-tight md:text-3xl">Every autonomous action remains visible, scoped, and reviewable.</h2></div>
        <div className="flex flex-wrap gap-2"><button className="action-button" onClick={() => void runDemo("github")}><Play size={15} /> Run GitHub CI demo</button><button className="quiet-button" onClick={() => void runDemo("linear")}>Linear event</button><button className="quiet-button" onClick={() => void runDemo("sentry")}>Sentry alert</button></div>
      </div>
      {notice && <div role="status" className="mb-5 flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100"><ShieldCheck size={17} /> {notice}</div>}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<Activity />} label="Events received" value={state.events.length} detail="verified, demo & custom" color="cyan" />
        <Metric icon={<Bot />} label="Agent investigations" value={state.runs.length} detail={`${state.runs.filter((run) => run.status === "waiting_for_approval").length} waiting for review`} color="violet" />
        <Metric icon={<ShieldCheck />} label="Approval queue" value={pending.length} detail="writes require human decision" color="amber" />
        <Metric icon={<MemoryStick />} label="Scoped memories" value={state.memory.length} detail="project-private context" color="emerald" />
      </section>
      <section className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_.9fr]">
        <Panel title="Live event feed" icon={<Activity size={17} />} action={<span className="text-xs text-slate-500">Auto-refreshes every 5s</span>}>
          <div className="divide-y divide-white/7">{state.events.length === 0 && <Empty text={loading ? "Loading control plane…" : "No events yet — run a demo to begin."} />}{state.events.slice(0, 7).map((event) => <div key={event.id} className="flex items-center gap-3 py-3.5"><span className={`rounded-md px-2 py-1 text-xs font-medium ${providerColor(event.provider)}`}>{event.provider}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{event.topic} <span className="font-normal text-slate-500">· {event.signatureStatus}</span></p><p className="mt-0.5 text-xs text-slate-500">{Object.keys(event.payload).length} normalized fields · secrets redacted</p></div><span className="text-xs text-slate-500">{relative(event.receivedAt)}</span></div>)}</div>
        </Panel>
        <Panel title="Connector health" icon={<Braces size={17} />}><div className="space-y-2.5">{state.connectors.map((connector) => <div key={connector.provider} className="flex items-center justify-between rounded-lg border border-white/7 bg-white/[.025] px-3.5 py-3"><div><p className="text-sm capitalize">{connector.provider}</p><p className="mt-0.5 text-xs text-slate-500">{connector.capabilities.join(" · ")}</p></div><span className={`status-pill ${connector.status === "configured" ? "status-ready" : "status-demo"}`}>{connector.status}</span></div>)}</div></Panel>
      </section>
      <section className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Panel title="Approval queue" icon={<ShieldCheck size={17} />} action={<span className="text-xs text-amber-300">Default: approval required</span>}>
          <div className="space-y-3">{pending.length === 0 && <Empty text="No pending writes. EventForge will never auto-approve a new workflow." />}{pending.map((action) => <button key={action.id} className="group flex w-full items-center gap-3 rounded-xl border border-amber-400/15 bg-amber-400/[.045] p-4 text-left transition hover:border-amber-300/35" onClick={() => setSelectedAction(action)}><CircleAlert size={19} className="shrink-0 text-amber-300" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{action.title}</p><p className="mt-1 text-xs text-slate-400">{action.type.replaceAll("_", " ")} · {action.requiredCapabilities.join(", ")}</p></div><ChevronRight size={18} className="text-slate-500 transition group-hover:translate-x-0.5" /></button>)}</div>
        </Panel>
        <Panel title="Agent run log" icon={<Bot size={17} />}><div className="space-y-3">{state.runs.length === 0 && <Empty text="Investigations will appear here with resumable Codex thread IDs." />}{state.runs.slice(0, 4).map((run) => <div key={run.id} className="rounded-lg border border-white/7 bg-white/[.025] p-3.5"><div className="mb-2 flex items-center justify-between"><span className="status-pill status-demo">{run.status.replaceAll("_", " ")}</span><span className="text-xs text-slate-500">{relative(run.startedAt)}</span></div><p className="line-clamp-2 text-sm leading-5 text-slate-300">{run.summary ?? "Starting investigation…"}</p>{run.threadId && <p className="mt-2 truncate font-mono text-[11px] text-violet-200/80">Codex thread · {run.threadId}</p>}</div>)}</div></Panel>
      </section>
      <section className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <Panel title="Forge Studio" icon={<FileCode2 size={17} />} action={<span className="text-xs text-slate-500">Isolated draft · explicit install</span>}>
          <label className="sr-only" htmlFor="forge-prompt">Connector request</label><textarea id="forge-prompt" value={forgePrompt} onChange={(event) => setForgePrompt(event.target.value)} className="min-h-24 w-full resize-y rounded-xl border border-white/10 bg-slate-950/60 p-3.5 text-sm leading-6 text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-400/50" />
          <div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs leading-5 text-slate-500">Forge validates code and scopes first. Generated connectors never hot-load automatically.</p><button className="action-button shrink-0" onClick={() => void forge()}><Braces size={15} /> Forge draft</button></div>
          <div className="mt-4 space-y-2">{state.forges.slice(0, 2).map((forge) => <div key={forge.id} className="rounded-lg border border-white/7 bg-white/[.025] p-3"><div className="flex gap-2"><FileCode2 size={16} className="mt-0.5 text-violet-300" /><div className="min-w-0 flex-1"><p className="truncate text-sm">{forge.prompt}</p><p className="mt-1 text-xs text-slate-500">Scopes: {forge.requestedScopes.join(", ")}</p></div><span className="status-pill status-ready">{forge.status}</span></div>{forge.status === "validated" && <div className="mt-3 flex justify-end gap-2"><button className="quiet-button text-xs" onClick={() => void decideForge(forge.id, false)}>Reject</button><button className="quiet-button text-xs text-emerald-200" onClick={() => void decideForge(forge.id, true)}>Approve artifact</button></div>}</div>)}</div>
        </Panel>
        <Panel title="Memory & audit trail" icon={<Clock3 size={17} />}><div className="space-y-3">{state.audit.length === 0 && <Empty text="Audit entries appear for every event, run, forge, and approval." />}{state.audit.slice(0, 5).map((entry) => <div key={entry.id} className="flex gap-3"><div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan-300" /><div><p className="text-sm leading-5 text-slate-300">{entry.message}</p><p className="mt-1 text-xs text-slate-600">{entry.kind.replaceAll("_", " ")} · {relative(entry.createdAt)}</p></div></div>)}</div></Panel>
      </section>
    </section>
    {selectedAction && <ApprovalDialog action={selectedAction} onClose={() => setSelectedAction(undefined)} onDecide={decideAction} />}
  </main>;
}

function Metric({ icon, label, value, detail, color }: { icon: React.ReactNode; label: string; value: number; detail: string; color: "cyan" | "violet" | "amber" | "emerald" }) { const colors = { cyan: "bg-cyan-400/10 text-cyan-300", violet: "bg-violet-400/10 text-violet-300", amber: "bg-amber-400/10 text-amber-300", emerald: "bg-emerald-400/10 text-emerald-300" }; return <div className="rounded-xl border border-white/8 bg-white/[.035] p-4"><div className={`mb-7 inline-flex rounded-lg p-2 ${colors[color]}`}>{icon}</div><p className="text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-sm text-slate-300">{label}</p><p className="mt-1 text-xs text-slate-600">{detail}</p></div>; }
function Panel({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) { return <section className="rounded-2xl border border-white/8 bg-slate-900/35 p-5 shadow-2xl shadow-black/10"><div className="mb-4 flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-medium text-slate-100">{icon}{title}</h3>{action}</div>{children}</section>; }
function Empty({ text }: { text: string }) { return <div className="rounded-lg border border-dashed border-white/10 px-4 py-7 text-center text-sm text-slate-500">{text}</div>; }
function ApprovalDialog({ action, onClose, onDecide }: { action: ActionItem; onClose: () => void; onDecide: (approved: boolean) => void }) { return <div className="fixed inset-0 z-20 grid place-items-center bg-slate-950/75 p-5 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="approval-title" className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#111724] p-6 shadow-2xl"><div className="flex items-start justify-between gap-5"><div><p className="mb-2 text-xs font-medium uppercase tracking-[.18em] text-amber-300">Approval required</p><h2 id="approval-title" className="text-xl font-semibold">{action.title}</h2><p className="mt-2 text-sm text-slate-400">This action has not been executed. Review its proposed capabilities and diff before deciding.</p></div><button aria-label="Close" className="text-slate-500 hover:text-white" onClick={onClose}><X /></button></div><div className="mt-5 grid gap-4 md:grid-cols-2"><div className="rounded-lg bg-white/[.04] p-4"><p className="text-xs uppercase tracking-wider text-slate-500">Requested capabilities</p><p className="mt-2 text-sm text-slate-200">{action.requiredCapabilities.join(", ")}</p></div><div className="rounded-lg bg-white/[.04] p-4"><p className="text-xs uppercase tracking-wider text-slate-500">Risk assessment</p><p className="mt-2 text-sm capitalize text-amber-200">{action.risk} risk</p></div></div><pre className="mt-4 max-h-56 overflow-auto rounded-lg border border-white/7 bg-black/25 p-4 text-xs leading-5 text-slate-300">{action.diff ?? "No code diff supplied."}</pre><div className="mt-6 flex justify-end gap-3"><button className="quiet-button" onClick={() => onDecide(false)}><X size={15} /> Reject</button><button className="action-button" onClick={() => onDecide(true)}><Check size={15} /> Approve action</button></div></section></div>; }
