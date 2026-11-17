import { Router, type IRouter, type Response } from "express";
import {
  db, orgFinanceAccountsTable, orgBudgetsTable, orgBudgetChangesTable, orgTransactionsTable, orgFilesTable, orgProjectsTable,
  orgCommitteesTable, orgMembershipsTable, usersTable, type OrgTransaction, type OrgBudget,
} from "@workspace/db";
import { alias } from "drizzle-orm/pg-core";
import { and, eq, gte, lte, inArray, or, desc, asc, sql, isNull, type SQL } from "drizzle-orm";
import { z } from "zod";
import { validateBody } from "../../middlewares/validate.js";
import { getOrg, can, requirePerm, type OrgContext } from "../../lib/org/context.js";
import { recordOrgAudit, diff } from "../../lib/org/audit.js";
import { notifyMembers } from "../../lib/org/notify.js";
import { badRequest, conflict, forbidden, idParam, isoDate, notFound, optionalId, optionalText, validatePatch } from "./util.js";
import { registerFileEntity } from "./files.js";
import { AccountingError, GENERAL_ADMIN, TREASURY_BY_KIND, postOpeningBalance, postTransaction } from "../../lib/org/accounting.js";

// Finance (brief §4). Restricted module: org-wide access needs finance.view;
// a delegated budget owner sees only their budget; members see only their own
// expense requests. Posted entries are never edited or deleted.

const router: IRouter = Router({ mergeParams: true });

const POSTED = ["paid", "received", "posted"] as const;
const OPEN_EXPENSE = ["submitted", "approved"] as const;
const isPosted = (t: OrgTransaction) => (POSTED as readonly string[]).includes(t.status);

// Accepts 1234.5 or "1234.50"; returns a canonical 2-decimal string.
const amount = z.union([z.string(), z.number()]).transform((v) => String(v).trim().replace(",", "."))
  .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v) && Number(v) > 0, "Enter a positive amount with at most 2 decimals")
  .transform((v) => Number(v).toFixed(2));
const currency = z.string().trim().toUpperCase().length(3);

async function delegatedBudgetIds(ctx: OrgContext) {
  const rows = await db.select({ id: orgBudgetsTable.id }).from(orgBudgetsTable)
    .where(and(eq(orgBudgetsTable.orgId, ctx.org.id), eq(orgBudgetsTable.ownerMembershipId, ctx.membership.id)));
  return rows.map((r) => r.id);
}

async function txVisibility(ctx: OrgContext): Promise<SQL> {
  const tenant = eq(orgTransactionsTable.orgId, ctx.org.id);
  if (can(ctx, "finance.view")) return tenant;
  const budgets = await delegatedBudgetIds(ctx);
  const rules: SQL[] = [eq(orgTransactionsTable.requestedByMembershipId, ctx.membership.id)];
  if (budgets.length) rules.push(inArray(orgTransactionsTable.budgetId, budgets));
  return and(tenant, or(...rules))!;
}

async function findTx(ctx: OrgContext, id: number | null) {
  if (!id) return null;
  const [t] = await db.select().from(orgTransactionsTable).where(and(await txVisibility(ctx), eq(orgTransactionsTable.id, id)));
  return t ?? null;
}

async function findBudget(ctx: OrgContext, id: number | null | undefined): Promise<OrgBudget | null> {
  if (!id) return null;
  const [b] = await db.select().from(orgBudgetsTable).where(and(eq(orgBudgetsTable.id, id), eq(orgBudgetsTable.orgId, ctx.org.id)));
  if (!b) return null;
  return can(ctx, "finance.view") || b.ownerMembershipId === ctx.membership.id ? b : null;
}

// Sequential human-readable references per organisation and year (EXP-2026-0007).
async function nextReference(orgId: number, kind: string) {
  const prefix = `${kind === "income" ? "INC" : kind === "expense" ? "EXP" : "REV"}-${new Date().getFullYear()}-`;
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(orgTransactionsTable)
    .where(and(eq(orgTransactionsTable.orgId, orgId), sql`${orgTransactionsTable.reference} like ${prefix + "%"}`));
  return (offset: number) => `${prefix}${String(Number(n) + 1 + offset).padStart(4, "0")}`;
}

type Exec = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function insertTx(values: Omit<typeof orgTransactionsTable.$inferInsert, "reference">, exec: Exec | typeof db = db) {
  const ref = await nextReference(values.orgId, values.kind);
  for (let i = 0; i < 5; i++) {
    try {
      const [t] = await exec.insert(orgTransactionsTable).values({ ...values, reference: ref(i) }).returning();
      return t;
    } catch (err: any) {
      if ((err?.code ?? err?.cause?.code) !== "23505") throw err;
    }
  }
  throw new Error("Could not allocate a transaction reference");
}

async function evidenceCounts(orgId: number, ids: number[]) {
  if (!ids.length) return new Map<number, number>();
  const rows = await db.select({ id: orgFilesTable.entityId, n: sql<number>`count(*)` }).from(orgFilesTable)
    .where(and(eq(orgFilesTable.orgId, orgId), eq(orgFilesTable.entityType, "transaction"), inArray(orgFilesTable.entityId, ids)))
    .groupBy(orgFilesTable.entityId);
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

// People with finance.approve, to notify about requests waiting for them.
async function approverMembershipIds(orgId: number) {
  const rows = await db.execute<{ id: number }>(sql`
    select m.id from org_memberships m join org_roles r on r.id = m.role_id
    where m.org_id = ${orgId} and m.status = 'active' and (r.key = 'org_admin' or 'finance.approve' = any(r.permissions))`);
  return rows.rows.map((r) => Number(r.id));
}

// Transaction evidence (receipts, invoices, agreements) uses private file storage.
registerFileEntity("transaction", {
  canRead: async (ctx, id) => Boolean(await findTx(ctx, id)),
  canWrite: async (ctx, id) => {
    const t = await findTx(ctx, id);
    if (!t || t.status === "rejected" || t.status === "cancelled") return false;
    return can(ctx, "finance.approve") || t.requestedByMembershipId === ctx.membership.id;
  },
});

// ── Summary ─────────────────────────────────────────────────────────────────

router.get("/finance/summary", requirePerm("finance.view"), async (req, res) => {
  const ctx = getOrg(req);
  const from = typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : `${new Date().getFullYear()}-01-01`;
  const to = typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : `${new Date().getFullYear()}-12-31`;
  const o = ctx.org.id;
  const [totals] = (await db.execute(sql`
    select
      coalesce(sum(case when direction = 'in' and kind = 'income' then amount end), 0) as income,
      coalesce(sum(case when direction = 'out' and kind = 'expense' then amount end), 0) as expenses,
      coalesce(sum(case when kind = 'reversal' then (case when direction = 'in' then -amount else amount end) end), 0) as reversals_net_out
    from org_transactions where org_id = ${o} and status in ('paid','received','posted') and date between ${from} and ${to}`)).rows as any[];
  const [committed] = (await db.execute(sql`
    select coalesce(sum(amount), 0) as committed, count(*) filter (where status = 'submitted') as awaiting
    from org_transactions where org_id = ${o} and kind = 'expense' and status in ('submitted','approved')`)).rows as any[];
  const [expected] = (await db.execute(sql`
    select coalesce(sum(amount), 0) as expected from org_transactions where org_id = ${o} and kind = 'income' and status = 'expected'`)).rows as any[];
  const monthly = (await db.execute(sql`
    select to_char(date_trunc('month', date), 'YYYY-MM') as month,
      coalesce(sum(case when direction = 'in' then amount end), 0) as "in",
      coalesce(sum(case when direction = 'out' then amount end), 0) as "out"
    from org_transactions where org_id = ${o} and status in ('paid','received','posted') and date between ${from} and ${to}
    group by 1 order by 1`)).rows;
  const byCategory = (await db.execute(sql`
    select coalesce(category, 'Uncategorised') as category, sum(amount) as total
    from org_transactions where org_id = ${o} and kind = 'expense' and status in ('paid','posted') and date between ${from} and ${to}
    group by 1 order by 2 desc limit 8`)).rows;
  const missingEvidence = (await db.execute(sql`
    select count(*) as n from org_transactions t where t.org_id = ${o} and t.kind in ('expense','income') and t.status in ('paid','received')
      and not exists (select 1 from org_files f where f.org_id = t.org_id and f.entity_type = 'transaction' and f.entity_id = t.id)`)).rows as any[];
  const budgets = await budgetFigures(ctx, undefined);
  res.json({
    period: { from, to }, currency: ctx.org.currency,
    income: String(totals.income), expenses: (Number(totals.expenses) + Number(totals.reversals_net_out)).toFixed(2),
    committed: String(committed.committed), awaitingApproval: Number(committed.awaiting), expectedIncome: String(expected.expected),
    monthly, byCategory, missingEvidence: Number(missingEvidence[0].n),
    budgets: {
      approved: budgets.filter((b) => b.status === "approved").reduce((s, b) => s + Number(b.approvedAmount), 0).toFixed(2),
      spent: budgets.reduce((s, b) => s + Number(b.spent), 0).toFixed(2),
      committed: budgets.reduce((s, b) => s + Number(b.committed), 0).toFixed(2),
    },
    accounts: await accountFigures(ctx),
  });
});

// ── Accounts ────────────────────────────────────────────────────────────────

async function accountFigures(ctx: OrgContext) {
  const accounts = await db.select().from(orgFinanceAccountsTable).where(eq(orgFinanceAccountsTable.orgId, ctx.org.id)).orderBy(asc(orgFinanceAccountsTable.name));
  const sums = (await db.execute(sql`
    select account_id, coalesce(sum(case when direction = 'in' then amount else -amount end), 0) as net,
      count(*) filter (where not reconciled) as unreconciled
    from org_transactions where org_id = ${ctx.org.id} and status in ('paid','received','posted') and account_id is not null
    group by account_id`)).rows as any[];
  return accounts.map((a) => {
    const s = sums.find((x) => Number(x.account_id) === a.id);
    return { ...a, balance: (Number(a.openingBalance) + Number(s?.net ?? 0)).toFixed(2), unreconciled: Number(s?.unreconciled ?? 0) };
  });
}

router.get("/finance/accounts", requirePerm("finance.view"), async (req, res) => {
  res.json({ accounts: await accountFigures(getOrg(req)) });
});

const AccountSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(["bank", "cash", "mobile_money", "other"]).default("bank"),
  currency: currency.default("MAD"),
  institution: optionalText(120),
  openingBalance: z.union([z.string(), z.number()]).transform((v) => String(v).replace(",", "."))
    .refine((v) => /^-?\d{1,12}(\.\d{1,2})?$/.test(v), "Invalid amount").transform((v) => Number(v).toFixed(2)).default("0.00"),
  archived: z.boolean().optional(),
});

router.post("/finance/accounts", requirePerm("finance.approve"), validateBody(AccountSchema.omit({ archived: true })), async (req, res) => {
  const ctx = getOrg(req);
  let a;
  try {
    a = await db.transaction(async (tx) => {
      const [created] = await tx.insert(orgFinanceAccountsTable)
        .values({ ...req.body, orgId: ctx.org.id, ledgerCode: TREASURY_BY_KIND[req.body.kind] ?? "5141" }).returning();
      await postOpeningBalance(tx, created.id, ctx.userId);
      return created;
    });
  } catch (err) {
    if (sendAccountingError(res, err)) return;
    throw err;
  }
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "finance.account_created", entityType: "account", entityId: a.id, summary: a.name, after: req.body });
  res.status(201).json({ account: a });
});

router.patch("/finance/accounts/:id", requirePerm("finance.approve"), validatePatch(AccountSchema.omit({ currency: true })), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [a] = id ? await db.select().from(orgFinanceAccountsTable).where(and(eq(orgFinanceAccountsTable.id, id), eq(orgFinanceAccountsTable.orgId, ctx.org.id))) : [];
  if (!a) {
    notFound(res, "Account");
    return;
  }
  const { archived, ...rest } = req.body;
  // The opening balance is part of the books: once anything is posted to the account it's fixed.
  if (rest.openingBalance !== undefined && rest.openingBalance !== a.openingBalance) {
    const [used] = await db.select({ id: orgTransactionsTable.id }).from(orgTransactionsTable)
      .where(and(eq(orgTransactionsTable.accountId, a.id), inArray(orgTransactionsTable.status, [...POSTED]))).limit(1);
    if (used) {
      conflict(res, "The opening balance can't change after transactions are posted to this account");
      return;
    }
  }
  const patch = { ...rest, ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}) };
  const [updated] = await db.update(orgFinanceAccountsTable).set(patch).where(eq(orgFinanceAccountsTable.id, a.id)).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "finance.account_updated", entityType: "account", entityId: a.id, summary: updated.name, ...diff(a, patch) });
  res.json({ account: updated });
});

router.post("/finance/accounts/:id/reconcile", requirePerm("finance.approve"), validateBody(z.object({ through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [a] = id ? await db.select().from(orgFinanceAccountsTable).where(and(eq(orgFinanceAccountsTable.id, id), eq(orgFinanceAccountsTable.orgId, ctx.org.id))) : [];
  if (!a) {
    notFound(res, "Account");
    return;
  }
  const updated = await db.update(orgTransactionsTable).set({ reconciled: true })
    .where(and(eq(orgTransactionsTable.accountId, a.id), inArray(orgTransactionsTable.status, [...POSTED]), lte(orgTransactionsTable.date, req.body.through), eq(orgTransactionsTable.reconciled, false)))
    .returning({ id: orgTransactionsTable.id });
  await db.update(orgFinanceAccountsTable).set({ reconciledThrough: req.body.through }).where(eq(orgFinanceAccountsTable.id, a.id));
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "finance.reconciled", entityType: "account", entityId: a.id, summary: a.name, after: { through: req.body.through, transactions: updated.length } });
  res.json({ reconciled: updated.length });
});

// ── Budgets ─────────────────────────────────────────────────────────────────

async function budgetFigures(ctx: OrgContext, only: number[] | undefined) {
  const conds: SQL[] = [eq(orgBudgetsTable.orgId, ctx.org.id)];
  if (only) conds.push(only.length ? inArray(orgBudgetsTable.id, only) : sql`false`);
  const owner = alias(orgMembershipsTable, "owner");
  const ownerUser = alias(usersTable, "owner_user");
  const budgets = await db.select({ b: orgBudgetsTable, projectTitle: orgProjectsTable.title, committeeName: orgCommitteesTable.name, ownerName: ownerUser.fullName })
    .from(orgBudgetsTable)
    .leftJoin(orgProjectsTable, eq(orgProjectsTable.id, orgBudgetsTable.projectId))
    .leftJoin(orgCommitteesTable, eq(orgCommitteesTable.id, orgBudgetsTable.committeeId))
    .leftJoin(owner, eq(owner.id, orgBudgetsTable.ownerMembershipId))
    .leftJoin(ownerUser, eq(ownerUser.id, owner.userId))
    .where(and(...conds)).orderBy(desc(orgBudgetsTable.createdAt));
  const ids = budgets.map((x) => x.b.id);
  const sums = ids.length ? (await db.execute(sql`
    select budget_id,
      coalesce(sum(case when status in ('paid','posted') then (case when direction = 'out' then amount else -amount end) end), 0) as spent,
      coalesce(sum(case when kind = 'expense' and status in ('submitted','approved') then amount end), 0) as committed
    from org_transactions where org_id = ${ctx.org.id} and budget_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) and kind in ('expense','reversal')
    group by budget_id`)).rows as any[] : [];
  const pending = ids.length ? await db.select({ budgetId: orgBudgetChangesTable.budgetId, n: sql<number>`count(*)` }).from(orgBudgetChangesTable)
    .where(and(inArray(orgBudgetChangesTable.budgetId, ids), eq(orgBudgetChangesTable.status, "pending"))).groupBy(orgBudgetChangesTable.budgetId) : [];
  return budgets.map(({ b, ...names }) => {
    const s = sums.find((x) => Number(x.budget_id) === b.id);
    const spent = Number(s?.spent ?? 0), committed = Number(s?.committed ?? 0);
    return {
      ...b, ...names, spent: spent.toFixed(2), committed: committed.toFixed(2),
      remaining: (Number(b.approvedAmount) - spent - committed).toFixed(2),
      pendingChanges: Number(pending.find((p) => p.budgetId === b.id)?.n ?? 0),
      isMine: b.ownerMembershipId === ctx.membership.id,
    };
  });
}

router.get("/finance/budgets", async (req, res) => {
  const ctx = getOrg(req);
  if (can(ctx, "finance.view")) {
    res.json({ budgets: await budgetFigures(ctx, undefined) });
    return;
  }
  res.json({ budgets: await budgetFigures(ctx, await delegatedBudgetIds(ctx)) });
});

const BudgetSchema = z.object({
  name: z.string().trim().min(2).max(160),
  projectId: optionalId,
  committeeId: optionalId,
  ownerMembershipId: optionalId,
  periodStart: isoDate,
  periodEnd: isoDate,
  approvedAmount: amount,
  currency: currency.optional(),
});

async function validateBudgetLinks(ctx: OrgContext, b: { projectId?: number | null; committeeId?: number | null; ownerMembershipId?: number | null }) {
  if (b.projectId && !(await db.select({ id: orgProjectsTable.id }).from(orgProjectsTable).where(and(eq(orgProjectsTable.id, b.projectId), eq(orgProjectsTable.orgId, ctx.org.id))))[0]) return "Project not found";
  if (b.committeeId && !(await db.select({ id: orgCommitteesTable.id }).from(orgCommitteesTable).where(and(eq(orgCommitteesTable.id, b.committeeId), eq(orgCommitteesTable.orgId, ctx.org.id))))[0]) return "Committee not found";
  if (b.ownerMembershipId && !(await db.select({ id: orgMembershipsTable.id }).from(orgMembershipsTable).where(and(eq(orgMembershipsTable.id, b.ownerMembershipId), eq(orgMembershipsTable.orgId, ctx.org.id), eq(orgMembershipsTable.status, "active"))))[0]) return "Budget owner not found";
  return null;
}

router.post("/finance/budgets", requirePerm("finance.approve"), validateBody(BudgetSchema), async (req, res) => {
  const ctx = getOrg(req);
  const err = await validateBudgetLinks(ctx, req.body);
  if (err) {
    badRequest(res, err);
    return;
  }
  const [b] = await db.insert(orgBudgetsTable).values({ ...req.body, currency: req.body.currency ?? ctx.org.currency, orgId: ctx.org.id, createdByMembershipId: ctx.membership.id }).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "finance.budget_created", entityType: "budget", entityId: b.id, summary: b.name, after: req.body });
  notifyMembers(ctx.org.id, ctx.org.slug, (await approverMembershipIds(ctx.org.id)).filter((m) => m !== ctx.membership.id), ctx.userId, {
    type: "finance.budget", title: `Budget awaiting approval: ${b.name}`, link: "/finance?tab=budgets",
  });
  res.status(201).json({ budget: b });
});

// Drafts can be edited freely; an approved amount only changes through a budget change request.
router.patch("/finance/budgets/:id", requirePerm("finance.approve"), validatePatch(BudgetSchema.extend({ status: z.enum(["closed"]) })), async (req, res) => {
  const ctx = getOrg(req);
  const b = await findBudget(ctx, idParam(req));
  if (!b) {
    notFound(res, "Budget");
    return;
  }
  if (b.status !== "draft" && (req.body.approvedAmount !== undefined || req.body.currency !== undefined)) {
    conflict(res, "Approved budgets change amount through a budget change request");
    return;
  }
  const err = await validateBudgetLinks(ctx, req.body);
  if (err) {
    badRequest(res, err);
    return;
  }
  const [updated] = await db.update(orgBudgetsTable).set(req.body).where(eq(orgBudgetsTable.id, b.id)).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "finance.budget_updated", entityType: "budget", entityId: b.id, summary: b.name, ...diff(b, req.body) });
  res.json({ budget: updated });
});

router.post("/finance/budgets/:id/approve", requirePerm("finance.approve"), async (req, res) => {
  const ctx = getOrg(req);
  const b = await findBudget(ctx, idParam(req));
  if (!b) {
    notFound(res, "Budget");
    return;
  }
  if (b.status !== "draft") {
    conflict(res, "Only draft budgets can be approved");
    return;
  }
  if (b.createdByMembershipId === ctx.membership.id) {
    forbidden(res, "A different person must approve the budget you created");
    return;
  }
  const [updated] = await db.update(orgBudgetsTable).set({ status: "approved", approvedByMembershipId: ctx.membership.id, approvedAt: new Date() })
    .where(and(eq(orgBudgetsTable.id, b.id), eq(orgBudgetsTable.status, "draft"))).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "finance.budget_approved", entityType: "budget", entityId: b.id, summary: b.name, after: { approvedAmount: b.approvedAmount } });
  notifyMembers(ctx.org.id, ctx.org.slug, [b.createdByMembershipId, b.ownerMembershipId], ctx.userId, { type: "finance.budget", title: `Budget approved: ${b.name}`, link: "/finance?tab=budgets" });
  res.json({ budget: updated });
});

router.get("/finance/budgets/:id/changes", async (req, res) => {
  const ctx = getOrg(req);
  const b = await findBudget(ctx, idParam(req));
  if (!b) {
    notFound(res, "Budget");
    return;
  }
  const changes = await db.select({ c: orgBudgetChangesTable, requestedBy: usersTable.fullName }).from(orgBudgetChangesTable)
    .leftJoin(orgMembershipsTable, eq(orgMembershipsTable.id, orgBudgetChangesTable.requestedByMembershipId))
    .leftJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
    .where(eq(orgBudgetChangesTable.budgetId, b.id)).orderBy(desc(orgBudgetChangesTable.createdAt));
  res.json({ changes: changes.map(({ c, requestedBy }) => ({ ...c, requestedBy })) });
});

router.post("/finance/budgets/:id/changes", validateBody(z.object({ newAmount: amount, reason: z.string().trim().min(3).max(1000) })), async (req, res) => {
  const ctx = getOrg(req);
  const b = await findBudget(ctx, idParam(req));
  if (!b) {
    notFound(res, "Budget");
    return;
  }
  if (!can(ctx, "finance.approve") && b.ownerMembershipId !== ctx.membership.id) {
    forbidden(res);
    return;
  }
  if (b.status !== "approved") {
    conflict(res, "Only approved budgets need change requests — edit the draft instead");
    return;
  }
  const [c] = await db.insert(orgBudgetChangesTable).values({
    orgId: ctx.org.id, budgetId: b.id, previousAmount: b.approvedAmount, newAmount: req.body.newAmount, reason: req.body.reason, requestedByMembershipId: ctx.membership.id,
  }).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "finance.budget_change_requested", entityType: "budget", entityId: b.id, summary: b.name, reason: req.body.reason, before: { approvedAmount: b.approvedAmount }, after: { approvedAmount: req.body.newAmount } });
  notifyMembers(ctx.org.id, ctx.org.slug, await approverMembershipIds(ctx.org.id), ctx.userId, { type: "finance.budget", title: `Budget change requested: ${b.name}`, body: req.body.reason, link: "/finance?tab=budgets" });
  res.status(201).json({ change: c });
});

router.post("/finance/budget-changes/:id/decide", requirePerm("finance.approve"), validateBody(z.object({ decision: z.enum(["approve", "reject"]), note: optionalText(1000) })), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [c] = id ? await db.select().from(orgBudgetChangesTable).where(and(eq(orgBudgetChangesTable.id, id), eq(orgBudgetChangesTable.orgId, ctx.org.id))) : [];
  if (!c) {
    notFound(res, "Budget change");
    return;
  }
  if (c.status !== "pending") {
    conflict(res, "This change was already decided");
    return;
  }
  if (c.requestedByMembershipId === ctx.membership.id) {
    forbidden(res, "A different person must decide your own change request");
    return;
  }
  const approve = req.body.decision === "approve";
  await db.transaction(async (tx) => {
    await tx.update(orgBudgetChangesTable).set({ status: approve ? "approved" : "rejected", decidedByMembershipId: ctx.membership.id, decisionNote: req.body.note, decidedAt: new Date() })
      .where(eq(orgBudgetChangesTable.id, c.id));
    if (approve) await tx.update(orgBudgetsTable).set({ approvedAmount: c.newAmount }).where(eq(orgBudgetsTable.id, c.budgetId));
  });
  await recordOrgAudit({
    orgId: ctx.org.id, actorUserId: ctx.userId, action: approve ? "finance.budget_change_approved" : "finance.budget_change_rejected", entityType: "budget", entityId: c.budgetId,
    reason: c.reason, before: { approvedAmount: c.previousAmount }, after: approve ? { approvedAmount: c.newAmount } : undefined,
  });
  notifyMembers(ctx.org.id, ctx.org.slug, [c.requestedByMembershipId], ctx.userId, { type: "finance.budget", title: `Budget change ${approve ? "approved" : "rejected"}`, body: req.body.note ?? undefined, link: "/finance?tab=budgets" });
  res.json({ success: true });
});

// ── Transactions ────────────────────────────────────────────────────────────

const requester = alias(orgMembershipsTable, "requester");
const requesterUser = alias(usersTable, "requester_user");
const approver = alias(orgMembershipsTable, "approver");
const approverUser = alias(usersTable, "approver_user");

function txQuery() {
  return db.select({
    t: orgTransactionsTable, projectTitle: orgProjectsTable.title, budgetName: orgBudgetsTable.name, accountName: orgFinanceAccountsTable.name,
    requestedBy: requesterUser.fullName, approvedBy: approverUser.fullName,
  }).from(orgTransactionsTable)
    .leftJoin(orgProjectsTable, eq(orgProjectsTable.id, orgTransactionsTable.projectId))
    .leftJoin(orgBudgetsTable, eq(orgBudgetsTable.id, orgTransactionsTable.budgetId))
    .leftJoin(orgFinanceAccountsTable, eq(orgFinanceAccountsTable.id, orgTransactionsTable.accountId))
    .leftJoin(requester, eq(requester.id, orgTransactionsTable.requestedByMembershipId))
    .leftJoin(requesterUser, eq(requesterUser.id, requester.userId))
    .leftJoin(approver, eq(approver.id, orgTransactionsTable.approvedByMembershipId))
    .leftJoin(approverUser, eq(approverUser.id, approver.userId))
    .$dynamic();
}

function txFilters(q: Record<string, unknown>): SQL[] {
  const conds: SQL[] = [];
  const num = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  if (q.kind === "income" || q.kind === "expense" || q.kind === "reversal") conds.push(eq(orgTransactionsTable.kind, q.kind));
  if (typeof q.status === "string" && q.status) {
    if (q.status === "open") conds.push(inArray(orgTransactionsTable.status, ["expected", "submitted", "approved"]));
    else if (q.status === "posted") conds.push(inArray(orgTransactionsTable.status, [...POSTED]));
    else conds.push(eq(orgTransactionsTable.status, q.status as any));
  }
  if (num(q.projectId)) conds.push(eq(orgTransactionsTable.projectId, num(q.projectId)!));
  if (num(q.budgetId)) conds.push(eq(orgTransactionsTable.budgetId, num(q.budgetId)!));
  if (num(q.accountId)) conds.push(eq(orgTransactionsTable.accountId, num(q.accountId)!));
  if (num(q.sponsorId)) conds.push(eq(orgTransactionsTable.sponsorId, num(q.sponsorId)!));
  if (day(q.from)) conds.push(gte(orgTransactionsTable.date, day(q.from)!));
  if (day(q.to)) conds.push(lte(orgTransactionsTable.date, day(q.to)!));
  return conds;
}

router.get("/finance/transactions", async (req, res) => {
  const ctx = getOrg(req);
  const conds = [await txVisibility(ctx), ...txFilters(req.query)];
  if (req.query.mine === "true") conds.push(eq(orgTransactionsTable.requestedByMembershipId, ctx.membership.id));
  const rows = await txQuery().where(and(...conds)).orderBy(desc(orgTransactionsTable.date), desc(orgTransactionsTable.id)).limit(1000);
  const evidence = await evidenceCounts(ctx.org.id, rows.map((r) => r.t.id));
  res.json({
    transactions: rows.map(({ t, ...n }) => ({ ...t, ...n, evidenceCount: evidence.get(t.id) ?? 0, ...txFlags(ctx, t) })),
    canViewAll: can(ctx, "finance.view"), canApprove: can(ctx, "finance.approve"), canSubmit: can(ctx, "finance.create_expense"),
  });
});

function txFlags(ctx: OrgContext, t: OrgTransaction) {
  const approverRole = can(ctx, "finance.approve");
  const mine = t.requestedByMembershipId === ctx.membership.id;
  return {
    canApprove: approverRole && t.status === "submitted" && !mine,
    canPay: approverRole && t.status === "approved",
    canReceive: approverRole && t.status === "expected",
    canEdit: !isPosted(t) && ["submitted", "expected"].includes(t.status) && (mine || approverRole),
    canCancel: ["submitted", "approved", "expected"].includes(t.status) && (mine || approverRole),
    canReverse: approverRole && isPosted(t) && t.kind !== "reversal" && !t.reversedById,
    canAttach: !["rejected", "cancelled"].includes(t.status) && (mine || approverRole),
  };
}

router.get("/finance/transactions/:id", async (req, res) => {
  const ctx = getOrg(req);
  const t = await findTx(ctx, idParam(req));
  if (!t) {
    notFound(res, "Transaction");
    return;
  }
  const [[row], files, history, related] = await Promise.all([
    txQuery().where(eq(orgTransactionsTable.id, t.id)),
    db.select({ id: orgFilesTable.id, fileName: orgFilesTable.fileName, size: orgFilesTable.size, mimeType: orgFilesTable.mimeType, createdAt: orgFilesTable.createdAt })
      .from(orgFilesTable).where(and(eq(orgFilesTable.orgId, ctx.org.id), eq(orgFilesTable.entityType, "transaction"), eq(orgFilesTable.entityId, t.id))),
    db.execute(sql`select e.*, u.full_name as "actorName" from org_audit_events e left join users u on u.id = e.actor_user_id
      where e.org_id = ${ctx.org.id} and e.entity_type = 'transaction' and e.entity_id = ${t.id} order by e.created_at asc`),
    t.reversesId || t.reversedById
      ? db.select({ id: orgTransactionsTable.id, reference: orgTransactionsTable.reference }).from(orgTransactionsTable)
          .where(and(eq(orgTransactionsTable.orgId, ctx.org.id), inArray(orgTransactionsTable.id, [t.reversesId, t.reversedById].filter((x): x is number => x != null))))
      : Promise.resolve([]),
  ]);
  const { t: _t, ...names } = row;
  res.json({ transaction: { ...t, ...names }, files, history: history.rows, related, ...txFlags(ctx, t) });
});

const ExpenseSchema = z.object({
  amount, currency: currency.optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().trim().min(1).max(80),
  counterparty: z.string().trim().min(1).max(200),
  description: z.string().trim().min(3).max(2000),
  budgetId: optionalId, projectId: optionalId, committeeId: optionalId,
  externalReference: optionalText(120),
  // "general" = general administration (no project). One of project/general is required.
  costCenter: z.enum(["general"]).nullish().transform((v) => v ?? null),
  // Moroccan supplier identifiers: ICE is 15 digits; IF is numeric.
  supplierIce: z.string().trim().regex(/^\d{15}$/, "ICE must be 15 digits").nullish().or(z.literal("")).transform((v) => v || null),
  supplierIf: z.string().trim().regex(/^\d{1,15}$/, "IF must be digits only").nullish().or(z.literal("")).transform((v) => v || null),
});

// Every movement is tied to a project or to general administration (analytical axis).
function costCenterError(projectId: number | null | undefined, costCenter: string | null | undefined) {
  return projectId || costCenter === "general" ? null : "Choose the project this is for, or General administration";
}

async function hasEvidence(orgId: number, transactionId: number) {
  const [f] = await db.select({ id: orgFilesTable.id }).from(orgFilesTable)
    .where(and(eq(orgFilesTable.orgId, orgId), eq(orgFilesTable.entityType, "transaction"), eq(orgFilesTable.entityId, transactionId))).limit(1);
  return Boolean(f);
}

function sendAccountingError(res: Response, err: unknown) {
  if (!(err instanceof AccountingError)) return false;
  res.status(err.status).json({ error: err.status === 400 ? "BadRequest" : "Conflict", message: err.message });
  return true;
}

async function validateTxLinks(ctx: OrgContext, b: { budgetId?: number | null; projectId?: number | null; committeeId?: number | null; accountId?: number | null }) {
  if (b.budgetId) {
    const budget = await findBudget(ctx, b.budgetId);
    if (!budget) return "Budget not found";
    if (budget.status !== "approved") return "Expenses can only be charged to an approved budget";
  }
  if (b.projectId && !(await db.select({ id: orgProjectsTable.id }).from(orgProjectsTable).where(and(eq(orgProjectsTable.id, b.projectId), eq(orgProjectsTable.orgId, ctx.org.id))))[0]) return "Project not found";
  if (b.committeeId && !(await db.select({ id: orgCommitteesTable.id }).from(orgCommitteesTable).where(and(eq(orgCommitteesTable.id, b.committeeId), eq(orgCommitteesTable.orgId, ctx.org.id))))[0]) return "Committee not found";
  if (b.accountId && !(await db.select({ id: orgFinanceAccountsTable.id }).from(orgFinanceAccountsTable).where(and(eq(orgFinanceAccountsTable.id, b.accountId), eq(orgFinanceAccountsTable.orgId, ctx.org.id), isNull(orgFinanceAccountsTable.archivedAt))))[0]) return "Account not found";
  return null;
}

router.post("/finance/expenses", validateBody(ExpenseSchema), async (req, res) => {
  const ctx = getOrg(req);
  const body = req.body as z.infer<typeof ExpenseSchema>;
  const delegated = body.budgetId ? (await delegatedBudgetIds(ctx)).includes(body.budgetId) : false;
  if (!can(ctx, "finance.create_expense") && !delegated) {
    forbidden(res, "You can't submit expenses here");
    return;
  }
  const err = await validateTxLinks(ctx, body);
  if (err) {
    badRequest(res, err);
    return;
  }
  // An expense charged to a budget inherits its project/committee.
  const budget = body.budgetId ? await findBudget(ctx, body.budgetId) : null;
  const projectId = body.projectId ?? budget?.projectId ?? null;
  const ccError = costCenterError(projectId, body.costCenter ?? (budget && !budget.projectId ? "general" : null));
  if (ccError) {
    badRequest(res, ccError);
    return;
  }
  const t = await insertTx({
    ...body, orgId: ctx.org.id, kind: "expense", direction: "out", status: "submitted", currency: body.currency ?? ctx.org.currency,
    projectId, costCenter: projectId ? null : "general", committeeId: body.committeeId ?? budget?.committeeId ?? null,
    requestedByMembershipId: ctx.membership.id,
  });
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "finance.expense_submitted", entityType: "transaction", entityId: t.id, summary: `${t.reference} · ${t.amount} ${t.currency}`, after: body });
  notifyMembers(ctx.org.id, ctx.org.slug, await approverMembershipIds(ctx.org.id), ctx.userId, {
    type: "finance.expense", title: `Expense to review: ${t.amount} ${t.currency}`, body: `${t.reference} — ${t.description}`, link: `/finance?tx=${t.id}`, email: true,
  });
  res.status(201).json({ transaction: t });
});

const IncomeSchema = z.object({
  amount, currency: currency.optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  counterparty: z.string().trim().min(1).max(200),
  description: z.string().trim().min(3).max(2000),
  fundingType: z.enum(["grant", "donation", "sponsorship", "membership_fees", "event_revenue", "public_funding", "other"]),
  status: z.enum(["expected", "received"]).default("expected"),
  accountId: optionalId, projectId: optionalId, committeeId: optionalId, sponsorId: optionalId,
  externalReference: optionalText(120),
  costCenter: z.enum(["general"]).nullish().transform((v) => v ?? null),
});

router.post("/finance/income", requirePerm("finance.approve"), validateBody(IncomeSchema), async (req, res) => {
  const ctx = getOrg(req);
  const body = req.body as z.infer<typeof IncomeSchema>;
  // Posting needs a supporting document, which can only be attached once the
  // entry exists: record it as expected, attach the receipt, then confirm.
  if (body.status === "received") {
    badRequest(res, "Record the income as expected, attach the agreement or bank receipt, then confirm it as received");
    return;
  }
  const ccError = costCenterError(body.projectId, body.costCenter);
  if (ccError) {
    badRequest(res, ccError);
    return;
  }
  const err = await validateTxLinks(ctx, body);
  if (err) {
    badRequest(res, err);
    return;
  }
  const { registerSponsorCheck } = sponsorHooks;
  if (body.sponsorId && !(await registerSponsorCheck(ctx, body.sponsorId))) {
    badRequest(res, "Sponsor not found");
    return;
  }
  const t = await insertTx({
    ...body, orgId: ctx.org.id, kind: "income", direction: "in", currency: body.currency ?? ctx.org.currency, requestedByMembershipId: ctx.membership.id,
    costCenter: body.projectId ? null : "general",
  });
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "finance.income_expected", entityType: "transaction", entityId: t.id, summary: `${t.reference} · ${t.amount} ${t.currency}`, after: body });
  res.status(201).json({ transaction: t });
});

// Lets the sponsor module validate sponsor links without a circular import.
export const sponsorHooks = { registerSponsorCheck: async (_ctx: OrgContext, _id: number) => false };

router.patch("/finance/transactions/:id", validatePatch(ExpenseSchema.omit({ currency: true }).extend({
  fundingType: IncomeSchema.shape.fundingType, accountId: optionalId, sponsorId: optionalId,
})), async (req, res) => {
  const ctx = getOrg(req);
  const t = await findTx(ctx, idParam(req));
  if (!t) {
    notFound(res, "Transaction");
    return;
  }
  if (!txFlags(ctx, t).canEdit) {
    conflict(res, isPosted(t) ? "Posted entries can't be edited — reverse it and record a correction" : "This entry can't be edited now");
    return;
  }
  const err = await validateTxLinks(ctx, req.body);
  if (err) {
    badRequest(res, err);
    return;
  }
  const changes = diff(t, req.body);
  const [updated] = await db.update(orgTransactionsTable).set({ ...req.body, updatedAt: new Date() })
    .where(and(eq(orgTransactionsTable.id, t.id), eq(orgTransactionsTable.status, t.status))).returning();
  if (!updated) {
    conflict(res, "The entry changed while you were editing — reload and try again");
    return;
  }
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "finance.transaction_edited", entityType: "transaction", entityId: t.id, summary: t.reference, ...changes });
  res.json({ transaction: updated });
});

// When `post` is set the journal entry is written in the same database
// transaction: if accounting refuses (e.g. locked period) nothing changes.
async function transition(res: Response, ctx: OrgContext, t: OrgTransaction, from: string, set: Partial<OrgTransaction>, action: string, extra: { reason?: string | null; after?: unknown } = {}, post = false) {
  let updated: OrgTransaction | null;
  try {
    updated = await db.transaction(async (tx) => {
      const [u] = await tx.update(orgTransactionsTable).set({ ...set, updatedAt: new Date() })
        .where(and(eq(orgTransactionsTable.id, t.id), eq(orgTransactionsTable.status, from as any))).returning();
      if (u && post) await postTransaction(tx, u, ctx.userId);
      return u ?? null;
    });
  } catch (err) {
    if (sendAccountingError(res, err)) return null;
    throw err;
  }
  if (!updated) {
    conflict(res, "This entry was already updated by someone else — reload");
    return null;
  }
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action, entityType: "transaction", entityId: t.id, summary: `${t.reference} · ${t.amount} ${t.currency}`, reason: extra.reason ?? null, before: { status: from }, after: { status: updated.status, ...(extra.after as object ?? {}) } });
  return updated;
}

router.post("/finance/transactions/:id/approve", requirePerm("finance.approve"), async (req, res) => {
  const ctx = getOrg(req);
  const t = await findTx(ctx, idParam(req));
  if (!t) {
    notFound(res, "Transaction");
    return;
  }
  if (t.requestedByMembershipId === ctx.membership.id) {
    forbidden(res, "You can't approve your own expense");
    return;
  }
  if (t.status !== "submitted") {
    conflict(res, "Only submitted expenses can be approved");
    return;
  }
  const updated = await transition(res, ctx, t, "submitted", { status: "approved", approvedByMembershipId: ctx.membership.id, approvedAt: new Date() }, "finance.expense_approved");
  if (!updated) return;
  notifyMembers(ctx.org.id, ctx.org.slug, [t.requestedByMembershipId], ctx.userId, { type: "finance.expense", title: `Expense approved: ${t.reference}`, link: `/finance?tx=${t.id}`, email: true });
  res.json({ transaction: updated });
});

router.post("/finance/transactions/:id/reject", requirePerm("finance.approve"), validateBody(z.object({ reason: z.string().trim().min(3).max(1000) })), async (req, res) => {
  const ctx = getOrg(req);
  const t = await findTx(ctx, idParam(req));
  if (!t) {
    notFound(res, "Transaction");
    return;
  }
  if (!["submitted", "approved"].includes(t.status) || t.kind !== "expense") {
    conflict(res, "Only open expenses can be rejected");
    return;
  }
  const updated = await transition(res, ctx, t, t.status, { status: "rejected", rejectionReason: req.body.reason }, "finance.expense_rejected", { reason: req.body.reason });
  if (!updated) return;
  notifyMembers(ctx.org.id, ctx.org.slug, [t.requestedByMembershipId], ctx.userId, { type: "finance.expense", title: `Expense rejected: ${t.reference}`, body: req.body.reason, link: `/finance?tx=${t.id}`, email: true });
  res.json({ transaction: updated });
});

const PostSchema = z.object({ accountId: z.coerce.number().int().positive(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), externalReference: optionalText(120) });

router.post("/finance/transactions/:id/pay", requirePerm("finance.approve"), validateBody(PostSchema), async (req, res) => {
  const ctx = getOrg(req);
  const t = await findTx(ctx, idParam(req));
  if (!t) {
    notFound(res, "Transaction");
    return;
  }
  if (t.status !== "approved") {
    conflict(res, "Only approved expenses can be marked as paid");
    return;
  }
  const err = await validateTxLinks(ctx, { accountId: req.body.accountId });
  if (err) {
    badRequest(res, err);
    return;
  }
  if (!(await hasEvidence(ctx.org.id, t.id))) {
    badRequest(res, "Attach the invoice or receipt before recording the payment — every accounting entry needs a supporting document");
    return;
  }
  const updated = await transition(res, ctx, t, "approved", {
    status: "paid", accountId: req.body.accountId, date: req.body.date ?? t.date, externalReference: req.body.externalReference ?? t.externalReference,
    postedByMembershipId: ctx.membership.id, postedAt: new Date(),
  }, "finance.expense_paid", { after: { accountId: req.body.accountId } }, true);
  if (!updated) return;
  notifyMembers(ctx.org.id, ctx.org.slug, [t.requestedByMembershipId], ctx.userId, {
    type: "finance.expense", title: `Expense paid: ${t.reference}`, body: "Please attach the invoice or receipt if you haven't yet.", link: `/finance?tx=${t.id}`,
  });
  res.json({ transaction: updated });
});

router.post("/finance/transactions/:id/receive", requirePerm("finance.approve"), validateBody(PostSchema), async (req, res) => {
  const ctx = getOrg(req);
  const t = await findTx(ctx, idParam(req));
  if (!t) {
    notFound(res, "Transaction");
    return;
  }
  if (t.status !== "expected") {
    conflict(res, "Only expected income can be confirmed as received");
    return;
  }
  const err = await validateTxLinks(ctx, { accountId: req.body.accountId });
  if (err) {
    badRequest(res, err);
    return;
  }
  if (!(await hasEvidence(ctx.org.id, t.id))) {
    badRequest(res, "Attach the agreement or bank receipt before confirming — every accounting entry needs a supporting document");
    return;
  }
  const updated = await transition(res, ctx, t, "expected", {
    status: "received", accountId: req.body.accountId, date: req.body.date ?? t.date, externalReference: req.body.externalReference ?? t.externalReference,
    postedByMembershipId: ctx.membership.id, postedAt: new Date(),
  }, "finance.income_received", { after: { accountId: req.body.accountId } }, true);
  if (!updated) return;
  res.json({ transaction: updated });
});

router.post("/finance/transactions/:id/cancel", validateBody(z.object({ reason: z.string().trim().min(3).max(1000) })), async (req, res) => {
  const ctx = getOrg(req);
  const t = await findTx(ctx, idParam(req));
  if (!t) {
    notFound(res, "Transaction");
    return;
  }
  if (!txFlags(ctx, t).canCancel) {
    conflict(res, isPosted(t) ? "Posted entries can't be cancelled — reverse them instead" : "This entry can't be cancelled");
    return;
  }
  const updated = await transition(res, ctx, t, t.status, { status: "cancelled", rejectionReason: req.body.reason }, "finance.transaction_cancelled", { reason: req.body.reason });
  if (!updated) return;
  res.json({ transaction: updated });
});

// Corrections never overwrite: a reversal entry cancels the original's effect
// and both stay in the books, linked, with the reason.
router.post("/finance/transactions/:id/reverse", requirePerm("finance.approve"), validateBody(z.object({ reason: z.string().trim().min(3).max(1000) })), async (req, res) => {
  const ctx = getOrg(req);
  const t = await findTx(ctx, idParam(req));
  if (!t) {
    notFound(res, "Transaction");
    return;
  }
  if (!txFlags(ctx, t).canReverse) {
    conflict(res, t.reversedById ? "This entry was already reversed" : "Only posted entries can be reversed");
    return;
  }
  let reversal: OrgTransaction;
  try {
    reversal = await db.transaction(async (tx) => {
      const r = await insertTx({
        orgId: ctx.org.id, kind: "reversal", direction: t.direction === "in" ? "out" : "in", status: "posted", amount: t.amount, currency: t.currency,
        date: new Date().toISOString().slice(0, 10), accountId: t.accountId, budgetId: t.budgetId, projectId: t.projectId, committeeId: t.committeeId,
        sponsorId: t.sponsorId, category: t.category, counterparty: t.counterparty, description: `Reversal of ${t.reference}: ${req.body.reason}`,
        reversesId: t.id, costCenter: t.costCenter, requestedByMembershipId: ctx.membership.id, postedByMembershipId: ctx.membership.id, postedAt: new Date(),
      }, tx);
      const [linked] = await tx.update(orgTransactionsTable).set({ reversedById: r.id })
        .where(and(eq(orgTransactionsTable.id, t.id), isNull(orgTransactionsTable.reversedById))).returning();
      if (!linked) throw new AccountingError("This entry was already reversed");
      await postTransaction(tx, r, ctx.userId);
      return r;
    });
  } catch (err) {
    if (sendAccountingError(res, err)) return;
    throw err;
  }
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "finance.transaction_reversed", entityType: "transaction", entityId: t.id, summary: `${t.reference} → ${reversal.reference}`, reason: req.body.reason, after: { reversalId: reversal.id } });
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "finance.reversal_posted", entityType: "transaction", entityId: reversal.id, summary: reversal.reference, reason: req.body.reason });
  res.status(201).json({ reversal });
});

// ── Project breakdown & money flows ─────────────────────────────────────────

// For each project (and general administration): approved budget, income
// received, actual spend (net of reversals), commitments and what's left.
router.get("/finance/breakdown", requirePerm("finance.view"), async (req, res) => {
  const ctx = getOrg(req);
  const o = ctx.org.id;
  const rows = (await db.execute(sql`
    with money as (
      select project_id,
        sum(case when kind = 'income' and status = 'received' then amount
                 when kind = 'reversal' and direction = 'out' and exists (select 1 from org_transactions x where x.id = t.reverses_id and x.kind = 'income') then -amount else 0 end) as income,
        sum(case when kind = 'expense' and status in ('paid','posted') then amount
                 when kind = 'reversal' and direction = 'in' and exists (select 1 from org_transactions x where x.id = t.reverses_id and x.kind = 'expense') then -amount else 0 end) as spent,
        sum(case when kind = 'expense' and status in ('submitted','approved') then amount else 0 end) as committed
      from org_transactions t where org_id = ${o} group by project_id
    ), budgets as (
      select project_id, sum(approved_amount) as budget from org_budgets where org_id = ${o} and status = 'approved' group by project_id
    )
    select p.id as "projectId", p.title, p.status,
      coalesce(b.budget, 0)::numeric(14,2)::text as budget, coalesce(m.income, 0)::numeric(14,2)::text as income,
      coalesce(m.spent, 0)::numeric(14,2)::text as spent, coalesce(m.committed, 0)::numeric(14,2)::text as committed
    from org_projects p
    left join money m on m.project_id = p.id
    left join budgets b on b.project_id = p.id
    where p.org_id = ${o} and (m.project_id is not null or b.project_id is not null)
    union all
    select null, ${GENERAL_ADMIN}, null,
      coalesce((select budget from budgets where project_id is null), 0)::numeric(14,2)::text,
      coalesce((select income from money where project_id is null), 0)::numeric(14,2)::text,
      coalesce((select spent from money where project_id is null), 0)::numeric(14,2)::text,
      coalesce((select committed from money where project_id is null), 0)::numeric(14,2)::text
    order by 1 nulls last`)).rows as any[];
  res.json({
    currency: ctx.org.currency,
    projects: rows.map((r) => ({
      ...r,
      remainingBudget: (Number(r.budget) - Number(r.spent) - Number(r.committed)).toFixed(2),
      netCash: (Number(r.income) - Number(r.spent)).toFixed(2),
    })),
  });
});

// Money flow for the year: funding source → bank/cash account → project → expense type.
router.get("/finance/flows", requirePerm("finance.view"), async (req, res) => {
  const ctx = getOrg(req);
  const year = Number(req.query.year) || new Date().getFullYear();
  const o = ctx.org.id;
  const [sources, spending] = await Promise.all([
    db.execute(sql`
      select coalesce(t.funding_type, 'other') as source, a.name as account, sum(t.amount)::numeric(14,2)::text as amount
      from org_transactions t join org_finance_accounts a on a.id = t.account_id
      where t.org_id = ${o} and t.kind = 'income' and t.status = 'received' and t.reversed_by_id is null and extract(year from t.date) = ${year}
      group by 1, 2`),
    db.execute(sql`
      select a.name as account, coalesce(p.title, ${GENERAL_ADMIN}) as project, coalesce(t.category, 'Other') as category, sum(t.amount)::numeric(14,2)::text as amount
      from org_transactions t join org_finance_accounts a on a.id = t.account_id left join org_projects p on p.id = t.project_id
      where t.org_id = ${o} and t.kind = 'expense' and t.status in ('paid','posted') and t.reversed_by_id is null and extract(year from t.date) = ${year}
      group by 1, 2, 3`),
  ]);
  res.json({ year, currency: ctx.org.currency, sources: sources.rows, spending: spending.rows });
});

// ── Reports & exports ───────────────────────────────────────────────────────

router.get("/finance/reports/project/:id", requirePerm("finance.view"), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [project] = id ? await db.select().from(orgProjectsTable).where(and(eq(orgProjectsTable.id, id), eq(orgProjectsTable.orgId, ctx.org.id))) : [];
  if (!project) {
    notFound(res, "Project");
    return;
  }
  const budgets = (await budgetFigures(ctx, undefined)).filter((b) => b.projectId === project.id);
  const rows = await txQuery().where(and(eq(orgTransactionsTable.orgId, ctx.org.id), eq(orgTransactionsTable.projectId, project.id), inArray(orgTransactionsTable.status, [...POSTED])))
    .orderBy(asc(orgTransactionsTable.date));
  const files = rows.length ? await db.select({ entityId: orgFilesTable.entityId, id: orgFilesTable.id, fileName: orgFilesTable.fileName })
    .from(orgFilesTable).where(and(eq(orgFilesTable.orgId, ctx.org.id), eq(orgFilesTable.entityType, "transaction"), inArray(orgFilesTable.entityId, rows.map((r) => r.t.id)))) : [];
  const total = (kind: string, dir: string) => rows.filter((r) => r.t.kind === kind && r.t.direction === dir).reduce((s, r) => s + Number(r.t.amount), 0);
  // Reversals of income flow out; reversals of expenses flow back in.
  const income = total("income", "in") - total("reversal", "out");
  const expenses = total("expense", "out") - total("reversal", "in");
  const byCategory: Record<string, number> = {};
  for (const r of rows.filter((x) => x.t.kind === "expense")) byCategory[r.t.category ?? "Uncategorised"] = (byCategory[r.t.category ?? "Uncategorised"] ?? 0) + Number(r.t.amount);
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "finance.report_viewed", entityType: "project", entityId: project.id, summary: project.title });
  res.json({
    project: { id: project.id, title: project.title, startDate: project.startDate, endDate: project.endDate },
    currency: ctx.org.currency, generatedAt: new Date().toISOString(),
    totals: { income: income.toFixed(2), expenses: expenses.toFixed(2), balance: (income - expenses).toFixed(2) },
    budgets, byCategory: Object.entries(byCategory).map(([category, total]) => ({ category, total: total.toFixed(2) })),
    transactions: rows.map(({ t, ...n }) => ({ ...t, ...n, files: files.filter((f) => f.entityId === t.id).map(({ entityId, ...f }) => f) })),
  });
});

// CSV export of the ledger (posted and open entries), filtered like the list.
router.get("/finance/export.csv", requirePerm("finance.export"), async (req, res) => {
  const ctx = getOrg(req);
  const rows = await txQuery().where(and(eq(orgTransactionsTable.orgId, ctx.org.id), ...txFilters(req.query))).orderBy(asc(orgTransactionsTable.date), asc(orgTransactionsTable.id));
  const evidence = await evidenceCounts(ctx.org.id, rows.map((r) => r.t.id));
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // neutralise spreadsheet formulas
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = ["reference", "date", "kind", "status", "direction", "amount", "currency", "category", "counterparty", "description", "funding_type", "project", "budget", "account", "requested_by", "approved_by", "external_reference", "reverses", "reversed_by", "reconciled", "evidence_files"];
  const lines = rows.map(({ t, ...n }) => [
    t.reference, t.date, t.kind, t.status, t.direction, t.amount, t.currency, t.category, t.counterparty, t.description, t.fundingType, n.projectTitle, n.budgetName, n.accountName,
    n.requestedBy, n.approvedBy, t.externalReference, t.reversesId, t.reversedById, t.reconciled, evidence.get(t.id) ?? 0,
  ].map(esc).join(","));
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "finance.exported", entityType: "organisation", entityId: ctx.org.id, after: { rows: rows.length, filters: req.query } });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="finance-${ctx.org.slug}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send("﻿" + [header.join(","), ...lines].join("\n"));
});

export { OPEN_EXPENSE };
export default router;
