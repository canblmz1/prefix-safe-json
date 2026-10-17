import type { RegressionOptions, RegressionReport } from "./types.js";

export type { RegressionFixture, RegressionExpectations, RegressionOptions, RegressionReport, RegressionMismatch } from "./types.js";

/** Exercise the installed SDK with offline raw transport fixtures and optional reviewed expectations. */
export async function runRegression(options: RegressionOptions): Promise<RegressionReport> {
  const { runSuite } = await import("./harness.js");
  return runSuite(options);
}
