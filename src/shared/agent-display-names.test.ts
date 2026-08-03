import { describe, it, expect } from "bun:test"
import { AGENT_DISPLAY_NAMES, getAgentDisplayName } from "./agent-display-names"

describe("getAgentDisplayName", () => {
  it("returns display name for lowercase config key (new format)", () => {
    // #given config key "sisyphus"
    const configKey = "sisyphus"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "Sisyphus (Ultraworker)"
    expect(result).toBe("Sisyphus (Ultraworker)")
  })

  it("returns display name for uppercase config key (old format - case-insensitive)", () => {
    // #given config key "Sisyphus" (old format)
    const configKey = "Sisyphus"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "Sisyphus (Ultraworker)" (case-insensitive lookup)
    expect(result).toBe("Sisyphus (Ultraworker)")
  })

  it("returns original key for unknown agents (fallback)", () => {
    // #given config key "custom-agent"
    const configKey = "custom-agent"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "custom-agent" (original key unchanged)
    expect(result).toBe("custom-agent")
  })

  it("returns display name for sisyphus-junior", () => {
    // #given config key "sisyphus-junior"
    const configKey = "sisyphus-junior"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "Sisyphus-Junior"
    expect(result).toBe("Sisyphus-Junior")
  })

  it("returns display name for oracle", () => {
    // #given config key "oracle"
    const configKey = "oracle"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "oracle"
    expect(result).toBe("oracle")
  })

  it("returns display name for explore", () => {
    // #given config key "explore"
    const configKey = "explore"

    // #when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // #then returns "explore"
    expect(result).toBe("explore")
  })
})

describe("AGENT_DISPLAY_NAMES", () => {
  it("contains all expected agent mappings", () => {
    // #given expected mappings
    const expectedMappings = {
      sisyphus: "Sisyphus (Ultraworker)",
      "sisyphus-junior": "Sisyphus-Junior",
      oracle: "oracle",
      explore: "explore",
    }

    // #when checking the constant
    // #then contains all expected mappings
    expect(AGENT_DISPLAY_NAMES).toEqual(expectedMappings)
  })
})
