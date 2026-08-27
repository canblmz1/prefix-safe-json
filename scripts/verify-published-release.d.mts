export interface ProvenanceFacts {
  available: boolean;
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
): ProvenanceFacts;

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
