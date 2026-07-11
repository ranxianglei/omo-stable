# omo-stable Development Specification

**omo-stable** is an independent fork of [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (based on v3.0.1). It is an OpenCode plugin: multi-model agent orchestration, 31 lifecycle hooks, 20+ tools (LSP, AST-Grep, delegation), 10 specialized agents, full Claude Code compatibility. "oh-my-zsh" for OpenCode.

This document is the authoritative spec for **development, build, deployment, and release**. Modeled on the opencode-acp AGENTS.md convention.

---

## 1. Repository Info

| Item | Value |
|------|-------|
| GitHub (canonical) | `github.com/ranxianglei/omo-stable` (remote `github`) |
| Self-hosted mirror | `192.168.10.96:3300/dog/omo-stable` (remote `gitea`) |
| Upstream (do not push) | `code-yeongyu/oh-my-openagent` (remote `origin`) |
| Old fork remote | `ranxianglei/oh-my-openagent` (remote `fork`, legacy) |
| Package name | `omo-stable` (npm) |
| Plugin load (local) | `file://` → `~/.cache/opencode/node_modules/omo-stable/dist/index.js` |

**Network note (this machine):**
- `github.com:443` is **unreachable directly** — all git/gh operations to GitHub require the **proxy `http://127.0.0.1:20171`**.
- `registry.npmjs.org` is **directly reachable** (`npm ping` ~650ms) — **NEVER use the proxy for npm** (it hangs publish indefinitely).

```bash
# GitHub git/gh — ALWAYS with proxy:
export http_proxy=http://127.0.0.1:20171 https_proxy=http://127.0.0.1:20171 ALL_PROXY=http://127.0.0.1:20171
# npm — NEVER with proxy (run in a shell WITHOUT the above exports).
```

---

## 2. Codebase Structure

```
omo-stable/
├── src/
│   ├── agents/        # 10 AI agents — see src/agents/AGENTS.md
│   ├── hooks/         # 31 lifecycle hooks — see src/hooks/AGENTS.md
│   ├── tools/         # 20+ tools — see src/tools/AGENTS.md
│   ├── features/      # Background agents, Claude Code compat — see src/features/AGENTS.md
│   ├── shared/        # Cross-cutting utilities — see src/shared/AGENTS.md
│   ├── cli/           # CLI installer, doctor — see src/cli/AGENTS.md
│   ├── mcp/           # Built-in MCPs — see src/mcp/AGENTS.md
│   ├── config/        # Zod schema, TypeScript types
│   └── index.ts       # Main plugin entry
├── script/            # build-schema.ts, build-binaries.ts
├── packages/          # platform-specific binaries (see §6.4)
└── dist/              # Build output (ESM + .d.ts) — gitignored, built
```

### Where to look

| Task | Location | Notes |
|------|----------|-------|
| Add agent | `src/agents/` | Create `.ts` with factory, add to `agentSources` |
| Add hook | `src/hooks/` | Create dir with `createXXXHook()`, register in `index.ts` |
| Add tool | `src/tools/` | Dir with index/types/constants/tools.ts |
| Add MCP | `src/mcp/` | Create config, add to `index.ts` |
| Add skill | `src/features/builtin-skills/` | Create dir with `SKILL.md` |
| Add command | `src/features/builtin-commands/` | Add template + register in `commands.ts` |
| Config schema | `src/config/schema.ts` | Zod schema, run `bun run build:schema` after edits |

### Complexity hotspots

| File | Lines | Description |
|------|-------|-------------|
| `src/features/background-agent/manager.ts` | ~1335 | Task lifecycle, concurrency |
| `src/features/builtin-skills/skills.ts` | ~1203 | Skill definitions |
| `src/agents/prometheus-prompt.ts` | ~1196 | Planning agent |
| `src/hooks/todo-continuation-enforcer.ts` | ~545 | Autonomous todo-resume enforcer (see §7) |
| `src/hooks/atlas/index.ts` | ~773 | Orchestrator hook |
| `src/index.ts` | ~601 | Main plugin entry |

---

## 3. Development Standards

### 3.1 Build & test commands

```bash
bun run typecheck      # tsc --noEmit (MUST be clean before commit)
bun run build          # bun build (index + cli) + tsc --emitDeclarationOnly + build:schema
bun run clean          # rm -rf dist
bun run rebuild        # clean + build
bun test               # run all tests (bun:test)
bun test path/to/file  # run one test file
```

**Package manager: Bun exclusively.** Never npm/yarn for dev. Types: `bun-types` (NEVER `@types/node`).

### 3.2 Build output

- `dist/index.js` — bundled ESM entry (loaded by opencode via `main`/`exports`).
- `dist/index.d.ts` — TypeScript declarations.
- `dist/cli/index.js` — CLI bundle.
- `dist/omo-stable.schema.json` — generated config schema.
- Published files (per `files` in `package.json`): `dist/`, `bin/`, `postinstall.mjs`.

### 3.3 Testing

- **Runner**: `bun test` (BDD style: `#given` / `#when` / `#then` comments).
- Test files live alongside source: `*.test.ts`.
- **TDD is mandatory**: RED → GREEN → REFACTOR. Never write implementation before test. Never delete a failing test — fix the code.
- Some hook tests are timing-sensitive and can be flaky under load (e.g. abort-detection in `todo-continuation-enforcer.test.ts`). Re-run individually before treating as real.

---

## 4. Local Deployment (testing in opencode)

**One script** — build (Docker) + deploy to the local plugin cache + checksum-verify:

```bash
./script/deploy-omo.sh             # Build via Docker + deploy + verify
./script/deploy-omo.sh --no-build  # Deploy existing dist/index.js only
```

The script resolves the project root relative to its own location (`script/` dir), so it works from any checkout. Install targets are overridable via `OMO_STABLE_TARGET` and `OMO_FORK_TARGET` env vars.

What it does:
1. Build: `sg docker -c "docker run --rm -v $OMO_SOURCE:/app -w /app oven/bun:latest bash -c 'bun install && bun build src/index.ts --outdir dist --target bun --format esm --external @ast-grep/napi'"`
2. Copy `dist/index.js` (with timestamped `.bak`) to **both**:
   - `~/.cache/opencode/node_modules/omo-stable/dist/index.js` ← **active** (referenced by `~/.opencode/opencode.json` via `file://`)
   - `~/.cache/opencode/node_modules/omo-fork/dist/index.js` ← legacy path, kept in sync
3. Verify all three sha256 match.

> ⚠️ `~/system/opencode.md` still references `omo-fork` — the **current active name is `omo-stable`**. Both paths are replaced by the script, so the stale doc does not affect deployment.

**Restart opencode after deploying** — the running process caches the module in memory. Verify the deployed bundle contains your change:
```bash
grep -c 'your-feature-name' ~/.cache/opencode/node_modules/omo-stable/dist/index.js
```

> Note: `script/deploy-omo.sh` builds only `dist/index.js` (the plugin entry) via the `bun build` one-liner — it does **not** generate declarations, CLI, or schema. That is sufficient for plugin loading. For a full publishable build (declarations + cli + schema), use `bun run build` locally (§3.1) or `npm publish` (which runs `prepublishOnly`).

---

## 5. Release Workflow (the standard flow)

This is the canonical release path. All changes go through PR + merge; npm publishes happen from `master` after merge.

### 5.1 Make a change

```bash
git checkout master && git pull github master   # via proxy
git checkout -b <type>/<short-desc>             # e.g. fix/todo-continuation-cap
# ... edit, test (bun test), typecheck (bun run typecheck) ...
git add <files> && git commit -m "<type>: <description>"
```

### 5.2 Push + open PR on GitHub

```bash
export http_proxy=http://127.0.0.1:20171 https_proxy=http://127.0.0.1:20171 ALL_PROXY=http://127.0.0.1:20171
git push github <type>/<short-desc>
gh pr create --repo ranxianglei/omo-stable --base master --title "<type>: <desc>" --body "..."
```

### 5.3 Merge the PR (squash)

```bash
# gh pr merge is guard-protected — override required (human-intent only):
export GH_ALLOW_DANGEROUS=1
gh pr merge <N> --repo ranxianglei/omo-stable --squash --delete-branch
gh pr view <N> --repo ranxianglei/omo-stable --json state -q '.state'   # → MERGED
```

### 5.4 Bump version + publish to npm + version PR

```bash
# 1. Sync local master (via proxy)
git checkout master && git pull github master

# 2. Version-bump branch
git checkout -b chore/bump-<X.Y.Z>
sed -i 's/"version": "<old>"/"version": "<X.Y.Z>"/' package.json
grep '"version"' package.json | head -1   # verify

# 3. Full build (declares + cli + schema) — MUST pass
bun run build

# 4. Publish — NO proxy shell (npm registry is direct), guard override required
unset http_proxy https_proxy ALL_PROXY
export NPM_ALLOW_DANGEROUS=1
npm publish --access public              # prepublishOnly runs clean + build, then publishes

# 5. Verify
npm view omo-stable version              # → <X.Y.Z>

# 6. Version PR (via proxy)
export http_proxy=http://127.0.0.1:20171 https_proxy=http://127.0.0.1:20171 ALL_PROXY=http://127.0.0.1:20171
git add package.json && git commit -m "chore: bump version to <X.Y.Z>"
git push github chore/bump-<X.Y.Z>
gh pr create --repo ranxianglei/omo-stable --base master --title "chore: bump version to <X.Y.Z>" --body "..."
# then merge it (§5.3)

# 7. Sync local install
~/scripts/deploy-omo.sh
```

**Version policy:** `major.minor.patch`. Bug fixes / small behavior changes → patch. New features / notable behavior changes → minor. Breaking → major. (`3.0.1 → 3.1.0` was a minor, reflecting the todo-continuation behavior change.)

### 5.5 Pre-publish checklist (MANDATORY)

1. `bun run typecheck` — zero errors.
2. `bun run build` — exits 0 (declarations + cli + schema all generate).
3. `bun test` — no NEW failures (pre-existing flaky tests noted in §3.3).
4. Working tree clean except the intended `package.json` version bump.
5. `npm view omo-stable version` — confirm the target version is not already published.
6. Publish from a shell **without** the proxy env vars.

---

## 6. Conventions & Gotchas

### 6.1 Commit convention

- Format: `<type>: <description>` (lowercase). Types: `fix`, `feat`, `refactor`, `chore`, `docs`, `test`, `perf`, `revert`.
- Atomic commits: one logical change per commit. Do not mix test changes with unrelated impl.
- Squash-merge PRs into `master` (one commit per PR).

### 6.2 Git safety rules (MANDATORY)

- Never `git push --force` to `master` (or any shared branch).
- Never commit secrets (API keys, tokens). The `.git/config` remote URLs on this machine contain tokens — never copy them into committed files.
- `bun.lock` may show incidental drift after `bun install` in Docker — restore it (`git checkout -- bun.lock`) unless the lockfile change is intentional.
- Pull requests are required for `master`. No direct pushes to `master`.

### 6.3 Guards (this machine)

Two guards block destructive ops by default — override only with explicit human intent:
- `gh pr merge` → needs `GH_ALLOW_DANGEROUS=1` (logged to `~/.local/share/gh-blocked.log`).
- `npm publish` → needs `NPM_ALLOW_DANGEROUS=1` (logged to `~/.local/share/npm-blocked.log`).

### 6.4 `optionalDependencies` (known leftover)

`package.json` lists `omo-stable-{platform}` optional deps pinned to a fixed version. These platform packages were **never published** (404 on npm) — they are a leftover from the upstream build system that expects prebuilt platform binaries. They cause install warnings ("CLI may not work on this platform") but do **not** block install or publish. Leaving them as-is is safe; cleaning them up is a separate, optional PR.

### 6.5 Code conventions

- **Exports**: barrel pattern via `index.ts`.
- **Naming**: kebab-case dirs; `createXXXHook` / `createXXXTool` factories.
- **Type safety**: never `as any`, `@ts-ignore`, `@ts-expect-error`. Never empty catch blocks.
- **Config**: Zod-validated (`src/config/schema.ts`); run `bun run build:schema` after schema edits.

### 6.6 Anti-patterns

| Category | Forbidden |
|----------|-----------|
| Package manager | npm/yarn for dev — Bun only |
| Types | `@types/node` — use `bun-types` |
| Type safety | `as any`, `@ts-ignore`, `@ts-expect-error` |
| Testing | Deleting failing tests to "pass" |
| Publishing | Direct to `master` without PR |
| npm publish | Via the proxy (hangs) — always direct |
| Commits | Mixing 3+ unrelated files in one commit |

---

## 7. Notable subsystem: `todo-continuation-enforcer`

Autonomously resumes the model when incomplete todos remain and the session goes idle. Located at `src/hooks/todo-continuation-enforcer.ts`. Key design (as of v3.1.0):

- **Per-stall nudge cap**: at most **1** nudge per no-progress stall (`MAX_STUCK_NUDGES = 1`). Counter resets when a todo is completed (progress) or a real user message arrives. This bounds token waste without throttling legitimate multi-step work.
- **No `sleep` hint**: the prompt must NOT instruct the model to `sleep` when waiting. `sleep` is a blocking tool call that keeps the session busy and prevents `session.idle` from firing, which bypasses the nudge cap and causes perpetual waiting.
- **Prompt rule**: "Unless you are waiting for user feedback or clarification (in which case you may stop and wait for a reply), do not stop until all tasks are done."
- Exponential countdown backoff (`BASE_COUNTDOWN_SECONDS=2`, `MAX_COUNTDOWN_SECONDS=300`), empty-response limit (`MAX_EMPTY_RESPONSE_RETRIES=2`), and abort-window detection all remain as lower-level safety nets.

When editing this hook, re-read these invariants carefully — a naive "total nudge cap" would break active multi-step work, and reintroducing `sleep` reintroduces the perpetual-wait bug.
