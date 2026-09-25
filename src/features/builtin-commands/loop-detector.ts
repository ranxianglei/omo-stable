import {
  CANCEL_RALPH_MARKER,
  RALPH_LOOP_START_MARKER,
  ULW_LOOP_START_MARKER,
} from "./templates/ralph-loop";

export type LoopDetection =
  | {
      kind: "ulw-loop";
      prompt: string;
      maxIterations?: number;
      completionPromise?: string;
    }
  | {
      kind: "ralph-loop";
      prompt: string;
      maxIterations?: number;
      completionPromise?: string;
    }
  | { kind: "cancel-ralph" }
  | null;

const USER_TASK_RE = /<user-task>\s*([\s\S]*?)\s*<\/user-task>/i;
const QUOTED_TASK_RE = /^["'](.+?)["']/;
const MAX_ITERATIONS_RE = /--max-iterations=(\d+)/i;
const COMPLETION_PROMISE_RE = /--completion-promise=["']?([^"'\s]+)["']?/i;

function extractUserTask(promptText: string): string {
  const taskMatch = promptText.match(USER_TASK_RE);
  return taskMatch?.[1]?.trim() || "";
}

function parseTask(rawTaskInput: string): {
  prompt: string;
  maxIterations?: number;
  completionPromise?: string;
} {
  const rawTask = rawTaskInput.trim();
  const quotedMatch = rawTask.match(QUOTED_TASK_RE);
  const prompt =
    quotedMatch?.[1] ||
    rawTask.split(/\s+--/)[0]?.trim() ||
    "Complete the task as instructed";
  const maxIterMatch = rawTask.match(MAX_ITERATIONS_RE);
  const promiseMatch = rawTask.match(COMPLETION_PROMISE_RE);
  return {
    prompt,
    maxIterations: maxIterMatch ? parseInt(maxIterMatch[1], 10) : undefined,
    completionPromise: promiseMatch?.[1],
  };
}

export function detectLoopCommand(promptText: string): LoopDetection {
  // Ultrawork is matched before the generic ralph marker: both templates share a body
  // (the ulw text still contains "How Ralph Loop Works"), so only the start marker
  // distinguishes them. Matching ralph first would swallow /ulw-loop again (#17).
  if (
    promptText.includes(ULW_LOOP_START_MARKER) &&
    promptText.includes("<user-task>")
  ) {
    return { kind: "ulw-loop", ...parseTask(extractUserTask(promptText)) };
  }
  if (
    promptText.includes(RALPH_LOOP_START_MARKER) &&
    promptText.includes("<user-task>")
  ) {
    return { kind: "ralph-loop", ...parseTask(extractUserTask(promptText)) };
  }
  if (promptText.includes(CANCEL_RALPH_MARKER)) {
    return { kind: "cancel-ralph" };
  }
  return null;
}
