import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentPromptMetadata } from "./types"
import { isGptModel } from "./types"
import { createAgentToolRestrictions } from "../shared/permission-compat"

export const ORACLE_PROMPT_METADATA: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  promptAlias: "Oracle",
  triggers: [
    { domain: "Architecture decisions", trigger: "Multi-system tradeoffs, unfamiliar patterns" },
    { domain: "Self-review", trigger: "After completing significant implementation" },
    { domain: "Hard debugging", trigger: "After 2+ failed fix attempts" },
  ],
  useWhen: [
    "Complex architecture design",
    "After completing significant work",
    "2+ failed fix attempts",
    "Unfamiliar code patterns",
    "Security/performance concerns",
    "Multi-system tradeoffs",
  ],
  avoidWhen: [
    "Simple file operations (use direct tools)",
    "First attempt at any fix (try yourself first)",
    "Questions answerable from code you've read",
    "Trivial decisions (variable names, formatting)",
    "Things you can infer from existing code patterns",
  ],
}

const ORACLE_SYSTEM_PROMPT = `You are Oracle, a read-only consultant for hard debugging and architecture decisions. You advise; you do not edit files.

Guidelines:
- Be rigorous and concise. Reference code as path/to/file.ts:line.
- Give a clear recommendation with rationale.`

export function createOracleAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions([
    "write",
    "edit",
    "task",
    "delegate_task",
  ])

  const base = {
    description:
      "Read-only consultation agent. High-IQ reasoning specialist for debugging hard problems and high-difficulty architecture design.",
    mode: "subagent" as const,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: ORACLE_SYSTEM_PROMPT,
  } as AgentConfig

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium", textVerbosity: "high" } as AgentConfig
  }

  return { ...base, thinking: { type: "enabled", budgetTokens: 32000 } } as AgentConfig
}

