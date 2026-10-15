import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { tmpdir } from "node:os"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  extractMessageContent,
  findFinalAssistantText,
  getTranscriptPath,
  formatTranscript,
  ensureGitExcludeEntry,
  writeTranscript,
  type TranscriptMessage,
  type TranscriptTask,
} from "./transcript"

const TASK: TranscriptTask = {
  id: "task_1",
  description: "Audit deps",
  agent: "explore",
  status: "completed",
  sessionID: "ses_child",
  startedAt: new Date("2026-10-15T03:00:00Z"),
  completedAt: new Date("2026-10-15T03:03:02Z"),
}

const MESSAGES = [
  {
    info: { id: "m1", role: "assistant", time: "2026-10-15T03:00:05Z" },
    parts: [{ type: "text", text: "intermediate finding" }],
  },
  {
    info: { id: "m2", role: "tool", time: "2026-10-15T03:01:00Z" },
    parts: [{ type: "tool_result", content: "TOOL-OUTPUT-BIG" }],
  },
  {
    info: { id: "m3", role: "assistant", time: "2026-10-15T03:02:00Z" },
    parts: [
      { type: "reasoning", text: "thinking deeply" },
      { type: "text", text: "final answer" },
    ],
  },
]

describe("getTranscriptPath", () => {
  test("nests under .omo-stable/background-tasks inside the workdir", () => {
    // #given / #when / #then
    expect(getTranscriptPath("/work/proj", "ses_abc")).toBe(
      "/work/proj/.omo-stable/background-tasks/ses_abc.md"
    )
  })
})

describe("formatTranscript", () => {
  test("includes task metadata header", () => {
    // #when
    const out = formatTranscript(TASK, MESSAGES)

    // #then
    expect(out).toContain("| Task ID | `task_1` |")
    expect(out).toContain("| Description | Audit deps |")
    expect(out).toContain("| Agent | explore |")
    expect(out).toContain("| Status | completed |")
    expect(out).toContain("| Duration | 3m 2s |")
    expect(out).toContain("| Session ID | `ses_child` |")
  })

  test("records every message section without truncation", () => {
    // #when
    const out = formatTranscript(TASK, MESSAGES)

    // #then - intermediate content survives in the file even though the
    // inline result only carries the final message
    expect(out).toContain("intermediate finding")
    expect(out).toContain("TOOL-OUTPUT-BIG")
    expect(out).toContain("final answer")
  })

  test("renders reasoning parts as blockquoted thinking sections", () => {
    // #when
    const out = formatTranscript(TASK, MESSAGES)

    // #then
    expect(out).toContain("> thinking deeply")
  })

  test("flattens tool_result content block arrays", () => {
    // #given
    const messages = [
      {
        info: { id: "m1", role: "tool" },
        parts: [{
          type: "tool_result",
          content: [
            { type: "text", text: "BLOCK-A" },
            { type: "text", text: "BLOCK-B" },
          ],
        }],
      },
    ]

    // #when
    const out = formatTranscript(TASK, messages)

    // #then
    expect(out).toContain("BLOCK-A")
    expect(out).toContain("BLOCK-B")
  })

  test("labels tool call parts with their name", () => {
    // #given
    const messages = [
      {
        info: { id: "m1", role: "assistant" },
        parts: [{ type: "tool", name: "bash", state: { output: { text: "ls output" } } }],
      },
    ]

    // #when
    const out = formatTranscript(TASK, messages)

    // #then
    expect(out).toContain("Tool call: bash")
    expect(out).toContain("ls output")
  })
})

describe("writeTranscript", () => {
  let workDir: string

  beforeEach(() => {
    workDir = join(tmpdir(), `omo-transcript-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(workDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  test("writes the full markdown transcript and returns its path", async () => {
    // #when
    const filePath = await writeTranscript(workDir, TASK, MESSAGES)

    // #then
    expect(filePath).toBe(getTranscriptPath(workDir, "ses_child"))
    const content = readFileSync(filePath!, "utf-8")
    expect(content).toContain("intermediate finding")
    expect(content).toContain("TOOL-OUTPUT-BIG")
    expect(content).toContain("final answer")
  })

  test("overwrites on repeated calls (idempotent full record)", async () => {
    // #given
    await writeTranscript(workDir, TASK, MESSAGES)

    // #when - second fetch rewrites the same record
    const filePath = await writeTranscript(workDir, TASK, MESSAGES)

    // #then
    expect(filePath).toBe(getTranscriptPath(workDir, "ses_child"))
    const content = readFileSync(filePath!, "utf-8")
    const occurrences = content.split("intermediate finding").length - 1
    expect(occurrences).toBe(1)
  })

  test("returns undefined instead of throwing when the target path is blocked", async () => {
    // #given - a regular file at .omo-stable makes mkdir -p fail
    writeFileSync(join(workDir, ".omo-stable"), "blocker")

    // #when
    const filePath = await writeTranscript(workDir, TASK, MESSAGES)

    // #then
    expect(filePath).toBeUndefined()
  })
})

describe("ensureGitExcludeEntry", () => {
  let workDir: string

  beforeEach(() => {
    workDir = join(tmpdir(), `omo-gitexclude-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(workDir, ".git", "info"), { recursive: true })
    writeFileSync(join(workDir, ".git", "info", "exclude"), "# git exclude\n\n# per-user\n")
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  test("appends .omo-stable/ to .git/info/exclude exactly once", () => {
    // #when
    ensureGitExcludeEntry(workDir)
    ensureGitExcludeEntry(workDir)

    // #then
    const content = readFileSync(join(workDir, ".git", "info", "exclude"), "utf-8")
    const occurrences = content.split("\n").filter((l) => l.trim() === ".omo-stable/").length
    expect(occurrences).toBe(1)
  })

  test("does nothing outside a git repository", () => {
    // #given
    const plainDir = join(tmpdir(), `omo-nogit-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(plainDir, { recursive: true })

    // #when / #then
    expect(() => ensureGitExcludeEntry(plainDir)).not.toThrow()
    expect(existsSync(join(plainDir, ".git"))).toBe(false)
    rmSync(plainDir, { recursive: true, force: true })
  })
})

describe("extractMessageContent", () => {
  test("joins text, reasoning and tool_result content with blank lines", () => {
    // #given
    const messages: TranscriptMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "first" }] },
      { info: { role: "tool" }, parts: [{ type: "tool_result", content: "TOOL-STRING" }] },
      {
        info: { role: "tool" },
        parts: [{ type: "tool_result", content: [{ type: "text", text: "BLOCK-A" }, { type: "reasoning", text: "BLOCK-B" }] }],
      },
      { info: { role: "assistant" }, parts: [{ type: "reasoning", text: "thoughts" }] },
    ]

    // #when
    const result = extractMessageContent(messages)

    // #then
    expect(result).toBe("first\n\nTOOL-STRING\n\nBLOCK-A\n\nBLOCK-B\n\nthoughts")
  })

  test("returns empty string when no extractable content exists", () => {
    // #given
    const messages: TranscriptMessage[] = [
      { info: { role: "assistant" }, parts: [] },
      { info: { role: "tool" }, parts: [{ type: "tool_result", content: "" }] },
    ]

    // #when / #then
    expect(extractMessageContent(messages)).toBe("")
  })
})

describe("findFinalAssistantText", () => {
  test("returns the last assistant message with non-empty text parts", () => {
    // #given
    const messages: TranscriptMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "earlier" }] },
      { info: { role: "tool" }, parts: [{ type: "tool_result", content: "noise" }] },
      { info: { role: "assistant" }, parts: [{ type: "reasoning", text: "only thinking" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "last one" }] },
    ]

    // #when / #then
    expect(findFinalAssistantText(messages)).toBe("last one")
  })

  test("joins multiple text parts of the final assistant message", () => {
    // #given
    const messages: TranscriptMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "part-a" }, { type: "text", text: "part-b" }] },
    ]

    // #when / #then
    expect(findFinalAssistantText(messages)).toBe("part-a\npart-b")
  })

  test("falls back to an earlier assistant message when the latest has no text", () => {
    // #given
    const messages: TranscriptMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "fallback-text" }] },
      { info: { role: "tool" }, parts: [{ type: "tool_result", content: "dump" }] },
    ]

    // #when / #then
    expect(findFinalAssistantText(messages)).toBe("fallback-text")
  })

  test("returns undefined when no assistant text exists at all", () => {
    // #given
    const messages: TranscriptMessage[] = [
      { info: { role: "tool" }, parts: [{ type: "tool_result", content: "only-tools" }] },
    ]

    // #when / #then
    expect(findFinalAssistantText(messages)).toBeUndefined()
  })
})
