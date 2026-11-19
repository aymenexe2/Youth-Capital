import { and, eq, inArray } from "drizzle-orm";
import { db, orgMembershipDuesTable, type Organisation } from "@workspace/db";
import { can, isOrgWide, type OrgContext } from "./context.js";

// Membership dues: the first paid year costs joining + annual, every later year the annual fee.
// A dues row for the current year is what makes someone a "verified" member.

export const duesYear = (org: Pick<Organisation, "timezone">, at = new Date()) =>
  Number(new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone: org.timezone || "Africa/Casablanca" }).format(at));

export function feeSchedule(org: Pick<Organisation, "joiningFee" | "annualFee" | "currency">) {
  const joining = Number(org.joiningFee);
  const annual = Number(org.annualFee);
  return { currency: org.currency, joiningFee: joining, annualFee: annual, firstYearTotal: joining + annual, renewalFee: annual };
}

// Recording payments is for treasurers/approvers or organisation-wide member editors.
export const canManageDues = (ctx: OrgContext) => can(ctx, "finance.approve") || (can(ctx, "members.edit") && isOrgWide(ctx));

export async function duesHistory(orgId: number, membershipId: number) {
  return db.select().from(orgMembershipDuesTable)
    .where(and(eq(orgMembershipDuesTable.orgId, orgId), eq(orgMembershipDuesTable.membershipId, membershipId)))
    .orderBy(orgMembershipDuesTable.year);
}

// Which of these memberships have paid for the given year.
export async function paidSet(orgId: number, year: number, membershipIds?: number[]): Promise<Set<number>> {
  if (membershipIds && membershipIds.length === 0) return new Set();
  const conds = [eq(orgMembershipDuesTable.orgId, orgId), eq(orgMembershipDuesTable.year, year)];
  if (membershipIds) conds.push(inArray(orgMembershipDuesTable.membershipId, membershipIds));
  const rows = await db.select({ id: orgMembershipDuesTable.membershipId }).from(orgMembershipDuesTable).where(and(...conds));
  return new Set(rows.map((r) => r.id));
}

// Summary shown on the profile and member pages.
export async function duesSummary(org: Organisation, membershipId: number) {
  const year = duesYear(org);
  const history = await duesHistory(org.id, membershipId);
  const fees = feeSchedule(org);
  const paidThisYear = history.find((h) => h.year === year) ?? null;
  const everPaid = history.length > 0;
  return {
    year,
    fees,
    verified: !!paidThisYear,
    paidThisYear,
    amountDue: paidThisYear ? 0 : everPaid ? fees.renewalFee : fees.firstYearTotal,
    nextIsFirstYear: !everPaid,
    history: history.map((h) => ({ ...h, amount: Number(h.amount) })),
  };
}
