# FEATURES KNOWLEDGE BASE

## OVERVIEW

Core feature modules + Claude Code compatibility layer. Background agents, builtin commands, loaders. Skill discovery/execution is deferred to opencode-native (host `skill` tool + `packages/opencode/src/skill/`).

## STRUCTURE

```
features/
├── background-agent/           # Task lifecycle (1335 lines)
│   ├── manager.ts              # Launch → poll → complete
│   ├── concurrency.ts          # Per-provider limits
│   └── types.ts                # BackgroundTask, LaunchInput
├── builtin-commands/           # ralph-loop, refactor, init-deep, start-work, remove-deadcode
│   ├── commands.ts             # Command registry
│   └── templates/              # Command templates (4 files)
├── claude-code-agent-loader/   # ~/.claude/agents/*.md
├── claude-code-command-loader/ # ~/.claude/commands/*.md
├── claude-code-mcp-loader/     # .mcp.json
├── claude-code-plugin-loader/  # installed_plugins.json
├── claude-code-session-state/  # Session persistence
├── context-injector/           # AGENTS.md/README.md injection
├── boulder-state/              # Todo state persistence
├── hook-message-injector/      # Message injection
└── task-toast-manager/         # Background task notifications
```

## LOADER PRIORITY

| Type | Priority (highest first) |
|------|--------------------------|
| Commands | `.opencode/command/` > `~/.config/opencode/command/` > `.claude/commands/` |
| MCPs | `.claude/.mcp.json` > `.mcp.json` > `~/.claude/.mcp.json` |

> Skills are NOT loaded by omo-stable. The host (opencode-core) discovers `SKILL.md` files and provides the native `skill` tool.

## BACKGROUND AGENT

- **Lifecycle**: `launch` → `poll` (2s) → `complete`
- **Stability**: 3 consecutive polls = idle
- **Concurrency**: Per-provider/model limits
- **Cleanup**: 30m TTL, 3m stale timeout

## ANTI-PATTERNS

- **Sequential delegation**: Use `delegate_task` parallel
- **Trust self-reports**: ALWAYS verify
- **Main thread blocks**: No heavy I/O in loader init
