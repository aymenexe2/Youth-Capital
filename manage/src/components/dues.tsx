import { useState } from "react";
import { BadgeCheck, CalendarClock, Loader2, Receipt, RotateCcw, Sparkles, Wallet } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { useOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState, Field, IconTile, Pill, Section } from "@/components/primitives";
import { OptionSelect } from "@/components/pickers";
import { FormDialog } from "@/components/forms";

type Fees = { currency: string; joiningFee: number; annualFee: number; firstYearTotal: number; renewalFee: number };
type DuesRow = { id: number; year: number; amount: number; includesJoiningFee: boolean; method: string | null; reference: string | null; note: string | null; paidAt: string };
type Summary = {
  year: number; fees: Fees; verified: boolean; paidThisYear: DuesRow | null; amountDue: number; nextIsFirstYear: boolean; history: DuesRow[]; canManage: boolean;
};

const METHODS = ["cash", "bank_transfer", "card", "mobile_money", "other"] as const;
const METHOD_LABEL: Record<string, string> = { cash: "Cash", bank_transfer: "Bank transfer", card: "Card", mobile_money: "Mobile money", other: "Other" };

// The four amounts of the membership fee schedule.
export function FeeSchedule({ fees }: { fees: Fees }) {
  const { t, lang } = useI18n();
  const money = (n: number) => formatMoney(n, fees.currency, lang);
  const items = [
    { label: t("Annual membership"), value: money(fees.annualFee), hint: t("Every year"), icon: CalendarClock, tone: "blue" as const },
    { label: t("Joining fee"), value: money(fees.joiningFee), hint: t("One time, first year only"), icon: Sparkles, tone: "violet" as const },
    { label: t("Total first-year payment"), value: money(fees.firstYearTotal), hint: t("Joining fee + annual membership"), icon: Wallet, tone: "gold" as const },
    { label: t("Annual renewal"), value: money(fees.renewalFee), hint: t("From the second year"), icon: RotateCcw, tone: "green" as const },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="flex items-start gap-3 rounded-2xl border bg-card p-4">
          <IconTile icon={i.icon} tone={i.tone} size={40} />
          <div className="min-w-0">
            <div className="text-xs font-medium text-muted-foreground">{i.label}</div>
            <div className="text-lg font-bold tabular-nums" dir="ltr">{i.value}</div>
            <div className="text-xs text-muted-foreground">{i.hint}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Dues status + history for one membership. `manage` shows the admin controls (mark paid / undo).
export function MembershipDues({ membershipId, manage = false, showSchedule = false }: { membershipId?: number; manage?: boolean; showSchedule?: boolean }) {
  const { t, lang } = useI18n();
  const { org } = useOrg();
  const q = useOrgQuery<Summary>(manage && membershipId ? `/members/${membershipId}/dues` : "/dues/me");
  const [paying, setPaying] = useState(false);
  const [undoYear, setUndoYear] = useState<number | null>(null);

  const undo = useOrgMutation((year: number, base) => api.del(`${base}/members/${membershipId}/dues/${year}`), {
    success: "Payment record removed", onSuccess: () => setUndoYear(null),
  });

  if (q.isLoading) return <Section title={t("Membership fees")} icon={Receipt}><div className="h-24 animate-pulse rounded-xl bg-muted" /></Section>;
  if (!q.data) return null;
  const d = q.data;
  const money = (n: number) => formatMoney(n, d.fees.currency, lang);
  const canManage = manage && d.canManage && membershipId;

  return (
    <>
      {showSchedule && <FeeSchedule fees={d.fees} />}
      <Section
        title={t("Membership fees")}
        icon={Receipt}
        action={canManage && !d.verified ? <Button size="sm" onClick={() => setPaying(true)}><BadgeCheck />{t("Mark as paid")}</Button> : undefined}
      >
        {d.verified ? (
          <div className="flex items-center gap-3 rounded-xl bg-[#0a84ff]/10 p-3.5 text-sm ring-1 ring-inset ring-[#0a84ff]/25">
            <BadgeCheck className="size-7 shrink-0 fill-[#0a84ff] text-white" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{t("Verified member for {year}", { year: d.year })}</div>
              <div className="text-muted-foreground">
                {t("Paid {amount} on {date}", { amount: money(d.paidThisYear!.amount), date: formatDate(d.paidThisYear!.paidAt, lang, org.timezone) })}
              </div>
            </div>
            {canManage && <Button size="sm" variant="ghost" onClick={() => setUndoYear(d.year)}><RotateCcw />{t("Undo")}</Button>}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl bg-amber-500/10 p-3.5 text-sm ring-1 ring-inset ring-amber-500/30">
            <Wallet className="size-6 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{t("{amount} due for {year}", { amount: money(d.amountDue), year: d.year })}</div>
              <div className="text-muted-foreground">
                {d.nextIsFirstYear ? t("First year: joining fee + annual membership.") : t("Annual renewal.")}{" "}
                {!manage && t("Once an administrator records your payment you'll get the verified badge.")}
              </div>
            </div>
          </div>
        )}

        <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("Payment history")}</h3>
        {d.history.length === 0 ? <EmptyState icon={Receipt} title={t("No payments recorded yet")} className="py-4" /> : (
          <ul className="divide-y divide-border">
            {[...d.history].reverse().map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <span className="w-12 font-semibold tabular-nums">{h.year}</span>
                <span className="font-medium tabular-nums" dir="ltr">{money(h.amount)}</span>
                {h.includesJoiningFee && <Pill tone="violet">{t("incl. joining fee")}</Pill>}
                {h.method && <span className="text-muted-foreground">{t(METHOD_LABEL[h.method] ?? h.method)}</span>}
                {h.reference && <span className="text-muted-foreground" dir="ltr">#{h.reference}</span>}
                <span className="ms-auto text-xs text-muted-foreground">{formatDate(h.paidAt, lang, org.timezone)}</span>
                {canManage && h.year !== d.year && (
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setUndoYear(h.year)} aria-label={t("Undo")}><RotateCcw className="size-3.5" /></Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {canManage && <PayDialog open={paying} onOpenChange={setPaying} membershipId={membershipId!} summary={d} />}
      <AlertDialog open={undoYear != null} onOpenChange={(o) => { if (!o && !undo.isPending) setUndoYear(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Remove the {year} payment?", { year: undoYear ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("Use this if the payment was recorded by mistake. The member loses the verified badge for that year.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={undo.isPending}>{t("Cancel")}</AlertDialogCancel>
            <Button variant="destructive" disabled={undo.isPending} onClick={() => undoYear != null && undo.mutate(undoYear)}>
              {undo.isPending && <Loader2 className="animate-spin" />}{t("Remove payment")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PayDialog({ open, onOpenChange, membershipId, summary }: { open: boolean; onOpenChange: (o: boolean) => void; membershipId: number; summary: Summary }) {
  const { t, lang } = useI18n();
  const [method, setMethod] = useState<string | null>("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const pay = useOrgMutation((body: any, base) => api.post(`${base}/members/${membershipId}/dues`, body), {
    success: "Payment recorded", onSuccess: () => { onOpenChange(false); setReference(""); setNote(""); },
  });
  return (
    <FormDialog
      open={open} onOpenChange={onOpenChange}
      title={t("Record membership payment — {year}", { year: summary.year })}
      description={summary.nextIsFirstYear ? t("First year: joining fee + annual membership.") : t("Annual renewal.")}
      submitLabel={t("Mark as paid")} busy={pay.isPending}
      onSubmit={() => pay.mutate({ method, reference: reference || null, note: note || null })}
    >
      <div className="rounded-xl bg-muted p-3 text-center">
        <div className="text-xs text-muted-foreground">{t("Amount")}</div>
        <div className="text-2xl font-bold tabular-nums" dir="ltr">{formatMoney(summary.amountDue, summary.fees.currency, lang)}</div>
      </div>
      <Field label={t("Payment method")}>
        <OptionSelect value={method} onChange={setMethod} options={METHODS.map((m) => ({ value: m, label: t(METHOD_LABEL[m]) }))} />
      </Field>
      <Field label={t("Reference (optional)")} htmlFor="dues-ref"><Input id="dues-ref" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      <Field label={t("Note (optional)")} htmlFor="dues-note"><Input id="dues-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </FormDialog>
  );
}
