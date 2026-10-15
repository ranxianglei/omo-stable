import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { tmpdir } from "node:os"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "../../features/background-agent"
import { createCallOmoAgent } from "./tools"
import { resetMessageCursor } from "../../shared/session-cursor"

interface MockMessage {
  info: { id: string; role: string; agent?: string; time?: { created?: number } }
  parts?: Array<{ type: string; text?: string; content?: string }>
}

function createClient(messagesBySession: Record<string, MockMessage[]>, directory: string) {
  return {
    session: {
      get: async () => ({ data: { directory } }),
      create: async () => ({ data: { id: "ses_call" } }),
      prompt: async () => ({}),
      status: async () => ({ data: { ses_call: { type: "idle" } } }),
      messages: async (args: { path: { id: string } }) => ({
        data: messagesBySession[args.path.id] ?? [],
      }),
      children: async () => ({ data: [] }),
      abort: async () => ({}),
      todo: async () => ({ data: [] }),
    },
  }
}

function multiMessageFixture(): MockMessage[] {
  return [
    { info: { id: "u1", role: "user", agent: "explore", time: { created: 1 } } },
    {
      info: { id: "a1", role: "assistant", time: { created: 2 } },
      parts: [{ type: "text", text: "INTERMEDIATE-SEARCH-RESULTS" }],
    },
    {
      info: { id: "t1", role: "tool", time: { created: 3 } },
      parts: [{ type: "tool_result", content: "TOOL-DUMP-BIG" }],
    },
    {
      info: { id: "a2", role: "assistant", time: { created: 4 } },
      parts: [{ type: "text", text: "FINAL-SUMMARY-OK" }],
    },
  ]
}

describe("call_omo_agent sync result mode", () => {
  let workDir: string
  let manager: BackgroundManager

  beforeEach(() => {
    // #given - session cursors are module-global; isolate per test
    resetMessageCursor()
    workDir = join(tmpdir(), `omo-callo-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(workDir, { recursive: true })
  })

  afterEach(() => {
    manager?.shutdown()
    rmSync(workDir, { recursive: true, force: true })
  })

  function createTool(messages: MockMessage[]) {
    const client = createClient({ ses_call: messages }, workDir)
    const ctx = { client, directory: workDir } as unknown as PluginInput
    manager = new BackgroundManager(ctx)
    return createCallOmoAgent(ctx, manager)
  }

  function toolContext() {
    return {
      sessionID: "ses_parent",
      messageID: "msg_test",
      agent: "test-agent",
      abort: new AbortController().signal,
    }
  }

  const args = {
    description: "Explore codebase",
    prompt: "Find all usages of X",
    subagent_type: "explore",
    run_in_background: false,
  }

  test("default mode returns only the final message plus transcript file pointer", async () => {
    // #given
    const toolDef = createTool(multiMessageFixture())

    // #when
    const result = await toolDef.execute(args, toolContext() as never)

    // #then - inline output carries only the final message + file pointer
    expect(result).toContain("FINAL-SUMMARY-OK")
    expect(result).not.toContain("INTERMEDIATE-SEARCH-RESULTS")
    expect(result).not.toContain("TOOL-DUMP-BIG")
    expect(result).toContain(".omo-stable/background-tasks/ses_call.md")

    // #then - full record lands in the transcript file
    const fileContent = readFileSync(
      join(workDir, ".omo-stable", "background-tasks", "ses_call.md"),
      "utf-8"
    )
    expect(fileContent).toContain("INTERMEDIATE-SEARCH-RESULTS")
    expect(fileContent).toContain("TOOL-DUMP-BIG")
    expect(fileContent).toContain("FINAL-SUMMARY-OK")
  })

  test("full=true returns the complete output inline (legacy behavior)", async () => {
    // #given
    const toolDef = createTool(multiMessageFixture())

    // #when
    const result = await toolDef.execute(
      { ...args, full: true },
      toolContext() as never
    )

    // #then
    expect(result).toContain("INTERMEDIATE-SEARCH-RESULTS")
    expect(result).toContain("TOOL-DUMP-BIG")
    expect(result).toContain("FINAL-SUMMARY-OK")
  })
})
