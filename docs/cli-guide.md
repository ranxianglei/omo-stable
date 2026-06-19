# Omo-Stable CLI Guide

This document provides a comprehensive guide to using the Omo-Stable CLI tools.

## 1. Overview

Omo-Stable provides CLI tools accessible via the `bunx omo-stable` command. The CLI supports various features including plugin installation, environment diagnostics, and session execution.

```bash
# Basic execution (displays help)
bunx omo-stable

# Or run with npx
npx omo-stable
```

---

## 2. Available Commands

| Command | Description |
|---------|-------------|
| `install` | Interactive Setup Wizard |
| `doctor` | Environment diagnostics and health checks |
| `run` | OpenCode session runner |
| `auth` | Google Antigravity authentication management |
| `version` | Display version information |

---

## 3. `install` - Interactive Setup Wizard

An interactive installation tool for initial Omo-Stable setup. Provides a beautiful TUI (Text User Interface) based on `@clack/prompts`.

### Usage

```bash
bunx omo-stable install
```

### Installation Process

1. **Provider Selection**: Choose your AI provider from Claude, ChatGPT, or Gemini.
2. **API Key Input**: Enter the API key for your selected provider.
3. **Configuration File Creation**: Generates `opencode.json` or `omo-stable.json` files.
4. **Plugin Registration**: Automatically registers the omo-stable plugin in OpenCode settings.

### Options

| Option | Description |
|--------|-------------|
| `--no-tui` | Run in non-interactive mode without TUI (for CI/CD environments) |
| `--verbose` | Display detailed logs |

---

## 4. `doctor` - Environment Diagnostics

Diagnoses your environment to ensure Omo-Stable is functioning correctly. Performs 17+ health checks.

### Usage

```bash
bunx omo-stable doctor
```

### Diagnostic Categories

| Category | Check Items |
|----------|-------------|
| **Installation** | OpenCode version (>= 1.0.150), plugin registration status |
| **Configuration** | Configuration file validity, JSONC parsing |
| **Authentication** | Anthropic, OpenAI, Google API key validity |
| **Dependencies** | Bun, Node.js, Git installation status |
| **Tools** | LSP server status, MCP server status |
| **Updates** | Latest version check |

### Options

| Option | Description |
|--------|-------------|
| `--category <name>` | Check specific category only (e.g., `--category authentication`) |
| `--json` | Output results in JSON format |
| `--verbose` | Include detailed information |

### Example Output

```
omo-stable doctor

┌──────────────────────────────────────────────────┐
│  Omo-Stable Doctor                           │
└──────────────────────────────────────────────────┘

Installation
  ✓ OpenCode version: 1.0.155 (>= 1.0.150)
  ✓ Plugin registered in opencode.json

Configuration
  ✓ omo-stable.json is valid
  ⚠ categories.visual-engineering: using default model

Authentication
  ✓ Anthropic API key configured
  ✓ OpenAI API key configured
  ✗ Google API key not found

Dependencies
  ✓ Bun 1.2.5 installed
  ✓ Node.js 22.0.0 installed
  ✓ Git 2.45.0 installed

Summary: 10 passed, 1 warning, 1 failed
```

---

## 5. `run` - OpenCode Session Runner

Executes OpenCode sessions and monitors task completion.

### Usage

```bash
bunx omo-stable run [prompt]
```

### Options

| Option | Description |
|--------|-------------|
| `--enforce-completion` | Keep session active until all TODOs are completed |
| `--timeout <seconds>` | Set maximum execution time |

---

## 6. `auth` - Authentication Management

Manages Google Antigravity OAuth authentication. Required for using Gemini models.

### Usage

```bash
# Login
bunx omo-stable auth login

# Logout
bunx omo-stable auth logout

# Check current status
bunx omo-stable auth status
```

---

## 7. Configuration Files

The CLI searches for configuration files in the following locations (in priority order):

1. **Project Level**: `.opencode/omo-stable.json`
2. **User Level**: `~/.config/opencode/omo-stable.json`

### JSONC Support

Configuration files support **JSONC (JSON with Comments)** format. You can use comments and trailing commas.

```jsonc
{
  // Agent configuration
  "sisyphus_agent": {
    "disabled": false,
    "planner_enabled": true,
  },
  
  /* Category customization */
  "categories": {
    "visual-engineering": {
      "model": "google/gemini-3-pro",
    },
  },
}
```

---

## 8. Troubleshooting

### "OpenCode version too old" Error

```bash
# Update OpenCode
npm install -g opencode@latest
# or
bun install -g opencode@latest
```

### "Plugin not registered" Error

```bash
# Reinstall plugin
bunx omo-stable install
```

### Doctor Check Failures

```bash
# Diagnose with detailed information
bunx omo-stable doctor --verbose

# Check specific category only
bunx omo-stable doctor --category authentication
```

---

## 9. Non-Interactive Mode

Use the `--no-tui` option for CI/CD environments.

```bash
# Run doctor in CI environment
bunx omo-stable doctor --no-tui --json

# Save results to file
bunx omo-stable doctor --json > doctor-report.json
```

---

## 10. Developer Information

### CLI Structure

```
src/cli/
├── index.ts              # Commander.js-based main entry
├── install.ts            # @clack/prompts-based TUI installer
├── config-manager.ts     # JSONC parsing, multi-source config management
├── doctor/               # Health check system
│   ├── index.ts          # Doctor command entry
│   └── checks/           # 17+ individual check modules
├── run/                  # Session runner
└── commands/auth.ts      # Authentication management
```

### Adding New Doctor Checks

1. Create `src/cli/doctor/checks/my-check.ts`:

```typescript
import type { DoctorCheck } from "../types"

export const myCheck: DoctorCheck = {
  name: "my-check",
  category: "environment",
  check: async () => {
    // Check logic
    const isOk = await someValidation()
    
    return {
      status: isOk ? "pass" : "fail",
      message: isOk ? "Everything looks good" : "Something is wrong",
    }
  },
}
```

2. Register in `src/cli/doctor/checks/index.ts`:

```typescript
export { myCheck } from "./my-check"
```
