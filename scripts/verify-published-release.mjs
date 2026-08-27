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
import { fileURLToPath, pathToFileURL } from "node:url";

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

// This GNU tar build resolves an archive/`-C` path containing a drive-letter
// colon inconsistently when passed Windows-style backslashes together with
// `--force-local` (needed so `C:\...` isn't parsed as a remote `host:path`
// spec in the first place). Forward slashes avoid both problems and are
// accepted by both `tar` and Windows itself.
function tarPath(path) {
  return path.replaceAll("\\", "/");
}

function listArchive(tarball) {
  const entries = capture("tar", ["--force-local", "-tzf", tarPath(tarball)])
    .split(/\r?\n/u)
    .filter(Boolean);
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
  run("tar", ["--force-local", "-xzf", tarPath(tarball), "-C", tarPath(destination)]);
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

/**
 * Decodes and validates one SLSA provenance statement's own internal claims:
 * that its subject digest matches the tarball we downloaded, and that it
 * names this project's repository and publish workflow. Does not know about
 * npm `gitHead` and does not pick a final release commit - see
 * `determineReleaseCommit` for that. Fails closed (throws) on anything
 * malformed or ambiguous enough that "available: false" would be misleading;
 * returns `{ available: false }` only for the clean "no SLSA statement
 * present at all" case.
 */
export function decodeProvenance(attestations, tarballSha512, version) {
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
  if (subjectSha512 !== tarballSha512) fail("provenance subject SHA-512 does not match tarball");

  const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow;
  if (workflow?.repository !== "https://github.com/canblmz1/prefix-safe-json") {
    fail(`unexpected provenance repository: ${workflow?.repository}`);
  }
  if (workflow?.path !== ".github/workflows/publish.yml") {
    fail(`unexpected provenance workflow: ${workflow?.path}`);
  }

  const resolvedCommits = [
    ...new Set(
      (statement.predicate?.buildDefinition?.resolvedDependencies ?? [])
        .map((entry) => entry.digest?.gitCommit)
        .filter(Boolean),
    ),
  ];
  if (resolvedCommits.length === 0) fail("provenance has no resolved source commit");
  if (resolvedCommits.length > 1) fail("provenance has ambiguous, conflicting resolved source commits");
  const [sourceCommit] = resolvedCommits;

  return {
    available: true,
    predicateType: statement.predicateType,
    subject: subject?.name,
    subjectSha512,
    repository: workflow.repository,
    workflow: workflow.path,
    workflowRef: workflow.ref,
    sourceCommit,
    builder: statement.predicate?.runDetails?.builder?.id,
    invocation: statement.predicate?.runDetails?.metadata?.invocationId,
  };
}

/**
 * Picks the single authoritative release source commit from every
 * available identity signal, and how it was established. Fails closed
 * (throws) on any disagreement or on insufficient evidence - never silently
 * prefers one signal over another.
 *
 * - `npmGitHead` present: tag, gitHead, and (if available) provenance must
 *   all agree. This is the pre-existing policy, preserved unweakened; when
 *   provenance is unavailable it is simply not cross-checked, exactly as
 *   before this fallback existed.
 * - `npmGitHead` absent (e.g. published via `npm publish <tarball-path>`,
 *   which does not populate `gitHead`): provenance becomes REQUIRED. Its
 *   repository/workflow/subject-digest claims are validated by
 *   `decodeProvenance` before this function ever sees it; here we only need
 *   `provenance.sourceCommit` to exist and match the tag commit.
 */
export function determineReleaseCommit({ tagCommit, npmGitHead, provenance }) {
  if (npmGitHead) {
    if (tagCommit !== npmGitHead) {
      fail(`tag resolves to ${tagCommit}, but npm gitHead is ${npmGitHead}`);
    }
    if (provenance?.available && provenance.sourceCommit !== npmGitHead) {
      fail(
        `provenance source commit ${provenance.sourceCommit} does not match npm gitHead ${npmGitHead}`,
      );
    }
    return { releaseCommit: npmGitHead, sourceIdentityMethod: "npm-gitHead" };
  }

  if (!provenance?.available) {
    fail(
      "npm gitHead is absent and no verified provenance is available to establish release source identity",
    );
  }
  if (!provenance.sourceCommit) fail("provenance is available but has no verified source commit");
  if (provenance.sourceCommit !== tagCommit) {
    fail(`provenance source commit ${provenance.sourceCommit} does not match tag commit ${tagCommit}`);
  }
  return { releaseCommit: tagCommit, sourceIdentityMethod: "provenance" };
}

function parseArgs(argv) {
  const version = argv.find((argument) => argument !== "--");
  if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    fail("usage: npm run verify:published-release -- <exact-version>");
  }
  return { version };
}

async function main() {
  // 1. parse exact version
  const { version } = parseArgs(process.argv.slice(2));
  const tag = `v${version}`;
  const currentHead = capture("git", ["rev-parse", "HEAD"], { cwd: repoRoot });

  // 2. resolve Git tag commit
  const tagCommit = capture("git", ["rev-parse", `${tag}^{commit}`], { cwd: repoRoot });

  // 3. fetch npm metadata
  const metadataUrl = `${REGISTRY_ORIGIN}/${PACKAGE_NAME}/${encodeURIComponent(version)}`;
  const metadata = await fetchJson(metadataUrl);

  // 4. validate package/version identity
  if (metadata.name !== PACKAGE_NAME || metadata.version !== version) fail("registry metadata identity mismatch");
  const npmGitHead = metadata.gitHead ?? null;

  const auditRoot = mkdtempSync(join(tmpdir(), `${PACKAGE_NAME}-${version}-audit-`));

  // 5. download official npm tarball
  const publishedTarball = join(auditRoot, `${PACKAGE_NAME}-${version}-published.tgz`);
  await download(metadata.dist.tarball, publishedTarball);
  const publishedBytes = readFileSync(publishedTarball);

  // 6. verify dist.integrity
  verifyIntegrity(publishedBytes, metadata.dist.integrity);

  // 7. verify dist.shasum ; 8. compute SHA-256 / SHA-512
  const publishedSha1 = digest(publishedBytes, "sha1");
  const publishedSha256 = digest(publishedBytes, "sha256");
  const publishedSha512 = digest(publishedBytes, "sha512");
  if (publishedSha1 !== metadata.dist.shasum) fail("downloaded tarball does not match npm dist.shasum");

  // 9. fetch provenance if available ; 10. validate provenance subject digest
  // against the downloaded tarball (done inside decodeProvenance)
  let provenance = { available: false };
  if (metadata.dist.attestations?.url) {
    const attestations = await fetchJson(metadata.dist.attestations.url);
    writeFileSync(join(auditRoot, "attestations.json"), `${JSON.stringify(attestations, null, 2)}\n`);
    provenance = decodeProvenance(attestations, publishedSha512, version);
  }

  // 11. determine authoritative source commit ; 12. require it == tag commit
  // (enforced inside determineReleaseCommit for both identity-method cases)
  const { releaseCommit, sourceIdentityMethod } = determineReleaseCommit({
    tagCommit,
    npmGitHead,
    provenance,
  });

  // 13. export exact source commit using canonical Git blob bytes
  const sourceTar = join(auditRoot, "release-source.tar");
  run("git", ["-c", "core.autocrlf=false", "archive", "--format=tar", `--output=${sourceTar}`, releaseCommit], { cwd: repoRoot });
  const sourceRoot = join(auditRoot, "source");
  mkdirSync(sourceRoot);
  run("tar", ["--force-local", "-xf", tarPath(sourceTar), "-C", tarPath(sourceRoot)]);
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
    tagCommit,
    releaseCommit,
    sourceIdentityMethod,
    npmGitHead,
    provenanceSourceCommit: provenance.available ? provenance.sourceCommit : null,
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

// Only run as a CLI entry point, not as a side effect of importing this
// module for its exported pure functions (e.g. from unit tests).
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((error) => {
    process.stderr.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
