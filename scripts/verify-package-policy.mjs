import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const EXPECTED_FILES = ["LICENSE", "LICENSE-APACHE", "LICENSE-MIT", "README.md", "dist"];
const EXPECTED_RUNTIME_DEPENDENCIES = { ajv: "^8.20.0" };
const INSTALL_LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];
const ALLOWED_ROOT_FILES = new Set([
  "LICENSE",
  "LICENSE-APACHE",
  "LICENSE-MIT",
  "README.md",
  "package.json",
]);

function fail(message) {
  throw new Error(`package policy violation: ${message}`);
}

function command(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function archiveEntries(tarball) {
  const output = execFileSync(command("tar"), ["-tzf", tarball], { encoding: "utf8" });
  return output.split(/\r?\n/u).filter(Boolean);
}

function assertArchiveModes(tarball) {
  const output = execFileSync(command("tar"), ["-tvzf", tarball], { encoding: "utf8" });
  for (const line of output.split(/\r?\n/u).filter(Boolean)) {
    const mode = line.trimStart().split(/\s+/u)[0];
    if (!/^[dl-][rwx-]{9}$/u.test(mode)) fail(`could not parse archive mode: ${line}`);
    if (mode.startsWith("l")) fail(`symbolic-link archive member is not allowed: ${line}`);
    if (mode.startsWith("-") && mode.slice(1).includes("x")) {
      fail(`executable archive member is not allowed: ${line}`);
    }
  }
}

function assertSafeArchiveEntries(entries) {
  for (const entry of entries) {
    const normalized = entry.replaceAll("\\", "/");
    if (
      !normalized.startsWith("package/") ||
      normalized.startsWith("/") ||
      /^[A-Za-z]:\//u.test(normalized) ||
      normalized.split("/").includes("..")
    ) {
      fail(`unsafe archive path ${JSON.stringify(entry)}`);
    }
  }
}

function walk(root, current = root) {
  const rows = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    const path = relative(root, absolute).split(sep).join("/");
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) fail(`symbolic link is not allowed: ${path}`);
    if (stat.isDirectory()) rows.push(...walk(root, absolute));
    else if (stat.isFile()) rows.push({ path, size: stat.size });
    else fail(`non-regular archive entry is not allowed: ${path}`);
  }
  return rows;
}

function assertObjectEquals(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} changed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function verifyPackagePolicy(tarballPath) {
  const tarball = resolve(tarballPath);
  const entries = archiveEntries(tarball);
  assertSafeArchiveEntries(entries);
  assertArchiveModes(tarball);

  const auditRoot = mkdtempSync(join(tmpdir(), "prefix-safe-json-package-policy-"));
  execFileSync(command("tar"), ["-xzf", tarball, "-C", auditRoot]);
  const packageRoot = join(auditRoot, "package");
  const files = walk(packageRoot).sort((a, b) => a.path.localeCompare(b.path));

  for (const file of files) {
    const parts = file.path.split("/");
    if (parts.some((part) => part.startsWith("."))) fail(`hidden path is not allowed: ${file.path}`);
    if (ALLOWED_ROOT_FILES.has(file.path)) continue;
    if (!/^dist\/.+\.(?:js|d\.ts)(?:\.map)?$/u.test(file.path)) {
      fail(`unexpected shipped file: ${file.path}`);
    }
    const bytes = readFileSync(join(packageRoot, ...parts));
    if (bytes.includes(0)) fail(`NUL byte suggests unexpected binary content: ${file.path}`);
  }

  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  assertObjectEquals(
    [...(manifest.files ?? [])].sort(),
    [...EXPECTED_FILES].sort(),
    "package files whitelist",
  );
  assertObjectEquals(manifest.dependencies, EXPECTED_RUNTIME_DEPENDENCIES, "runtime dependency whitelist");

  for (const field of ["optionalDependencies", "peerDependencies", "bundledDependencies", "bundleDependencies", "bin"]) {
    const value = manifest[field];
    if (value !== undefined && value !== null && Object.keys(value).length !== 0) {
      fail(`${field} must remain absent or empty`);
    }
  }
  for (const script of INSTALL_LIFECYCLE_SCRIPTS) {
    if (manifest.scripts?.[script] !== undefined) fail(`consumer lifecycle script ${script} is present`);
  }
  if (manifest.type !== "module") fail(`package type must remain "module"`);
  if (manifest.sideEffects !== false) fail(`sideEffects must remain false`);
  assertObjectEquals(
    manifest.exports,
    { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    "public entrypoint policy",
  );

  const result = {
    result: "PASS",
    tarball: basename(tarball),
    fileCount: files.length,
    unpackedBytes: files.reduce((sum, file) => sum + file.size, 0),
    runtimeDependencies: manifest.dependencies,
    installLifecycleScripts: INSTALL_LIFECYCLE_SCRIPTS.filter((name) => manifest.scripts?.[name]),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const tarball = process.argv.slice(2).find((argument) => argument !== "--");
  if (!tarball) {
    process.stderr.write("Usage: node scripts/verify-package-policy.mjs <package.tgz>\n");
    process.exitCode = 2;
  } else {
    try {
      verifyPackagePolicy(tarball);
    } catch (error) {
      process.stderr.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
