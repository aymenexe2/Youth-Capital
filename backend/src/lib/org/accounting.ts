import {
  db, orgLedgerAccountsTable, orgAccountMappingsTable, orgJournalEntriesTable, orgJournalLinesTable, orgJournalSequencesTable,
  orgAccountingLocksTable, orgFinanceAccountsTable, orgProjectsTable, orgTransactionsTable, type OrgTransaction,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";

// Accounting Pro posting engine. Finance stays the simple input screen; every
// transaction that moves money (expense paid, income received, reversal) is
// turned into a balanced double entry here, in the same database transaction.
//
// Defaults follow the Moroccan chart of accounts (Plan Comptable Marocain) as
// commonly applied to associations. They are editable per organisation and
// MUST be validated by the organisation's accountant before production use.

type Exec = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const DEFAULT_CHART: { code: string; label: string }[] = [
  { code: "1111", label: "Fonds associatif" },
  { code: "1191", label: "Résultat net en instance d'affectation" },
  { code: "4411", label: "Fournisseurs" },
  { code: "5141", label: "Banques" },
  { code: "5146", label: "Autres établissements financiers" },
  { code: "5161", label: "Caisses" },
  { code: "6122", label: "Achats non stockés de matières et fournitures" },
  { code: "6125", label: "Achats de travaux, études et prestations de services" },
  { code: "6131", label: "Locations et charges locatives" },
  { code: "6136", label: "Rémunérations d'intermédiaires et honoraires" },
  { code: "6142", label: "Transports" },
  { code: "6143", label: "Déplacements, missions et réceptions" },
  { code: "6144", label: "Publicité, publications et relations publiques" },
  { code: "6145", label: "Frais postaux et frais de télécommunications" },
  { code: "6147", label: "Services bancaires" },
  { code: "6148", label: "Autres charges externes" },
  { code: "7121", label: "Cotisations des adhérents" },
  { code: "7124", label: "Recettes des manifestations" },
  { code: "7161", label: "Subventions d'exploitation reçues" },
  { code: "7182", label: "Dons reçus" },
  { code: "7188", label: "Autres produits d'exploitation" },
];

export const DEFAULT_MAPPINGS: { kind: "expense_category" | "funding_type"; key: string; accountCode: string }[] = [
  { kind: "expense_category", key: "Venue", accountCode: "6131" },
  { kind: "expense_category", key: "Catering", accountCode: "6143" },
  { kind: "expense_category", key: "Transport", accountCode: "6142" },
  { kind: "expense_category", key: "Accommodation", accountCode: "6143" },
  { kind: "expense_category", key: "Printing & materials", accountCode: "6122" },
  { kind: "expense_category", key: "Communication", accountCode: "6144" },
  { kind: "expense_category", key: "Equipment", accountCode: "6122" },
  { kind: "expense_category", key: "Services", accountCode: "6136" },
  { kind: "expense_category", key: "Fees", accountCode: "6147" },
  { kind: "expense_category", key: "Other", accountCode: "6148" },
  { kind: "funding_type", key: "grant", accountCode: "7161" },
  { kind: "funding_type", key: "public_funding", accountCode: "7161" },
  { kind: "funding_type", key: "sponsorship", accountCode: "7161" },
  { kind: "funding_type", key: "donation", accountCode: "7182" },
  { kind: "funding_type", key: "membership_fees", accountCode: "7121" },
  { kind: "funding_type", key: "event_revenue", accountCode: "7124" },
  { kind: "funding_type", key: "other", accountCode: "7188" },
];

const FALLBACK = { expense: "6148", income: "7188", equity: "1111" };
export const TREASURY_BY_KIND: Record<string, string> = { bank: "5141", cash: "5161", mobile_money: "5146", other: "5141" };
export const GENERAL_ADMIN = "Administration générale";

export class AccountingError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

/** Seeds the chart and mappings for an organisation (idempotent). */
export async function ensureChart(exec: Exec | typeof db, orgId: number) {
  await exec.insert(orgLedgerAccountsTable).values(DEFAULT_CHART.map((a) => ({ orgId, ...a }))).onConflictDoNothing();
  await exec.insert(orgAccountMappingsTable).values(DEFAULT_MAPPINGS.map((m) => ({ orgId, ...m }))).onConflictDoNothing();
}

async function accountLabel(exec: Exec, orgId: number, code: string) {
  const [a] = await exec.select({ label: orgLedgerAccountsTable.label }).from(orgLedgerAccountsTable)
    .where(and(eq(orgLedgerAccountsTable.orgId, orgId), eq(orgLedgerAccountsTable.code, code)));
  return a?.label ?? `Compte ${code}`;
}

async function mappedAccount(exec: Exec, orgId: number, kind: "expense_category" | "funding_type", key: string | null, fallback: string) {
  if (!key) return fallback;
  const [m] = await exec.select({ code: orgAccountMappingsTable.accountCode }).from(orgAccountMappingsTable)
    .where(and(eq(orgAccountMappingsTable.orgId, orgId), eq(orgAccountMappingsTable.kind, kind), eq(orgAccountMappingsTable.key, key)));
  return m?.code ?? fallback;
}

async function treasury(exec: Exec, accountId: number) {
  const [a] = await exec.select().from(orgFinanceAccountsTable).where(eq(orgFinanceAccountsTable.id, accountId));
  if (!a) throw new AccountingError("Finance account not found", 400);
  return { code: a.ledgerCode || TREASURY_BY_KIND[a.kind] || "5141", journal: a.kind === "cash" ? "CA" : "BQ", account: a };
}

export async function isLocked(exec: Exec | typeof db, orgId: number, isoDate: string) {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const rows = await exec.select({ month: orgAccountingLocksTable.month }).from(orgAccountingLocksTable)
    .where(and(eq(orgAccountingLocksTable.orgId, orgId), eq(orgAccountingLocksTable.fiscalYear, year), inArray(orgAccountingLocksTable.month, [0, month])));
  return rows.length > 0;
}

// Gapless: the counter row is incremented inside the posting transaction.
async function nextNumber(exec: Exec, orgId: number, year: number) {
  const [row] = await exec.insert(orgJournalSequencesTable).values({ orgId, fiscalYear: year, last: 1 })
    .onConflictDoUpdate({ target: [orgJournalSequencesTable.orgId, orgJournalSequencesTable.fiscalYear], set: { last: sql`${orgJournalSequencesTable.last} + 1` } })
    .returning({ last: orgJournalSequencesTable.last });
  return `${year}-${String(row.last).padStart(4, "0")}`;
}

type Line = { accountCode: string; label: string; debit: string; credit: string; projectId: number | null; analytic: string | null };

async function writeEntry(exec: Exec, orgId: number, e: {
  journalCode: string; date: string; label: string; transactionId?: number | null; accountId?: number | null;
  pieceRef?: string | null; pieceDate?: string | null; reversesEntryId?: number | null; userId: number | null; lines: Line[];
}) {
  if (await isLocked(exec, orgId, e.date)) {
    throw new AccountingError(`The accounting period for ${e.date.slice(0, 7)} is locked — use a date in an open period`);
  }
  const debit = e.lines.reduce((s, l) => s + Math.round(Number(l.debit) * 100), 0);
  const credit = e.lines.reduce((s, l) => s + Math.round(Number(l.credit) * 100), 0);
  if (debit !== credit || debit === 0) throw new AccountingError("Unbalanced journal entry", 500);
  const year = Number(e.date.slice(0, 4));
  const [entry] = await exec.insert(orgJournalEntriesTable).values({
    orgId, fiscalYear: year, number: await nextNumber(exec, orgId, year), journalCode: e.journalCode, date: e.date, label: e.label.slice(0, 250),
    transactionId: e.transactionId ?? null, accountId: e.accountId ?? null, pieceRef: e.pieceRef ?? null, pieceDate: e.pieceDate ?? null,
    reversesEntryId: e.reversesEntryId ?? null, postedByUserId: e.userId,
  }).returning();
  const labels = new Map<string, string>();
  for (const l of e.lines) if (!labels.has(l.accountCode)) labels.set(l.accountCode, await accountLabel(exec, orgId, l.accountCode));
  await exec.insert(orgJournalLinesTable).values(e.lines.map((l, i) => ({
    orgId, entryId: entry.id, lineNo: i + 1, accountCode: l.accountCode, accountLabel: labels.get(l.accountCode)!, label: l.label.slice(0, 250),
    debit: l.debit, credit: l.credit, projectId: l.projectId, analytic: l.analytic,
  })));
  return entry;
}

async function analyticFor(exec: Exec, t: OrgTransaction) {
  if (!t.projectId) return { projectId: null, analytic: GENERAL_ADMIN };
  const [p] = await exec.select({ title: orgProjectsTable.title }).from(orgProjectsTable).where(eq(orgProjectsTable.id, t.projectId));
  return { projectId: t.projectId, analytic: p?.title ?? `Projet #${t.projectId}` };
}

/**
 * Posts the double entry for a Finance transaction that just moved money.
 * Idempotent: a transaction is posted at most once (unique index).
 */
export async function postTransaction(exec: Exec, t: OrgTransaction, userId: number | null) {
  const [existing] = await exec.select().from(orgJournalEntriesTable).where(eq(orgJournalEntriesTable.transactionId, t.id));
  if (existing) return existing;
  await ensureChart(exec, t.orgId);
  const amount = Number(t.amount).toFixed(2);
  const { projectId, analytic } = await analyticFor(exec, t);
  const piece = { pieceRef: t.externalReference || t.reference, pieceDate: t.date };
  const label = `${t.reference} · ${t.counterparty ? `${t.counterparty} · ` : ""}${t.description}`;

  if (t.kind === "reversal") {
    // Contre-passation: the original entry's lines with debit and credit swapped.
    const [orig] = await exec.select().from(orgJournalEntriesTable).where(eq(orgJournalEntriesTable.transactionId, t.reversesId!));
    if (!orig) throw new AccountingError("The original entry has not been posted yet", 409);
    const lines = await exec.select().from(orgJournalLinesTable).where(eq(orgJournalLinesTable.entryId, orig.id)).orderBy(orgJournalLinesTable.lineNo);
    return writeEntry(exec, t.orgId, {
      journalCode: orig.journalCode, date: t.date, label: `Contre-passation ${orig.number} · ${t.description}`, transactionId: t.id, accountId: t.accountId,
      pieceRef: orig.pieceRef, pieceDate: orig.pieceDate, reversesEntryId: orig.id, userId,
      lines: lines.map((l) => ({ accountCode: l.accountCode, label: `Contre-passation ${orig.number}`, debit: l.credit, credit: l.debit, projectId: l.projectId, analytic: l.analytic })),
    });
  }

  if (!t.accountId) throw new AccountingError("Choose the bank or cash account the money moved through", 400);
  const tre = await treasury(exec, t.accountId);
  if (t.kind === "income") {
    const revenue = await mappedAccount(exec, t.orgId, "funding_type", t.fundingType, FALLBACK.income);
    return writeEntry(exec, t.orgId, {
      journalCode: tre.journal, date: t.date, label, transactionId: t.id, accountId: t.accountId, ...piece, userId,
      lines: [
        { accountCode: tre.code, label, debit: amount, credit: "0.00", projectId, analytic },
        { accountCode: revenue, label, debit: "0.00", credit: amount, projectId, analytic },
      ],
    });
  }
  const charge = await mappedAccount(exec, t.orgId, "expense_category", t.category, FALLBACK.expense);
  return writeEntry(exec, t.orgId, {
    journalCode: tre.journal, date: t.date, label, transactionId: t.id, accountId: t.accountId, ...piece, userId,
    lines: [
      { accountCode: charge, label, debit: amount, credit: "0.00", projectId, analytic },
      { accountCode: tre.code, label, debit: "0.00", credit: amount, projectId, analytic },
    ],
  });
}

/** Opening balance of a bank/cash account: treasury against the association's fund (à-nouveau). */
export async function postOpeningBalance(exec: Exec, accountId: number, userId: number | null) {
  const [existing] = await exec.select({ id: orgJournalEntriesTable.id }).from(orgJournalEntriesTable)
    .where(and(eq(orgJournalEntriesTable.accountId, accountId), eq(orgJournalEntriesTable.journalCode, "AN")));
  if (existing) return null;
  const tre = await treasury(exec, accountId);
  const value = Number(tre.account.openingBalance);
  if (!value) return null;
  await ensureChart(exec, tre.account.orgId);
  const amount = Math.abs(value).toFixed(2);
  const date = tre.account.createdAt.toISOString().slice(0, 10);
  const label = `Solde d'ouverture · ${tre.account.name}`;
  const debitTreasury = value > 0;
  return writeEntry(exec, tre.account.orgId, {
    journalCode: "AN", date, label, accountId, pieceRef: `OUV-${tre.account.id}`, pieceDate: date, userId,
    lines: [
      { accountCode: tre.code, label, debit: debitTreasury ? amount : "0.00", credit: debitTreasury ? "0.00" : amount, projectId: null, analytic: GENERAL_ADMIN },
      { accountCode: FALLBACK.equity, label, debit: debitTreasury ? "0.00" : amount, credit: debitTreasury ? amount : "0.00", projectId: null, analytic: GENERAL_ADMIN },
    ],
  });
}

/** Posts anything that should be in the journal but isn't yet (data from before Accounting Pro). */
export async function backfill(orgId: number, userId: number | null) {
  let posted = 0;
  await ensureChart(db, orgId);
  const accounts = await db.select({ id: orgFinanceAccountsTable.id }).from(orgFinanceAccountsTable).where(eq(orgFinanceAccountsTable.orgId, orgId));
  for (const a of accounts) {
    if (await db.transaction((tx) => postOpeningBalance(tx, a.id, userId))) posted++;
  }
  const pending = await db.select().from(orgTransactionsTable)
    .where(and(eq(orgTransactionsTable.orgId, orgId), inArray(orgTransactionsTable.status, ["paid", "received", "posted"]),
      sql`not exists (select 1 from org_journal_entries e where e.transaction_id = ${orgTransactionsTable.id})`))
    .orderBy(orgTransactionsTable.id);
  const errors: string[] = [];
  for (const t of pending) {
    try {
      await db.transaction((tx) => postTransaction(tx, t, userId));
      posted++;
    } catch (err) {
      errors.push(`${t.reference}: ${(err as Error).message}`);
    }
  }
  return { posted, errors };
}
