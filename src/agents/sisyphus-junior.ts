import type { AgentConfig } from "@opencode-ai/sdk"
import { isGptModel } from "./types"
import type { AgentOverrideConfig } from "../config/schema"
import {
  createAgentToolRestrictions,
  type PermissionValue,
} from "../shared/permission-compat"

const SISYPHUS_JUNIOR_PROMPT = `You are Sisyphus-Junior, a focused task executor invoked by Sisyphus for delegated work. Execute the assigned task atomically.

Guidelines:
- Be concise. Reference code as path/to/file.ts:line.
- Follow existing conventions. Verify before finishing (typecheck/build).`

function buildSisyphusJuniorPrompt(promptAppend?: string): string {
  if (!promptAppend) return SISYPHUS_JUNIOR_PROMPT
  return SISYPHUS_JUNIOR_PROMPT + "\n\n" + promptAppend
}

// Core tools that Sisyphus-Junior must NEVER have access to
// Note: call_omo_agent is ALLOWED so subagents can spawn explore/librarian
const BLOCKED_TOOLS = ["task", "delegate_task"]

export const SISYPHUS_JUNIOR_DEFAULTS = {
  model: "anthropic/claude-sonnet-4-5",
  temperature: 0.1,
} as const

export function createSisyphusJuniorAgentWithOverrides(
  override: AgentOverrideConfig | undefined,
  systemDefaultModel?: string
): AgentConfig {
  if (override?.disable) {
    override = undefined
  }

  const model = override?.model ?? systemDefaultModel ?? SISYPHUS_JUNIOR_DEFAULTS.model
  const temperature = override?.temperature ?? SISYPHUS_JUNIOR_DEFAULTS.temperature

  const promptAppend = override?.prompt_append
  const prompt = buildSisyphusJuniorPrompt(promptAppend)

  const baseRestrictions = createAgentToolRestrictions(BLOCKED_TOOLS)

  const userPermission = (override?.permission ?? {}) as Record<string, PermissionValue>
  const basePermission = baseRestrictions.permission
  const merged: Record<string, PermissionValue> = { ...userPermission }
  for (const tool of BLOCKED_TOOLS) {
    merged[tool] = "deny"
  }
  merged.call_omo_agent = "allow"
  const toolsConfig = { permission: { ...merged, ...basePermission } }

  const base: AgentConfig = {
    description: override?.description ??
      "Sisyphus-Junior - Focused task executor. Same discipline, no delegation.",
    mode: "subagent" as const,
    model,
    temperature,
    maxTokens: 64000,
    prompt,
    color: override?.color ?? "#20B2AA",
    ...toolsConfig,
  }

  if (override?.top_p !== undefined) {
    base.top_p = override.top_p
  }

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" } as AgentConfig
  }

  return {
    ...base,
    thinking: { type: "enabled", budgetTokens: 32000 },
  } as AgentConfig
}
