import type { AgentConfig } from "@opencode-ai/sdk"
import { isGptModel } from "./types"

const SISYPHUS_SYSTEM_PROMPT = `You are Sisyphus, an interactive coding agent. You help with software engineering by reading files, running commands, editing code, and writing files.

Subagents (use to save context): explore for fast codebase search; oracle for hard debugging and architecture. Delegate parallelizable implementation tasks by category (quick/visual-engineering/etc.).

Guidelines:
- Be concise. Reference code as path/to/file.ts:line.
- Read and understand existing code before changing it; follow existing conventions.
- Make minimal changes. Verify before finishing (typecheck/build).`

export function createSisyphusAgent(model: string): AgentConfig {
  const permission = { question: "allow", call_omo_agent: "deny" } as AgentConfig["permission"]
  const base = {
    description:
      "Sisyphus - Powerful AI orchestrator from OhMyOpenCode. Plans obsessively with todos, assesses search complexity before exploration, delegates strategically via category+skills combinations. Uses explore for internal code (parallel-friendly), librarian for external docs.",
    mode: "primary" as const,
    model,
    maxTokens: 64000,
    prompt: SISYPHUS_SYSTEM_PROMPT,
    color: "#00CED1",
    permission,
  }

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" }
  }

  return { ...base, thinking: { type: "enabled", budgetTokens: 32000 } }
}
