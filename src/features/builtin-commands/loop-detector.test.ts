import { describe, expect, test } from "bun:test";
import { detectLoopCommand } from "./loop-detector";
import { loadBuiltinCommands } from "./commands";
import {
  CANCEL_RALPH_TEMPLATE,
  RALPH_LOOP_TEMPLATE,
  ULW_LOOP_TEMPLATE,
} from "./templates/ralph-loop";

// Mirrors commands.ts wrapping; opencode substitutes $ARGUMENTS, so detection runs on fully-expanded text.
function expand(template: string, args: string): string {
  return `<command-instruction>\n${template}\n</command-instruction>\n\n<user-task>\n${args}\n</user-task>`;
}

function expandCancel(): string {
  return `<command-instruction>\n${CANCEL_RALPH_TEMPLATE}\n</command-instruction>`;
}

describe("detectLoopCommand", () => {
  test("#given ulw-loop expanded text #when detected #then kind is ulw-loop with parsed prompt", () => {
    const result = detectLoopCommand(expand(ULW_LOOP_TEMPLATE, '"ship it"'));
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("ulw-loop");
    if (result && result.kind === "ulw-loop") {
      expect(result.prompt).toBe("ship it");
      expect(result.maxIterations).toBeUndefined();
      expect(result.completionPromise).toBeUndefined();
    }
  });

  test("#given ralph-loop expanded text #when detected #then kind is ralph-loop", () => {
    const result = detectLoopCommand(expand(RALPH_LOOP_TEMPLATE, '"build api"'));
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("ralph-loop");
    if (result && result.kind === "ralph-loop") {
      expect(result.prompt).toBe("build api");
    }
  });

  test("#given unquoted task with flags #when parsed #then prompt stripped and flags captured", () => {
    const result = detectLoopCommand(
      expand(ULW_LOOP_TEMPLATE, 'do the thing --max-iterations=5 --completion-promise=DONE')
    );
    expect(result?.kind).toBe("ulw-loop");
    if (result && result.kind === "ulw-loop") {
      expect(result.prompt).toBe("do the thing");
      expect(result.maxIterations).toBe(5);
      expect(result.completionPromise).toBe("DONE");
    }
  });

  test("#given quoted task with flags #when parsed #then quoted prompt kept and flags captured", () => {
    const result = detectLoopCommand(
      expand(RALPH_LOOP_TEMPLATE, '"fix the bug" --max-iterations=3')
    );
    expect(result?.kind).toBe("ralph-loop");
    if (result && result.kind === "ralph-loop") {
      expect(result.prompt).toBe("fix the bug");
      expect(result.maxIterations).toBe(3);
    }
  });

  test("#given empty args #when parsed #then falls back to default prompt", () => {
    const result = detectLoopCommand(expand(RALPH_LOOP_TEMPLATE, ""));
    expect(result?.kind).toBe("ralph-loop");
    if (result && result.kind === "ralph-loop") {
      expect(result.prompt).toBe("Complete the task as instructed");
    }
  });

  test("#given cancel-ralph expanded text #when detected #then kind is cancel-ralph", () => {
    const result = detectLoopCommand(expandCancel());
    expect(result?.kind).toBe("cancel-ralph");
  });

  test("#given plain user text #when detected #then null", () => {
    expect(detectLoopCommand("hello world, please help me")).toBeNull();
  });

  // THE REGRESSION GUARD (#17): the two loops share a body, so detection must
  // rely on the distinct START marker alone. An ultrawork expansion must never
  // be misread as a plain ralph loop (that is what silently dropped ultrawork mode).
  test("#given ulw expansion #when detected #then it is NOT a ralph loop", () => {
    const result = detectLoopCommand(expand(ULW_LOOP_TEMPLATE, '"task"'));
    expect(result?.kind).toBe("ulw-loop");
    expect(result?.kind).not.toBe("ralph-loop");
  });

  test("#given ralph expansion #when detected #then it is NOT an ultrawork loop", () => {
    const result = detectLoopCommand(expand(RALPH_LOOP_TEMPLATE, '"task"'));
    expect(result?.kind).toBe("ralph-loop");
    expect(result?.kind).not.toBe("ulw-loop");
  });

  // End-to-end: feed the ACTUAL builtin command definitions through the detector.
  // This is the exact path opencode takes when a user runs /ulw-loop or /ralph-loop,
  // so it catches any drift between the command templates and the detector.
  test("end-to-end: loadBuiltinCommands templates route to the correct loop kind", () => {
    const cmds = loadBuiltinCommands();
    const ulwText = (cmds["ulw-loop"].template as string).replace("$ARGUMENTS", '"ship it"');
    const ralphText = (cmds["ralph-loop"].template as string).replace("$ARGUMENTS", '"ship it"');

    const ulwResult = detectLoopCommand(ulwText);
    const ralphResult = detectLoopCommand(ralphText);

    expect(ulwResult?.kind).toBe("ulw-loop");
    expect(ralphResult?.kind).toBe("ralph-loop");
    expect(ulwText).not.toBe(ralphText);
  });
});
