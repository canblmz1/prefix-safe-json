import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import process from "node:process";
import console from "node:console";

export function bodySha256(body) {
  return createHash("sha256").update(body ?? "").digest("hex");
}

function validateConfig(config) {
  const repository = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  if (config.schemaVersion !== 1 || !repository.test(config.repository) || !Array.isArray(config.targets) ||
    !config.maintainer || !Number.isFinite(Date.parse(config.integrationReportsSince))) {
    throw new Error("Invalid adoption watcher configuration");
  }
  for (const target of config.targets) {
    if (!repository.test(target.repository) || !Number.isSafeInteger(target.number) || target.number < 1 ||
      !["issue", "discussion"].includes(target.kind) || !Number.isFinite(Date.parse(target.since)) ||
      !target.invitationUrl.startsWith(`https://github.com/${target.repository}/`)) {
      throw new Error("Invalid public thread target");
    }
  }
  const developers = config.goal?.confirmedDevelopers;
  if (!Array.isArray(developers) || !Number.isSafeInteger(config.goal.target) || config.goal.target < 1 ||
    new Set(developers.map(person => String(person.login).toLowerCase())).size !== developers.length ||
    developers.some(person => !person.login || String(person.login).toLowerCase() === config.maintainer.toLowerCase() || !repository.test(person.project) ||
      !person.evidence?.startsWith("https://github.com/"))) {
    throw new Error("Confirmed developers require distinct manually reviewed evidence records");
  }
}

function reviewResponse(comment, since, maintainer, reviewed) {
  const author = comment.author?.login ?? "[deleted]";
  if (author === maintainer || Math.max(Date.parse(comment.createdAt), Date.parse(comment.updatedAt ?? comment.createdAt)) < Date.parse(since)) {
    return undefined;
  }
  const body = comment.body ?? "";
  const hash = bodySha256(body);
  const known = reviewed.find(item => item.url === comment.url && item.bodySha256 === hash);
  const bot = comment.bot === true || comment.author?.__typename === "Bot";
  return { author, url: comment.url, createdAt: comment.createdAt, updatedAt: comment.updatedAt,
    body, bodySha256: hash, bot,
    needsManualReview: !known && !bot,
    ...(known ? { reviewedClassification: known.classification } : {}) };
}

export async function collectAdoptionReport(config, { token, fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  validateConfig(config);
  if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN is required for read-only GitHub queries");
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json",
    "user-agent": "prefix-safe-json-adoption-watch", "x-github-api-version": "2022-11-28" };
  async function request(path, payload) {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method: payload ? "POST" : "GET", headers,
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub ${path} returned HTTP ${response.status}`);
    const data = await response.json();
    if (data.errors?.length) throw new Error(`GitHub GraphQL returned ${data.errors.length} error(s)`);
    return payload ? data.data : data;
  }
  async function pages(path) {
    const items = [];
    for (let page = 1; ; page++) {
      const batch = await request(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error("GitHub collection response was not an array");
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  }
  const restComment = item => ({ author: { login: item.user?.login }, bot: item.user?.type === "Bot",
    body: item.body, url: item.html_url, createdAt: item.created_at ?? item.submitted_at,
    updatedAt: item.updated_at ?? item.submitted_at });
  async function discussionComments(target) {
    const [owner, name] = target.repository.split("/");
    const comments = [];
    let after = null;
    do {
      const data = await request("/graphql", { query: `query($owner:String!,$name:String!,$number:Int!,$after:String) {
        repository(owner:$owner,name:$name) { discussion(number:$number) {
          comments(first:100,after:$after) { pageInfo { hasNextPage endCursor } nodes {
            id author { login __typename } body url createdAt updatedAt
            replies(first:100) { pageInfo { hasNextPage endCursor } nodes { author { login __typename } body url createdAt updatedAt } }
          } }
        } }
      }`, variables: { owner, name, number: target.number, after } });
      const connection = data.repository?.discussion?.comments;
      if (!connection) throw new Error("Public discussion comments were unavailable");
      for (const comment of connection.nodes) {
        comments.push(comment);
        let replies = comment.replies;
        comments.push(...replies.nodes);
        while (replies.pageInfo.hasNextPage) {
          const more = await request("/graphql", { query: `query($id:ID!,$after:String) {
            node(id:$id) { ... on DiscussionComment { replies(first:100,after:$after) {
              pageInfo { hasNextPage endCursor } nodes { author { login __typename } body url createdAt updatedAt }
            } } }
          }`, variables: { id: comment.id, after: replies.pageInfo.endCursor } });
          replies = more.node?.replies;
          if (!replies) throw new Error("Public discussion replies were unavailable");
          comments.push(...replies.nodes);
        }
      }
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    } while (after);
    return comments;
  }
  const targets = [];
  const failures = [];
  for (const target of config.targets) {
    const base = { repository: target.repository, number: target.number, kind: target.kind,
      invitationUrl: target.invitationUrl, purpose: target.purpose };
    try {
      const comments = target.kind === "discussion" ? await discussionComments(target) :
        (await pages(`/repos/${target.repository}/issues/${target.number}/comments`)).map(restComment);
      if (target.invitationUrl.split("#")[0] === `https://github.com/${target.repository}/pull/${target.number}`) {
        const reviews = await pages(`/repos/${target.repository}/pulls/${target.number}/reviews`);
        // Pending reviews are private drafts and do not belong in a public report.
        comments.push(...reviews.filter(item => item.state !== "PENDING").map(restComment));
        comments.push(...(await pages(`/repos/${target.repository}/pulls/${target.number}/comments`)).map(restComment));
      }
      const responses = comments.map(item => reviewResponse(item, target.since, config.maintainer, target.reviewedResponses ?? [])).filter(Boolean);
      targets.push({ ...base, status: "checked", responses,
        needsManualReview: responses.some(item => item.needsManualReview) });
    } catch (error) {
      failures.push({ thread: target.invitationUrl, error: error.message });
      targets.push({ ...base, status: "fetch-failed", error: error.message });
    }
  }
  const integrationReports = [];
  try {
    const issues = await pages(`/repos/${config.repository}/issues?state=all&since=${encodeURIComponent(config.integrationReportsSince)}`);
    const isIntegration = issue => issue.labels?.some(label => (typeof label === "string" ? label : label.name) === "integration") ||
      /^\[Integration\]:/i.test(issue.title ?? "") || (issue.body ?? "").includes("### What did you run?");
    for (const issue of issues.filter(item => !item.pull_request && isIntegration(item))) {
      const reviewed = config.reviewedIntegrationReports ?? [];
      const body = reviewResponse(restComment(issue), config.integrationReportsSince, config.maintainer, reviewed);
      const comments = (await pages(`/repos/${config.repository}/issues/${issue.number}/comments`))
        .map(restComment).map(item => reviewResponse(item, config.integrationReportsSince, config.maintainer, reviewed)).filter(Boolean);
      integrationReports.push({ number: issue.number, url: issue.html_url,
        ...(body ? { report: body } : {}), comments,
        needsManualReview: body?.needsManualReview === true || comments.some(item => item.needsManualReview) });
    }
  } catch (error) { failures.push({ thread: "integration reports", error: error.message }); }
  return { checkedAt: now.toISOString(), status: failures.length ? "partial-failure" : "complete",
    goal: { target: config.goal.target, manuallyConfirmedDevelopers: config.goal.confirmedDevelopers,
      manuallyConfirmedCount: config.goal.confirmedDevelopers.length, countingRule: config.goal.countingRule },
    targets, integrationReports, failures,
    needsManualReview: targets.some(item => item.needsManualReview) || integrationReports.some(item => item.needsManualReview),
    limits: ["Replies require manual review; no comment, fixture run or download automatically counts as adoption.",
      "This job reads public GitHub records and writes reports; it sends no invitations, changes no threads and runs no third-party code."] };
}

async function main() {
  const { values } = parseArgs({ options: {
    config: { type: "string", default: fileURLToPath(new URL("../.github/adoption-watch.json", import.meta.url)) },
    output: { type: "string", default: "artifacts/adoption-watch" },
  } });
  const config = JSON.parse(await readFile(values.config, "utf8"));
  const report = await collectAdoptionReport(config, { token: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN });
  await mkdir(values.output, { recursive: true });
  await writeFile(resolve(values.output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  const summary = ["# PSJ trial follow-up", "",
    `New manually confirmed own-project developers: **${report.goal.manuallyConfirmedCount}/${report.goal.target}** (historical verification tracked separately).`,
    `Threads checked: ${report.targets.filter(item => item.status === "checked").length}/${report.targets.length}.`,
    `New evidence needs manual review: **${report.needsManualReview ? "yes" : "no"}**. API failures: ${report.failures.length}.`,
    "", "| Thread | Purpose | Check | Review needed |", "| --- | --- | --- | --- |",
    ...report.targets.map(item => `| [${item.repository} #${item.number}](${item.invitationUrl}) | ${item.purpose} | ${item.status} | ${item.needsManualReview ? "yes" : "no"} |`),
    "", "Download the report artifact for public reply bodies and integration reports. No automatic user counting or outreach.", ""].join("\n");
  await writeFile(resolve(values.output, "summary.md"), summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(JSON.stringify({ status: report.status, checkedThreads: report.targets.length,
    manuallyConfirmedUsers: report.goal.manuallyConfirmedCount, needsManualReview: report.needsManualReview, failures: report.failures.length }));
  if (report.failures.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
