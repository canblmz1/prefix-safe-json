/** JSON values accepted by the data-only fixture and expectation formats. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** One reviewed tool stub. It records its input and returns fixed JSON. */
export interface FixtureTool {
  inputSchema: Record<string, Json>;
  result: Json;
}

/** A recorded or authored HTTP response body; bytes are not reconstructed. */
export interface FixtureResponse {
  body: string;
  chunkBytes?: number;
}

/** One bounded offline conversation, with explicit fixture provenance. */
export interface FixtureCase {
  id: string;
  positiveControl?: boolean;
  provenance: { classification: "authored" | "recorded"; note: string };
  responses: FixtureResponse[];
}

/** Versioned raw OpenAI-compatible Chat Completions SSE fixture suite. */
export interface RegressionFixture {
  formatVersion: 1;
  protocol: "openai-chat-completions-sse";
  tools: Record<string, FixtureTool>;
  cases: FixtureCase[];
}

/** SDK-assigned identities are labelled consistently, without changing requests. */
export type ToolCallReference = string | { sdkAssigned: number };

/** Internal observed harmless execution, compared before report redaction. */
export interface ObservedExecution {
  toolCallId: ToolCallReference;
  name: string;
  input: Json;
}

/** A reviewed profile expectation; it is never generated from a passing run. */
export interface ProfileExpectation {
  requests: number;
  executions: ObservedExecution[];
  toolResultIds: ToolCallReference[];
  finalText: string;
  errorCount: number;
  decisions?: Array<{ action: string; reason: string; name?: string; toolCallId?: string }>;
}

/** Expected outcomes for both native SDK execution and PSJ-controlled stubs. */
export interface RegressionExpectations {
  formatVersion: 1;
  cases: Array<{ id: string; native: ProfileExpectation; guarded: ProfileExpectation }>;
}

/** Reports identify changed fields without exposing their argument values. */
export interface RegressionMismatch {
  caseId: string;
  profile: "native" | "guarded" | "suite";
  field: string;
}

/** One diagnostic decision from original wire evidence. */
export interface DecisionSummary {
  action: string;
  reason: string;
  name?: string;
  toolCallId?: string;
  explanation?: string;
  evidence?: {
    terminalConfirmed: boolean;
    structurallyComplete: boolean;
    parserExecutable: boolean;
    streamEndReason?: string;
    schemaValid?: boolean;
  };
}

/** Redacted observation of one actual SDK run. */
export interface ProfileReport {
  requests: number;
  executions: Array<Omit<ObservedExecution, "input"> & { inputSha256: string }>;
  toolResultIds: ToolCallReference[];
  finalTextSha256: string;
  errorCount: number;
  decisions: DecisionSummary[];
}

/** Versioned report from the installed SDK and provider, without live calls. */
export interface RegressionReport {
  formatVersion: 1;
  scope: "offline-sdk-regression";
  versions: Record<string, string | null>;
  fixtureSha256: string;
  cases: Array<{
    id: string;
    provenance: FixtureCase["provenance"];
    responseSha256: string[];
    native: ProfileReport;
    guarded: ProfileReport;
  }>;
  expectations: { checked: boolean; pass: boolean | null; mismatches: RegressionMismatch[] };
  limits: string[];
}

/** File-based entry point usable from a test runner as well as the CLI. */
export interface RegressionOptions {
  fixture: string;
  expect?: string;
}
