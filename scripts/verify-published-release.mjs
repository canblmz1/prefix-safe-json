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

// Pinned independently of the release's own `packNpmVersion` (read from the
// release source's publish.yml, which isn't known yet at this point in the
// flow - see `verifyProvenanceCryptographically`). Known to perform real
// Sigstore-backed `npm audit signatures` attestation verification, which is
// what this pin needs to guarantee rather than whatever npm happens to be
// ambient on a given machine or CI runner.
const PROVENANCE_VERIFICATION_NPM_VERSION = "11.5.1";

function fail(message) {
  throw new Error(message);
}

function executable(name) {
  if (process.platform !== "win32") return name;
  return name === "npx" || name === "corepack" ? `${name}.cmd` : `${name}.exe`;
}

function capture(name, args, options = {}) {
  // `.cmd` shims (npx/corepack on Windows) need a shell to execute at all -
  // execFileSync against them directly fails with EINVAL. Mirrors `run()`'s
  // existing handling of the same issue; this path was previously untaken
  // because capture() was never called with npx/corepack before.
  const needsCommandShell = process.platform === "win32" && (name === "npx" || name === "corepack");
  return execFileSync(executable(name), args, { encoding: "utf8", shell: needsCommandShell, ...options }).trim();
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

const SLSA_PREDICATE_TYPE = "https://slsa.dev/provenance/v1";

/**
 * Cryptographically verifies that this package version's npm provenance
 * attestation is real - a valid Sigstore-backed signature, not merely a
 * DSSE envelope whose JSON payload happens to parse and whose fields happen
 * to match what we expect. Delegates to the pinned npm CLI's own
 * `audit signatures` (which performs genuine Sigstore/Rekor verification)
 * in an isolated, disposable install, rather than hand-rolling signature
 * verification or adding a Sigstore client as a project dependency.
 *
 * `expectedIntegrity` ties this check back to the exact tarball already
 * downloaded and hashed: the isolated install's own resolved integrity for
 * this exact version must match it, so a registry that served different
 * bytes to this install than it served to the earlier download would be
 * caught here rather than silently verifying signatures for something else.
 *
 * Never returns `false` - either the verification fully succeeds, or this
 * throws (fail closed), including on any network/subprocess error.
 */
function verifyProvenanceCryptographically({ version, expectedIntegrity }) {
  const verifyRoot = mkdtempSync(join(tmpdir(), `${PACKAGE_NAME}-${version}-provenance-verify-`));
  writeFileSync(
    join(verifyRoot, "package.json"),
    JSON.stringify({ name: "prefix-safe-json-provenance-verify", version: "0.0.0", private: true }),
  );

  run(
    "npx",
    ["-y", `npm@${PROVENANCE_VERIFICATION_NPM_VERSION}`, "install", `${PACKAGE_NAME}@${version}`, "--save-exact"],
    { cwd: verifyRoot },
  );

  const lockfile = JSON.parse(readFileSync(join(verifyRoot, "package-lock.json"), "utf8"));
  const installedIntegrity = lockfile.packages?.[`node_modules/${PACKAGE_NAME}`]?.integrity;
  if (installedIntegrity !== expectedIntegrity) {
    fail(
      `isolated provenance-verification install resolved integrity ${installedIntegrity}, which does not match the already-downloaded and verified tarball's integrity ${expectedIntegrity}`,
    );
  }

  const jsonReport = JSON.parse(
    capture("npx", ["-y", `npm@${PROVENANCE_VERIFICATION_NPM_VERSION}`, "audit", "signatures", "--json"], {
      cwd: verifyRoot,
    }),
  );
  const problems = [...(jsonReport.invalid ?? []), ...(jsonReport.missing ?? [])];
  if (problems.length > 0) {
    fail(`npm audit signatures reported unverified/invalid packages: ${JSON.stringify(problems)}`);
  }

  // `--json` only ever reports problems (see above) - it does not positively
  // confirm that *this* package specifically has a verified attestation, as
  // opposed to merely a verified registry signature (which every dependency
  // here has, attestation or not). The plain-text report does say so
  // explicitly, and only when at least one package's attestation verified;
  // it is silently omitted rather than printed with a zero count otherwise
  // (confirmed empirically against a package with no provenance at all).
  // This isolated tree contains only prefix-safe-json and its own
  // production dependencies (ajv and its four sub-dependencies, none of
  // which ship provenance), so a nonzero count here can only be
  // prefix-safe-json's own attestation.
  const textReport = capture("npx", ["-y", `npm@${PROVENANCE_VERIFICATION_NPM_VERSION}`, "audit", "signatures"], {
    cwd: verifyRoot,
  });
  const attestationMatch = /(\d+) packages? has? a verified attestation/u.exec(textReport);
  const verifiedAttestationCount = attestationMatch ? Number(attestationMatch[1]) : 0;
  if (verifiedAttestationCount < 1) {
    fail("npm audit signatures did not report any verified attestation for the isolated install");
  }

  return true;
}

/**
 * Decodes and validates provenance for one package version. Does not know
 * about npm `gitHead` and does not pick a final release commit - see
 * `determineReleaseCommit` for that.
 *
 * `cryptographicallyVerified` must be the result of an already-performed,
 * independent cryptographic verification of this exact attestation (see
 * `verifyProvenanceCryptographically`) - this function never performs that
 * verification itself and never treats "the JSON parsed and its fields
 * matched" as equivalent to "the signature checked out." Content that would
 * otherwise be perfectly valid still fails closed if this is not `true`.
 *
 * Also fails closed on anything malformed or ambiguous enough that
 * `{ available: false }` would be misleading - including more than one SLSA
 * statement for this subject, which is never reconciled automatically, even
 * if every statement happens to agree. Returns `{ available: false }` only
 * for the clean "no SLSA statement present at all" case.
 */
export function decodeProvenance(attestations, tarballSha512, version, cryptographicallyVerified) {
  const candidates = (attestations.attestations ?? []).filter(
    (entry) => entry.predicateType === SLSA_PREDICATE_TYPE,
  );
  if (candidates.length === 0) return { available: false };
  if (candidates.length > 1) {
    fail(`provenance has ${candidates.length} SLSA statements for this subject; refusing to reconcile multiple statements`);
  }
  if (cryptographicallyVerified !== true) {
    fail("provenance attestation was not cryptographically verified; refusing to trust its content");
  }

  const [attestation] = candidates;
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
    cryptographicallyVerified: true,
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
 * Unconditionally, in both cases below: available provenance that was not
 * cryptographically verified is never usable, not even as a cross-check.
 * This is checked again here (`decodeProvenance` already refuses to return
 * `available: true` for unverified provenance) so this function's own
 * guarantee does not depend on every caller going through `decodeProvenance`.
 *
 * - `npmGitHead` present: tag, gitHead, and (if available and verified)
 *   provenance must all agree. This is the pre-existing policy, preserved
 *   unweakened; when provenance is unavailable it is simply not
 *   cross-checked, exactly as before this fallback existed.
 * - `npmGitHead` absent (e.g. published via `npm publish <tarball-path>`,
 *   which does not populate `gitHead`): verified provenance becomes
 *   REQUIRED. Its repository/workflow/subject-digest claims and its
 *   cryptographic signature are validated by `decodeProvenance` before this
 *   function ever sees it; here we only need `provenance.sourceCommit` to
 *   exist and match the tag commit.
 */
export function determineReleaseCommit({ tagCommit, npmGitHead, provenance }) {
  if (provenance?.available && provenance.cryptographicallyVerified !== true) {
    fail("provenance is available but was not cryptographically verified; refusing to use it for source identity");
  }

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

  // 9. fetch provenance if available
  let provenance = { available: false };
  if (metadata.dist.attestations?.url) {
    const attestations = await fetchJson(metadata.dist.attestations.url);
    writeFileSync(join(auditRoot, "attestations.json"), `${JSON.stringify(attestations, null, 2)}\n`);

    // Cryptographically verify BEFORE decoding/trusting any of its content -
    // an unsigned or invalidly-signed attestation is never inspected for
    // matching fields at all, let alone trusted for source identity.
    const cryptographicallyVerified = verifyProvenanceCryptographically({
      version,
      expectedIntegrity: metadata.dist.integrity,
    });

    // 10. validate provenance subject digest against the downloaded tarball
    // (done inside decodeProvenance, which also enforces the crypto result)
    provenance = decodeProvenance(attestations, publishedSha512, version, cryptographicallyVerified);
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
