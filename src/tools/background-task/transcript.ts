import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { log } from "../../shared/logger"
import type { MessageTime } from "../../shared/session-cursor"

const TRANSCRIPT_DIR_NAME = ".omo-stable"
const TRANSCRIPT_SUBDIR = "background-tasks"
const GIT_EXCLUDE_LINE = ".omo-stable/"

export interface TranscriptTask {
  id: string
  description: string
  agent: string
  status: string
  sessionID?: string
  startedAt?: Date
  completedAt?: Date
}

export interface TranscriptPart {
  type?: string
  text?: string
  name?: string
  tool?: string
  content?: string | Array<{ type?: string; text?: string }>
  state?: { title?: string; output?: { text?: string } }
}

export interface TranscriptMessage {
  info?: { role?: string; time?: MessageTime }
  parts?: TranscriptPart[]
}

export function getTranscriptPath(workDir: string, sessionID: string): string {
  return join(workDir, TRANSCRIPT_DIR_NAME, TRANSCRIPT_SUBDIR, `${sessionID}.md`)
}

export function formatDuration(start: Date, end?: Date): string {
  const duration = (end ?? new Date()).getTime() - start.getTime()
  const seconds = Math.floor(duration / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

function toBlockquote(text: string): string {
  return text.split("\n").map((line) => `> ${line}`).join("\n")
}

// Message timestamps differ between callers: ISO strings (background tasks) vs
// epoch numbers vs { created: number } objects (sync subagent sessions).
function formatTimestamp(time: unknown): string {
  if (typeof time === "string" && time.length > 0) return time
  if (typeof time === "number") return new Date(time).toISOString()
  if (time && typeof time === "object") {
    const created = (time as { created?: unknown }).created
    if (typeof created === "number") return new Date(created).toISOString()
  }
  return ""
}

export function transcriptPointerLine(filePath: string | undefined): string {
  return filePath ? `\n\nFull transcript saved to: ${filePath}` : ""
}

export function transcriptHintLine(filePath: string | undefined, messageCount: number): string {
  if (!filePath) {
    return "\n\n(Transcript file unavailable - pass full=true to get the complete output inline.)"
  }
  return `

Full transcript (${messageCount} messages, untruncated) saved to: ${filePath}
Read or grep that file for details instead of pulling everything inline. Pass full=true for the complete output here.`
}

function toolResultText(part: TranscriptPart): string[] {
  const out: string[] = []
  const content = part.content
  if (typeof content === "string" && content) {
    out.push(content)
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if ((block.type === "text" || block.type === "reasoning") && block.text) {
        out.push(block.text)
      }
    }
  }
  return out
}

export function extractMessageContent(messages: TranscriptMessage[]): string {
  const extracted: string[] = []

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if ((part.type === "text" || part.type === "reasoning") && part.text) {
        extracted.push(part.text)
      } else if (part.type === "tool_result") {
        for (const text of toolResultText(part)) {
          extracted.push(text)
        }
      }
    }
  }

  return extracted.filter((text) => text.length > 0).join("\n\n")
}

export function findFinalAssistantText(messages: TranscriptMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.info?.role !== "assistant") continue

    const texts: string[] = []
    for (const part of message.parts ?? []) {
      if (part.type === "text" && part.text) texts.push(part.text)
    }
    if (texts.length > 0) return texts.join("\n")
  }
  return undefined
}

export function formatTranscript(task: TranscriptTask, messages: TranscriptMessage[]): string {
  const lines: string[] = []
  lines.push("# Background Task Transcript")
  lines.push("")
  lines.push("| Field | Value |")
  lines.push("|-------|-------|")
  lines.push(`| Task ID | \`${task.id}\` |`)
  lines.push(`| Description | ${task.description} |`)
  lines.push(`| Agent | ${task.agent} |`)
  lines.push(`| Status | ${task.status} |`)
  if (task.startedAt) {
    lines.push(`| Duration | ${formatDuration(task.startedAt, task.completedAt)} |`)
  }
  if (task.sessionID) {
    lines.push(`| Session ID | \`${task.sessionID}\` |`)
  }
  lines.push(`| Generated | ${new Date().toISOString()} |`)
  lines.push("")
  lines.push("## Messages")

  for (const message of messages) {
    const role = message.info?.role ?? "unknown"
    const time = formatTimestamp(message.info?.time)
    lines.push("")
    lines.push(`### [${role}]${time ? ` ${time}` : ""}`)
    lines.push("")

    for (const part of message.parts ?? []) {
      if (part.type === "text" && part.text) {
        lines.push(part.text)
        lines.push("")
      } else if (part.type === "reasoning" && part.text) {
        lines.push("#### Thinking")
        lines.push("")
        lines.push(toBlockquote(part.text))
        lines.push("")
      } else if (part.type === "tool") {
        const name = part.name ?? part.tool ?? part.state?.title ?? "tool"
        lines.push(`#### Tool call: ${name}`)
        lines.push("")
        const output = part.state?.output?.text
        if (output) {
          lines.push(output)
          lines.push("")
        }
      } else if (part.type === "tool_result") {
        for (const text of toolResultText(part)) {
          lines.push(text)
          lines.push("")
        }
      }
    }
  }

  return lines.join("\n")
}

// Best-effort: keeps the transcript dir out of `git status` without touching
// any tracked file (.git/info/exclude is local metadata only).
export function ensureGitExcludeEntry(workDir: string): void {
  const excludePath = join(workDir, ".git", "info", "exclude")
  if (!existsSync(excludePath)) return

  try {
    const current = readFileSync(excludePath, "utf-8")
    if (current.split("\n").some((line) => line.trim() === GIT_EXCLUDE_LINE)) return
    const base = current.endsWith("\n") || current.length === 0 ? current : `${current}\n`
    writeFileSync(excludePath, `${base}${GIT_EXCLUDE_LINE}\n`, "utf-8")
  } catch (error) {
    log("[background-task] failed to update .git/info/exclude", { excludePath, error: String(error) })
  }
}

export async function writeTranscript(
  workDir: string,
  task: TranscriptTask,
  messages: TranscriptMessage[]
): Promise<string | undefined> {
  if (!task.sessionID) return undefined

  try {
    const filePath = getTranscriptPath(workDir, task.sessionID)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, formatTranscript(task, messages), "utf-8")
    ensureGitExcludeEntry(workDir)
    return filePath
  } catch (error) {
    log("[background-task] failed to write transcript file", {
      workDir,
      sessionID: task.sessionID,
      error: String(error),
    })
    return undefined
  }
}
