import { useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Braces,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileCode2,
  MemoryStick,
  Moon,
  Play,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { api, type ActionItem, type ForgeItem } from "./api";
import { ApprovalDialog, ForgeReviewDialog } from "./components/Dialogs";
import { applyTheme, getInitialTheme, persistTheme, type Theme } from "./theme";
import { type ConnectionStatus, type Resource, useDashboard } from "./use-dashboard";

function relative(value: string): string {
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
    Math.round((new Date(value).getTime() - Date.now()) / 60_000),
    "minute",
  );
}
function providerColor(provider: string): string {
  return provider === "github"
    ? "provider-github"
    : provider === "linear"
      ? "provider-linear"
      : "provider-sentry";
}

export default function App() {
  const { resources, status, refreshing, refresh } = useDashboard();
  const state = useMemo(
    () => ({
      events: resources.events.data,
      actions: resources.actions.data,
      runs: resources.runs.data,
      audit: resources.audit.data,
      memory: resources.memory.data,
      connectors: resources.connectors.data,
      forges: resources.forges.data,
    }),
    [resources],
  );
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [forgePrompt, setForgePrompt] = useState(
    "Connect Linear to GitHub and prepare a pull request when a high-priority issue is ready.",
  );
  const [selectedAction, setSelectedAction] = useState<ActionItem>();
  const [selectedForge, setSelectedForge] = useState<ForgeItem>();
  const [selectedForgeFile, setSelectedForgeFile] = useState<string>();
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  const pending = useMemo(
    () => state.actions.filter((action) => action.status === "pending"),
    [state.actions],
  );
  const perform = async (key: string, operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError(undefined);
    try {
      await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Operation failed.");
    } finally {
      setBusy(undefined);
    }
  };
  const runDemo = (provider: "github" | "linear" | "sentry") =>
    void perform(`demo:${provider}`, async () => {
      setNotice(`Receiving ${provider} event…`);
      await api.demo(provider);
      await refresh();
      setNotice(
        `${provider.charAt(0).toUpperCase()}${provider.slice(1)} event processed. Review the pending proposal.`,
      );
    });
  const decideAction = (approved: boolean) => {
    if (!selectedAction) return;
    void perform(`action:${selectedAction.id}`, async () => {
      await api.decideAction(selectedAction.id, approved);
      setSelectedAction(undefined);
      await refresh();
      setNotice(
        approved
          ? "Action approved and recorded in the audit trail."
          : "Action rejected. No write was performed.",
      );
    });
  };
  const forge = () =>
    void perform("forge", async () => {
      const job = await api.forge(forgePrompt);
      await refresh();
      setNotice(
        job.status === "validated"
          ? "Connector draft validated. Review its requested scopes before approval."
          : "Forge draft was blocked by the security scanner.",
      );
    });
  const reviewForge = (forge: ForgeItem) => {
    setSelectedForge(forge);
    setSelectedForgeFile(forge.generatedFiles[0]?.path);
  };
  const decideForge = (id: string, approved: boolean) =>
    void perform(`forge:${id}`, async () => {
      await api.decideForge(id, approved);
      setSelectedForge(undefined);
      await refresh();
      setNotice(
        approved
          ? "Connector artifact approved. Installation remains a separate local action."
          : "Connector draft rejected.",
      );
    });
  const changeTheme = (nextTheme: Theme) => {
    applyTheme(nextTheme);
    persistTheme(nextTheme);
    setTheme(nextTheme);
  };

  return (
    <main className="console-shell min-h-screen">
      <div className="console-ambient fixed inset-0 -z-10" />
      <header className="mx-auto flex max-w-[1540px] items-center justify-between px-6 py-5 lg:px-10">
        <div className="flex items-center gap-3">
          <div className="brand-mark grid h-10 w-10 place-items-center rounded-xl">
            <img className="h-7 w-7" src="/eventforge-mark.svg" alt="" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-semibold tracking-tight">EventForge</h1>
            <p className="brand-subtitle text-xs">Autonomous engineering operations</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm sm:gap-3">
          <ConnectionBadge status={status} />
          <ThemeControl theme={theme} onChange={changeTheme} />
          <button
            className="quiet-button refresh-button hidden sm:inline-flex"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>
      <section className="mx-auto max-w-[1540px] px-6 pb-10 lg:px-10">
        <div className="hero-panel mb-6 flex flex-col gap-4 rounded-2xl p-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="eyebrow mb-1 text-xs font-medium uppercase tracking-[.18em]">
              Operations command center
            </p>
            <h2 className="max-w-2xl text-2xl font-semibold tracking-tight md:text-3xl">
              Every autonomous action remains visible, scoped, and reviewable.
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="action-button"
              disabled={Boolean(busy)}
              onClick={() => runDemo("github")}
            >
              <Play size={15} /> {busy === "demo:github" ? "Running…" : "Run GitHub CI demo"}
            </button>
            <button
              className="quiet-button"
              disabled={Boolean(busy)}
              onClick={() => runDemo("linear")}
            >
              Linear event
            </button>
            <button
              className="quiet-button"
              disabled={Boolean(busy)}
              onClick={() => runDemo("sentry")}
            >
              Sentry alert
            </button>
          </div>
        </div>
        {notice && (
          <div
            role="status"
            className="notice mb-5 flex items-center gap-2 rounded-lg px-4 py-3 text-sm"
          >
            <ShieldCheck size={17} /> {notice}
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="error-notice mb-5 flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm"
          >
            <span>{error}</span>
            <button className="quiet-button text-xs" onClick={() => setError(undefined)}>
              Dismiss
            </button>
          </div>
        )}
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Metric
            icon={<Activity />}
            label="Events received"
            value={state.events.length}
            detail="verified, demo & custom"
            color="cyan"
          />
          <Metric
            icon={<Bot />}
            label="Agent investigations"
            value={state.runs.length}
            detail={`${state.runs.filter((run) => run.status === "waiting_for_approval").length} waiting for review`}
            color="violet"
          />
          <Metric
            icon={<ShieldCheck />}
            label="Approval queue"
            value={pending.length}
            detail="writes require human decision"
            color="amber"
          />
          <Metric
            icon={<MemoryStick />}
            label="Scoped memories"
            value={state.memory.length}
            detail="project-private context"
            color="emerald"
          />
        </section>
        <section className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_.9fr]">
          <Panel
            title="Live event feed"
            icon={<Activity size={17} />}
            action={<span className="muted-text text-xs">Auto-refreshes every 5s</span>}
          >
            <ResourceBoundary
              resource={resources.events}
              empty="No events yet — run a demo to begin."
            >
              <div className="feed-list divide-y">
                {state.events.slice(0, 7).map((event) => (
                  <div key={event.id} className="flex items-center gap-3 py-3.5">
                    <span
                      className={`provider-badge rounded-md px-2 py-1 text-xs font-medium ${providerColor(event.provider)}`}
                    >
                      {event.provider}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {event.topic}{" "}
                        <span className="muted-text font-normal">· {event.signatureStatus}</span>
                      </p>
                      <p className="muted-text mt-0.5 text-xs">
                        {Object.keys(event.payload).length} normalized fields · secrets redacted
                      </p>
                    </div>
                    <span className="muted-text text-xs">{relative(event.receivedAt)}</span>
                  </div>
                ))}
              </div>
            </ResourceBoundary>
          </Panel>
          <Panel title="Connector health" icon={<Braces size={17} />}>
            <div className="space-y-2.5">
              {state.connectors.map((connector) => (
                <div
                  key={connector.provider}
                  className="soft-card flex items-center justify-between rounded-lg px-3.5 py-3"
                >
                  <div>
                    <p className="text-sm capitalize">{connector.provider}</p>
                    <p className="muted-text mt-0.5 text-xs">
                      {connector.capabilities.join(" · ")}
                    </p>
                  </div>
                  <span
                    className={`status-pill ${connector.status === "configured" ? "status-ready" : "status-demo"}`}
                  >
                    {connector.status}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </section>
        <section className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_1fr]">
          <Panel
            title="Approval queue"
            icon={<ShieldCheck size={17} />}
            action={<span className="warning-label text-xs">Default: approval required</span>}
          >
            <ResourceBoundary
              resource={resources.actions}
              empty="No pending writes. EventForge will never auto-approve a new workflow."
            >
              <div className="space-y-3">
                {pending.map((action) => (
                  <button
                    key={action.id}
                    className="approval-row group flex w-full items-center gap-3 rounded-xl p-4 text-left"
                    onClick={() => setSelectedAction(action)}
                  >
                    <CircleAlert size={19} className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{action.title}</p>
                      <p className="muted-text mt-1 text-xs">
                        {action.type.replaceAll("_", " ")} ·{" "}
                        {action.requiredCapabilities.join(", ")}
                      </p>
                    </div>
                    <ChevronRight size={18} className="approval-chevron shrink-0" />
                  </button>
                ))}
              </div>
            </ResourceBoundary>
          </Panel>
          <Panel title="Agent run log" icon={<Bot size={17} />}>
            <div className="space-y-3">
              {state.runs.length === 0 && (
                <Empty text="Investigations will appear here with resumable Codex thread IDs." />
              )}
              {state.runs.slice(0, 4).map((run) => (
                <div key={run.id} className="soft-card rounded-lg p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="status-pill status-demo">
                      {run.status.replaceAll("_", " ")}
                    </span>
                    <span className="muted-text text-xs">{relative(run.startedAt)}</span>
                  </div>
                  <p className="secondary-text line-clamp-2 text-sm leading-5">
                    {run.summary ?? "Starting investigation…"}
                  </p>
                  {run.threadId && (
                    <p className="thread-id mt-2 truncate font-mono text-[11px]">
                      Codex thread · {run.threadId}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        </section>
        <section className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
          <Panel
            title="Forge Studio"
            icon={<FileCode2 size={17} />}
            action={<span className="muted-text text-xs">Isolated draft · explicit install</span>}
          >
            <label className="sr-only" htmlFor="forge-prompt">
              Connector request
            </label>
            <textarea
              id="forge-prompt"
              value={forgePrompt}
              onChange={(event) => setForgePrompt(event.target.value)}
              className="forge-input min-h-24 w-full resize-y rounded-xl p-3.5 text-sm leading-6"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="muted-text text-xs leading-5">
                Forge validates code and scopes first. Generated connectors never hot-load
                automatically.
              </p>
              <button
                className="action-button shrink-0"
                disabled={Boolean(busy) || forgePrompt.trim().length === 0}
                onClick={forge}
              >
                <Braces size={15} /> {busy === "forge" ? "Forging…" : "Forge draft"}
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {state.forges.slice(0, 2).map((forge) => (
                <div key={forge.id} className="soft-card rounded-lg p-3">
                  <div className="flex gap-2">
                    <FileCode2 size={16} className="forge-icon mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{forge.prompt}</p>
                      <p className="muted-text mt-1 text-xs">
                        Scopes: {forge.requestedScopes.join(", ")}
                      </p>
                    </div>
                    <span
                      className={`status-pill ${forge.status === "validated" ? "status-ready" : "status-demo"}`}
                    >
                      {forge.status}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span
                      className={`text-xs ${forge.validation.passed ? "validation-pass" : "validation-fail"}`}
                    >
                      {forge.validation.passed
                        ? "Scanner passed"
                        : `${forge.validation.findings.length} scanner finding${forge.validation.findings.length === 1 ? "" : "s"}`}
                    </span>
                    <button className="quiet-button text-xs" onClick={() => reviewForge(forge)}>
                      Review artifact
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Memory & audit trail" icon={<Clock3 size={17} />}>
            <div className="space-y-3">
              {state.audit.length === 0 && (
                <Empty text="Audit entries appear for every event, run, forge, and approval." />
              )}
              {state.audit.slice(0, 5).map((entry) => (
                <div key={entry.id} className="flex gap-3">
                  <div className="audit-dot mt-1.5 h-2 w-2 shrink-0 rounded-full" />
                  <div>
                    <p className="secondary-text text-sm leading-5">{entry.message}</p>
                    <p className="dim-text mt-1 text-xs">
                      {entry.kind.replaceAll("_", " ")} · {relative(entry.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </section>
      </section>
      {selectedAction && (
        <ApprovalDialog
          action={selectedAction}
          busy={busy === `action:${selectedAction.id}`}
          onClose={() => setSelectedAction(undefined)}
          onDecide={decideAction}
        />
      )}
      {selectedForge && (
        <ForgeReviewDialog
          forge={selectedForge}
          busy={busy === `forge:${selectedForge.id}`}
          selectedFilePath={selectedForgeFile}
          onSelectFile={setSelectedForgeFile}
          onClose={() => setSelectedForge(undefined)}
          onDecide={(approved) => decideForge(selectedForge.id, approved)}
        />
      )}
    </main>
  );
}

function ThemeControl({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  return (
    <div className="theme-control" role="group" aria-label="Color theme">
      <button
        type="button"
        className="theme-choice"
        aria-label="Use light theme"
        aria-pressed={theme === "light"}
        onClick={() => onChange("light")}
      >
        <Sun size={15} />
        <span className="hidden sm:inline">Light</span>
      </button>
      <button
        type="button"
        className="theme-choice"
        aria-label="Use dark theme"
        aria-pressed={theme === "dark"}
        onClick={() => onChange("dark")}
      >
        <Moon size={15} />
        <span className="hidden sm:inline">Dark</span>
      </button>
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
  detail,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
  color: "cyan" | "violet" | "amber" | "emerald";
}) {
  return (
    <div className="metric-card rounded-xl p-4">
      <div className={`metric-icon metric-${color} mb-7 inline-flex rounded-lg p-2`}>{icon}</div>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      <p className="secondary-text mt-1 text-sm">{label}</p>
      <p className="dim-text mt-1 text-xs">{detail}</p>
    </div>
  );
}
function Panel({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="panel-title flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="empty-state rounded-lg px-4 py-7 text-center text-sm">{text}</div>;
}
function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return (
    <span
      className={`connection-status connection-${status} hidden sm:inline-flex sm:items-center sm:gap-2`}
    >
      <span className="connection-indicator h-1.5 w-1.5 rounded-full" /> Control plane {status}
    </span>
  );
}
function ResourceBoundary<T>({
  resource,
  empty,
  children,
}: {
  resource: Resource<T[]>;
  empty: string;
  children: React.ReactNode;
}) {
  if (resource.loading && resource.data.length === 0)
    return <Empty text="Loading control plane…" />;
  if (resource.error && resource.data.length === 0)
    return (
      <div className="resource-error rounded-lg px-4 py-5 text-sm" role="alert">
        Unable to load this panel: {resource.error}
      </div>
    );
  if (resource.data.length === 0) return <Empty text={empty} />;
  return (
    <>
      {resource.error && (
        <p className="resource-warning mb-3 text-xs" role="status">
          Showing cached data · refresh failed
        </p>
      )}
      {children}
    </>
  );
}
