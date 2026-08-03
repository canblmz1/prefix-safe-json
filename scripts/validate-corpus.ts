// ---------------------------------------------------------------------------
// Corpus Validator
// ---------------------------------------------------------------------------
// Validates all fixture JSON files against the expected schema.
// Uses only Node.js built-in APIs.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CORPUS_DIR = join(__dirname, "..", "corpus");
const SCHEMA_FILE = join(CORPUS_DIR, "schema", "fixture.schema.json");

const DIRS = ["canonical", "malformed", "unicode", "truncation", "fuzz", "provider-envelopes"];

function validateFixture(validate: { (d: unknown): boolean; errors?: { instancePath: string; message?: string }[] | null }, data: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const valid = validate(data);
  
  if (!valid && validate.errors) {
    for (const err of validate.errors) {
      errors.push(`${err.instancePath} ${err.message}`);
    }
  }

  // Also check if id matches filename (roughly) if needed, but for now just Ajv
  return errors;
}

let hasErrors = false;
let totalFiles = 0;
let passedFiles = 0;

  if (!existsSync(SCHEMA_FILE)) {
    console.error(`❌ Schema file not found: ${SCHEMA_FILE}`);
    process.exit(1);
  }

  const schemaContent = readFileSync(SCHEMA_FILE, "utf8");
  const schema = JSON.parse(schemaContent);
  // @ts-expect-error TS2351 - Ajv construct signature mismatch with ESM
  const ajv = new Ajv({ strict: false });
  const validate = ajv.compile(schema);

  for (const dir of DIRS) {
    const dirPath = join(CORPUS_DIR, dir);
    if (!existsSync(dirPath)) continue;

    const files = readdirSync(dirPath).filter((f: string) => f.endsWith(".json"));
    for (const file of files) {
      totalFiles++;
      const filePath = join(dirPath, file);
      try {
        const content = readFileSync(filePath, "utf8");
        const data = JSON.parse(content) as Record<string, unknown>;
        const errors = validateFixture(validate, data);

      if (errors.length > 0) {
        console.error(`❌ ${file}:`);
        errors.forEach((e) => console.error(`   - ${e}`));
        hasErrors = true;
      } else {
        passedFiles++;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`❌ Failed to parse ${file}: ${msg}`);
      hasErrors = true;
    }
  }
}

console.log(`\nValidated ${totalFiles} fixtures: ${passedFiles} passed, ${totalFiles - passedFiles} failed.`);

if (hasErrors) {
  process.exit(1);
} else {
  console.log("✅ All fixtures valid.");
}
