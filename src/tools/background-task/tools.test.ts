import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { tmpdir } from "node:os"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "../../features/background-agent"
import { createBackgroundOutput, createBackgroundCancel } from "./tools"
import { resetMessageCursor } from "../../shared/session-cursor"

interface MockChild {
  id: string
  title?: string
}

interface MockMessage {
  info: { role: string; agent?: string; id?: string }
  parts?: Array<{ type: string; text?: string; content?: string }>
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

function createClient(fixture: Fixture, directory = "/test/dir") {
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
      get: async () => ({ data: { directory } }),
    },
  }
}

function freshWorkDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function seedMultiMessageChild(fixture: Fixture, parentID: string, sessionID: string): void {
  fixture.childrenByParent[parentID] = [{ id: sessionID, title: `Background: Job ${sessionID}` }]
  fixture.messagesBySession[sessionID] = [
    { info: { id: "u1", role: "user", agent: "explorer" } },
    { info: { id: "a1", role: "assistant" }, parts: [{ type: "text", text: "INTERMEDIATE-NOTES" }] },
    { info: { id: "t1", role: "tool" }, parts: [{ type: "tool_result", content: "TOOL-DUMP-XYZ" }] },
    { info: { id: "a2", role: "assistant" }, parts: [{ type: "text", text: "FINAL-ANSWER-42" }] },
  ]
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

describe("background_output transcript file mode", () => {
  const PARENT = "ses_parent_bg"
  let fixture: Fixture
  let client: ReturnType<typeof createClient>
  let manager: BackgroundManager
  let workDir: string

  beforeEach(() => {
    // #given - session cursors are module-global; isolate per test
    resetMessageCursor()
    fixture = createFixture()
    workDir = freshWorkDir("omo-bgout")
    client = createClient(fixture, workDir)
    manager = new BackgroundManager(
      { client, directory: tmpdir() } as unknown as PluginInput
    )
  })

  afterEach(() => {
    manager.shutdown()
    rmSync(workDir, { recursive: true, force: true })
  })

  test("default mode returns only the final message plus transcript file pointer", async () => {
    // #given - child session with intermediate content and tool output
    seedMultiMessageChild(fixture, PARENT, "ses_job")
    const outputTool = createBackgroundOutput(manager, client as unknown as PluginInput["client"])

    // #when
    const result = await outputTool.execute(
      { task_id: "ses_job" },
      createToolContext(PARENT)
    )

    // #then - inline result carries only the final message + file pointer
    expect(result).toContain("FINAL-ANSWER-42")
    expect(result).not.toContain("INTERMEDIATE-NOTES")
    expect(result).not.toContain("TOOL-DUMP-XYZ")
    expect(result).toContain(".omo-stable/background-tasks/ses_job.md")

    // #then - full record lands in the transcript file
    const fileContent = readFileSync(
      join(workDir, ".omo-stable", "background-tasks", "ses_job.md"),
      "utf-8"
    )
    expect(fileContent).toContain("INTERMEDIATE-NOTES")
    expect(fileContent).toContain("TOOL-DUMP-XYZ")
    expect(fileContent).toContain("FINAL-ANSWER-42")
  })

  test("full=true returns the complete output inline (legacy behavior)", async () => {
    // #given
    seedMultiMessageChild(fixture, PARENT, "ses_job")
    const outputTool = createBackgroundOutput(manager, client as unknown as PluginInput["client"])

    // #when
    const result = await outputTool.execute(
      { task_id: "ses_job", full: true },
      createToolContext(PARENT)
    )

    // #then
    expect(result).toContain("INTERMEDIATE-NOTES")
    expect(result).toContain("TOOL-DUMP-XYZ")
    expect(result).toContain("FINAL-ANSWER-42")
  })

  test("cursor still advances: second call reports no new output", async () => {
    // #given
    seedMultiMessageChild(fixture, PARENT, "ses_job")
    const outputTool = createBackgroundOutput(manager, client as unknown as PluginInput["client"])

    // #when
    const first = await outputTool.execute({ task_id: "ses_job" }, createToolContext(PARENT))
    const second = await outputTool.execute({ task_id: "ses_job" }, createToolContext(PARENT))

    // #then
    expect(first).toContain("FINAL-ANSWER-42")
    expect(second).toContain("(No new output since last check)")
  })

  test("falls back to the last non-empty assistant text when the final message has none", async () => {
    // #given - session ends with a tool message, no trailing assistant text
    fixture.childrenByParent[PARENT] = [{ id: "ses_fallback", title: "Background: Fallback job" }]
    fixture.messagesBySession["ses_fallback"] = [
      { info: { id: "u1", role: "user", agent: "explorer" } },
      { info: { id: "a1", role: "assistant" }, parts: [{ type: "text", text: "EARLY-TEXT" }] },
      { info: { id: "t1", role: "tool" }, parts: [{ type: "tool_result", content: "TOOL-DUMP-99" }] },
    ]
    const outputTool = createBackgroundOutput(manager, client as unknown as PluginInput["client"])

    // #when
    const result = await outputTool.execute(
      { task_id: "ses_fallback" },
      createToolContext(PARENT)
    )

    // #then
    expect(result).toContain("EARLY-TEXT")
    expect(result).not.toContain("TOOL-DUMP-99")
  })

  test("degrades gracefully when the transcript file cannot be written", async () => {
    // #given - a regular file at .omo-stable makes mkdir fail
    writeFileSync(join(workDir, ".omo-stable"), "blocker")
    seedMultiMessageChild(fixture, PARENT, "ses_job")
    const outputTool = createBackgroundOutput(manager, client as unknown as PluginInput["client"])

    // #when
    const result = await outputTool.execute(
      { task_id: "ses_job" },
      createToolContext(PARENT)
    )

    // #then - final message still returned, no dangling file pointer
    expect(result).toContain("FINAL-ANSWER-42")
    expect(result).not.toContain(".omo-stable/background-tasks")
  })
})
