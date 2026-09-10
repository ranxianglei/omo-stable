import { describe, expect, test } from "bun:test";
import { loadBuiltinCommands } from "./commands";

describe("loadBuiltinCommands - ralph vs ultrawork distinguishability (#17)", () => {
  test("#given builtin commands #when loaded #then ulw-loop and ralph-loop templates differ", () => {
    const cmds = loadBuiltinCommands();
    expect(cmds["ulw-loop"].template).not.toBe(cmds["ralph-loop"].template);
  });

  test("#given ulw-loop #when loaded #then carries ultrawork start marker and not the ralph one", () => {
    const cmds = loadBuiltinCommands();
    expect(cmds["ulw-loop"].template).toContain("You are starting an Ultrawork Loop");
    expect(cmds["ulw-loop"].template).not.toContain("You are starting a Ralph Loop");
    expect(cmds["ulw-loop"].template).toContain("<user-task>");
  });

  test("#given ralph-loop #when loaded #then keeps original ralph start marker and not the ulw one", () => {
    const cmds = loadBuiltinCommands();
    expect(cmds["ralph-loop"].template).toContain("You are starting a Ralph Loop");
    expect(cmds["ralph-loop"].template).not.toContain("You are starting an Ultrawork Loop");
  });

  test("#given disabled_commands #when ulw-loop disabled #then it is omitted but ralph remains", () => {
    const cmds = loadBuiltinCommands(["ulw-loop"]);
    expect(cmds["ulw-loop"]).toBeUndefined();
    expect(cmds["ralph-loop"]).toBeDefined();
  });
});
