# Contributing to EventForge

## Development setup

Use Node.js 22.17 or newer and the Corepack-managed pnpm version declared in the root package. CI validates Node.js 22 and 24. From a clean checkout:

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm quality
```

Run the control plane and console in separate terminals:

```bash
pnpm dev
```

```bash
pnpm dev:console
```

The default local configuration is a credential-free demo. Live provider and Codex modes require their documented external secrets.

## Change requirements

- Keep provider payloads untrusted and verify the preserved original raw body before accepting or normalizing a delivery.
- Default new workflows and capabilities to approval-required.
- Add a regression test that explains the invariant being protected.
- Do not weaken repository, path, domain, provider, role, or workspace boundaries to make a test pass.
- Keep generated connectors review-only. Exact artifact-digest approval and installation are Track B prerequisites, not current capabilities.
- Do not commit `.env`, provider credentials, tunnel tokens, local databases, generated artifacts, or Codex credentials.
- Do not add co-authors to commits.

Pull requests must pass `pnpm quality`, package smoke tests, deployment rendering, and the production dependency audit. Browser changes must also update the cumulative playbook in `workfiles/agent-browser/README.md`.
