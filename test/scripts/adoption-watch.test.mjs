import assert from "node:assert/strict";
import test from "node:test";
import { bodySha256, collectAdoptionReport } from "../../scripts/watch-adoption.mjs";

const since = "2026-10-14T00:00:00Z";
const later = "2026-10-16T00:00:00Z";
const url = "https://github.com/example/project/issues/1";
function config(targets = [{ repository: "example/project", number: 1, kind: "issue", since,
  invitationUrl: url, purpose: "psj-project-trial", reviewedResponses: [] }]) {
  return { schemaVersion: 1, repository: "owner/psj", maintainer: "owner", targets,
    integrationReportsSince: since, reviewedIntegrationReports: [],
    goal: { target: 5, confirmedDevelopers: [], countingRule: "Manual independent own-project evidence" } };
}
function comment(id, author = "developer", body = "I tried PSJ in my project") {
  return { id, user: { login: author, type: "User" }, body,
    html_url: `${url}#issuecomment-${id}`, created_at: later, updated_at: later };
}
const json = data => new globalThis.Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
const run = (value, fetchImpl) => collectAdoptionReport(value, { token: "fixture-not-a-real-token", fetchImpl });

test("finds a human response after a full page without counting it as adoption", async () => {
  const pages = [];
  const report = await run(config(), async input => {
    const request = new URL(input);
    if (request.pathname.endsWith("/comments")) {
      pages.push(request.searchParams.get("page"));
      return json(pages.length === 1 ? Array.from({ length: 100 }, (_, index) => comment(index, "owner")) : [comment(101)]);
    }
    return json([]);
  });
  assert.deepEqual(pages, ["1", "2"]);
  assert.equal(report.targets[0].responses.length, 1);
  assert.equal(report.needsManualReview, true);
  assert.equal(report.goal.manuallyConfirmedCount, 0);
});

test("edited reviewed text needs review again; unchanged text, bots and our replies do not", async () => {
  const value = config();
  value.targets[0].reviewedResponses = [1, 2].map(id => ({ url: `${url}#issuecomment-${id}`, bodySha256: bodySha256("declined"), classification: "declined" }));
  const unchanged = comment(1, "maintainer", "declined");
  const edited = { ...comment(2, "maintainer", "now ran it"), created_at: "2026-01-01T00:00:00Z" };
  const bot = { ...comment(3, "robot[bot]"), user: { login: "robot[bot]", type: "Bot" } };
  const report = await run(value, async input => json(new URL(input).pathname.endsWith("/comments") ? [unchanged, edited, bot, comment(4, "owner")] : []));
  assert.deepEqual(report.targets[0].responses.filter(item => item.needsManualReview).map(item => item.url), [edited.html_url]);
  assert.equal(report.goal.manuallyConfirmedCount, 0);
});

test("follows discussion reply and comment cursors, including replies to our invitation", async () => {
  const target = { repository: "example/project", number: 1, kind: "discussion", since,
    invitationUrl: "https://github.com/example/project/discussions/1", purpose: "psj-project-trial" };
  const actor = (id, author = "developer") => ({ author: { login: author, __typename: "User" }, body: "Own-project result",
    url: `${target.invitationUrl}#discussioncomment-${id}`, createdAt: later, updatedAt: later });
  const cursors = [];
  const report = await run(config([target]), async (input, options) => {
    if (new URL(input).pathname !== "/graphql") return json([]);
    const { query, variables } = JSON.parse(options.body);
    cursors.push(variables.after);
    if (query.includes("node(id:$id)")) return json({ data: { node: { replies: {
      pageInfo: { hasNextPage: false }, nodes: [actor(101)],
    } } } });
    return json({ data: { repository: { discussion: { comments: variables.after ? {
      pageInfo: { hasNextPage: false }, nodes: [{ ...actor(102), id: "comment2", replies: { pageInfo: { hasNextPage: false }, nodes: [] } }],
    } : { pageInfo: { hasNextPage: true, endCursor: "comments-next" }, nodes: [{ ...actor(0, "owner"), id: "comment1",
      replies: { pageInfo: { hasNextPage: true, endCursor: "replies-next" }, nodes: [actor(1, "owner")] },
    }] } } } } });
  });
  assert.deepEqual(cursors, [null, "replies-next", "comments-next"]);
  assert.equal(report.targets[0].responses.length, 2);
  assert.equal(report.goal.manuallyConfirmedCount, 0);
});

test("API failures remain unknown instead of appearing as no-response success", async () => {
  const report = await run(config(), async () => new globalThis.Response("unavailable", { status: 503 }));
  assert.equal(report.status, "partial-failure");
  assert.equal(report.targets[0].status, "fetch-failed");
  assert.equal(report.targets[0].responses, undefined);
  assert.equal(report.failures.length, 2);
});

test("a new comment on a reviewed integration report is still surfaced", async () => {
  const value = config([]);
  const issue = { ...comment(5), number: 5, title: "[Integration]: own-project result", labels: [], html_url: "https://github.com/owner/psj/issues/5" };
  value.reviewedIntegrationReports = [{ url: issue.html_url, bodySha256: bodySha256(issue.body), classification: "reviewed" }];
  const report = await run(value, async input => json(new URL(input).pathname.endsWith("/comments") ? [comment(6)] : [issue, { ...issue, number: 7, pull_request: {} }]));
  assert.equal(report.integrationReports.length, 1);
  assert.equal(report.integrationReports[0].report.needsManualReview, false);
  assert.equal(report.integrationReports[0].needsManualReview, true);
  assert.equal(report.goal.manuallyConfirmedCount, 0);
});

test("maintainer self-runs cannot be inserted into the independent-user count", async () => {
  const value = config([]);
  value.goal.confirmedDevelopers = [{ login: "owner", project: "owner/psj", evidence: url }];
  await assert.rejects(() => run(value, async () => { throw new Error("must not fetch"); }), /distinct manually reviewed evidence/);
});

test("GitHub login capitalization cannot inflate the manually recorded count", async () => {
  const value = config([]);
  value.goal.confirmedDevelopers = ["Developer", "developer"].map(login => ({ login, project: "example/project", evidence: url }));
  await assert.rejects(() => run(value, async () => { throw new Error("must not fetch"); }), /distinct manually reviewed evidence/);
});

test("reads submitted PR reviews and inline feedback while excluding private pending drafts", async () => {
  const value = config();
  value.targets[0].invitationUrl = "https://github.com/example/project/pull/1#issuecomment-10";
  const approval = { ...comment(7, "maintainer", "Own-project test passed"), state: "APPROVED", submitted_at: later,
    created_at: undefined, updated_at: undefined, html_url: "https://github.com/example/project/pull/1#pullrequestreview-7" };
  const pending = { ...approval, state: "PENDING", body: "private draft must stay private" };
  const report = await run(value, async input => {
    const path = new URL(input).pathname;
    return json(path.endsWith("/reviews") ? [approval, pending] :
      path.includes("/pulls/") && path.endsWith("/comments") ? [comment(8, "reviewer", "Counter 1/0 confirmed")] : []);
  });
  assert.equal(report.targets[0].responses.length, 2);
  assert.equal(report.targets[0].responses[0].createdAt, later);
  assert.equal(report.needsManualReview, true);
  assert.equal(report.goal.manuallyConfirmedCount, 0);
  assert.equal(JSON.stringify(report).includes(pending.body), false);
});
