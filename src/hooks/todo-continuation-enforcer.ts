import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { BackgroundManager } from "../features/background-agent"
import { getMainSessionID, subagentSessions } from "../features/claude-code-session-state"
import {
    findNearestMessageWithFields,
    MESSAGE_STORAGE,
    type ToolPermission,
} from "../features/hook-message-injector"
import { log } from "../shared/logger"
import { createSystemDirective, SystemDirectiveTypes } from "../shared/system-directive"

const HOOK_NAME = "todo-continuation-enforcer"

const DEFAULT_SKIP_AGENTS = ["prometheus", "compaction"]

export interface TodoContinuationEnforcerOptions {
  backgroundManager?: BackgroundManager
  skipAgents?: string[]
}

export interface TodoContinuationEnforcer {
  handler: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  markRecovering: (sessionID: string) => void
  markRecoveryComplete: (sessionID: string) => void
}

interface Todo {
  content: string
  status: string
  priority: string
  id: string
}

interface SessionState {
  countdownTimer?: ReturnType<typeof setTimeout>
  countdownInterval?: ReturnType<typeof setInterval>
  isRecovering?: boolean
  countdownStartedAt?: number
  abortDetectedAt?: number
  consecutiveEmptyResponses?: number
  consecutiveNudges?: number
  lastNudgeAt?: number
  lastSelfInjectionAt?: number
}

const CONTINUATION_PROMPT = `${createSystemDirective(SystemDirectiveTypes.TODO_CONTINUATION)}

Incomplete tasks remain in your todo list. Before starting any work, FIRST verify whether the pending tasks are actually already done — if so, mark them completed immediately. Only then continue working on any remaining pending tasks.

- FIRST: Check if pending tasks were already completed in previous turns. If yes, mark them as completed using the todowrite tool.
- THEN: Continue working on the next truly pending task.
- Proceed without asking for permission.
- Mark each task complete when finished.
- Do not stop until all tasks are done.
- If you are genuinely blocked and need user input to proceed, state your question clearly and stop. Do not loop or retry.`

const BASE_COUNTDOWN_SECONDS = 2
const MAX_COUNTDOWN_SECONDS = 300
const TOAST_DURATION_MS = 900
const COUNTDOWN_GRACE_PERIOD_MS = 500
const MAX_EMPTY_RESPONSE_RETRIES = 2

function getCountdownSeconds(consecutiveNudges: number): number {
  const seconds = BASE_COUNTDOWN_SECONDS * Math.pow(2, consecutiveNudges)
  return Math.min(seconds, MAX_COUNTDOWN_SECONDS)
}

function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

function getIncompleteCount(todos: Todo[]): number {
  return todos.filter(t => t.status !== "completed" && t.status !== "cancelled").length
}

interface MessageInfo {
  id?: string
  role?: string
  error?: { name?: string; data?: unknown }
  tokens?: { input?: number; output?: number }
  finish?: string
}

function isLastAssistantMessageAborted(messages: Array<{ info?: MessageInfo }>): boolean {
  if (!messages || messages.length === 0) return false

  const assistantMessages = messages.filter(m => m.info?.role === "assistant")
  if (assistantMessages.length === 0) return false

  const lastAssistant = assistantMessages[assistantMessages.length - 1]
  const info = lastAssistant.info
  const errorName = info?.error?.name

  if (errorName) {
    return errorName === "MessageAbortedError" || errorName === "AbortError"
  }

  // Fallback: detect empty responses where the model returned nothing
  // opencode sometimes aborts without setting error field, or models
  // return finish="other" with zero tokens (no content generated)
  const tokens = info?.tokens
  const hasNoOutput = tokens && tokens.input === 0 && tokens.output === 0
  const finishReason = info?.finish
  const isEmptyResponse = finishReason === "other" || (hasNoOutput && finishReason !== "stop" && finishReason !== "tool_use")

  return !!isEmptyResponse
}

export function createTodoContinuationEnforcer(
  ctx: PluginInput,
  options: TodoContinuationEnforcerOptions = {}
): TodoContinuationEnforcer {
  const { backgroundManager, skipAgents = DEFAULT_SKIP_AGENTS } = options
  const sessions = new Map<string, SessionState>()

  function getState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {}
      sessions.set(sessionID, state)
    }
    return state
  }

  function cancelCountdown(sessionID: string): void {
    const state = sessions.get(sessionID)
    if (!state) return

    if (state.countdownTimer) {
      clearTimeout(state.countdownTimer)
      state.countdownTimer = undefined
    }
    if (state.countdownInterval) {
      clearInterval(state.countdownInterval)
      state.countdownInterval = undefined
    }
    state.countdownStartedAt = undefined
  }

  function cleanup(sessionID: string): void {
    cancelCountdown(sessionID)
    sessions.delete(sessionID)
  }

  const markRecovering = (sessionID: string): void => {
    const state = getState(sessionID)
    state.isRecovering = true
    cancelCountdown(sessionID)
    log(`[${HOOK_NAME}] Session marked as recovering`, { sessionID })
  }

  const markRecoveryComplete = (sessionID: string): void => {
    const state = sessions.get(sessionID)
    if (state) {
      state.isRecovering = false
      log(`[${HOOK_NAME}] Session recovery complete`, { sessionID })
    }
  }

  async function showCountdownToast(seconds: number, incompleteCount: number): Promise<void> {
    await ctx.client.tui.showToast({
      body: {
        title: "Todo Continuation",
        message: `Resuming in ${seconds}s... (${incompleteCount} tasks remaining)`,
        variant: "warning" as const,
        duration: TOAST_DURATION_MS,
      },
    }).catch(() => {})
  }

  interface ResolvedMessageInfo {
    agent?: string
    model?: { providerID: string; modelID: string }
    tools?: Record<string, ToolPermission>
  }

  async function injectContinuation(
    sessionID: string,
    incompleteCount: number,
    total: number,
    resolvedInfo?: ResolvedMessageInfo
  ): Promise<void> {
    const state = sessions.get(sessionID)

    if (state?.isRecovering) {
      log(`[${HOOK_NAME}] Skipped injection: in recovery`, { sessionID })
      return
    }

    const hasRunningBgTasks = backgroundManager
      ? backgroundManager.getTasksByParentSession(sessionID).some(t => t.status === "running")
      : false

    if (hasRunningBgTasks) {
      log(`[${HOOK_NAME}] Skipped injection: background tasks running`, { sessionID })
      return
    }

    let todos: Todo[] = []
    try {
      const response = await ctx.client.session.todo({ path: { id: sessionID } })
      todos = (response.data ?? response) as Todo[]
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to fetch todos`, { sessionID, error: String(err) })
      return
    }

    const freshIncompleteCount = getIncompleteCount(todos)
    if (freshIncompleteCount === 0) {
      log(`[${HOOK_NAME}] Skipped injection: no incomplete todos`, { sessionID })
      return
    }

    let agentName = resolvedInfo?.agent
    let model = resolvedInfo?.model
    let tools = resolvedInfo?.tools

    if (!agentName || !model) {
      const messageDir = getMessageDir(sessionID)
      const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
      agentName = agentName ?? prevMessage?.agent
      model = model ?? (prevMessage?.model?.providerID && prevMessage?.model?.modelID
        ? { providerID: prevMessage.model.providerID, modelID: prevMessage.model.modelID }
        : undefined)
      tools = tools ?? prevMessage?.tools
    }

    if (agentName && skipAgents.includes(agentName)) {
      log(`[${HOOK_NAME}] Skipped: agent in skipAgents list`, { sessionID, agent: agentName })
      return
    }

    const editPermission = tools?.edit
    const writePermission = tools?.write
    const hasWritePermission = !tools ||
      ((editPermission !== false && editPermission !== "deny") &&
       (writePermission !== false && writePermission !== "deny"))
    if (!hasWritePermission) {
      log(`[${HOOK_NAME}] Skipped: agent lacks write permission`, { sessionID, agent: agentName })
      return
    }

    const now = Date.now()
    const elapsedSinceLastNudge = state?.lastNudgeAt
      ? Math.round((now - state.lastNudgeAt) / 1000)
      : null

    const prompt = `${CONTINUATION_PROMPT}

[Status: ${todos.length - freshIncompleteCount}/${todos.length} completed, ${freshIncompleteCount} remaining]
[Current time: ${new Date().toISOString()}${elapsedSinceLastNudge !== null ? ` | Time since last prompt: ${elapsedSinceLastNudge}s` : " | First prompt this session"}]`

    try {
      log(`[${HOOK_NAME}] Injecting continuation`, { sessionID, agent: agentName, model, incompleteCount: freshIncompleteCount })

      if (state) {
        state.lastSelfInjectionAt = Date.now()
      }

      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent: agentName,
          ...(model !== undefined ? { model } : {}),
          parts: [{ type: "text", text: prompt }],
        },
        query: { directory: ctx.directory },
      })

      log(`[${HOOK_NAME}] Injection successful`, { sessionID })

      if (state) {
        state.lastNudgeAt = Date.now()
        state.consecutiveNudges = (state.consecutiveNudges ?? 0) + 1
      }
    } catch (err) {
      log(`[${HOOK_NAME}] Injection failed`, { sessionID, error: String(err) })
    }
  }

  function startCountdown(
    sessionID: string,
    incompleteCount: number,
    total: number,
    resolvedInfo?: ResolvedMessageInfo
  ): void {
    const state = getState(sessionID)
    cancelCountdown(sessionID)

    const countdownSeconds = getCountdownSeconds(state.consecutiveNudges ?? 0)
    let secondsRemaining = countdownSeconds
    showCountdownToast(secondsRemaining, incompleteCount)
    state.countdownStartedAt = Date.now()

    // Reduce toast frequency for longer countdowns to avoid UI spam
    const toastIntervalMs = countdownSeconds > 30 ? 10000 : 1000
    state.countdownInterval = setInterval(() => {
      secondsRemaining -= Math.floor(toastIntervalMs / 1000)
      if (secondsRemaining > 0) {
        showCountdownToast(secondsRemaining, incompleteCount)
      }
    }, toastIntervalMs)

    state.countdownTimer = setTimeout(() => {
      cancelCountdown(sessionID)
      injectContinuation(sessionID, incompleteCount, total, resolvedInfo)
    }, countdownSeconds * 1000)

    log(`[${HOOK_NAME}] Countdown started`, { sessionID, seconds: countdownSeconds, consecutiveNudges: state.consecutiveNudges ?? 0, incompleteCount })
  }

  const handler = async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const error = props?.error as { name?: string } | undefined
      if (error?.name === "MessageAbortedError" || error?.name === "AbortError") {
        const state = getState(sessionID)
        state.abortDetectedAt = Date.now()
        log(`[${HOOK_NAME}] Abort detected via session.error`, { sessionID, errorName: error.name })
      }

      cancelCountdown(sessionID)
      log(`[${HOOK_NAME}] session.error`, { sessionID })
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      log(`[${HOOK_NAME}] session.idle`, { sessionID })

      const mainSessionID = getMainSessionID()
      const isMainSession = sessionID === mainSessionID
      const isBackgroundTaskSession = subagentSessions.has(sessionID)

      if (mainSessionID && !isMainSession && !isBackgroundTaskSession) {
        log(`[${HOOK_NAME}] Skipped: not main or background task session`, { sessionID })
        return
      }

      const state = getState(sessionID)

      if (state.isRecovering) {
        log(`[${HOOK_NAME}] Skipped: in recovery`, { sessionID })
        return
      }

      // Check 1: Event-based abort detection (primary, most reliable)
      if (state.abortDetectedAt) {
        const timeSinceAbort = Date.now() - state.abortDetectedAt
        const ABORT_WINDOW_MS = 3000
        if (timeSinceAbort < ABORT_WINDOW_MS) {
          log(`[${HOOK_NAME}] Skipped: abort detected via event ${timeSinceAbort}ms ago`, { sessionID })
          state.abortDetectedAt = undefined
          return
        }
        state.abortDetectedAt = undefined
      }

      const hasRunningBgTasks = backgroundManager
        ? backgroundManager.getTasksByParentSession(sessionID).some(t => t.status === "running")
        : false

      if (hasRunningBgTasks) {
        log(`[${HOOK_NAME}] Skipped: background tasks running`, { sessionID })
        return
      }

      // Check 2: API-based abort detection (fallback, for cases where event was missed)
      try {
        const messagesResp = await ctx.client.session.messages({
          path: { id: sessionID },
          query: { directory: ctx.directory },
        })
        const messages = (messagesResp as { data?: Array<{ info?: MessageInfo }> }).data ?? []

        if (isLastAssistantMessageAborted(messages)) {
          state.consecutiveEmptyResponses = (state.consecutiveEmptyResponses || 0) + 1

          if (state.consecutiveEmptyResponses > MAX_EMPTY_RESPONSE_RETRIES) {
            log(`[${HOOK_NAME}] Skipped: ${state.consecutiveEmptyResponses} consecutive empty responses (max: ${MAX_EMPTY_RESPONSE_RETRIES})`, { sessionID })
            return
          }

          log(`[${HOOK_NAME}] Empty response #${state.consecutiveEmptyResponses}, attempting recovery`, { sessionID })
          // Fall through to normal continuation logic as recovery
        } else {
          if (state.consecutiveEmptyResponses) {
            log(`[${HOOK_NAME}] Normal response, resetting empty response counter`, { sessionID })
            state.consecutiveEmptyResponses = 0
          }
        }
      } catch (err) {
        log(`[${HOOK_NAME}] Messages fetch failed, continuing`, { sessionID, error: String(err) })
      }

      let todos: Todo[] = []
      try {
        const response = await ctx.client.session.todo({ path: { id: sessionID } })
        todos = (response.data ?? response) as Todo[]
      } catch (err) {
        log(`[${HOOK_NAME}] Todo fetch failed`, { sessionID, error: String(err) })
        return
      }

      if (!todos || todos.length === 0) {
        log(`[${HOOK_NAME}] No todos`, { sessionID })
        return
      }

      const incompleteCount = getIncompleteCount(todos)
      if (incompleteCount === 0) {
        log(`[${HOOK_NAME}] All todos complete`, { sessionID, total: todos.length })
        return
      }

      let resolvedInfo: ResolvedMessageInfo | undefined
      let hasCompactionMessage = false
      try {
        const messagesResp = await ctx.client.session.messages({
          path: { id: sessionID },
        })
        const messages = (messagesResp.data ?? []) as Array<{
          info?: {
            agent?: string
            model?: { providerID: string; modelID: string }
            modelID?: string
            providerID?: string
            tools?: Record<string, ToolPermission>
          }
        }>
        for (let i = messages.length - 1; i >= 0; i--) {
          const info = messages[i].info
          if (info?.agent === "compaction") {
            hasCompactionMessage = true
            continue
          }
          if (info?.agent || info?.model || (info?.modelID && info?.providerID)) {
            resolvedInfo = {
              agent: info.agent,
              model: info.model ?? (info.providerID && info.modelID ? { providerID: info.providerID, modelID: info.modelID } : undefined),
              tools: info.tools,
            }
            break
          }
        }
      } catch (err) {
        log(`[${HOOK_NAME}] Failed to fetch messages for agent check`, { sessionID, error: String(err) })
      }

      log(`[${HOOK_NAME}] Agent check`, { sessionID, agentName: resolvedInfo?.agent, skipAgents, hasCompactionMessage })
      if (resolvedInfo?.agent && skipAgents.includes(resolvedInfo.agent)) {
        log(`[${HOOK_NAME}] Skipped: agent in skipAgents list`, { sessionID, agent: resolvedInfo.agent })
        return
      }
      if (hasCompactionMessage && !resolvedInfo?.agent) {
        log(`[${HOOK_NAME}] Skipped: compaction occurred but no agent info resolved`, { sessionID })
        return
      }

      startCountdown(sessionID, incompleteCount, todos.length, resolvedInfo)
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined

      if (!sessionID) return

      if (role === "user") {
        const state = sessions.get(sessionID)
        if (state?.countdownStartedAt) {
          const elapsed = Date.now() - state.countdownStartedAt
          if (elapsed < COUNTDOWN_GRACE_PERIOD_MS) {
            log(`[${HOOK_NAME}] Ignoring user message in grace period`, { sessionID, elapsed })
            return
          }
        }
        // Skip reset for self-injected continuation prompts
        if (state?.lastSelfInjectionAt && Date.now() - state.lastSelfInjectionAt < 5000) {
          log(`[${HOOK_NAME}] Skipping reset: self-injected message`, { sessionID })
          return
        }
        if (state) {
          state.abortDetectedAt = undefined
          state.consecutiveNudges = 0
          state.lastNudgeAt = undefined
        }
        cancelCountdown(sessionID)
      }

      if (role === "assistant") {
        const state = sessions.get(sessionID)
        if (state) state.abortDetectedAt = undefined
        cancelCountdown(sessionID)
      }
      return
    }

    if (event.type === "message.part.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined

      if (sessionID && role === "assistant") {
        const state = sessions.get(sessionID)
        if (state) state.abortDetectedAt = undefined
        cancelCountdown(sessionID)
      }
      return
    }

    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = props?.sessionID as string | undefined
      if (sessionID) {
        const state = sessions.get(sessionID)
        if (state) state.abortDetectedAt = undefined
        cancelCountdown(sessionID)
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        cleanup(sessionInfo.id)
        log(`[${HOOK_NAME}] Session deleted: cleaned up`, { sessionID: sessionInfo.id })
      }
      return
    }
  }

  return {
    handler,
    markRecovering,
    markRecoveryComplete,
  }
}
