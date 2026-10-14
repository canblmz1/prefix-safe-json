/** A local file fingerprint; it does not prove the file's content is correct. */
export interface Evidence { name: string; size: number; sha256: string; }
/** One explicit user requirement and its current local evidence. */
export interface Requirement {
  id: string; text: string;
  claim: { revision: number; note: string } | null;
  evidence: Evidence | null;
  review: { revision: number; sha256: string } | null;
}
/** Experimental portable task state, unrelated to execution authority. */
export interface Project { formatVersion: number; id: string; intentId: string; title: string; goal: string; revision: number; requirements: Requirement[]; nextSteps: string[]; }
/** User-authored task input. */
export interface ProjectInput { title: string; goal: string; items: string[]; }
export function createProject(input: ProjectInput): Project;
export function reviseProject(project: Project, input: ProjectInput): Project;
export function attachEvidence(project: Project, id: string, input: Evidence): Project;
export function reviewRequirement(project: Project, id: string): Project;
export function unreviewRequirement(project: Project, id: string): Project;
export function reportRequirement(project: Project, id: string, note: string): Project;
export function statusFor(project: Project, item: Requirement): "reviewed" | "stale" | "reported" | "evidence" | "pending";
export function hashBytes(bytes: ArrayBuffer): Promise<string>;
export function applyReport(project: Project, input: string): Project;
export function exportProject(project: Project): string;
export function importProject(input: string): Project;
export function restoreLocalProject(input: string): Project;
export function handoffFor(project: Project): string;
