export interface ProvenanceFacts {
  available: boolean;
  cryptographicallyVerified?: boolean;
  predicateType?: string;
  subject?: string;
  subjectSha512?: string;
  repository?: string;
  workflow?: string;
  workflowRef?: string;
  sourceCommit?: string;
  builder?: string;
  invocation?: string;
}

export function decodeProvenance(
  attestations: unknown,
  tarballSha512: string,
  version: string,
  cryptographicallyVerified: boolean,
): ProvenanceFacts;

export interface VerifiedPackageEntry {
  name: string;
  version: string;
  location?: string;
  registry?: string;
  attestationBundles?: unknown[];
  [key: string]: unknown;
}

export interface NpmAuditSignaturesReport {
  invalid?: Array<{ name?: string; version?: string; [key: string]: unknown }>;
  missing?: Array<{ name?: string; version?: string; [key: string]: unknown }>;
  verified?: VerifiedPackageEntry[];
}

export function selectVerifiedPackageEntry(
  auditReport: NpmAuditSignaturesReport,
  identity: { name: string; version: string },
): VerifiedPackageEntry;

export function requireVerifiedAttestationBundles(verifiedEntry: VerifiedPackageEntry): unknown[];

export interface ReleaseCommitInput {
  tagCommit: string;
  npmGitHead: string | null;
  provenance: ProvenanceFacts;
}

export interface ReleaseCommitResult {
  releaseCommit: string;
  sourceIdentityMethod: "npm-gitHead" | "provenance";
}

export function determineReleaseCommit(input: ReleaseCommitInput): ReleaseCommitResult;
