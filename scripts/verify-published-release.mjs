import { createHash, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { execFileSync, spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "prefix-safe-json";
const REGISTRY_ORIGIN = "https://registry.npmjs.org";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  throw new Error(message);
}

function executable(name) {
  if (process.platform !== "win32") return name;
  return name === "npx" || name === "corepack" ? `${name}.cmd` : `${name}.exe`;
}

function capture(name, args, options = {}) {
  return execFileSync(executable(name), args, { encoding: "utf8", ...options }).trim();
}

function run(name, args, options = {}) {
  process.stdout.write(`$ ${name} ${args.join(" ")}\n`);
  const needsCommandShell = process.platform === "win32" && (name === "npx" || name === "corepack");
  const result = spawnSync(executable(name), args, {
    stdio: "inherit",
    shell: needsCommandShell,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${name} exited with status ${result.status}`);
}

async function fetchJson(url) {
  const response = await globalThis.fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) fail(`GET ${url} failed: ${response.status} ${response.statusText}`);
  return response.json();
}

async function download(url, destination) {
  const parsed = new URL(url);
  if (parsed.origin !== REGISTRY_ORIGIN) fail(`refusing non-registry tarball URL: ${url}`);
  const response = await globalThis.fetch(parsed);
  if (!response.ok) fail(`GET ${url} failed: ${response.status} ${response.statusText}`);
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

function digest(buffer, algorithm, encoding = "hex") {
  return createHash(algorithm).update(buffer).digest(encoding);
}

function verifyIntegrity(buffer, integrity) {
  const match = /^(sha512)-(.+)$/u.exec(integrity ?? "");
  if (!match) fail(`unsupported or missing npm integrity: ${JSON.stringify(integrity)}`);
  const expected = Buffer.from(match[2], "base64");
  const actual = createHash(match[1]).update(buffer).digest();
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    fail("downloaded tarball does not match npm dist.integrity");
  }
}

function listArchive(tarball) {
  const entries = capture("tar", ["-tzf", tarball]).split(/\r?\n/u).filter(Boolean);
  for (const entry of entries) {
    const normalized = entry.replaceAll("\\", "/");
    if (
      !normalized.startsWith("package/") ||
      normalized.startsWith("/") ||
      /^[A-Za-z]:\//u.test(normalized) ||
      normalized.split("/").includes("..")
    ) {
      fail(`unsafe archive path: ${entry}`);
    }
  }
  return entries;
}

function unpack(tarball, destination) {
  listArchive(tarball);
  mkdirSync(destination, { recursive: true });
  run("tar", ["-xzf", tarball, "-C", destination]);
}

function manifest(root, current = root) {
  const rows = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    const path = relative(root, absolute).split(sep).join("/");
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) rows.push(...manifest(root, absolute));
    else if (stat.isSymbolicLink()) rows.push({ path, type: "symlink", target: readlinkSync(absolute) });
    else if (stat.isFile()) {
      const bytes = readFileSync(absolute);
      rows.push({ path, type: "file", size: stat.size, sha256: digest(bytes, "sha256") });
    } else fail(`unsupported unpacked entry type: ${path}`);
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

function compareManifests(published, rebuilt) {
  const publishedByPath = new Map(published.map((row) => [row.path, row]));
  const rebuiltByPath = new Map(rebuilt.map((row) => [row.path, row]));
  const paths = [...new Set([...publishedByPath.keys(), ...rebuiltByPath.keys()])].sort();
  return paths.flatMap((path) => {
    const left = publishedByPath.get(path);
    const right = rebuiltByPath.get(path);
    return JSON.stringify(left) === JSON.stringify(right) ? [] : [{ path, published: left, rebuilt: right }];
  });
}

function decodeProvenance(attestations, tarballSha512, gitHead, version) {
  const attestation = attestations.attestations?.find(
    (entry) => entry.predicateType === "https://slsa.dev/provenance/v1",
  );
  if (!attestation) return { available: false };
  const statement = JSON.parse(
    Buffer.from(attestation.bundle.dsseEnvelope.payload, "base64").toString("utf8"),
  );
  const subject = statement.subject?.find((entry) => entry.name === `pkg:npm/${PACKAGE_NAME}@${version}`);
  if (!subject) fail("provenance has no subject for the requested package version");
  const subjectSha512 = subject?.digest?.sha512;
  const dependency = statement.predicate?.buildDefinition?.resolvedDependencies?.find(
    (entry) => entry.digest?.gitCommit,
  );
  if (subjectSha512 !== tarballSha512) fail("provenance subject SHA-512 does not match tarball");
  if (dependency?.digest?.gitCommit !== gitHead) fail("provenance source commit does not match npm gitHead");
  const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow;
  if (workflow?.repository !== "https://github.com/canblmz1/prefix-safe-json") {
    fail(`unexpected provenance repository: ${workflow?.repository}`);
  }
  if (workflow?.path !== ".github/workflows/publish.yml") {
    fail(`unexpected provenance workflow: ${workflow?.path}`);
  }
  return {
    available: true,
    predicateType: statement.predicateType,
    subject: subject?.name,
    subjectSha512,
    repository: workflow.repository,
    workflow: workflow.path,
    workflowRef: workflow.ref,
    sourceCommit: dependency?.digest?.gitCommit,
    builder: statement.predicate?.runDetails?.builder?.id,
    invocation: statement.predicate?.runDetails?.metadata?.invocationId,
  };
}

function parseArgs(argv) {
  const version = argv.find((argument) => argument !== "--");
  if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    fail("usage: npm run verify:published-release -- <exact-version>");
  }
  return { version };
}

async function main() {
  const { version } = parseArgs(process.argv.slice(2));
  const tag = `v${version}`;
  const currentHead = capture("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  const releaseCommit = capture("git", ["rev-parse", `${tag}^{commit}`], { cwd: repoRoot });
  const metadataUrl = `${REGISTRY_ORIGIN}/${PACKAGE_NAME}/${encodeURIComponent(version)}`;
  const metadata = await fetchJson(metadataUrl);
  if (metadata.name !== PACKAGE_NAME || metadata.version !== version) fail("registry metadata identity mismatch");
  if (!metadata.gitHead) fail("registry metadata has no gitHead");
  if (releaseCommit !== metadata.gitHead) {
    fail(`${tag} resolves to ${releaseCommit}, but npm gitHead is ${metadata.gitHead}`);
  }

  const auditRoot = mkdtempSync(join(tmpdir(), `${PACKAGE_NAME}-${version}-audit-`));
  const publishedTarball = join(auditRoot, `${PACKAGE_NAME}-${version}-published.tgz`);
  await download(metadata.dist.tarball, publishedTarball);
  const publishedBytes = readFileSync(publishedTarball);
  verifyIntegrity(publishedBytes, metadata.dist.integrity);
  const publishedSha1 = digest(publishedBytes, "sha1");
  const publishedSha256 = digest(publishedBytes, "sha256");
  const publishedSha512 = digest(publishedBytes, "sha512");
  if (publishedSha1 !== metadata.dist.shasum) fail("downloaded tarball does not match npm dist.shasum");

  let provenance = { available: false };
  if (metadata.dist.attestations?.url) {
    const attestations = await fetchJson(metadata.dist.attestations.url);
    writeFileSync(join(auditRoot, "attestations.json"), `${JSON.stringify(attestations, null, 2)}\n`);
    provenance = decodeProvenance(attestations, publishedSha512, metadata.gitHead, version);
  }

  const sourceTar = join(auditRoot, "release-source.tar");
  run("git", ["-c", "core.autocrlf=false", "archive", "--format=tar", `--output=${sourceTar}`, releaseCommit], { cwd: repoRoot });
  const sourceRoot = join(auditRoot, "source");
  mkdirSync(sourceRoot);
  run("tar", ["-xf", sourceTar, "-C", sourceRoot]);
  const packageManager = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8")).packageManager;
  if (!/^pnpm@\d+\.\d+\.\d+$/u.test(packageManager ?? "")) fail("release source lacks an exact pnpm packageManager pin");
  const publishWorkflow = readFileSync(join(sourceRoot, ".github", "workflows", "publish.yml"), "utf8");
  const packNpmVersion = /npm install -g npm@(\d+\.\d+\.\d+)/u.exec(publishWorkflow)?.[1];
  if (!packNpmVersion) fail("could not find exact npm CLI pin in release workflow");

  run("corepack", ["pnpm", "install", "--frozen-lockfile"], { cwd: sourceRoot });
  run("corepack", ["pnpm", "run", "clean"], { cwd: sourceRoot });
  run("corepack", ["pnpm", "run", "build"], { cwd: sourceRoot });
  const rebuiltDir = join(auditRoot, "rebuilt");
  mkdirSync(rebuiltDir);
  run("npx", ["-y", `npm@${packNpmVersion}`, "pack", "--pack-destination", rebuiltDir], { cwd: sourceRoot });
  const rebuiltTarball = join(rebuiltDir, `${PACKAGE_NAME}-${version}.tgz`);
  const rebuiltBytes = readFileSync(rebuiltTarball);

  const publishedUnpacked = join(auditRoot, "published-unpacked");
  const rebuiltUnpacked = join(auditRoot, "rebuilt-unpacked");
  unpack(publishedTarball, publishedUnpacked);
  unpack(rebuiltTarball, rebuiltUnpacked);
  const publishedManifest = manifest(join(publishedUnpacked, "package"));
  const rebuiltManifest = manifest(join(rebuiltUnpacked, "package"));
  const differences = compareManifests(publishedManifest, rebuiltManifest);
  writeFileSync(join(auditRoot, "published-manifest.json"), `${JSON.stringify(publishedManifest, null, 2)}\n`);
  writeFileSync(join(auditRoot, "rebuilt-manifest.json"), `${JSON.stringify(rebuiltManifest, null, 2)}\n`);
  writeFileSync(join(auditRoot, "manifest-diff.json"), `${JSON.stringify(differences, null, 2)}\n`);

  const tarballByteIdentical = publishedBytes.equals(rebuiltBytes);
  const packageContentIdentical = differences.length === 0;
  const result = {
    result: packageContentIdentical ? "PASS" : "FAIL",
    package: `${PACKAGE_NAME}@${version}`,
    runnerCheckoutHead: currentHead,
    tag,
    releaseCommit,
    npmGitHead: metadata.gitHead,
    packageManager,
    packNpmVersion,
    registryTarball: metadata.dist.tarball,
    npmIntegrity: metadata.dist.integrity,
    npmShasum: metadata.dist.shasum,
    tarballSha256: publishedSha256,
    tarballByteIdentical,
    packageContentIdentical,
    publishedFileCount: publishedManifest.length,
    rebuiltFileCount: rebuiltManifest.length,
    differences: differences.length,
    provenance,
    artifacts: auditRoot,
  };
  writeFileSync(join(auditRoot, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!packageContentIdentical) fail(`published and rebuilt manifests differ; inspect ${auditRoot}`);
}

main().catch((error) => {
  process.stderr.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
