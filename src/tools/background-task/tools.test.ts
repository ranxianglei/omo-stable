import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "../../features/background-agent"
import { createBackgroundOutput, createBackgroundCancel } from "./tools"

interface MockChild {
  id: string
  title?: string
}

interface MockMessage {
  info: { role: string; agent?: string }
  parts?: Array<{ type: string; text?: string }>
}

interface Fixture {
  childrenByParent: Record<string, MockChild[]>
  messagesBySession: Record<string, MockMessage[]>
  statusMap: Record<string, { type: string }>
  abortCalls: string[]
}

function createFixture(): Fixture {
  return {
    childrenByParent: {},
    messagesBySession: {},
    statusMap: {},
    abortCalls: [],
  }
}

function createClient(fixture: Fixture) {
  return {
    session: {
      prompt: async () => ({}),
      abort: async (args: { path: { id: string } }) => {
        fixture.abortCalls.push(args.path.id)
        return {}
      },
      children: async (args: { path: { id: string } }) => ({
        data: fixture.childrenByParent[args.path.id] ?? [],
      }),
      messages: async (args: { path: { id: string } }) => ({
        data: fixture.messagesBySession[args.path.id] ?? [],
      }),
      todo: async () => ({ data: [] }),
      status: async () => ({ data: fixture.statusMap }),
      get: async () => ({ data: { directory: "/test/dir" } }),
    },
  }
}

function createToolContext(sessionID: string) {
  return {
    sessionID,
    messageID: "msg_test",
    agent: "test-agent",
    abort: new AbortController().signal,
  }
}

describe("background tools - recovery after process restart", () => {
  const PARENT = "ses_parent"
  let fixture: Fixture
  let client: ReturnType<typeof createClient>
  let manager: BackgroundManager

  beforeEach(() => {
    // #given
    fixture = createFixture()
    client = createClient(fixture)
    manager = new BackgroundManager(
      { client, directory: tmpdir() } as unknown as PluginInput
    )
  })

  afterEach(() => {
    manager.shutdown()
  })

  test("background_output should recover a finished task addressed by session id", async () => {
    // #given - the registry is empty, as it would be after a restart
    fixture.childrenByParent[PARENT] = [{ id: "ses_done", title: "Background: Audit deps" }]
    fixture.messagesBySession["ses_done"] = [
      { info: { role: "user", agent: "explorer" } },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "found 3 issues" }] },
    ]
    const outputTool = createBackgroundOutput(manager, client as unknown as PluginInput["client"])

    // #when
    const result = await outputTool.execute(
      { task_id: "ses_done" },
      createToolContext(PARENT)
    )

    // #then
    expect(result).toContain("found 3 issues")
    expect(result).not.toContain("Task not found")
  })

  test("background_output should list recoverable sessions for an unresolvable id", async () => {
    // #given - the requested session is gone, but a sibling background session survives
    fixture.childrenByParent[PARENT] = [{ id: "ses_orphan", title: "Background: Orphan job" }]
    fixture.messagesBySession["ses_orphan"] = [
      { info: { role: "user", agent: "explorer" } },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "done" }] },
    ]
    const outputTool = createBackgroundOutput(manager, client as unknown as PluginInput["client"])

    // #when
    const result = await outputTool.execute(
      { task_id: "ses_vanished" },
      createToolContext(PARENT)
    )

    // #then
    expect(result).toContain("Task not found: ses_vanished")
    expect(result).toContain("ses_orphan")
    expect(result).toContain("Orphan job")
  })

  test("background_cancel(all) should abort orphaned running sessions", async () => {
    // #given
    fixture.childrenByParent[PARENT] = [{ id: "ses_live", title: "Background: Still running" }]
    fixture.statusMap["ses_live"] = { type: "busy" }
    fixture.messagesBySession["ses_live"] = [
      { info: { role: "user", agent: "explorer" } },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "working" }] },
    ]
    const cancelTool = createBackgroundCancel(manager, client as unknown as PluginInput["client"])

    // #when
    const result = await cancelTool.execute({ all: true }, createToolContext(PARENT))

    // #then
    expect(fixture.abortCalls).toContain("ses_live")
    expect(result).toContain("Still running")
  })
})
