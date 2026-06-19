#!/usr/bin/env bun
import * as z from "zod"
import { OhMyOpenCodeConfigSchema } from "../src/config/schema"

const SCHEMA_OUTPUT_PATH = "assets/omo-stable.schema.json"

async function main() {
  console.log("Generating JSON Schema...")

  const jsonSchema = z.toJSONSchema(OhMyOpenCodeConfigSchema, {
    io: "input",
    target: "draft-7",
  })

  const finalSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/omo-stable.schema.json",
    title: "Omo Stable Configuration",
    description: "Configuration schema for omo-stable plugin",
    ...jsonSchema,
  }

  await Bun.write(SCHEMA_OUTPUT_PATH, JSON.stringify(finalSchema, null, 2))

  console.log(`✓ JSON Schema generated: ${SCHEMA_OUTPUT_PATH}`)
}

main()
