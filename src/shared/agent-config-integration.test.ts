import { describe, test, expect } from "bun:test"
import { migrateAgentNames } from "./migration"
import { getAgentDisplayName } from "./agent-display-names"
import { AGENT_MODEL_REQUIREMENTS } from "./model-requirements"

describe("Agent Config Integration", () => {
  describe("Old format config migration", () => {
    test("migrates old format agent keys to lowercase", () => {
      // #given - config with old format keys
      const oldConfig = {
        Sisyphus: { model: "anthropic/claude-opus-4-5" },
        "Sisyphus-Junior": { model: "anthropic/claude-sonnet-4-5" },
      }

      // #when - migration is applied
      const result = migrateAgentNames(oldConfig)

      // #then - keys are lowercase
      expect(result.migrated).toHaveProperty("sisyphus")
      expect(result.migrated).toHaveProperty("sisyphus-junior")

      // #then - old keys are removed
      expect(result.migrated).not.toHaveProperty("Sisyphus")
      expect(result.migrated).not.toHaveProperty("Sisyphus-Junior")

      // #then - values are preserved
      expect(result.migrated.sisyphus).toEqual({ model: "anthropic/claude-opus-4-5" })

      // #then - changed flag is true
      expect(result.changed).toBe(true)
    })

    test("preserves already lowercase keys", () => {
      // #given - config with lowercase keys
      const config = {
        sisyphus: { model: "anthropic/claude-opus-4-5" },
        oracle: { model: "openai/gpt-5.2" },
        explore: { model: "opencode/gpt-5-nano" },
      }

      // #when - migration is applied
      const result = migrateAgentNames(config)

      // #then - keys remain unchanged
      expect(result.migrated).toEqual(config)

      // #then - changed flag is false
      expect(result.changed).toBe(false)
    })

    test("handles mixed case config", () => {
      // #given - config with mixed old and new format
      const mixedConfig = {
        Sisyphus: { model: "anthropic/claude-opus-4-5" },
        oracle: { model: "openai/gpt-5.2" },
        "Sisyphus-Junior": { model: "anthropic/claude-sonnet-4-5" },
      }

      // #when - migration is applied
      const result = migrateAgentNames(mixedConfig)

      // #then - all keys are lowercase
      expect(result.migrated).toHaveProperty("sisyphus")
      expect(result.migrated).toHaveProperty("oracle")
      expect(result.migrated).toHaveProperty("sisyphus-junior")
      expect(Object.keys(result.migrated).every((key) => key === key.toLowerCase())).toBe(true)

      // #then - changed flag is true
      expect(result.changed).toBe(true)
    })
  })

  describe("Display name resolution", () => {
    test("returns correct display names for all builtin agents", () => {
      // #given - lowercase config keys
      const agents = ["sisyphus", "sisyphus-junior", "oracle", "explore"]

      // #when - display names are requested
      const displayNames = agents.map((agent) => getAgentDisplayName(agent))

      // #then - display names are correct
      expect(displayNames).toContain("Sisyphus (Ultraworker)")
      expect(displayNames).toContain("Sisyphus-Junior")
      expect(displayNames).toContain("oracle")
      expect(displayNames).toContain("explore")
    })

    test("handles lowercase keys case-insensitively", () => {
      // #given - various case formats of lowercase keys
      const keys = ["Sisyphus", "SISYPHUS", "sisyphus", "Oracle", "ORACLE"]

      // #when - display names are requested
      const displayNames = keys.map((key) => getAgentDisplayName(key))

      // #then - correct display names are returned
      expect(displayNames[0]).toBe("Sisyphus (Ultraworker)")
      expect(displayNames[1]).toBe("Sisyphus (Ultraworker)")
      expect(displayNames[2]).toBe("Sisyphus (Ultraworker)")
      expect(displayNames[3]).toBe("oracle")
      expect(displayNames[4]).toBe("oracle")
    })

    test("returns original key for unknown agents", () => {
      // #given - unknown agent key
      const unknownKey = "custom-agent"

      // #when - display name is requested
      const displayName = getAgentDisplayName(unknownKey)

      // #then - original key is returned
      expect(displayName).toBe(unknownKey)
    })
  })

  describe("Model requirements integration", () => {
    test("all model requirements use lowercase keys", () => {
      // #given - AGENT_MODEL_REQUIREMENTS object
      const agentKeys = Object.keys(AGENT_MODEL_REQUIREMENTS)

      // #when - checking key format
      const allLowercase = agentKeys.every((key) => key === key.toLowerCase())

      // #then - all keys are lowercase
      expect(allLowercase).toBe(true)
    })

    test("model requirements include all builtin agents", () => {
      // #given - expected builtin agents
      const expectedAgents = ["sisyphus", "oracle", "explore"]

      // #when - checking AGENT_MODEL_REQUIREMENTS
      const agentKeys = Object.keys(AGENT_MODEL_REQUIREMENTS)

      // #then - all expected agents are present
      for (const agent of expectedAgents) {
        expect(agentKeys).toContain(agent)
      }
    })

    test("no uppercase keys in model requirements", () => {
      // #given - AGENT_MODEL_REQUIREMENTS object
      const agentKeys = Object.keys(AGENT_MODEL_REQUIREMENTS)

      // #when - checking for uppercase keys
      const uppercaseKeys = agentKeys.filter((key) => key !== key.toLowerCase())

      // #then - no uppercase keys exist
      expect(uppercaseKeys).toEqual([])
    })
  })

  describe("End-to-end config flow", () => {
    test("old config migrates and displays correctly", () => {
      // #given - old format config
      const oldConfig = {
        Sisyphus: { model: "anthropic/claude-opus-4-5", temperature: 0.1 },
        "Sisyphus-Junior": { model: "anthropic/claude-sonnet-4-5" },
      }

      // #when - config is migrated
      const result = migrateAgentNames(oldConfig)

      // #then - keys are lowercase
      expect(result.migrated).toHaveProperty("sisyphus")
      expect(result.migrated).toHaveProperty("sisyphus-junior")

      // #when - display names are retrieved
      const sisyphusDisplay = getAgentDisplayName("sisyphus")
      const juniorDisplay = getAgentDisplayName("sisyphus-junior")

      // #then - display names are correct
      expect(sisyphusDisplay).toBe("Sisyphus (Ultraworker)")
      expect(juniorDisplay).toBe("Sisyphus-Junior")

      // #then - config values are preserved
      expect(result.migrated.sisyphus).toEqual({ model: "anthropic/claude-opus-4-5", temperature: 0.1 })
      expect(result.migrated["sisyphus-junior"]).toEqual({ model: "anthropic/claude-sonnet-4-5" })
    })

    test("new config works without migration", () => {
      // #given - new format config (already lowercase)
      const newConfig = {
        sisyphus: { model: "anthropic/claude-opus-4-5" },
        oracle: { model: "openai/gpt-5.2" },
      }

      // #when - migration is applied (should be no-op)
      const result = migrateAgentNames(newConfig)

      // #then - config is unchanged
      expect(result.migrated).toEqual(newConfig)

      // #then - changed flag is false
      expect(result.changed).toBe(false)

      // #when - display names are retrieved
      const sisyphusDisplay = getAgentDisplayName("sisyphus")
      const oracleDisplay = getAgentDisplayName("oracle")

      // #then - display names are correct
      expect(sisyphusDisplay).toBe("Sisyphus (Ultraworker)")
      expect(oracleDisplay).toBe("oracle")
    })
  })
})
