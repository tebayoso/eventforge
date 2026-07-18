import {
  ArrowDownRight,
  ArrowUpRight,
  Asterisk,
  Check,
  ChevronDown,
  CircleDotDashed,
  CornerDownRight,
  FileCheck2,
  Fingerprint,
  Flame,
  GitPullRequest,
  LockKeyhole,
  Play,
  ShieldCheck,
  Sparkles,
  Waves,
  Workflow
} from "lucide-react";

const principles = [
  {
    marker: "01",
    title: "One event inbox",
    text: "Bring GitHub, Linear, Sentry, and custom webhooks into one place instead of asking your team to keep five tabs open.",
    icon: Waves
  },
  {
    marker: "02",
    title: "Less noise, more signal",
    text: "Use policies to surface the events that need attention and keep the routine chatter out of your team’s way.",
    icon: CircleDotDashed
  },
  {
    marker: "03",
    title: "Agents start with context",
    text: "When something matters, an agent can investigate and prepare the next step — so people start with an answer, not a blank page.",
    icon: LockKeyhole
  }
];

function Mark() {
  return <span className="ef-mark" aria-hidden="true"><i /><i /><i /></span>;
}

function TraceBoard() {
  return <div className="ef-trace-board" aria-label="A sample EventForge event inbox">
    <div className="ef-trace-header"><span>One event inbox</span><span>What deserves attention</span></div>
    <svg className="ef-trace-wire" viewBox="0 0 500 430" aria-hidden="true">
      <path d="M55 72 C160 72, 142 178, 252 178 S328 278, 438 278" />
      <path className="ef-trace-dash" d="M55 72 C160 72, 142 178, 252 178 S328 278, 438 278" />
      <circle cx="55" cy="72" r="7" /><circle cx="252" cy="178" r="7" /><circle cx="438" cy="278" r="7" />
    </svg>
    <article className="ef-trace-card ef-trace-card--signal">
      <span className="ef-card-kicker"><Waves size={13} /> Event received</span>
      <strong>CI failed on main</strong>
      <p>GitHub · verified · high impact</p>
    </article>
    <article className="ef-trace-card ef-trace-card--read">
      <span className="ef-card-kicker"><Sparkles size={13} /> Worth a closer look</span>
      <strong>Context gathered</strong>
      <p>What changed · what failed · what to do next</p>
    </article>
    <article className="ef-trace-card ef-trace-card--decision">
      <span className="ef-card-kicker"><ShieldCheck size={13} /> Ready for your team</span>
      <strong>A clear next step</strong>
      <p>Review only when a decision is needed</p>
      <span className="ef-review-stamp">USEFUL</span>
    </article>
    <span className="ef-trace-caption">The events matter. The rest can stay quiet.</span>
  </div>;
}

function DecisionLedger() {
  return <div className="ef-ledger" aria-label="EventForge value summary">
    <div className="ef-ledger-topline"><span>What EventForge gives you</span><span>One useful view</span></div>
    <div className="ef-ledger-row"><span className="ef-ledger-index">A</span><span>Sources</span><strong>GitHub, Linear, Sentry, custom</strong><Check size={16} /></div>
    <div className="ef-ledger-row"><span className="ef-ledger-index">B</span><span>Priority</span><strong>Only events that match your rules</strong><Check size={16} /></div>
    <div className="ef-ledger-row"><span className="ef-ledger-index">C</span><span>Context</span><strong>What happened and what changed</strong><Check size={16} /></div>
    <div className="ef-ledger-row ef-ledger-row--verdict"><span className="ef-ledger-index">D</span><span>Outcome</span><strong>A next step your team can use</strong><span className="ef-pulse" /></div>
    <div className="ef-ledger-foot"><Fingerprint size={17} /> Start with the signal, not the alert fatigue.</div>
  </div>;
}

export default function LandingPage() {
  return <main className="ef-landing">
    <div className="ef-grain" aria-hidden="true" />
    <header className="ef-site-header">
      <a className="ef-brand" href="/" aria-label="EventForge home"><Mark /><span>EventForge</span></a>
      <nav aria-label="Primary navigation">
        <a href="#problem">What it solves</a>
        <a href="#principles">Why EventForge</a>
        <a className="ef-nav-console" href="/console">Open console <ArrowUpRight size={15} /></a>
      </nav>
    </header>

    <section className="ef-hero">
      <div className="ef-hero-copy">
        <div className="ef-eyebrow"><Asterisk size={14} /> Your event layer for agent-ready work</div>
        <h1>One place for<br />every webhook.<br /><em>Less noise.</em></h1>
        <p className="ef-hero-intro">EventForge centralizes the signals from the tools your team already uses, filters out the chatter, and turns the important events into useful work.</p>
        <div className="ef-hero-actions">
          <a className="ef-primary-cta" href="/console">See your event inbox <ArrowDownRight size={18} /></a>
          <a className="ef-text-cta" href="https://youtu.be/pht3rrl--pE" target="_blank" rel="noreferrer"><Play size={15} fill="currentColor" /> Watch the demo</a>
        </div>
        <div className="ef-hero-footnote"><span className="ef-live-dot" /> Keep your current stack. Give its signals one useful place to go.</div>
      </div>
      <TraceBoard />
    </section>

    <section className="ef-manifesto" id="problem">
      <div className="ef-section-label"><span>The problem</span><span>Your tools are busy. Your team should not be.</span></div>
      <div className="ef-manifesto-copy">
        <p className="ef-manifesto-lead">Your tools are talking.<br /><i>EventForge helps you hear the right things.</i></p>
        <p>GitHub alerts, Linear updates, Sentry issues, and custom webhooks create a constant stream of activity. EventForge collects that stream, applies your rules, and gives your team a calmer queue of events that are actually worth acting on.</p>
      </div>
      <div className="ef-side-annotation"><CornerDownRight size={18} /><span>One overlay<br />for every signal.</span></div>
    </section>

    <section className="ef-principles" id="principles">
      <div className="ef-section-heading"><span className="ef-section-label">The value</span><h2>More clarity around<br />the work that matters.</h2></div>
      <div className="ef-principle-grid">
        {principles.map(({ marker, title, text, icon: Icon }) => <article className="ef-principle" key={marker}>
          <div className="ef-principle-head"><span>{marker}</span><Icon size={20} /></div>
          <h3>{title}</h3><p>{text}</p>
        </article>)}
      </div>
    </section>

    <section className="ef-proof">
      <div className="ef-proof-copy">
        <div className="ef-eyebrow"><Flame size={14} /> An overlay, not another replacement</div>
        <h2>Keep your stack.<br />Make it <em>quieter.</em></h2>
        <p>EventForge sits above the tools and automations you already run. It gives their events a shared inbox, a common set of rules, and agents that can take the first pass when something deserves attention.</p>
        <ul>
          <li><GitPullRequest size={17} /> Stop chasing alerts across every tool.</li>
          <li><FileCheck2 size={17} /> See the context behind an event before you act.</li>
          <li><Workflow size={17} /> Let agents help with the follow-up, not the noise.</li>
        </ul>
      </div>
      <DecisionLedger />
    </section>

    <section className="ef-close">
      <div className="ef-close-meta"><span>EventForge</span><span>Bring your event stream under one roof.</span></div>
      <h2>Turn webhook noise<br />into <em>useful work.</em></h2>
      <a className="ef-close-link" href="/console">Open your event inbox <ArrowUpRight size={23} /></a>
      <ChevronDown className="ef-close-arrow" size={23} aria-hidden="true" />
    </section>

    <footer className="ef-footer"><a className="ef-brand" href="/"><Mark /><span>EventForge</span></a><span>Policy-first operations for event-driven teams.</span><span>© 2026</span></footer>
  </main>;
}
