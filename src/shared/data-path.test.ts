import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { getDataDir, getOpenCodeStorageDir } from "./data-path"

describe("data-path", () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = {
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      OPENCODE_STORAGE_DIR: process.env.OPENCODE_STORAGE_DIR,
    }
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
    }
  })

  describe("getDataDir", () => {
    test("returns XDG_DATA_HOME when set", () => {
      // #given XDG_DATA_HOME is set
      process.env.XDG_DATA_HOME = "/custom/data"

      // #when getDataDir is called
      const result = getDataDir()

      // #then returns XDG_DATA_HOME as-is
      expect(result).toBe("/custom/data")
    })

    test("falls back to ~/.local/share when XDG_DATA_HOME is not set", () => {
      // #given XDG_DATA_HOME is not set
      delete process.env.XDG_DATA_HOME

      // #when getDataDir is called
      const result = getDataDir()

      // #then returns ~/.local/share
      expect(result).toBe(join(homedir(), ".local", "share"))
    })
  })

  describe("getOpenCodeStorageDir", () => {
    test("returns default <dataDir>/opencode/storage when env var is not set", () => {
      // #given OPENCODE_STORAGE_DIR is not set and XDG_DATA_HOME is not set
      delete process.env.OPENCODE_STORAGE_DIR
      delete process.env.XDG_DATA_HOME

      // #when getOpenCodeStorageDir is called
      const result = getOpenCodeStorageDir()

      // #then returns ~/.local/share/opencode/storage
      expect(result).toBe(join(homedir(), ".local", "share", "opencode", "storage"))
    })

    test("follows XDG_DATA_HOME when OPENCODE_STORAGE_DIR is not set", () => {
      // #given only XDG_DATA_HOME is set
      delete process.env.OPENCODE_STORAGE_DIR
      process.env.XDG_DATA_HOME = "/xdg/data"

      // #when getOpenCodeStorageDir is called
      const result = getOpenCodeStorageDir()

      // #then returns $XDG_DATA_HOME/opencode/storage
      expect(result).toBe("/xdg/data/opencode/storage")
    })

    test("returns OPENCODE_STORAGE_DIR when env var is set", () => {
      // #given OPENCODE_STORAGE_DIR is set to a custom path
      process.env.OPENCODE_STORAGE_DIR = "/custom/opencode/storage"
      delete process.env.XDG_DATA_HOME

      // #when getOpenCodeStorageDir is called
      const result = getOpenCodeStorageDir()

      // #then returns the custom path
      expect(result).toBe("/custom/opencode/storage")
    })

    test("falls back to default when env var is empty string", () => {
      // #given OPENCODE_STORAGE_DIR is set to empty string
      process.env.OPENCODE_STORAGE_DIR = ""
      delete process.env.XDG_DATA_HOME

      // #when getOpenCodeStorageDir is called
      const result = getOpenCodeStorageDir()

      // #then returns default ~/.local/share/opencode/storage
      expect(result).toBe(join(homedir(), ".local", "share", "opencode", "storage"))
    })

    test("falls back to default when env var is whitespace only", () => {
      // #given OPENCODE_STORAGE_DIR is set to whitespace only
      process.env.OPENCODE_STORAGE_DIR = "   "
      delete process.env.XDG_DATA_HOME

      // #when getOpenCodeStorageDir is called
      const result = getOpenCodeStorageDir()

      // #then returns default ~/.local/share/opencode/storage
      expect(result).toBe(join(homedir(), ".local", "share", "opencode", "storage"))
    })

    test("trims surrounding whitespace from env var value", () => {
      // #given OPENCODE_STORAGE_DIR has surrounding whitespace
      process.env.OPENCODE_STORAGE_DIR = "  /custom/opencode/storage  "
      delete process.env.XDG_DATA_HOME

      // #when getOpenCodeStorageDir is called
      const result = getOpenCodeStorageDir()

      // #then returns trimmed path
      expect(result).toBe("/custom/opencode/storage")
    })

    test("resolves relative path to absolute path", () => {
      // #given OPENCODE_STORAGE_DIR is set to a relative path
      process.env.OPENCODE_STORAGE_DIR = "./my-opencode-storage"

      // #when getOpenCodeStorageDir is called
      const result = getOpenCodeStorageDir()

      // #then returns resolved absolute path
      expect(result).toBe(resolve("./my-opencode-storage"))
    })

    test("OPENCODE_STORAGE_DIR takes priority over XDG_DATA_HOME", () => {
      // #given both OPENCODE_STORAGE_DIR and XDG_DATA_HOME are set
      process.env.OPENCODE_STORAGE_DIR = "/custom/opencode/storage"
      process.env.XDG_DATA_HOME = "/xdg/data"

      // #when getOpenCodeStorageDir is called
      const result = getOpenCodeStorageDir()

      // #then OPENCODE_STORAGE_DIR takes priority
      expect(result).toBe("/custom/opencode/storage")
    })
  })
})
