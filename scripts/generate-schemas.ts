import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateJsonSchemas } from "../src/schema.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaDirectory = resolve(projectRoot, "schemas");
const schemas = generateJsonSchemas();
const documents = new Map([
  ["state-snapshot.schema.json", schemas.stateSnapshot],
  ["run-event.schema.json", schemas.runEvent],
]);
const checkOnly = process.argv.includes("--check");

await mkdir(schemaDirectory, { recursive: true });
for (const [filename, schema] of documents) {
  const path = resolve(schemaDirectory, filename);
  const expected = `${JSON.stringify(schema, null, 2)}\n`;
  if (checkOnly) {
    let actual: string;
    try {
      actual = await readFile(path, "utf8");
    } catch {
      actual = "";
    }
    if (actual !== expected) {
      console.error(`Generated schema is out of date: schemas/${filename}`);
      process.exitCode = 1;
    }
  } else {
    await writeFile(path, expected);
  }
}
