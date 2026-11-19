// Tenant-isolation and permission tests for the organisation workspace API.
//
// Runs the real Express app against a DISPOSABLE Postgres database:
//   DATABASE_URL=postgres://…/yc_test npm run push-force -w @workspace/db
//   DATABASE_URL=postgres://…/yc_test npm test -w @workspace/api-server
// It refuses to run unless the database name contains "test", because it
// writes users and organisations.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const url = process.env.DATABASE_URL || "";
if (!/test/i.test(new URL(url || "postgres://x/none").pathname)) {
  throw new Error("Set DATABASE_URL to a disposable database whose name contains 'test'");
}

const { default: app } = await import("../src/app.js");
const { db, pool, usersTable } = await import("@workspace/db");
const { eq } = await import("drizzle-orm");
const { createSession } = await import("../src/lib/session.js");
const { hashPassword } = await import("../src/lib/password.js");

let server: Server;
let base = "";
const run = Date.now().toString(36);

type Actor = { id: number; email: string; token: string };

async function makeUser(name: string, opts: { platformAdmin?: boolean } = {}): Promise<Actor> {
  const email = `${name}.${run}@example.test`;
  const [u] = await db.insert(usersTable).values({
    email, fullName: `${name} ${run}`, passwordHash: await hashPassword("x-password-123"), role: opts.platformAdmin ? "admin" : "user",
  }).returning();
  return { id: u.id, email, token: await createSession(u.id) };
}

let n = 1;
async function api(actor: Actor, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/org${path}`, {
    method,
    headers: {
      "x-session-token": actor.token,
      // The app trusts one proxy hop, so a distinct client IP per request keeps
      // the tests clear of the per-IP rate limiters.
      "x-forwarded-for": `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n++ & 255}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: any = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function ok(actor: Actor, method: string, path: string, body?: unknown) {
  const r = await api(actor, method, path, body);
  assert.ok(r.status < 300, `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

// Adds an existing user to an org directly through an invitation round trip.
async function invite(admin: Actor, slug: string, who: Actor, roleKey: string, extra: Record<string, unknown> = {}) {
  const { roles } = await ok(admin, "GET", `/${slug}/roles`);
  const role = roles.find((r: any) => r.key === roleKey);
  const { link } = await ok(admin, "POST", `/${slug}/invitations`, { email: who.email, roleId: role.id, ...extra });
  const token = link.split("/invite/")[1];
  await ok(who, "POST", `/invitations/${token}/accept`);
  const { me } = await ok(who, "GET", `/${slug}`);
  return me.membershipId as number;
}

// ── Fixture: two tenants ────────────────────────────────────────────────────
let platform: Actor, adminA: Actor, adminB: Actor, headA: Actor, memberA: Actor, otherA: Actor, dual: Actor, outsider: Actor;
let slugA = "", slugB = "";
let committeeA1 = 0, committeeA2 = 0, projectA1 = 0, projectA2 = 0, projectB = 0, taskB = 0, eventB = 0;
let memberAId = 0, otherAId = 0, headAId = 0, dualInB = 0;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  platform = await makeUser("platform", { platformAdmin: true });
  adminA = await makeUser("adminA", { platformAdmin: true });
  adminB = await makeUser("adminB", { platformAdmin: true });
  headA = await makeUser("headA");
  memberA = await makeUser("memberA");
  otherA = await makeUser("otherA");
  dual = await makeUser("dual");
  outsider = await makeUser("outsider");

  slugA = `alpha-${run}`;
  slugB = `beta-${run}`;
  await ok(adminA, "POST", "/", { name: "Alpha Org", slug: slugA });
  await ok(adminB, "POST", "/", { name: "Beta Org", slug: slugB });

  committeeA1 = (await ok(adminA, "POST", `/${slugA}/committees`, { name: "Technology" })).committee.id;
  committeeA2 = (await ok(adminA, "POST", `/${slugA}/committees`, { name: "Climate" })).committee.id;

  headAId = await invite(adminA, slugA, headA, "committee_head");
  memberAId = await invite(adminA, slugA, memberA, "member");
  otherAId = await invite(adminA, slugA, otherA, "member");
  await invite(adminA, slugA, dual, "org_admin");
  dualInB = await invite(adminB, slugB, dual, "member");

  await ok(adminA, "POST", `/${slugA}/committees/${committeeA1}/members`, { membershipId: headAId, role: "head" });
  await ok(adminA, "POST", `/${slugA}/committees/${committeeA1}/members`, { membershipId: memberAId });

  projectA1 = (await ok(adminA, "POST", `/${slugA}/projects`, { title: "Tech project", committeeId: committeeA1 })).project.id;
  projectA2 = (await ok(adminA, "POST", `/${slugA}/projects`, { title: "Climate project", committeeId: committeeA2 })).project.id;
  projectB = (await ok(adminB, "POST", `/${slugB}/projects`, { title: "Beta secret project" })).project.id;
  taskB = (await ok(adminB, "POST", `/${slugB}/tasks`, { title: "Beta secret task", projectId: projectB })).task.id;
  eventB = (await ok(adminB, "POST", `/${slugB}/events`, { title: "Beta event", startsAt: new Date(Date.now() + 86400000).toISOString() })).event.id;
});

after(async () => {
  server?.close();
  await pool.end();
});

describe("tenant isolation", () => {
  test("non-members get 404 for another organisation", async () => {
    assert.equal((await api(adminA, "GET", `/${slugB}`)).status, 404);
    assert.equal((await api(outsider, "GET", `/${slugA}/projects`)).status, 404);
  });

  test("platform admins have no implicit access to tenant data", async () => {
    assert.equal((await api(platform, "GET", `/${slugA}`)).status, 404);
    assert.equal((await api(platform, "GET", `/${slugB}/tasks`)).status, 404);
  });

  test("Tenant B records can't be read through Tenant A's workspace", async () => {
    assert.equal((await api(adminA, "GET", `/${slugA}/projects/${projectB}`)).status, 404);
    assert.equal((await api(adminA, "GET", `/${slugA}/tasks/${taskB}`)).status, 404);
    assert.equal((await api(adminA, "GET", `/${slugA}/events/${eventB}`)).status, 404);
    const { projects } = await ok(adminA, "GET", `/${slugA}/projects`);
    assert.ok(!projects.some((p: any) => p.id === projectB));
    const { tasks } = await ok(adminA, "GET", `/${slugA}/tasks`);
    assert.ok(!tasks.some((t: any) => t.id === taskB));
    const { events } = await ok(adminA, "GET", `/${slugA}/events`);
    assert.ok(!events.some((e: any) => e.id === eventB));
  });

  test("Tenant B records can't be modified through Tenant A's workspace", async () => {
    assert.equal((await api(adminA, "PATCH", `/${slugA}/tasks/${taskB}`, { title: "hacked" })).status, 404);
    assert.equal((await api(adminA, "PATCH", `/${slugA}/projects/${projectB}`, { title: "hacked" })).status, 404);
    assert.equal((await api(adminA, "POST", `/${slugA}/tasks/${taskB}/comments`, { body: "hi" })).status, 404);
    assert.equal((await api(adminA, "POST", `/${slugA}/tasks/${taskB}/submit`, {})).status, 404);
    const { task } = await ok(adminB, "GET", `/${slugB}/tasks/${taskB}`);
    assert.equal(task.title, "Beta secret task");
  });

  test("Tenant B ids are rejected as references inside Tenant A", async () => {
    assert.equal((await api(adminA, "POST", `/${slugA}/tasks`, { title: "x task", projectId: projectB })).status, 400);
    assert.equal((await api(adminA, "POST", `/${slugA}/tasks`, { title: "x task", assigneeMembershipId: dualInB })).status, 400);
    assert.equal((await api(adminA, "POST", `/${slugA}/committees/${committeeA1}/members`, { membershipId: dualInB })).status, 404);
    assert.equal((await api(adminA, "POST", `/${slugA}/tasks/${(await ok(adminA, "POST", `/${slugA}/tasks`, { title: "dep host" })).task.id}/dependencies`, { dependsOnTaskId: taskB })).status, 400);
    const { roles } = await ok(adminB, "GET", `/${slugB}/roles`);
    assert.equal((await api(adminA, "POST", `/${slugA}/invitations`, { email: "x@example.test", roleId: roles[0].id })).status, 400);
  });

  test("a user with roles in two organisations gets each role only in its own tenant", async () => {
    // Admin in A…
    assert.ok((await api(dual, "POST", `/${slugA}/committees`, { name: "Dual-made" })).status < 300);
    // …but an ordinary member in B.
    assert.equal((await api(dual, "POST", `/${slugB}/committees`, { name: "Nope" })).status, 403);
    assert.equal((await api(dual, "GET", `/${slugB}/activity`)).body.full, false);
    const { members } = await ok(dual, "GET", `/${slugB}/members`);
    assert.deepEqual(members.map((m: any) => m.membershipId), [dualInB]);
  });

  test("notifications stay inside their tenant", async () => {
    // dual was assigned work in neither org yet; give them a task in each.
    await ok(adminA, "POST", `/${slugA}/tasks`, { title: "Alpha task for dual", assigneeMembershipId: (await ok(dual, "GET", `/${slugA}`)).me.membershipId });
    await ok(adminB, "POST", `/${slugB}/tasks`, { title: "Beta task for dual", assigneeMembershipId: dualInB });
    await new Promise((r) => setTimeout(r, 300)); // notifications are written asynchronously
    const orgA = (await ok(dual, "GET", `/${slugA}`)).organisation.id;
    const orgB = (await ok(dual, "GET", `/${slugB}`)).organisation.id;
    const inA = (await ok(dual, "GET", `/${slugA}/notifications`)).notifications;
    const inB = (await ok(dual, "GET", `/${slugB}/notifications`)).notifications;
    assert.ok(inA.length > 0 && inA.every((x: any) => x.orgId === orgA));
    assert.ok(inB.length > 0 && inB.every((x: any) => x.orgId === orgB));
    assert.ok(!inA.some((x: any) => x.title.includes("Beta")));
  });
});

describe("role scopes", () => {
  test("a member sees their committee's projects but not other committees'", async () => {
    const { projects } = await ok(memberA, "GET", `/${slugA}/projects`);
    const ids = projects.map((p: any) => p.id);
    assert.ok(ids.includes(projectA1));
    assert.ok(!ids.includes(projectA2));
    assert.equal((await api(memberA, "GET", `/${slugA}/projects/${projectA2}`)).status, 404);
  });

  test("a member can't see other members' contact details or org-wide stats", async () => {
    const { members } = await ok(memberA, "GET", `/${slugA}/members`);
    assert.deepEqual(members.map((m: any) => m.membershipId), [memberAId]);
    assert.equal((await api(memberA, "GET", `/${slugA}/members/${otherAId}`)).status, 404);
    assert.equal((await api(memberA, "GET", `/${slugA}/members-stats`)).status, 403);
    const { people } = await ok(memberA, "GET", `/${slugA}/people`);
    assert.ok(people.length >= 4 && people.every((p: any) => !("email" in p)));
  });

  test("a committee head creates projects only in the committee they lead", async () => {
    assert.ok((await api(headA, "POST", `/${slugA}/projects`, { title: "Head project", committeeId: committeeA1 })).status < 300);
    assert.equal((await api(headA, "POST", `/${slugA}/projects`, { title: "Other committee", committeeId: committeeA2 })).status, 403);
    assert.equal((await api(headA, "PATCH", `/${slugA}/projects/${projectA2}`, { title: "Renamed" })).status, 404);
  });

  test("members can't change roles, invite admins or edit organisation settings", async () => {
    const { roles } = await ok(adminA, "GET", `/${slugA}/roles`);
    const adminRole = roles.find((r: any) => r.key === "org_admin");
    assert.equal((await api(memberA, "PATCH", `/${slugA}/members/${memberAId}`, { roleId: adminRole.id })).status, 403);
    assert.equal((await api(memberA, "POST", `/${slugA}/invitations`, { email: "y@example.test", roleId: adminRole.id })).status, 403);
    assert.equal((await api(memberA, "PATCH", `/${slugA}`, { name: "Renamed" })).status, 403);
    assert.equal((await api(headA, "PATCH", `/${slugA}/roles/${adminRole.id}`, { name: "x" })).status, 403);
  });

  test("the last active administrator can't be demoted or suspended", async () => {
    const { members } = await ok(adminB, "GET", `/${slugB}/members`);
    const self = members.find((m: any) => m.roleKey === "org_admin");
    const { roles } = await ok(adminB, "GET", `/${slugB}/roles`);
    const member = roles.find((r: any) => r.key === "member");
    assert.equal((await api(adminB, "PATCH", `/${slugB}/members/${self.membershipId}`, { roleId: member.id })).status, 409);
    assert.equal((await api(adminB, "PATCH", `/${slugB}/members/${self.membershipId}`, { status: "suspended", reason: "test" })).status, 409);
  });

  test("membership status changes need a reason and are audited", async () => {
    assert.equal((await api(adminA, "PATCH", `/${slugA}/members/${otherAId}`, { status: "inactive" })).status, 400);
    await ok(adminA, "PATCH", `/${slugA}/members/${otherAId}`, { status: "inactive", reason: "No activity for 3 months — review opened" });
    const { events } = await ok(adminA, "GET", `/${slugA}/activity?entityType=membership`);
    const e = events.find((x: any) => x.action === "membership.status_changed" && x.entityId === otherAId);
    assert.ok(e);
    assert.equal(e.reason, "No activity for 3 months — review opened");
    assert.deepEqual(e.after, { status: "inactive" });
    await ok(adminA, "PATCH", `/${slugA}/members/${otherAId}`, { status: "active", reason: "Explained absence" });
  });
});

describe("task validation workflow", () => {
  test("submit → review → completed, with separation of duties and full history", async () => {
    const { task } = await ok(headA, "POST", `/${slugA}/tasks`, {
      title: "Write the forum report", projectId: projectA1, assigneeMembershipId: memberAId, reviewerMembershipId: headAId, evidenceRequired: true,
    });

    // Completion can't be set directly.
    assert.equal((await api(memberA, "PATCH", `/${slugA}/tasks/${task.id}`, { status: "completed" })).status, 400);
    // Evidence is required before submitting.
    assert.equal((await api(memberA, "POST", `/${slugA}/tasks/${task.id}/submit`, {})).status, 400);
    await ok(memberA, "POST", `/${slugA}/tasks/${task.id}/comments`, { kind: "evidence", url: "https://example.org/report.pdf" });
    await ok(memberA, "POST", `/${slugA}/tasks/${task.id}/submit`, { note: "Done" });

    // The assignee can never validate their own work.
    assert.equal((await api(memberA, "POST", `/${slugA}/tasks/${task.id}/review`, { decision: "approve" })).status, 403);
    // Returning work needs a reason.
    assert.equal((await api(headA, "POST", `/${slugA}/tasks/${task.id}/review`, { decision: "return" })).status, 400);
    await ok(headA, "POST", `/${slugA}/tasks/${task.id}/review`, { decision: "return", reason: "Add the attendance numbers" });
    await ok(memberA, "POST", `/${slugA}/tasks/${task.id}/submit`, {});
    const approved = await ok(headA, "POST", `/${slugA}/tasks/${task.id}/review`, { decision: "approve" });
    assert.equal(approved.task.status, "completed");
    assert.equal(approved.task.validatedByMembershipId, headAId);
    assert.equal(approved.task.submittedByMembershipId, memberAId);

    const detail = await ok(memberA, "GET", `/${slugA}/tasks/${task.id}`);
    const actions = detail.history.map((h: any) => h.action);
    for (const a of ["task.created", "task.evidence_added", "task.submitted", "task.returned", "task.approved"]) assert.ok(actions.includes(a), a);
    assert.ok(detail.comments.some((c: any) => c.kind === "review_returned" && c.body === "Add the attendance numbers"));

    // A second approval of the same submission is rejected.
    assert.equal((await api(headA, "POST", `/${slugA}/tasks/${task.id}/review`, { decision: "approve" })).status, 409);
  });

  test("open dependencies block starting and submitting a task", async () => {
    const first = (await ok(adminA, "POST", `/${slugA}/tasks`, { title: "Book venue", projectId: projectA1, assigneeMembershipId: memberAId })).task;
    const second = (await ok(adminA, "POST", `/${slugA}/tasks`, { title: "Send invites", projectId: projectA1, assigneeMembershipId: memberAId, dependsOn: [first.id] })).task;
    assert.equal((await api(memberA, "PATCH", `/${slugA}/tasks/${second.id}`, { status: "in_progress" })).status, 409);
    assert.equal((await api(memberA, "POST", `/${slugA}/tasks/${second.id}/submit`, {})).status, 409);
    // Circular dependencies are refused.
    assert.equal((await api(adminA, "POST", `/${slugA}/tasks/${first.id}/dependencies`, { dependsOnTaskId: second.id })).status, 400);
  });

  test("an assignee can move their task but not reassign or cancel it", async () => {
    const { task } = await ok(adminA, "POST", `/${slugA}/tasks`, { title: "Prepare slides", projectId: projectA1, assigneeMembershipId: memberAId });
    await ok(memberA, "PATCH", `/${slugA}/tasks/${task.id}`, { status: "in_progress" });
    assert.equal((await api(memberA, "PATCH", `/${slugA}/tasks/${task.id}`, { assigneeMembershipId: otherAId })).status, 403);
    assert.equal((await api(memberA, "PATCH", `/${slugA}/tasks/${task.id}`, { status: "cancelled" })).status, 403);
  });

  test("members see only their own audit events", async () => {
    const { events, full } = await ok(memberA, "GET", `/${slugA}/activity`);
    assert.equal(full, false);
    assert.ok(events.length > 0 && events.every((e: any) => e.actorUserId === memberA.id));
  });
});

describe("partial updates", () => {
  test("PATCH changes only the fields sent", async () => {
    const { project } = await ok(adminA, "POST", `/${slugA}/projects`, {
      title: "Patch target", description: "Keep me", priority: "high", status: "active", committeeId: committeeA1,
    });
    const { project: after } = await ok(adminA, "PATCH", `/${slugA}/projects/${project.id}`, { title: "Patched" });
    assert.equal(after.title, "Patched");
    assert.equal(after.description, "Keep me");
    assert.equal(after.priority, "high");
    assert.equal(after.status, "active");
    assert.equal(after.committeeId, committeeA1);
    const { membership } = await ok(adminA, "PATCH", `/${slugA}/members/${memberAId}`, { title: "Ambassador" });
    assert.equal(membership.title, "Ambassador");
  });
});

describe("invitations", () => {
  test("an invitation can only be accepted by the invited email address", async () => {
    const { roles } = await ok(adminA, "GET", `/${slugA}/roles`);
    const member = roles.find((r: any) => r.key === "member");
    const { link } = await ok(adminA, "POST", `/${slugA}/invitations`, { email: `invitee.${run}@example.test`, roleId: member.id });
    const token = link.split("/invite/")[1];
    assert.equal((await api(outsider, "POST", `/invitations/${token}/accept`)).status, 403);
    assert.equal((await api(outsider, "GET", `/${slugA}`)).status, 404);
    assert.equal((await api(outsider, "POST", `/invitations/not-a-real-token/accept`)).status, 404);
  });

  test("a regional coordinator can only invite plain members into their own region", async () => {
    const north = (await ok(adminA, "POST", `/${slugA}/regions`, { name: "North" })).region.id;
    const south = (await ok(adminA, "POST", `/${slugA}/regions`, { name: "South" })).region.id;
    const coord = await makeUser("coord");
    await invite(adminA, slugA, coord, "regional_coordinator", { regionId: north });
    const { roles } = await ok(adminA, "GET", `/${slugA}/roles`);
    const member = roles.find((r: any) => r.key === "member");
    const head = roles.find((r: any) => r.key === "committee_head");
    assert.ok((await api(coord, "POST", `/${slugA}/invitations`, { email: `n.${run}@example.test`, roleId: member.id, regionId: north })).status < 300);
    assert.equal((await api(coord, "POST", `/${slugA}/invitations`, { email: `s.${run}@example.test`, roleId: member.id, regionId: south })).status, 403);
    assert.equal((await api(coord, "POST", `/${slugA}/invitations`, { email: `h.${run}@example.test`, roleId: head.id, regionId: north })).status, 403);
  });
});

describe("performance", () => {
  test("approving a task awards the assignee points exactly once", async () => {
    const { history, total } = await ok(memberA, "GET", `/${slugA}/performance/me`);
    const awards = history.filter((h: any) => h.ruleKey === "task_approved");
    assert.ok(awards.length >= 1 && awards.every((h: any) => h.points === 20 && h.sourceType === "task" && h.sourceId));
    assert.equal(new Set(awards.map((h: any) => h.sourceId)).size, awards.length);
    assert.ok(total >= 20);
  });

  test("manual adjustments need a reason, the right scope, and never your own score", async () => {
    assert.equal((await api(adminA, "POST", `/${slugA}/performance/adjustments`, { membershipId: memberAId, points: 10 })).status, 400);
    assert.equal((await api(memberA, "POST", `/${slugA}/performance/adjustments`, { membershipId: otherAId, points: 10, reason: "Nice work" })).status, 403);
    const { me } = await ok(adminA, "GET", `/${slugA}`);
    assert.equal((await api(adminA, "POST", `/${slugA}/performance/adjustments`, { membershipId: me.membershipId, points: 10, reason: "Self" })).status, 403);
    // A committee head adjusts only members of their committee…
    assert.ok((await api(headA, "POST", `/${slugA}/performance/adjustments`, { membershipId: memberAId, ruleKey: "event_participation", reason: "Attended the forum" })).status < 300);
    assert.equal((await api(headA, "POST", `/${slugA}/performance/adjustments`, { membershipId: otherAId, points: 10, reason: "Not my committee" })).status, 403);
    // …and nobody adjusts across tenants.
    assert.equal((await api(adminB, "POST", `/${slugB}/performance/adjustments`, { membershipId: memberAId, points: 10, reason: "Cross tenant" })).status, 404);
    const { history } = await ok(memberA, "GET", `/${slugA}/performance/me`);
    assert.ok(history.some((h: any) => h.ruleKey === "event_participation" && h.points === 30 && h.reason === "Attended the forum"));
  });

  test("a low score opens a review case but never changes membership on its own", async () => {
    await ok(adminA, "POST", `/${slugA}/performance/adjustments`, { membershipId: otherAId, points: -600, reason: "Test: repeated missed commitments" });
    const { cases } = await ok(adminA, "GET", `/${slugA}/performance/reviews?status=active`);
    const rc = cases.find((c: any) => c.membershipId === otherAId && c.trigger === "low_score");
    assert.ok(rc, "review case opened");
    assert.equal(rc.membershipStatus, "active");
    const mine = await ok(otherA, "GET", `/${slugA}/performance/me`);
    assert.ok(mine.reviewCases.some((c: any) => c.id === rc.id));
    await ok(otherA, "POST", `/${slugA}/performance/reviews/${rc.id}/respond`, { response: "I was sitting exams." });
    assert.equal((await api(otherA, "POST", `/${slugA}/performance/reviews/${rc.id}/decide`, { decision: "no_action", note: "Self-decided" })).status, 403);
    const decided = await ok(adminA, "POST", `/${slugA}/performance/reviews/${rc.id}/decide`, { decision: "support_plan", note: "Agreed a lighter workload until exams end." });
    assert.equal(decided.case.status, "resolved");
    const { members } = await ok(adminA, "GET", `/${slugA}/members`);
    assert.equal(members.find((m: any) => m.membershipId === otherAId).status, "active");
  });

  test("automatic badges are earned at their threshold", async () => {
    await ok(adminA, "POST", `/${slugA}/performance/achievements`, { name: "First steps", icon: "star", autoRule: { type: "points", threshold: 40 } });
    await ok(headA, "POST", `/${slugA}/performance/adjustments`, { membershipId: memberAId, points: 5, reason: "Helped set up the room" });
    const { badges } = await ok(memberA, "GET", `/${slugA}/performance/me`);
    assert.ok(badges.some((b: any) => b.name === "First steps"));
  });

  test("leaderboards only include the organisation's own members", async () => {
    const { leaderboard } = await ok(memberA, "GET", `/${slugA}/performance/leaderboard`);
    assert.ok(leaderboard.some((r: any) => r.membershipId === memberAId));
    assert.ok(!leaderboard.some((r: any) => r.membershipId === dualInB));
  });
});

describe("private files", () => {
  const upload = async (actor: Actor, slug: string, taskId: number, name: string, bytes: Buffer, type: string) => {
    const res = await fetch(`${base}/api/org/${slug}/files?entityType=task&entityId=${taskId}&name=${encodeURIComponent(name)}`, {
      method: "POST", headers: { "x-session-token": actor.token, "content-type": type, "x-forwarded-for": `10.200.0.${n++ & 255}` }, body: bytes,
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  const pdf = Buffer.from("%PDF-1.4\n% test evidence\n%%EOF\n");

  test("evidence files are only served to people who can see the task", async () => {
    const { task } = await ok(headA, "POST", `/${slugA}/tasks`, { title: "Upload the attendance sheet", projectId: projectA1, assigneeMembershipId: memberAId });
    const up = await upload(memberA, slugA, task.id, "attendance.pdf", pdf, "application/pdf");
    assert.equal(up.status, 201);
    const get = (actor: Actor, slug: string) => fetch(`${base}/api/org/${slug}/files/${up.body.file.id}`, { headers: { "x-session-token": actor.token } });
    const okRes = await get(headA, slugA);
    assert.equal(okRes.status, 200);
    assert.equal(Buffer.from(await okRes.arrayBuffer()).toString(), pdf.toString());
    assert.match(okRes.headers.get("content-disposition") ?? "", /attachment/);
    assert.equal((await get(otherA, slugA)).status, 404);
    assert.equal((await get(adminB, slugB)).status, 404);
    assert.equal((await get(outsider, slugA)).status, 404);
    const detail = await ok(memberA, "GET", `/${slugA}/tasks/${task.id}`);
    assert.ok(detail.comments.some((c: any) => c.kind === "evidence" && c.fileName === "attendance.pdf"));
  });

  test("uploads are type-checked by content and need write access", async () => {
    const { task } = await ok(headA, "POST", `/${slugA}/tasks`, { title: "Another evidence task", projectId: projectA1, assigneeMembershipId: memberAId });
    assert.equal((await upload(memberA, slugA, task.id, "invoice.pdf", Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x20]), "application/pdf")).status, 400);
    assert.equal((await upload(memberA, slugA, task.id, "run.exe", Buffer.from([0x4d, 0x5a]), "application/octet-stream")).status, 400);
    assert.equal((await upload(otherA, slugA, task.id, "x.pdf", pdf, "application/pdf")).status, 403);
    assert.equal((await upload(adminB, slugB, task.id, "x.pdf", pdf, "application/pdf")).status, 403);
  });
});

describe("daily jobs", () => {
  test("the cron endpoint needs the secret and sends overdue reminders once", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    assert.equal((await fetch(`${base}/api/cron/daily`)).status, 401);
    assert.equal((await fetch(`${base}/api/cron/daily`, { headers: { authorization: "Bearer wrong-secret-xx" } })).status, 401);
    const { task } = await ok(headA, "POST", `/${slugA}/tasks`, { title: "Long overdue report", projectId: projectA1, assigneeMembershipId: memberAId, dueDate: "2020-01-01" });
    const cron = () => fetch(`${base}/api/cron/daily`, { headers: { authorization: "Bearer test-cron-secret" } });
    assert.equal((await cron()).status, 200);
    await cron();
    await new Promise((r) => setTimeout(r, 300));
    const { notifications } = await ok(memberA, "GET", `/${slugA}/notifications`);
    assert.equal(notifications.filter((x: any) => x.type === "task.overdue" && x.link === `/tasks/${task.id}`).length, 1);
    // Deductions are off by default, so no missed-deadline penalty was applied.
    const { history } = await ok(memberA, "GET", `/${slugA}/performance/me`);
    assert.ok(!history.some((h: any) => h.ruleKey === "missed_deadline"));
  });
});

async function attachPdf(actor: Actor, slug: string, txId: number, name = "receipt.pdf") {
  const res = await fetch(`${base}/api/org/${slug}/files?entityType=transaction&entityId=${txId}&name=${encodeURIComponent(name)}`, {
    method: "POST", headers: { "x-session-token": actor.token, "content-type": "application/pdf", "x-forwarded-for": `10.202.0.${n++ & 255}` },
    body: Buffer.from("%PDF-1.4\n% supporting document\n%%EOF\n"),
  });
  assert.equal(res.status, 201, `attach → ${res.status}`);
  return ((await res.json()) as any).file;
}

describe("finance", () => {
  let treasurer: Actor;
  let accountId = 0, budgetId = 0, expenseId = 0;

  before(async () => {
    treasurer = await makeUser("treasurer");
    await invite(adminA, slugA, treasurer, "treasurer");
  });

  test("members have no access to finance records", async () => {
    assert.equal((await api(memberA, "GET", `/${slugA}/finance/summary`)).status, 403);
    assert.equal((await api(memberA, "GET", `/${slugA}/finance/accounts`)).status, 403);
    assert.deepEqual((await ok(memberA, "GET", `/${slugA}/finance/transactions`)).transactions, []);
    assert.deepEqual((await ok(memberA, "GET", `/${slugA}/finance/budgets`)).budgets, []);
    assert.equal((await api(memberA, "POST", `/${slugA}/finance/expenses`, { amount: "10", date: "2026-11-01", category: "Food", counterparty: "Cafe", description: "Coffee" })).status, 403);
  });

  test("budgets need a second person to approve them", async () => {
    accountId = (await ok(treasurer, "POST", `/${slugA}/finance/accounts`, { name: "Main bank account", openingBalance: "1000.00" })).account.id;
    const { budget } = await ok(treasurer, "POST", `/${slugA}/finance/budgets`, { name: "Forum budget", projectId: projectA1, ownerMembershipId: headAId, approvedAmount: "5000" });
    budgetId = budget.id;
    assert.equal(budget.approvedAmount, "5000.00");
    assert.equal((await api(treasurer, "POST", `/${slugA}/finance/budgets/${budgetId}/approve`)).status, 403);
    await ok(adminA, "POST", `/${slugA}/finance/budgets/${budgetId}/approve`);
    // Approved amounts change only through a change request.
    assert.equal((await api(treasurer, "PATCH", `/${slugA}/finance/budgets/${budgetId}`, { approvedAmount: "9000" })).status, 409);
  });

  test("a delegated budget owner submits expenses; approval and payment are separated", async () => {
    // headA has no finance permissions but owns the delegated budget.
    assert.equal((await api(headA, "GET", `/${slugA}/finance/summary`)).status, 403);
    const { budgets } = await ok(headA, "GET", `/${slugA}/finance/budgets`);
    assert.deepEqual(budgets.map((b: any) => b.id), [budgetId]);
    assert.equal((await api(headA, "POST", `/${slugA}/finance/expenses`, { amount: "10.005", date: "2026-11-02", category: "Venue", counterparty: "Hotel", description: "Deposit", budgetId })).status, 400);
    const { transaction } = await ok(headA, "POST", `/${slugA}/finance/expenses`, { amount: "1234.5", date: "2026-11-02", category: "Venue", counterparty: "Hotel Rabat", description: "Venue deposit", budgetId });
    expenseId = transaction.id;
    assert.equal(transaction.amount, "1234.50");
    assert.equal(transaction.status, "submitted");
    assert.match(transaction.reference, /^EXP-\d{4}-\d{4}$/);
    assert.equal(transaction.projectId, projectA1); // inherited from the budget
    assert.equal((await api(headA, "POST", `/${slugA}/finance/transactions/${expenseId}/approve`)).status, 403);
    assert.equal((await api(treasurer, "POST", `/${slugA}/finance/transactions/${expenseId}/pay`, { accountId })).status, 409); // not approved yet
    await ok(treasurer, "POST", `/${slugA}/finance/transactions/${expenseId}/approve`);
    // Every accounting entry needs its supporting document.
    assert.equal((await api(treasurer, "POST", `/${slugA}/finance/transactions/${expenseId}/pay`, { accountId })).status, 400);
    await attachPdf(headA, slugA, expenseId, "hotel-invoice.pdf");
    const paid = await ok(treasurer, "POST", `/${slugA}/finance/transactions/${expenseId}/pay`, { accountId });
    assert.equal(paid.transaction.status, "paid");
    const after = (await ok(treasurer, "GET", `/${slugA}/finance/budgets`)).budgets.find((b: any) => b.id === budgetId);
    assert.equal(after.spent, "1234.50");
    assert.equal(after.remaining, "3765.50");
  });

  test("nobody approves their own expense", async () => {
    const { transaction } = await ok(treasurer, "POST", `/${slugA}/finance/expenses`, { amount: "50", date: "2026-11-03", category: "Transport", counterparty: "Taxi", description: "Taxi to venue", costCenter: "general" });
    assert.equal((await api(treasurer, "POST", `/${slugA}/finance/transactions/${transaction.id}/approve`)).status, 403);
  });

  test("posted entries are immutable; corrections are linked reversals", async () => {
    assert.equal((await api(treasurer, "PATCH", `/${slugA}/finance/transactions/${expenseId}`, { description: "Changed" })).status, 409);
    assert.equal((await api(treasurer, "POST", `/${slugA}/finance/transactions/${expenseId}/cancel`, { reason: "Oops" })).status, 409);
    assert.equal((await api(treasurer, "POST", `/${slugA}/finance/transactions/${expenseId}/reverse`, {})).status, 400); // reason required
    const { reversal } = await ok(treasurer, "POST", `/${slugA}/finance/transactions/${expenseId}/reverse`, { reason: "Duplicate payment, refunded by hotel" });
    assert.equal(reversal.reversesId, expenseId);
    assert.equal(reversal.direction, "in");
    assert.equal(reversal.amount, "1234.50");
    assert.equal((await api(treasurer, "POST", `/${slugA}/finance/transactions/${expenseId}/reverse`, { reason: "Again" })).status, 409);
    const original = await ok(treasurer, "GET", `/${slugA}/finance/transactions/${expenseId}`);
    assert.equal(original.transaction.status, "paid");
    assert.equal(original.transaction.reversedById, reversal.id);
    assert.ok(original.history.some((h: any) => h.action === "finance.transaction_reversed" && h.reason === "Duplicate payment, refunded by hotel"));
    const b = (await ok(treasurer, "GET", `/${slugA}/finance/budgets`)).budgets.find((x: any) => x.id === budgetId);
    assert.equal(b.spent, "0.00");
    const { accounts } = await ok(treasurer, "GET", `/${slugA}/finance/accounts`);
    assert.equal(accounts.find((a: any) => a.id === accountId).balance, "1000.00");
  });

  test("budget changes are requested, decided by someone else, and keep both values", async () => {
    const { change } = await ok(headA, "POST", `/${slugA}/finance/budgets/${budgetId}/changes`, { newAmount: "6500", reason: "More attendees confirmed" });
    assert.equal(change.previousAmount, "5000.00");
    assert.equal(change.newAmount, "6500.00");
    await ok(treasurer, "POST", `/${slugA}/finance/budget-changes/${change.id}/decide`, { decision: "approve" });
    const b = (await ok(treasurer, "GET", `/${slugA}/finance/budgets`)).budgets.find((x: any) => x.id === budgetId);
    assert.equal(b.approvedAmount, "6500.00");
    const { change: own } = await ok(treasurer, "POST", `/${slugA}/finance/budgets/${budgetId}/changes`, { newAmount: "7000", reason: "Buffer" });
    assert.equal((await api(treasurer, "POST", `/${slugA}/finance/budget-changes/${own.id}/decide`, { decision: "approve" })).status, 403);
  });

  test("finance is isolated between tenants and exports need permission", async () => {
    assert.equal((await api(adminB, "GET", `/${slugB}/finance/transactions/${expenseId}`)).status, 404);
    assert.ok(!(await ok(adminB, "GET", `/${slugB}/finance/transactions`)).transactions.some((t: any) => t.id === expenseId));
    assert.equal((await api(adminB, "POST", `/${slugB}/finance/expenses`, { amount: "5", date: "2026-11-01", category: "x", counterparty: "y", description: "Cross", budgetId })).status, 400);
    assert.equal((await api(memberA, "GET", `/${slugA}/finance/export.csv`)).status, 403);
    const res = await fetch(`${base}/api/org/${slugA}/finance/export.csv`, { headers: { "x-session-token": treasurer.token } });
    assert.equal(res.status, 200);
    const csv = await res.text();
    assert.match(csv, /reference,date,kind,status/);
    assert.match(csv, /Venue deposit/);
  });

  test("receipts on transactions are private to finance and the requester", async () => {
    const pdf = Buffer.from("%PDF-1.4\n% receipt\n%%EOF\n");
    const up = await fetch(`${base}/api/org/${slugA}/files?entityType=transaction&entityId=${expenseId}&name=receipt.pdf`, {
      method: "POST", headers: { "x-session-token": headA.token, "content-type": "application/pdf", "x-forwarded-for": `10.201.0.${n++ & 255}` }, body: pdf,
    });
    assert.equal(up.status, 201);
    const { file } = await up.json() as any;
    const get = (a: Actor) => fetch(`${base}/api/org/${slugA}/files/${file.id}`, { headers: { "x-session-token": a.token } });
    assert.equal((await get(treasurer)).status, 200);
    assert.equal((await get(headA)).status, 200);
    assert.equal((await get(memberA)).status, 404);
  });
});

describe("sponsor portal", () => {
  let sponsorUser: Actor, otherSponsorUser: Actor;
  let sponsorId = 0, otherSponsorId = 0, sharedTxId = 0;

  const joinAsSponsor = async (sid: number, who: Actor) => {
    const { link } = await ok(adminA, "POST", `/${slugA}/sponsors/${sid}/contacts`, { email: who.email });
    await ok(who, "POST", `/invitations/${link.split("/invite/")[1]}/accept`);
  };

  before(async () => {
    sponsorId = (await ok(adminA, "POST", `/${slugA}/sponsors`, { name: "ABC Group" })).sponsor.id;
    otherSponsorId = (await ok(adminA, "POST", `/${slugA}/sponsors`, { name: "Other Foundation" })).sponsor.id;
    await ok(adminA, "POST", `/${slugA}/sponsors/${sponsorId}/projects`, { projectId: projectA1, committedAmount: "50000" });
    await ok(adminA, "POST", `/${slugA}/sponsors/${otherSponsorId}/projects`, { projectId: projectA2, committedAmount: "20000" });
    sponsorUser = await makeUser("sponsor");
    otherSponsorUser = await makeUser("sponsor2");
    await joinAsSponsor(sponsorId, sponsorUser);
    await joinAsSponsor(otherSponsorId, otherSponsorUser);
  });

  test("sponsor accounts can't reach any internal endpoint", async () => {
    for (const p of ["/projects", `/projects/${projectA1}`, "/members", "/people", "/tasks", "/events", "/committees", "/finance/transactions", "/finance/budgets", "/activity", "/dashboard", "/sponsors", "/performance/me", "/roles"]) {
      assert.equal((await api(sponsorUser, "GET", `/${slugA}${p}`)).status, 404, p);
    }
    assert.equal((await api(sponsorUser, "POST", `/${slugA}/tasks`, { title: "Sneaky task" })).status, 404);
  });

  test("the portal shows only the sponsor's own funded projects and contributions", async () => {
    const { transaction: inc } = await ok(adminA, "POST", `/${slugA}/finance/income`, { amount: "25000", date: "2026-11-05", counterparty: "ABC Group", description: "First instalment", fundingType: "sponsorship", projectId: projectA1, sponsorId });
    await attachPdf(adminA, slugA, inc.id, "abc-agreement.pdf");
    await ok(adminA, "POST", `/${slugA}/finance/transactions/${inc.id}/receive`, { accountId: (await ok(adminA, "GET", `/${slugA}/finance/accounts`)).accounts[0].id });
    const portal = await ok(sponsorUser, "GET", `/${slugA}/portal`);
    assert.equal(portal.sponsor.name, "ABC Group");
    assert.deepEqual(portal.projects.map((p: any) => p.id), [projectA1]);
    assert.equal(portal.projects[0].funding.committed, "50000.00");
    assert.equal(portal.projects[0].funding.received, "25000.00");
    assert.equal(portal.projects[0].funding.approvedBudget, "6500.00");
    assert.ok(portal.contributions.some((c: any) => c.amount === "25000.00"));
    const other = await ok(otherSponsorUser, "GET", `/${slugA}/portal`);
    assert.deepEqual(other.projects.map((p: any) => p.id), [projectA2]);
    assert.equal(other.contributions.length, 0);
  });

  test("updates are visible only once published and only to their audience", async () => {
    const { update } = await ok(adminA, "POST", `/${slugA}/sponsor-updates`, { projectId: projectA1, title: "Venue confirmed", body: "We booked the venue." });
    assert.equal((await ok(sponsorUser, "GET", `/${slugA}/portal`)).updates.length, 0);
    await ok(adminA, "POST", `/${slugA}/sponsor-updates/${update.id}/publish`, { publish: true });
    assert.ok((await ok(sponsorUser, "GET", `/${slugA}/portal`)).updates.some((u: any) => u.id === update.id));
    assert.ok(!(await ok(otherSponsorUser, "GET", `/${slugA}/portal`)).updates.some((u: any) => u.id === update.id));
    const { update: named } = await ok(adminA, "POST", `/${slugA}/sponsor-updates`, { projectId: projectA1, title: "Private note", body: "Only for the other foundation.", visibility: "named", sponsorIds: [otherSponsorId] });
    await ok(adminA, "POST", `/${slugA}/sponsor-updates/${named.id}/publish`, { publish: true });
    assert.ok(!(await ok(sponsorUser, "GET", `/${slugA}/portal`)).updates.some((u: any) => u.id === named.id));
  });

  test("financial records are shared explicitly, only from funded projects, and logged", async () => {
    const treasurerish = adminA;
    const { transactions } = await ok(treasurerish, "GET", `/${slugA}/finance/transactions?projectId=${projectA1}`);
    sharedTxId = transactions.find((t: any) => t.kind === "expense").id;
    assert.equal((await ok(sponsorUser, "GET", `/${slugA}/portal`)).shared.transactions.length, 0);
    await ok(adminA, "POST", `/${slugA}/sponsors/${sponsorId}/shares`, { entityType: "transaction", entityId: sharedTxId });
    const portal = await ok(sponsorUser, "GET", `/${slugA}/portal`);
    assert.deepEqual(portal.shared.transactions.map((t: any) => t.id), [sharedTxId]);
    assert.equal((await ok(otherSponsorUser, "GET", `/${slugA}/portal`)).shared.transactions.length, 0);
    // A record from a project the sponsor doesn't fund can't be shared with them.
    const { transaction: foreign } = await ok(adminA, "POST", `/${slugA}/finance/income`, { amount: "100", date: "2026-11-06", counterparty: "Donor", description: "Climate donation", fundingType: "donation", status: "expected", projectId: projectA2 });
    assert.equal((await api(adminA, "POST", `/${slugA}/sponsors/${sponsorId}/shares`, { entityType: "transaction", entityId: foreign.id })).status, 400);
    const { events } = await ok(adminA, "GET", `/${slugA}/activity?entityType=sponsor`);
    assert.ok(events.some((e: any) => e.action === "sponsor.shared" && e.entityId === sponsorId));
  });

  test("shared files are downloadable only by the sponsor they were shared with", async () => {
    const { files } = await ok(adminA, "GET", `/${slugA}/files?entityType=transaction&entityId=${sharedTxId}`);
    const fileId = files[0]?.id;
    assert.ok(fileId, "the receipt uploaded earlier exists");
    const dl = (a: Actor) => fetch(`${base}/api/org/${slugA}/portal/files/${fileId}`, { headers: { "x-session-token": a.token } });
    assert.equal((await dl(sponsorUser)).status, 404);
    await ok(adminA, "POST", `/${slugA}/sponsors/${sponsorId}/shares`, { entityType: "file", entityId: fileId });
    assert.equal((await dl(sponsorUser)).status, 200);
    assert.equal((await dl(otherSponsorUser)).status, 404);
    // Internal members can't use the portal endpoints.
    assert.equal((await dl(memberA)).status, 404);
  });
});

describe("accounting pro", () => {
  let bookkeeper: Actor;
  let cashId = 0, expenseId = 0;

  before(async () => {
    bookkeeper = await makeUser("bookkeeper");
    await invite(adminA, slugA, bookkeeper, "treasurer");
    cashId = (await ok(bookkeeper, "POST", `/${slugA}/finance/accounts`, { name: "Petty cash", kind: "cash", openingBalance: "500" })).account.id;
  });

  test("members can't see the books", async () => {
    for (const p of ["/accounting/overview", "/accounting/journal", "/accounting/balance", "/accounting/fec", "/accounting/statements"]) {
      assert.equal((await api(memberA, "GET", `/${slugA}${p}`)).status, 403, p);
    }
  });

  test("every movement needs a project or general administration, and a valid ICE", async () => {
    const base = { amount: "80", date: "2026-11-10", category: "Catering", counterparty: "Traiteur Atlas", description: "Lunch for volunteers" };
    assert.equal((await api(bookkeeper, "POST", `/${slugA}/finance/expenses`, base)).status, 400);
    assert.equal((await api(bookkeeper, "POST", `/${slugA}/finance/expenses`, { ...base, projectId: projectA1, supplierIce: "123" })).status, 400);
    assert.equal((await api(bookkeeper, "POST", `/${slugA}/finance/income`, { amount: "10", date: "2026-11-10", counterparty: "X", description: "Direct receipt", fundingType: "donation", costCenter: "general", status: "received" })).status, 400);
    const { transaction } = await ok(bookkeeper, "POST", `/${slugA}/finance/expenses`, { ...base, projectId: projectA1, supplierIce: "001234567000089", supplierIf: "12345678" });
    expenseId = transaction.id;
    assert.equal(transaction.supplierIce, "001234567000089");
  });

  test("paying posts a balanced double entry with the right accounts and analytics", async () => {
    await ok(adminA, "POST", `/${slugA}/finance/transactions/${expenseId}/approve`);
    await attachPdf(bookkeeper, slugA, expenseId, "facture-traiteur.pdf");
    await ok(bookkeeper, "POST", `/${slugA}/finance/transactions/${expenseId}/pay`, { accountId: cashId, date: "2026-11-10" });
    const { entries } = await ok(bookkeeper, "GET", `/${slugA}/accounting/journal?year=2026`);
    const e = entries.find((x: any) => x.transactionId === expenseId);
    assert.ok(e, "entry posted");
    assert.equal(e.journalCode, "CA");
    assert.deepEqual(e.lines.map((l: any) => [l.accountCode, l.debit, l.credit]), [["6143", "80.00", "0.00"], ["5161", "0.00", "80.00"]]);
    assert.ok(e.lines.every((l: any) => l.analytic === "Tech project"));
    assert.equal(e.files.length, 1);
    const opening = entries.find((x: any) => x.journalCode === "AN" && x.accountId === cashId);
    assert.deepEqual(opening.lines.map((l: any) => [l.accountCode, l.debit, l.credit]), [["5161", "500.00", "0.00"], ["1111", "0.00", "500.00"]]);
  });

  test("entry numbers are sequential with no gaps", async () => {
    const { entries } = await ok(bookkeeper, "GET", `/${slugA}/accounting/journal?year=2026`);
    const nums = entries.map((x: any) => Number(x.number.split("-")[1])).sort((a: number, b: number) => a - b);
    assert.ok(nums.length >= 4);
    assert.deepEqual(nums, nums.map((_: number, i: number) => i + 1));
    assert.ok(entries.every((x: any) => /^2026-\d{4}$/.test(x.number)));
  });

  test("a reversal posts a contre-passation instead of changing the entry", async () => {
    const before = (await ok(bookkeeper, "GET", `/${slugA}/accounting/journal?year=2026`)).entries.find((x: any) => x.transactionId === expenseId);
    await ok(bookkeeper, "POST", `/${slugA}/finance/transactions/${expenseId}/reverse`, { reason: "Paid twice by mistake" });
    const { entries } = await ok(bookkeeper, "GET", `/${slugA}/accounting/journal?year=2026`);
    const same = entries.find((x: any) => x.id === before.id);
    assert.deepEqual(same.lines, before.lines);
    const contra = entries.find((x: any) => x.reversesEntryId === before.id);
    assert.ok(contra);
    assert.deepEqual(contra.lines.map((l: any) => [l.accountCode, l.debit, l.credit]), [["6143", "0.00", "80.00"], ["5161", "80.00", "0.00"]]);
    assert.equal(contra.files.length, 1); // the original's supporting document
  });

  test("the trial balance and statements balance", async () => {
    const bal = await ok(bookkeeper, "GET", `/${slugA}/accounting/balance?year=2026`);
    assert.equal(bal.balanced, true);
    assert.equal(bal.totals.debit, bal.totals.credit);
    const st = await ok(bookkeeper, "GET", `/${slugA}/accounting/statements?year=2026`);
    assert.equal(st.bilan.totalActif, st.bilan.totalPassif);
    assert.ok(st.cpc.produits.some((p: any) => p.code === "7161"));
  });

  test("FEC export has the agreed columns in order", async () => {
    const fec = await ok(bookkeeper, "GET", `/${slugA}/accounting/fec?year=2026`);
    assert.deepEqual(fec.columns, ["JournalCode", "EcritureNum", "EcritureDate", "CompteNum", "CompteLib", "PieceRef", "PieceDate", "EcritureLib", "Debit", "Credit", "Projet_Analytique"]);
    assert.ok(fec.rows.some((r: any) => r.CompteNum === "6143" && r.Projet_Analytique === "Tech project"));
    const txt = await (await fetch(`${base}/api/org/${slugA}/accounting/fec.txt?year=2026`, { headers: { "x-session-token": bookkeeper.token } })).text();
    assert.equal(txt.replace(/^\uFEFF/, "").split("\r\n")[0], fec.columns.join("|"));
    assert.match(txt, /\|2026\d{4}\|6143\|/);
  });

  test("books are isolated between organisations", async () => {
    const { entries } = await ok(adminB, "GET", `/${slugB}/accounting/journal?year=2026`);
    assert.ok(!entries.some((x: any) => x.transactionId === expenseId));
    assert.equal((await api(adminB, "GET", `/${slugB}/accounting/ledger?year=2026&account=6143`)).status, 200);
  });

  test("a locked period refuses new entries", async () => {
    const { transaction } = await ok(bookkeeper, "POST", `/${slugA}/finance/expenses`, { amount: "20", date: "2026-11-12", category: "Transport", counterparty: "Taxi", description: "Taxi", costCenter: "general" });
    await ok(adminA, "POST", `/${slugA}/finance/transactions/${transaction.id}/approve`);
    await attachPdf(bookkeeper, slugA, transaction.id);
    await ok(bookkeeper, "POST", `/${slugA}/accounting/locks`, { year: 2026, month: 11 });
    const refused = await api(bookkeeper, "POST", `/${slugA}/finance/transactions/${transaction.id}/pay`, { accountId: cashId, date: "2026-11-12" });
    assert.equal(refused.status, 409);
    assert.equal((await ok(bookkeeper, "GET", `/${slugA}/finance/transactions/${transaction.id}`)).transaction.status, "approved");
    await ok(bookkeeper, "POST", `/${slugA}/finance/transactions/${transaction.id}/pay`, { accountId: cashId, date: "2026-12-01" });
    assert.equal((await api(bookkeeper, "POST", `/${slugA}/accounting/locks`, { year: 2026, month: 11 })).status, 409);
  });
});

describe("admin user deletion", () => {
  test("an unfinished Google sign-up (with its own audit entry) can be deleted", async () => {
    const { auditLogsTable } = await import("@workspace/db");
    const admin = await makeUser("deleter", { platformAdmin: true });
    const victim = await makeUser("halfsignup");
    await db.insert(auditLogsTable).values({ actorId: victim.id, action: "auth.oauth_signup", targetType: "user", targetId: victim.id });
    const res = await fetch(`${base}/api/users/${victim.id}`, {
      method: "DELETE",
      headers: { "x-session-token": admin.token, "x-forwarded-for": "10.200.0.1" },
    });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json().catch(() => ({}))));
    const left = await db.select().from(usersTable).where(eq(usersTable.id, victim.id));
    assert.equal(left.length, 0);
  });
});

describe("removing a member from an organisation", () => {
  test("only org-wide editors can remove, never themselves or the last admin, and the person can be re-invited", async () => {
    const leaver = await makeUser("leaver");
    const plain = await makeUser("plainmember");
    const leaverId = await invite(adminA, slugA, leaver, "member");
    await invite(adminA, slugA, plain, "member");
    const { me: adminMe } = await ok(adminA, "GET", `/${slugA}`);

    // The member page tells the UI who may delete.
    assert.equal((await ok(adminA, "GET", `/${slugA}/members/${leaverId}`)).canDelete, true);
    assert.equal((await ok(adminA, "GET", `/${slugA}/members/${adminMe.membershipId}`)).canDelete, false);

    // A plain member can't; another tenant's admin can't even see them; nobody removes themselves.
    assert.equal((await api(plain, "DELETE", `/${slugA}/members/${leaverId}`)).status, 403);
    assert.equal((await api(adminB, "DELETE", `/${slugA}/members/${leaverId}`)).status, 404);
    assert.equal((await api(adminA, "DELETE", `/${slugA}/members/${adminMe.membershipId}`)).status, 403);

    await ok(adminA, "DELETE", `/${slugA}/members/${leaverId}`, { reason: "Left the association" });
    assert.equal((await api(leaver, "GET", `/${slugA}`)).status, 404);
    assert.equal((await api(adminA, "GET", `/${slugA}/members/${leaverId}`)).status, 404);

    // They can come back through a fresh invitation.
    const again = await invite(adminA, slugA, leaver, "member");
    assert.ok(again > 0 && again !== leaverId);
  });
});

describe("view permissions are enforced", () => {
  test("a role with no view permissions sees only their own work", async () => {
    const { role } = await ok(adminA, "POST", `/${slugA}/roles`, { name: `Nothing ${run}`, scope: "organisation", permissions: [] });
    const nobody = await makeUser("noview");
    const { link } = await ok(adminA, "POST", `/${slugA}/invitations`, { email: nobody.email, roleId: role.id });
    await ok(nobody, "POST", `/invitations/${link.split("/invite/")[1]}/accept`);
    const { me } = await ok(nobody, "GET", `/${slugA}`);
    // Put them in a committee and give them a project task: membership alone must not reveal everything.
    await ok(adminA, "POST", `/${slugA}/committees/${committeeA1}/members`, { membershipId: me.membershipId });
    await ok(adminA, "POST", `/${slugA}/events`, { title: "Org-wide gala", startsAt: new Date(Date.now() + 86400000).toISOString() });
    const mine = (await ok(adminA, "POST", `/${slugA}/tasks`, { title: "Their own task", projectId: projectA1, assigneeMembershipId: me.membershipId })).task.id;

    assert.equal((await ok(nobody, "GET", `/${slugA}/projects`)).projects.length, 0);
    assert.equal((await ok(nobody, "GET", `/${slugA}/events`)).events.length, 0);
    assert.equal((await api(nobody, "GET", `/${slugA}/projects/${projectA1}`)).status, 404);
    const members = (await ok(nobody, "GET", `/${slugA}/members`)).members;
    assert.deepEqual(members.map((m: any) => m.membershipId), [me.membershipId]);
    // Committees: only the one they belong to.
    assert.deepEqual((await ok(nobody, "GET", `/${slugA}/committees`)).committees.map((c: any) => c.id), [committeeA1]);
    assert.equal((await api(nobody, "GET", `/${slugA}/committees/${committeeA2}`)).status, 404);
    // Their own assigned work stays reachable.
    const tasks = (await ok(nobody, "GET", `/${slugA}/tasks`)).tasks;
    assert.deepEqual(tasks.map((t: any) => t.id), [mine]);
  });
});

describe("membership dues", () => {
  test("first year is joining + annual, renewals are annual, and only managers can record payments", async () => {
    const payer = await makeUser("payer");
    const payerId = await invite(adminA, slugA, payer, "member");
    const fresh = await ok(payer, "GET", `/${slugA}/dues/me`);
    assert.deepEqual(
      { j: fresh.fees.joiningFee, a: fresh.fees.annualFee, f: fresh.fees.firstYearTotal, r: fresh.fees.renewalFee, cur: fresh.fees.currency },
      { j: 100, a: 200, f: 300, r: 200, cur: "MAD" },
    );
    assert.equal(fresh.verified, false);
    assert.equal(fresh.amountDue, 300);

    // Members can't mark themselves (or others) as paid, or read someone else's dues.
    assert.equal((await api(payer, "POST", `/${slugA}/members/${payerId}/dues`, {})).status, 403);
    assert.equal((await api(memberA, "GET", `/${slugA}/members/${payerId}/dues`)).status, 404);

    const year = fresh.year;
    const first = await ok(adminA, "POST", `/${slugA}/members/${payerId}/dues`, { method: "cash" });
    assert.equal(first.dues.amount, 300);
    assert.equal(first.dues.includesJoiningFee, true);
    assert.equal((await api(adminA, "POST", `/${slugA}/members/${payerId}/dues`, {})).status, 409);

    const after = await ok(payer, "GET", `/${slugA}/dues/me`);
    assert.equal(after.verified, true);
    assert.equal(after.amountDue, 0);
    assert.equal((await ok(payer, "GET", `/${slugA}`)).me.verified, true);
    const row = (await ok(adminA, "GET", `/${slugA}/members`)).members.find((m: any) => m.membershipId === payerId);
    assert.equal(row.verified, true);

    // Next year is a renewal at the annual fee.
    const renewal = await ok(adminA, "POST", `/${slugA}/members/${payerId}/dues`, { year: year + 1 });
    assert.equal(renewal.dues.amount, 200);
    assert.equal(renewal.dues.includesJoiningFee, false);

    // Undo removes the badge.
    await ok(adminA, "DELETE", `/${slugA}/members/${payerId}/dues/${year}`);
    assert.equal((await ok(payer, "GET", `/${slugA}/dues/me`)).verified, false);

    // Fees are editable in settings.
    await ok(adminA, "PATCH", `/${slugA}`, { joiningFee: 150, annualFee: 250 });
    const changed = await ok(payer, "GET", `/${slugA}/dues/fees`);
    assert.equal(changed.fees.firstYearTotal, 400);
    await ok(adminA, "PATCH", `/${slugA}`, { joiningFee: 100, annualFee: 200 });
  });
});

describe("open tasks", () => {
  test("published open tasks can be claimed once by an eligible member and given back", async () => {
    const a = await makeUser("claimerA");
    const b = await makeUser("claimerB");
    const aId = await invite(adminA, slugA, a, "member");
    await invite(adminA, slugA, b, "member");

    // Members can't publish open tasks.
    assert.equal((await api(a, "POST", `/${slugA}/tasks`, { title: "Sneaky open task", openToClaim: true })).status, 403);

    const open = (await ok(adminA, "POST", `/${slugA}/tasks`, { title: "Design the poster", openToClaim: true, assigneeMembershipId: aId })).task;
    assert.equal(open.assigneeMembershipId, null, "an open task starts unassigned");
    const reserved = (await ok(adminA, "POST", `/${slugA}/tasks`, { title: "Tech-only job", openToClaim: true, claimCommitteeId: committeeA1 })).task;

    const listA = (await ok(a, "GET", `/${slugA}/tasks?claimable=true`)).tasks;
    assert.ok(listA.some((t: any) => t.id === open.id && t.canClaim));
    assert.ok(!listA.some((t: any) => t.id === reserved.id), "committee-only tasks are hidden from non-members");
    assert.ok((await ok(memberA, "GET", `/${slugA}/tasks?claimable=true`)).tasks.some((t: any) => t.id === reserved.id && t.canClaim));

    const [r1, r2] = await Promise.all([
      api(a, "POST", `/${slugA}/tasks/${open.id}/claim`),
      api(b, "POST", `/${slugA}/tasks/${open.id}/claim`),
    ]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409], "only one person gets it");
    const winner = r1.status === 200 ? a : b;
    const loser = winner === a ? b : a;
    assert.equal((await api(loser, "POST", `/${slugA}/tasks/${open.id}/release`)).status, 404, "taken tasks disappear for others");
    await ok(winner, "POST", `/${slugA}/tasks/${open.id}/release`);
    await ok(loser, "POST", `/${slugA}/tasks/${open.id}/claim`);
  });
});
