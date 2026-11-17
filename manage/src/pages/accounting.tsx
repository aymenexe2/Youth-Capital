import { Fragment, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, BookOpenCheck, Landmark, CheckCircle2, Download, FileArchive, FileSpreadsheet, FileText, Lock, LockOpen, Paperclip, Plus, RefreshCw, Scale,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api, errorMessage } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { formatDate, formatMoney } from "@/lib/format";
import { EXPENSE_CATEGORIES, FUNDING_TYPE } from "@/lib/labels";
import { useOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Field, LoadingRows, PageHeader, Pill, Section, StatCard } from "@/components/primitives";
import { OptionSelect } from "@/components/pickers";

const JOURNALS: Record<string, string> = { BQ: "Bank", CA: "Cash", AN: "Opening balances", OD: "Miscellaneous" };
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function useAmount() {
  const { lang } = useI18n();
  const { org } = useOrg();
  return (v: string | number) => formatMoney(v, org.currency, lang);
}

export default function AccountingPage() {
  const { t } = useI18n();
  const { can } = useOrg();
  const [year, setYear] = useState(new Date().getFullYear());
  const overview = useOrgQuery<any>(`/accounting/overview?year=${year}`);
  const o = overview.data;
  const backfill = useOrgMutation((_: void, base) => api.post<{ posted: number; errors: string[] }>(`${base}/accounting/backfill`), {
    onSuccess: (d) => {
      toast.success(t("{n} entries posted", { n: d.posted }));
      if (d.errors.length) toast.error(d.errors.slice(0, 3).join(" · "));
    },
  });

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">Accounting Pro</span>}
        description={t("The legal double-entry books, generated automatically from Finance. Entries can't be edited — corrections are reversals.")}
        actions={
          <div className="w-32">
            <OptionSelect value={year} onChange={(v) => setYear(Number(v))} options={(o?.years ?? [year]).map((y: number) => ({ value: y, label: String(y) }))} />
          </div>
        }
      />

      {overview.error ? <ErrorState onRetry={() => overview.refetch()} /> : !o ? <LoadingRows rows={2} /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={t("Journal entries")} value={o.entries} icon={BookOpenCheck} tone="blue" />
            <StatCard label={t("Total debit = total credit")} value={o.balanced ? t("Balanced") : t("Not balanced")} icon={Scale} tone={o.balanced ? "green" : "red"} hint={`${formatMoney(o.debit, o.currency, "fr")}`} />
            <StatCard label={t("Entries without a supporting document")} value={o.missingPieces} icon={Paperclip} tone={o.missingPieces ? "red" : "green"} />
            <StatCard label={t("Expenses without supplier ICE")} value={o.missingSupplierIce} icon={AlertTriangle} tone={o.missingSupplierIce ? "amber" : "green"} />
          </div>
          {o.unposted > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-st-amber/30 bg-st-amber/10 p-4 text-sm">
              <AlertTriangle className="size-4 text-st-amber" />
              <span className="flex-1">{t("{n} paid or received Finance transactions aren't in the journal yet (recorded before Accounting Pro).", { n: o.unposted })}</span>
              {can("accounting.manage") && <Button size="sm" onClick={() => backfill.mutate()} disabled={backfill.isPending}><RefreshCw />{t("Post missing entries")}</Button>}
            </div>
          )}
        </>
      )}

      <Tabs defaultValue="journal">
        <TabsList className="flex-wrap">
          <TabsTrigger value="journal">{t("Journal")}</TabsTrigger>
          <TabsTrigger value="ledger">{t("General ledger")}</TabsTrigger>
          <TabsTrigger value="balance">{t("Trial balance")}</TabsTrigger>
          <TabsTrigger value="statements">{t("CPC & Bilan")}</TabsTrigger>
          <TabsTrigger value="close">{t("Closing & export")}</TabsTrigger>
          <TabsTrigger value="settings">{t("Settings")}</TabsTrigger>
        </TabsList>
        <TabsContent value="journal" className="mt-4"><Journal year={year} /></TabsContent>
        <TabsContent value="ledger" className="mt-4"><Ledger year={year} /></TabsContent>
        <TabsContent value="balance" className="mt-4"><Balance year={year} /></TabsContent>
        <TabsContent value="statements" className="mt-4"><Statements year={year} /></TabsContent>
        <TabsContent value="close" className="mt-4"><Closing year={year} overview={o} /></TabsContent>
        <TabsContent value="settings" className="mt-4"><AccountingSettings /></TabsContent>
      </Tabs>
    </>
  );
}

function PieceLink({ files }: { files: { id: number; fileName: string }[] }) {
  const { t } = useI18n();
  const { slug } = useOrg();
  if (!files?.length) return <span className="inline-flex items-center gap-1 text-xs text-st-red"><Paperclip className="size-3" />{t("missing")}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {files.map((f) => (
        <a key={f.id} href={`${API_URL}/api/org/${slug}/files/${f.id}`} title={f.fileName}
          className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/15">
          <Paperclip className="size-3" />{t("View")}
        </a>
      ))}
    </span>
  );
}

function Journal({ year }: { year: number }) {
  const { t, lang } = useI18n();
  const { org } = useOrg();
  const money = useAmount();
  const [journal, setJournal] = useState<string | null>(null);
  const q = useOrgQuery<{ entries: any[] }>(`/accounting/journal?year=${year}${journal ? `&journal=${journal}` : ""}`);
  return (
    <div className="space-y-3">
      <div className="w-56"><OptionSelect value={journal} onChange={setJournal} allowNone noneLabel={t("All journals")} options={Object.keys(JOURNALS).map((k) => ({ value: k, label: `${k} — ${t(JOURNALS[k])}` }))} /></div>
      <Section bodyClassName="p-0">
        {q.isLoading ? <div className="p-4"><LoadingRows /></div> : (q.data?.entries ?? []).length === 0 ? <EmptyState icon={BookOpenCheck} title={t("No journal entries for this year")} description={t("Entries appear automatically when an expense is paid or income is received in Finance.")} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-start font-medium">{t("N° entry")}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t("Date")}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t("Account")}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t("Label")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("Debit")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("Credit")}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t("Document")}</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.entries.map((e) => (
                  <Fragment key={e.id}>
                    <tr className="border-t border-border bg-muted/40">
                      <td className="px-3 py-2 font-mono text-xs font-semibold">{e.number}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(e.date, lang, org.timezone)}</td>
                      <td className="px-3 py-2 text-xs"><Pill tone={e.reversesEntryId ? "amber" : "neutral"}>{e.journalCode}</Pill></td>
                      <td className="px-3 py-2 text-xs font-medium" colSpan={3}>{e.label}{e.pieceRef && <span className="ms-2 font-mono text-muted-foreground">· {e.pieceRef}</span>}</td>
                      <td className="px-3 py-2">{e.transactionId || e.reversesEntryId ? <PieceLink files={e.files} /> : <span className="text-xs text-muted-foreground">—</span>}</td>
                    </tr>
                    {e.lines.map((l: any) => (
                      <tr key={l.id} className="text-[13px]">
                        <td /><td />
                        <td className="px-3 py-1.5"><span className="font-mono">{l.accountCode}</span> <span className="text-muted-foreground">{l.accountLabel}</span></td>
                        <td className="px-3 py-1.5 text-muted-foreground">{l.analytic}</td>
                        <td className="px-3 py-1.5 text-end tabular">{Number(l.debit) ? money(l.debit) : ""}</td>
                        <td className="px-3 py-1.5 text-end tabular">{Number(l.credit) ? money(l.credit) : ""}</td>
                        <td />
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function Ledger({ year }: { year: number }) {
  const { t, lang } = useI18n();
  const { org } = useOrg();
  const money = useAmount();
  const bal = useOrgQuery<any>(`/accounting/balance?year=${year}`);
  const accounts = (bal.data?.accounts ?? []) as any[];
  const [account, setAccount] = useState<string | null>(null);
  useEffect(() => { if (!account && accounts.length) setAccount(accounts.find((a) => a.code.startsWith("514"))?.code ?? accounts[0].code); }, [accounts, account]);
  const q = useOrgQuery<any>(`/accounting/ledger?year=${year}&account=${account}`, { enabled: !!account });
  return (
    <div className="space-y-3">
      <div className="w-80"><OptionSelect value={account} onChange={setAccount} options={accounts.map((a) => ({ value: a.code, label: `${a.code} — ${a.label}` }))} placeholder={t("Choose an account")} /></div>
      <Section bodyClassName="p-0" title={q.data ? `${q.data.account.code} — ${q.data.account.label}` : undefined}>
        {!account || q.isLoading ? <div className="p-4"><LoadingRows rows={4} /></div> : !q.data ? null : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-start font-medium">{t("Date")}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t("N° entry")}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t("Label")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("Debit")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("Credit")}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t("Balance")}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border bg-muted/40 text-xs"><td className="px-3 py-2" colSpan={5}>{t("Brought forward")}</td><td className="px-3 py-2 text-end font-medium tabular">{money(q.data.opening)}</td></tr>
                {q.data.lines.map((l: any) => (
                  <tr key={l.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-3 py-2">{formatDate(l.date, lang, org.timezone)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{l.number}</td>
                    <td className="max-w-md truncate px-3 py-2">{l.label}</td>
                    <td className="px-3 py-2 text-end tabular">{Number(l.debit) ? money(l.debit) : ""}</td>
                    <td className="px-3 py-2 text-end tabular">{Number(l.credit) ? money(l.credit) : ""}</td>
                    <td className={cn("px-3 py-2 text-end font-medium tabular", Number(l.balance) < 0 && "text-st-red")}>{money(l.balance)}</td>
                  </tr>
                ))}
                <tr className="bg-muted/40 font-semibold"><td className="px-3 py-2" colSpan={5}>{t("Closing balance")}</td><td className="px-3 py-2 text-end tabular">{money(q.data.closing)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function Balance({ year }: { year: number }) {
  const { t } = useI18n();
  const money = useAmount();
  const q = useOrgQuery<any>(`/accounting/balance?year=${year}`);
  if (q.isLoading) return <LoadingRows />;
  if (!q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const b = q.data;
  return (
    <Section bodyClassName="p-0" title={t("Trial balance {year}", { year })}
      action={b.balanced ? <Pill tone="green"><CheckCircle2 className="size-3.5" />{t("Balanced")}</Pill> : <Pill tone="red"><AlertTriangle className="size-3.5" />{t("Not balanced")}</Pill>}>
      {b.accounts.length === 0 ? <EmptyState icon={Scale} title={t("Nothing posted for this year")} /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-start font-medium">{t("Account")}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t("Brought forward")}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t("Debit")}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t("Credit")}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t("Debit balance")}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t("Credit balance")}</th>
              </tr>
            </thead>
            <tbody>
              {b.accounts.map((a: any) => (
                <tr key={a.code} className="border-b border-border">
                  <td className="px-3 py-2"><span className="font-mono">{a.code}</span> <span className="text-muted-foreground">{a.label}</span></td>
                  <td className="px-3 py-2 text-end tabular">{Number(a.opening) ? money(a.opening) : ""}</td>
                  <td className="px-3 py-2 text-end tabular">{money(a.debit)}</td>
                  <td className="px-3 py-2 text-end tabular">{money(a.credit)}</td>
                  <td className="px-3 py-2 text-end tabular">{Number(a.closingDebit) ? money(a.closingDebit) : ""}</td>
                  <td className="px-3 py-2 text-end tabular">{Number(a.closingCredit) ? money(a.closingCredit) : ""}</td>
                </tr>
              ))}
              <tr className={cn("font-semibold", b.balanced ? "bg-st-green/10" : "bg-st-red/10")}>
                <td className="px-3 py-2.5" colSpan={2}>{t("Totals")}</td>
                <td className="px-3 py-2.5 text-end tabular">{money(b.totals.debit)}</td>
                <td className="px-3 py-2.5 text-end tabular">{money(b.totals.credit)}</td>
                <td className="px-3 py-2.5 text-end tabular">{money(b.totals.closingDebit)}</td>
                <td className="px-3 py-2.5 text-end tabular">{money(b.totals.closingCredit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function StatementTable({ title, rows, total, totalLabel, extra }: { title: string; rows: any[]; total: string; totalLabel: string; extra?: [string, string] }) {
  const money = useAmount();
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className="border-b border-border">
              <td className="py-1.5 pe-2 font-mono text-xs">{r.code}</td>
              <td className="py-1.5">{r.label}</td>
              <td className="py-1.5 text-end tabular">{money(r.amount)}</td>
            </tr>
          ))}
          {extra && <tr className="border-b border-border"><td /><td className="py-1.5 italic">{extra[0]}</td><td className="py-1.5 text-end tabular">{money(extra[1])}</td></tr>}
          <tr className="font-semibold"><td /><td className="py-2">{totalLabel}</td><td className="py-2 text-end tabular">{money(total)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function Statements({ year }: { year: number }) {
  const { t } = useI18n();
  const money = useAmount();
  const q = useOrgQuery<any>(`/accounting/statements?year=${year}`);
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <LoadingRows />;
  if (!q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const st = q.data;
  const download = async () => {
    setBusy(true);
    try { await (await import("@/lib/accounting-export")).exportStatementsPdf(st); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t("Simplified model built from the trial balance. Have your chartered accountant validate it before filing.")}</p>
        <Button onClick={download} disabled={busy}><FileText />{t("Download CPC & Bilan (PDF)")}</Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t("CPC — Income and expenditure")}>
          <div className="space-y-5">
            <StatementTable title={t("Operating income")} rows={st.cpc.produits} total={st.cpc.totalProduits} totalLabel={t("Total income")} />
            <StatementTable title={t("Operating expenses")} rows={st.cpc.charges} total={st.cpc.totalCharges} totalLabel={t("Total expenses")} />
            <div className={cn("flex justify-between rounded-xl px-4 py-3 font-semibold", Number(st.cpc.resultat) >= 0 ? "bg-st-green/10 text-st-green" : "bg-st-red/10 text-st-red")}>
              <span>{Number(st.cpc.resultat) >= 0 ? t("Net result — surplus") : t("Net result — deficit")}</span><span className="tabular">{money(st.cpc.resultat)}</span>
            </div>
          </div>
        </Section>
        <Section title={t("Bilan — Balance sheet")}>
          <div className="space-y-5">
            <StatementTable title={t("Assets")} rows={st.bilan.actif} total={st.bilan.totalActif} totalLabel={t("Total assets")} />
            <StatementTable title={t("Liabilities & funds")} rows={st.bilan.passif} total={st.bilan.totalPassif} totalLabel={t("Total liabilities & funds")} extra={[t("Net result for the year"), st.bilan.resultat]} />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Closing({ year, overview }: { year: number; overview: any }) {
  const { t } = useI18n();
  const { slug, can, org } = useOrg();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const lock = useOrgMutation((body: { year: number; month: number }, base) => api.post(`${base}/accounting/locks`, body), { success: "Period locked" });
  const locks: number[] = overview?.locks ?? [];
  const yearLocked = locks.includes(0);
  const base = `/api/org/${slug}`;
  const fileTag = (overview?.identity?.ice || slug).replace(/[^\w-]/g, "");

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); setProgress(""); }
  };
  const legalPack = () => run("pack", async () => {
    const [journal, balance, settings] = await Promise.all([
      api.get<{ entries: any[] }>(`${base}/accounting/journal?year=${year}`),
      api.get<any>(`${base}/accounting/balance?year=${year}`),
      api.get<any>(`${base}/accounting/settings`),
    ]);
    const { exportLegalPackPdf } = await import("@/lib/accounting-export");
    await exportLegalPackPdf({ identity: { name: org.name, ...settings.identity }, year, currency: org.currency, entries: journal.entries, balance });
  });
  const fecXlsx = () => run("fec", async () => {
    const fec = await api.get<any>(`${base}/accounting/fec?year=${year}`);
    await (await import("@/lib/accounting-export")).exportFecXlsx(fec, fileTag);
  });
  const archive = () => run("zip", async () => {
    const a = await api.get<{ items: any[]; missing: string[] }>(`${base}/accounting/archive?year=${year}`);
    if (!a.items.length) { toast.info(t("No supporting documents for this year yet")); return; }
    await (await import("@/lib/accounting-export")).exportArchiveZip(slug, year, a.items, (d, n) => setProgress(`${d}/${n}`));
    if (a.missing.length) toast.warning(t("{n} entries have no document: {list}", { n: a.missing.length, list: a.missing.slice(0, 5).join(", ") }));
  });
  const statements = () => run("st", async () => {
    const st = await api.get<any>(`${base}/accounting/statements?year=${year}`);
    await (await import("@/lib/accounting-export")).exportStatementsPdf(st);
  });

  const doLock = (month: number) => {
    const label = month ? `${String(month).padStart(2, "0")}/${year}` : String(year);
    if (!window.confirm(t("Lock {period}? No entry can be added to it afterwards. This can't be undone.", { period: label }))) return;
    lock.mutate({ year, month }, { onSuccess: () => qc.invalidateQueries({ queryKey: ["org", slug] }) });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title={t("Export Legal Pack")} icon={Download}>
        <p className="mb-4 text-sm text-muted-foreground">{t("Ready to print or send to your chartered accountant — nothing to retype.")}</p>
        <div className="grid gap-2">
          <Button onClick={legalPack} disabled={!!busy}><FileText />{busy === "pack" ? t("Preparing…") : t("Journal, general ledger & trial balance (PDF)")}</Button>
          <Button variant="outline" onClick={statements} disabled={!!busy}><FileText />{busy === "st" ? t("Preparing…") : t("CPC & Bilan (PDF)")}</Button>
          <Button variant="outline" onClick={fecXlsx} disabled={!!busy}><FileSpreadsheet />{busy === "fec" ? t("Preparing…") : t("FEC — Excel (.xlsx)")}</Button>
          <Button variant="outline" asChild><a href={`${API_URL}${base}/accounting/fec.txt?year=${year}`}><FileSpreadsheet />{t("FEC — text file (.txt, pipe-separated)")}</a></Button>
          <Button variant="outline" onClick={archive} disabled={!!busy}><FileArchive />{busy === "zip" ? `${t("Downloading documents…")} ${progress}` : t("All supporting documents (ZIP, named by entry number)")}</Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("FEC columns: JournalCode | EcritureNum | EcritureDate | CompteNum | CompteLib | PieceRef | PieceDate | EcritureLib | Debit | Credit | Projet_Analytique")}</p>
      </Section>

      <Section title={t("Lock periods")} icon={Lock}>
        <p className="mb-4 text-sm text-muted-foreground">{t("After review, lock a month or the whole year. Locked periods accept no new entries — late corrections go into an open period as reversals.")}</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {MONTHS.map((m) => {
            const locked = yearLocked || locks.includes(m);
            const label = new Intl.DateTimeFormat("fr-MA", { month: "short" }).format(new Date(year, m - 1, 1));
            return (
              <button key={m} type="button" disabled={locked || !can("accounting.manage") || lock.isPending} onClick={() => doLock(m)}
                className={cn("flex items-center justify-between gap-1 rounded-xl border px-3 py-2 text-sm transition-colors",
                  locked ? "border-st-green/30 bg-st-green/10 text-st-green" : "border-border hover:bg-muted disabled:opacity-60")}>
                <span className="capitalize">{label}</span>{locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5 text-muted-foreground" />}
              </button>
            );
          })}
        </div>
        {can("accounting.manage") && (
          <Button className="mt-4 w-full" variant={yearLocked ? "outline" : "default"} disabled={yearLocked || lock.isPending} onClick={() => doLock(0)}>
            <Lock />{yearLocked ? t("Year {year} is closed", { year }) : t("Close the year {year}", { year })}
          </Button>
        )}
        {(overview?.missingPieces ?? 0) > 0 && <p className="mt-3 text-xs text-st-red">{t("Locking needs every entry to have its supporting document ({n} missing).", { n: overview.missingPieces })}</p>}
      </Section>
    </div>
  );
}

function AccountingSettings() {
  const { t } = useI18n();
  const { can } = useOrg();
  const q = useOrgQuery<any>("/accounting/settings");
  const [identity, setIdentity] = useState<any>({});
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [treasury, setTreasury] = useState<Record<number, string>>({});
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  useEffect(() => {
    if (!q.data) return;
    const i = q.data.identity;
    setIdentity({ legalName: i.legalName ?? "", ice: i.ice ?? "", taxId: i.taxId ?? "", registryNumber: i.registryNumber ?? "", address: i.address ?? "" });
    setMappings(Object.fromEntries(q.data.mappings.map((m: any) => [`${m.kind}:${m.key}`, m.accountCode])));
    setTreasury(Object.fromEntries(q.data.accounts.map((a: any) => [a.id, a.ledgerCode ?? ""])));
  }, [q.data]);
  const save = useOrgMutation((body: any, base) => api.patch(`${base}/accounting/settings`, body), { success: "Settings saved" });
  const chartOptions = useMemo(() => (q.data?.chart ?? []).map((a: any) => ({ value: a.code, label: `${a.code} — ${a.label}` })), [q.data]);
  if (q.isLoading) return <LoadingRows />;
  if (!q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const editable = can("accounting.manage");

  const mappingRows: { kind: "expense_category" | "funding_type"; key: string; label: string }[] = [
    ...EXPENSE_CATEGORIES.map((c) => ({ kind: "expense_category" as const, key: c, label: t(c) })),
    ...Object.keys(FUNDING_TYPE).map((k) => ({ kind: "funding_type" as const, key: k, label: t(FUNDING_TYPE[k]) })),
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title={t("Association identity")}>
        <div className="space-y-3">
          <Field label={t("Legal name")} htmlFor="ac-ln"><Input id="ac-ln" value={identity.legalName ?? ""} onChange={(e) => setIdentity({ ...identity, legalName: e.target.value })} disabled={!editable} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="ICE" htmlFor="ac-ice" hint={t("15 digits")}><Input id="ac-ice" inputMode="numeric" dir="ltr" value={identity.ice ?? ""} onChange={(e) => setIdentity({ ...identity, ice: e.target.value.replace(/\D/g, "") })} maxLength={15} disabled={!editable} /></Field>
            <Field label={t("IF (tax ID)")} htmlFor="ac-if"><Input id="ac-if" inputMode="numeric" dir="ltr" value={identity.taxId ?? ""} onChange={(e) => setIdentity({ ...identity, taxId: e.target.value.replace(/\D/g, "") })} disabled={!editable} /></Field>
            <Field label={t("Registration n°")} htmlFor="ac-rc"><Input id="ac-rc" value={identity.registryNumber ?? ""} onChange={(e) => setIdentity({ ...identity, registryNumber: e.target.value })} disabled={!editable} /></Field>
          </div>
          <Field label={t("Address")} htmlFor="ac-ad"><Input id="ac-ad" value={identity.address ?? ""} onChange={(e) => setIdentity({ ...identity, address: e.target.value })} disabled={!editable} /></Field>
          {editable && <Button disabled={save.isPending} onClick={() => save.mutate({ identity: { ...identity, ice: identity.ice || null, taxId: identity.taxId || null } })}>{t("Save identity")}</Button>}
        </div>
      </Section>

      <Section title={t("Chart of accounts")}>
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <tbody>{q.data.chart.map((a: any) => <tr key={a.code} className="border-b border-border"><td className="py-1.5 pe-3 font-mono">{a.code}</td><td className="py-1.5">{a.label}</td></tr>)}</tbody>
          </table>
        </div>
        {editable && (
          <div className="mt-3 flex gap-2">
            <Input className="w-28" placeholder="6xxx" dir="ltr" value={newCode} onChange={(e) => setNewCode(e.target.value.replace(/\D/g, ""))} maxLength={10} aria-label={t("Account number")} />
            <Input className="flex-1" placeholder={t("Account name")} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <Button disabled={newCode.length < 4 || newLabel.trim().length < 2 || save.isPending}
              onClick={() => save.mutate({ accounts: [{ code: newCode, label: newLabel.trim() }] }, { onSuccess: () => { setNewCode(""); setNewLabel(""); } })}><Plus />{t("Add")}</Button>
          </div>
        )}
      </Section>

      <Section title={t("Which account each category posts to")} className="lg:col-span-2">
        <p className="mb-4 text-xs text-muted-foreground">{t("Defaults follow the Moroccan chart of accounts as commonly used by associations. Have your accountant confirm them; changes apply to entries posted afterwards — past entries are never rewritten.")}</p>
        <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
          {mappingRows.map((m) => (
            <div key={`${m.kind}:${m.key}`} className="flex items-center gap-3">
              <span className="flex w-44 shrink-0 items-center gap-2 text-sm">{m.kind === "funding_type" ? <ArrowDownLeft className="size-4 text-st-green" /> : <ArrowUpRight className="size-4 text-st-red" />}{m.label}</span>
              <div className="flex-1"><OptionSelect value={mappings[`${m.kind}:${m.key}`]} onChange={(v) => v && setMappings({ ...mappings, [`${m.kind}:${m.key}`]: v })} options={chartOptions} /></div>
            </div>
          ))}
          {q.data.accounts.map((a: any) => (
            <div key={`t${a.id}`} className="flex items-center gap-3">
              <span className="flex w-44 shrink-0 items-center gap-2 text-sm"><Landmark className="size-4 text-primary" />{a.name}</span>
              <div className="flex-1"><OptionSelect value={treasury[a.id]} onChange={(v) => v && setTreasury({ ...treasury, [a.id]: v })} options={chartOptions.filter((o: any) => String(o.value).startsWith("5"))} /></div>
            </div>
          ))}
        </div>
        {editable && (
          <Button className="mt-4" disabled={save.isPending} onClick={() => save.mutate({
            mappings: Object.entries(mappings).map(([k, accountCode]) => { const [kind, ...rest] = k.split(":"); return { kind, key: rest.join(":"), accountCode }; }),
            treasury: Object.entries(treasury).filter(([, c]) => c).map(([id, ledgerCode]) => ({ id: Number(id), ledgerCode })),
          })}>{t("Save mapping")}</Button>
        )}
      </Section>
    </div>
  );
}
