import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  decodeProvenance,
  determineReleaseCommit,
  type ProvenanceFacts,
} from "../../scripts/verify-published-release.mjs";

const VERSION = "0.4.2";
const REPOSITORY = "https://github.com/canblmz1/prefix-safe-json";
const WORKFLOW_PATH = ".github/workflows/publish.yml";
const TARBALL_BYTES = Buffer.from("fixture-tarball-bytes");
const TARBALL_SHA512 = createHash("sha512").update(TARBALL_BYTES).digest("hex");
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

function slsaStatement(overrides: {
  version?: string;
  subjectSha512?: string;
  repository?: string;
  workflowPath?: string;
  workflowRef?: string;
  sourceCommit?: string | null;
  extraResolvedDependency?: { gitCommit: string } | null;
}) {
  const {
    version = VERSION,
    subjectSha512 = TARBALL_SHA512,
    repository = REPOSITORY,
    workflowPath = WORKFLOW_PATH,
    workflowRef = "refs/heads/main",
    sourceCommit = COMMIT_A,
    extraResolvedDependency = null,
  } = overrides;

  const resolvedDependencies = [];
  if (sourceCommit !== null) {
    resolvedDependencies.push({
      uri: `git+${repository}@${workflowRef}`,
      digest: { gitCommit: sourceCommit },
    });
  }
  if (extraResolvedDependency) {
    resolvedDependencies.push({ uri: "git+extra", digest: extraResolvedDependency });
  }

  return {
    _type: "https://in-toto.io/Statement/v1",
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [{ name: `pkg:npm/prefix-safe-json@${version}`, digest: { sha512: subjectSha512 } }],
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: { workflow: { ref: workflowRef, repository, path: workflowPath } },
        resolvedDependencies,
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: { invocationId: "https://github.com/canblmz1/prefix-safe-json/actions/runs/1/attempts/1" },
      },
    },
  };
}

function attestationEntry(statement: unknown) {
  const payload = Buffer.from(JSON.stringify(statement), "utf8").toString("base64");
  return {
    predicateType: (statement as { predicateType: string }).predicateType,
    bundle: { dsseEnvelope: { payload } },
  };
}

function attestationBundle(statement: unknown) {
  return { attestations: [attestationEntry(statement)] };
}

function multiStatementBundle(statements: unknown[]) {
  return { attestations: statements.map(attestationEntry) };
}

const availableProvenance: ProvenanceFacts = {
  available: true,
  cryptographicallyVerified: true,
  sourceCommit: COMMIT_A,
  repository: REPOSITORY,
  workflow: WORKFLOW_PATH,
  subjectSha512: TARBALL_SHA512,
};
const unavailableProvenance: ProvenanceFacts = { available: false };

describe("determineReleaseCommit", () => {
  it("case 1: gitHead present + provenance present + all equal -> PASS via npm-gitHead", () => {
    const result = determineReleaseCommit({
      tagCommit: COMMIT_A,
      npmGitHead: COMMIT_A,
      provenance: availableProvenance,
    });
    expect(result).toEqual({ releaseCommit: COMMIT_A, sourceIdentityMethod: "npm-gitHead" });
  });

  it("case 2: gitHead absent + provenance present + tag/provenance equal -> PASS via provenance", () => {
    const result = determineReleaseCommit({
      tagCommit: COMMIT_A,
      npmGitHead: null,
      provenance: availableProvenance,
    });
    expect(result).toEqual({ releaseCommit: COMMIT_A, sourceIdentityMethod: "provenance" });
  });

  it("case 3: gitHead absent + provenance absent -> FAIL", () => {
    expect(() =>
      determineReleaseCommit({ tagCommit: COMMIT_A, npmGitHead: null, provenance: unavailableProvenance }),
    ).toThrow(/provenance/i);
  });

  it("case 4: gitHead absent + provenance commit != tag -> FAIL", () => {
    expect(() =>
      determineReleaseCommit({
        tagCommit: COMMIT_A,
        npmGitHead: null,
        provenance: { ...availableProvenance, sourceCommit: COMMIT_B },
      }),
    ).toThrow(/does not match tag/i);
  });

  it("case 5: gitHead present + gitHead != tag -> FAIL", () => {
    expect(() =>
      determineReleaseCommit({ tagCommit: COMMIT_A, npmGitHead: COMMIT_B, provenance: unavailableProvenance }),
    ).toThrow(/gitHead/i);
  });

  it("case 6: gitHead present + provenance commit != gitHead -> FAIL", () => {
    expect(() =>
      determineReleaseCommit({
        tagCommit: COMMIT_A,
        npmGitHead: COMMIT_A,
        provenance: { ...availableProvenance, sourceCommit: COMMIT_B },
      }),
    ).toThrow(/provenance/i);
  });

  it("gitHead present + provenance unavailable -> PASS, preserves existing gitHead-only policy", () => {
    const result = determineReleaseCommit({
      tagCommit: COMMIT_A,
      npmGitHead: COMMIT_A,
      provenance: unavailableProvenance,
    });
    expect(result).toEqual({ releaseCommit: COMMIT_A, sourceIdentityMethod: "npm-gitHead" });
  });

  it("gitHead absent + otherwise-valid but NOT cryptographically verified provenance -> FAIL", () => {
    expect(() =>
      determineReleaseCommit({
        tagCommit: COMMIT_A,
        npmGitHead: null,
        provenance: { ...availableProvenance, cryptographicallyVerified: false },
      }),
    ).toThrow(/cryptographically verified/i);
  });

  it("gitHead present + provenance available but NOT cryptographically verified -> FAIL (unconditional, not just case B)", () => {
    expect(() =>
      determineReleaseCommit({
        tagCommit: COMMIT_A,
        npmGitHead: COMMIT_A,
        provenance: { ...availableProvenance, cryptographicallyVerified: false },
      }),
    ).toThrow(/cryptographically verified/i);
  });
});

describe("decodeProvenance", () => {
  it("case 7: provenance subject SHA-512 != downloaded tarball -> FAIL", () => {
    const bundle = attestationBundle(slsaStatement({ subjectSha512: "0".repeat(128) }));
    expect(() => decodeProvenance(bundle, TARBALL_SHA512, VERSION, true)).toThrow(
      /subject sha-512|subject SHA-512/i,
    );
  });

  it("case 8: wrong provenance repository -> FAIL", () => {
    const bundle = attestationBundle(slsaStatement({ repository: "https://github.com/someone-else/evil" }));
    expect(() => decodeProvenance(bundle, TARBALL_SHA512, VERSION, true)).toThrow(/repository/i);
  });

  it("case 9: wrong provenance workflow path -> FAIL", () => {
    const bundle = attestationBundle(slsaStatement({ workflowPath: ".github/workflows/other.yml" }));
    expect(() => decodeProvenance(bundle, TARBALL_SHA512, VERSION, true)).toThrow(/workflow/i);
  });

  it("case 10a: malformed provenance (no resolved source commit) -> FAIL", () => {
    const bundle = attestationBundle(slsaStatement({ sourceCommit: null }));
    expect(() => decodeProvenance(bundle, TARBALL_SHA512, VERSION, true)).toThrow(/source commit/i);
  });

  it("case 10b: ambiguous provenance (conflicting resolved commits within one statement) -> FAIL", () => {
    const bundle = attestationBundle(
      slsaStatement({ sourceCommit: COMMIT_A, extraResolvedDependency: { gitCommit: COMMIT_B } }),
    );
    expect(() => decodeProvenance(bundle, TARBALL_SHA512, VERSION, true)).toThrow(/ambiguous|conflict/i);
  });

  it("multiple conflicting SLSA attestation statements -> FAIL", () => {
    const bundle = multiStatementBundle([
      slsaStatement({ sourceCommit: COMMIT_A }),
      slsaStatement({ sourceCommit: COMMIT_B }),
    ]);
    expect(() => decodeProvenance(bundle, TARBALL_SHA512, VERSION, true)).toThrow(
      /multiple|more than one/i,
    );
  });

  it("multiple SLSA statements, even identical, -> FAIL (never silently reconciled)", () => {
    const one = slsaStatement({ sourceCommit: COMMIT_A });
    const bundle = multiStatementBundle([one, one]);
    expect(() => decodeProvenance(bundle, TARBALL_SHA512, VERSION, true)).toThrow(
      /multiple|more than one/i,
    );
  });

  it("no SLSA predicate present -> available: false (absent, not malformed)", () => {
    const result = decodeProvenance({ attestations: [] }, TARBALL_SHA512, VERSION, true);
    expect(result).toEqual({ available: false });
  });

  it("unsigned/unverified provenance with otherwise-matching JSON fields -> FAIL", () => {
    const bundle = attestationBundle(slsaStatement({}));
    expect(() => decodeProvenance(bundle, TARBALL_SHA512, VERSION, false)).toThrow(
      /cryptographically verified/i,
    );
  });

  it("valid, cryptographically verified provenance decodes to the expected facts -> PASS", () => {
    const bundle = attestationBundle(slsaStatement({}));
    const result = decodeProvenance(bundle, TARBALL_SHA512, VERSION, true);
    expect(result).toEqual({
      available: true,
      cryptographicallyVerified: true,
      predicateType: "https://slsa.dev/provenance/v1",
      subject: `pkg:npm/prefix-safe-json@${VERSION}`,
      subjectSha512: TARBALL_SHA512,
      repository: REPOSITORY,
      workflow: WORKFLOW_PATH,
      workflowRef: "refs/heads/main",
      sourceCommit: COMMIT_A,
      builder: "https://github.com/actions/runner/github-hosted",
      invocation: "https://github.com/canblmz1/prefix-safe-json/actions/runs/1/attempts/1",
    });
  });
});
