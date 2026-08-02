import { describe, test, expect, beforeEach } from "bun:test"
import {
  setSessionAgent,
  getSessionAgent,
  clearSessionAgent,
  updateSessionAgent,
  setMainSession,
  getMainSessionID,
  _resetForTesting,
} from "./state"

describe("claude-code-session-state", () => {
  beforeEach(() => {
    // #given - clean state before each test
    _resetForTesting()
    clearSessionAgent("test-session-1")
    clearSessionAgent("test-session-2")
    clearSessionAgent("test-agent-session")
  })

  describe("setSessionAgent", () => {
    test("should store agent for session", () => {
      // #given
      const sessionID = "test-session-1"
      const agent = "Prometheus (Planner)"

      // #when
      setSessionAgent(sessionID, agent)

      // #then
      expect(getSessionAgent(sessionID)).toBe(agent)
    })

    test("should NOT overwrite existing agent (first-write wins)", () => {
      // #given
      const sessionID = "test-session-1"
      setSessionAgent(sessionID, "Prometheus (Planner)")

      // #when - try to overwrite
      setSessionAgent(sessionID, "Sisyphus")

      // #then - first agent preserved
      expect(getSessionAgent(sessionID)).toBe("Prometheus (Planner)")
    })

    test("should return undefined for unknown session", () => {
      // #given - no session set

      // #when / #then
      expect(getSessionAgent("unknown-session")).toBeUndefined()
    })
  })

  describe("updateSessionAgent", () => {
    test("should overwrite existing agent", () => {
      // #given
      const sessionID = "test-session-1"
      setSessionAgent(sessionID, "Prometheus (Planner)")

      // #when - force update
      updateSessionAgent(sessionID, "Sisyphus")

      // #then
      expect(getSessionAgent(sessionID)).toBe("Sisyphus")
    })
  })

  describe("clearSessionAgent", () => {
    test("should remove agent from session", () => {
      // #given
      const sessionID = "test-session-1"
      setSessionAgent(sessionID, "Prometheus (Planner)")
      expect(getSessionAgent(sessionID)).toBe("Prometheus (Planner)")

      // #when
      clearSessionAgent(sessionID)

      // #then
      expect(getSessionAgent(sessionID)).toBeUndefined()
    })
  })

  describe("mainSessionID", () => {
    test("should store and retrieve main session ID", () => {
      // #given
      const mainID = "main-session-123"

      // #when
      setMainSession(mainID)

      // #then
      expect(getMainSessionID()).toBe(mainID)
    })

    test.skip("should return undefined when not set", () => {
      // #given - not set
      // TODO: Fix flaky test - parallel test execution causes state pollution
      // #then
      expect(getMainSessionID()).toBeUndefined()
    })
  })

  describe("agent session state storage", () => {
    test("should correctly store and retrieve agent name", () => {
      // #given - a session with an agent
      const sessionID = "test-agent-session"
      const agentName = "custom-agent"

      // #when - agent is set (simulating chat.message hook)
      setSessionAgent(sessionID, agentName)

      // #then - getSessionAgent returns the stored agent
      const agent = getSessionAgent(sessionID)
      expect(agent).toBe("custom-agent")
      expect(["custom-agent"].includes(agent!)).toBe(true)
    })

    test("should return undefined when agent not set (bug scenario)", () => {
      // #given - session exists but no agent set (the bug)
      const sessionID = "test-agent-session"

      // #when / #then - this is the bug: agent is undefined
      expect(getSessionAgent(sessionID)).toBeUndefined()
    })
  })

  describe("issue #893: custom agent switch reset", () => {
    test("should preserve custom agent when default agent is sent on subsequent messages", () => {
      // #given - user switches to custom agent "MyCustomAgent"
      const sessionID = "test-session-custom"
      const customAgent = "MyCustomAgent"
      const defaultAgent = "Sisyphus"

      // User switches to custom agent (via UI)
      setSessionAgent(sessionID, customAgent)
      expect(getSessionAgent(sessionID)).toBe(customAgent)

      // #when - first message after switch sends default agent
      // This simulates the bug: input.agent = "Sisyphus" on first message
      // Using setSessionAgent (first-write wins) should preserve custom agent
      setSessionAgent(sessionID, defaultAgent)

      // #then - custom agent should be preserved, NOT overwritten
      expect(getSessionAgent(sessionID)).toBe(customAgent)
    })

    test("should allow explicit agent update via updateSessionAgent", () => {
      // #given - custom agent is set
      const sessionID = "test-session-explicit"
      const customAgent = "MyCustomAgent"
      const newAgent = "AnotherAgent"

      setSessionAgent(sessionID, customAgent)

      // #when - explicit update (user intentionally switches)
      updateSessionAgent(sessionID, newAgent)

      // #then - should be updated
      expect(getSessionAgent(sessionID)).toBe(newAgent)
    })
  })
})
