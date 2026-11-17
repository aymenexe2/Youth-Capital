import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Bar, BarChart, ResponsiveContainer, Sankey, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, Banknote, Check, Download, FileText, FolderKanban, HandCoins, Landmark, Lock, Paperclip, Plus, Printer,
  Receipt, RotateCcw, Undo2, Wallet, X,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api, errorMessage, MAX_UPLOAD_BYTES } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { formatDate, formatDateTime, formatMoney, relativeTime, todayISO } from "@/lib/format";
import { ACCOUNT_KIND, AUDIT_ACTION, BUDGET_STATUS, EXPENSE_CATEGORIES, FUNDING_TYPE, TX_KIND, TX_STATUS } from "@/lib/labels";
import { useOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, Field, KeyValue, LoadingRows, PageHeader, Pill, ProgressBar, Section, StatCard, type Tone } from "@/components/primitives";
import { OptionSelect, PersonPicker } from "@/components/pickers";
import { FormDialog } from "@/components/forms";

const STATUS_TONE: Record<string, Tone> = {
  expected: "blue", submitted: "amber", approved: "violet", paid: "green", received: "green", posted: "neutral", rejected: "red", cancelled: "neutral",
};

function TxStatus({ status }: { status: string }) {
  const { t } = useI18n();
  return <Pill tone={STATUS_TONE[status] ?? "neutral"} dot>{t(TX_STATUS[status] ?? status)}</Pill>;
}

function useMoney() {
  const { lang } = useI18n();
  const { org } = useOrg();
  return (v: string | number | null | undefined, currency = org.currency) => formatMoney(v, currency, lang);
}

export default function FinancePage() {
  const { t } = useI18n();
  const { can, slug } = useOrg();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const txId = params.get("tx");
  const canView = can("finance.view");
  const budgets = useOrgQuery<{ budgets: any[] }>("/finance/budgets");
  const delegated = (budgets.data?.budgets ?? []).filter((b) => b.isMine && b.status === "approved");
  const canSubmit = can("finance.create_expense") || delegated.length > 0;
  const [tab, setTab] = useState(params.get("tab") ?? (canView ? "overview" : "transactions"));
  const [dialog, setDialog] = useState<null | "expense" | "income">(null);

  const openTx = (id: number | null) => {
    const p = new URLSearchParams(window.location.search);
    if (id) p.set("tx", String(id)); else p.delete("tx");
    navigate(`${window.location.pathname}${p.toString() ? `?${p}` : ""}`, { replace: !id });
  };

  return (
    <>
      <PageHeader
        title={t("Finance")}
        description={canView ? t("Income, expenses, budgets and evidence — every entry traceable, nothing silently changed.") : t("Your expense requests and the budgets delegated to you.")}
        actions={
          <>
            {can("finance.export") && (
              <Button variant="outline" asChild><a href={`${API_URL}/api/org/${slug}/finance/export.csv`}><Download />{t("Export CSV")}</a></Button>
            )}
            {can("finance.approve") && <Button variant="outline" onClick={() => setDialog("income")}><ArrowDownLeft />{t("Record income")}</Button>}
            {canSubmit && <Button onClick={() => setDialog("expense")}><ArrowUpRight />{t("Submit expense")}</Button>}
          </>
        }
      />
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        {t("Financial administration and evidence only — not a substitute for professional accounting or statutory books. Have your accountant validate the setup before production use.")}
      </p>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {canView && <TabsTrigger value="overview">{t("Overview")}</TabsTrigger>}
          <TabsTrigger value="transactions">{canView ? t("Transactions") : t("My requests")}</TabsTrigger>
          {(canView || (budgets.data?.budgets ?? []).length > 0) && <TabsTrigger value="budgets">{t("Budgets")}</TabsTrigger>}
          {canView && <TabsTrigger value="accounts">{t("Accounts")}</TabsTrigger>}
          {canView && <TabsTrigger value="reports">{t("Reports")}</TabsTrigger>}
        </TabsList>
        {canView && <TabsContent value="overview" className="mt-4"><Overview onOpen={openTx} /></TabsContent>}
        <TabsContent value="transactions" className="mt-4"><Transactions onOpen={openTx} /></TabsContent>
        <TabsContent value="budgets" className="mt-4"><Budgets /></TabsContent>
        {canView && <TabsContent value="accounts" className="mt-4"><Accounts /></TabsContent>}
        {canView && <TabsContent value="reports" className="mt-4"><Reports /></TabsContent>}
      </Tabs>
      <ExpenseDialog open={dialog === "expense"} onOpenChange={(o) => !o && setDialog(null)} delegated={delegated} onCreated={(id) => openTx(id)} />
      <IncomeDialog open={dialog === "income"} onOpenChange={(o) => !o && setDialog(null)} onCreated={(id) => openTx(id)} />
      <TransactionDrawer id={txId ? Number(txId) : null} onClose={() => openTx(null)} />
    </>
  );
}

// ── Overview ───────────────────────────────────────────────────────────────

function Overview({ onOpen }: { onOpen: (id: number) => void }) {
  const { t, lang } = useI18n();
  const money = useMoney();
  const q = useOrgQuery<any>("/finance/summary");
  const pending = useOrgQuery<{ transactions: any[] }>("/finance/transactions?status=submitted");
  if (q.isLoading) return <div className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[84px] rounded-xl" />)}</div>;
  if (q.error || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const d = q.data;
  const remaining = Number(d.budgets.approved) - Number(d.budgets.spent) - Number(d.budgets.committed);
  const monthly = d.monthly.map((m: any) => ({
    label: new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : lang === "fr" ? "fr-MA" : "en-GB", { month: "short" }).format(new Date(`${m.month}-15`)),
    in: Number(m.in), out: Number(m.out),
  }));
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("Income this year")} value={money(d.income)} icon={ArrowDownLeft} tone="green" hint={Number(d.expectedIncome) > 0 ? t("{amount} expected", { amount: money(d.expectedIncome) }) : undefined} />
        <StatCard label={t("Spent this year")} value={money(d.expenses)} icon={ArrowUpRight} tone="red" />
        <StatCard label={t("Committed, not yet paid")} value={money(d.committed)} icon={Receipt} tone="amber" />
        <StatCard label={t("Budget remaining")} value={money(remaining)} icon={Wallet} tone="gold" hint={t("of {amount} approved", { amount: money(d.budgets.approved) })} />
      </div>
      {(d.awaitingApproval > 0 || d.missingEvidence > 0) && (
        <div className="flex flex-wrap gap-3">
          {d.awaitingApproval > 0 && <Pill tone="amber"><AlertTriangle className="size-3" />{t("{n} expenses awaiting approval", { n: d.awaitingApproval })}</Pill>}
          {d.missingEvidence > 0 && <Pill tone="red"><Paperclip className="size-3" />{t("{n} posted entries without a receipt or document", { n: d.missingEvidence })}</Pill>}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title={t("Money in and out")} className="lg:col-span-2" icon={Banknote}>
          {monthly.length === 0 ? <EmptyState title={t("No posted entries this year")} className="py-8" /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" width={60} tickFormatter={(v) => new Intl.NumberFormat(undefined, { notation: "compact" }).format(v)} />
                  <Tooltip cursor={{ fill: "var(--muted)" }} formatter={(v: number) => money(v)} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="in" name={t("Income")} fill="var(--st-green)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="out" name={t("Expenses")} fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>
        <Section title={t("Spending by category")}>
          {d.byCategory.length === 0 ? <p className="text-sm text-muted-foreground">{t("No expenses yet.")}</p> : (
            <ul className="space-y-3">
              {d.byCategory.map((c: any) => {
                const max = Math.max(...d.byCategory.map((x: any) => Number(x.total)));
                return (
                  <li key={c.category}>
                    <div className="mb-1 flex justify-between text-sm"><span className="truncate">{t(c.category)}</span><span className="font-medium tabular">{money(c.total)}</span></div>
                    <ProgressBar value={(Number(c.total) / max) * 100} tone="gold" />
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
      <ProjectBreakdown />
      <MoneyFlow />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t("Awaiting approval")} bodyClassName="p-0">
          {(pending.data?.transactions ?? []).length === 0 ? <EmptyState icon={Check} title={t("Nothing waiting")} className="py-8" /> : (
            <ul className="divide-y divide-border">
              {pending.data!.transactions.slice(0, 8).map((x) => (
                <li key={x.id}>
                  <button onClick={() => onOpen(x.id)} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-muted/50">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{x.description}</span><span className="block text-xs text-muted-foreground">{x.reference} · {x.requestedBy} · {relativeTime(x.createdAt, lang)}</span></span>
                    <span className="text-sm font-semibold tabular">{money(x.amount, x.currency)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={t("Accounts")} bodyClassName="p-0">
          {d.accounts.length === 0 ? <EmptyState icon={Landmark} title={t("No accounts yet")} className="py-8" /> : (
            <ul className="divide-y divide-border">
              {d.accounts.filter((a: any) => !a.archivedAt).map((a: any) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                  <Landmark className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{a.name}</span><span className="block text-xs text-muted-foreground">{t(ACCOUNT_KIND[a.kind])}{a.unreconciled > 0 && ` · ${t("{n} unreconciled", { n: a.unreconciled })}`}</span></span>
                  <span className="text-sm font-semibold tabular">{money(a.balance, a.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

// Where each project's money came from and went: budget, income, spend, what's left.
function ProjectBreakdown() {
  const { t } = useI18n();
  const money = useMoney();
  const q = useOrgQuery<{ projects: any[] }>("/finance/breakdown");
  const rows = q.data?.projects ?? [];
  return (
    <Section title={t("Project financial breakdown")} icon={FolderKanban} bodyClassName="p-0">
      {q.isLoading ? <div className="p-4"><LoadingRows rows={3} /></div> : rows.length === 0 ? <EmptyState icon={FolderKanban} title={t("No project money yet")} className="py-8" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{t("Project / Cost center")}</th>
                <th className="px-4 py-3 text-end font-medium">{t("Budget")}</th>
                <th className="px-4 py-3 text-end font-medium">{t("Income received")}</th>
                <th className="px-4 py-3 text-end font-medium">{t("Actual spend")}</th>
                <th className="px-4 py-3 text-end font-medium">{t("Committed")}</th>
                <th className="px-4 py-3 text-end font-medium">{t("Budget left")}</th>
                <th className="w-36 px-4 py-3 text-start font-medium">{t("Used")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const used = Number(r.budget) ? ((Number(r.spent) + Number(r.committed)) / Number(r.budget)) * 100 : 0;
                return (
                  <tr key={r.projectId ?? "general"} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{r.projectId ? r.title : t("General administration")}</td>
                    <td className="px-4 py-3 text-end tabular">{money(r.budget)}</td>
                    <td className="px-4 py-3 text-end tabular text-st-green">{money(r.income)}</td>
                    <td className="px-4 py-3 text-end tabular">{money(r.spent)}</td>
                    <td className="px-4 py-3 text-end tabular text-muted-foreground">{money(r.committed)}</td>
                    <td className={cn("px-4 py-3 text-end font-semibold tabular", Number(r.remainingBudget) < 0 && "text-st-red")}>{Number(r.budget) ? money(r.remainingBudget) : "—"}</td>
                    <td className="px-4 py-3">{Number(r.budget) ? <ProgressBar value={used} tone={used > 100 ? "red" : used > 85 ? "amber" : "blue"} /> : <span className="text-xs text-muted-foreground">{t("No budget")}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// Sankey: funding source → bank/cash account → project → expense type.
function MoneyFlow() {
  const { t } = useI18n();
  const money = useMoney();
  const q = useOrgQuery<{ sources: any[]; spending: any[] }>(`/finance/flows?year=${new Date().getFullYear()}`);
  const data = useMemo(() => {
    if (!q.data) return null;
    const nodes: { name: string; color: string }[] = [];
    const index = new Map<string, number>();
    const node = (key: string, name: string, color: string) => {
      if (!index.has(key)) { index.set(key, nodes.length); nodes.push({ name, color }); }
      return index.get(key)!;
    };
    const links: { source: number; target: number; value: number }[] = [];
    const add = (a: number, b: number, v: number) => {
      const l = links.find((x) => x.source === a && x.target === b);
      if (l) l.value += v; else links.push({ source: a, target: b, value: v });
    };
    for (const r of q.data.sources) add(node(`s:${r.source}`, t(FUNDING_TYPE[r.source] ?? r.source), "#34c759"), node(`a:${r.account}`, r.account, "#007aff"), Number(r.amount));
    for (const r of q.data.spending) {
      const project = r.project === "Administration générale" ? t("General administration") : r.project;
      add(node(`a:${r.account}`, r.account, "#007aff"), node(`p:${r.project}`, project, "#af52de"), Number(r.amount));
      add(node(`p:${r.project}`, project, "#af52de"), node(`c:${r.category}`, t(r.category), "#ff9500"), Number(r.amount));
    }
    return links.length ? { nodes, links } : null;
  }, [q.data, t]);
  return (
    <Section title={t("Money flow this year")} icon={Banknote}>
      <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {[["#34c759", t("Funding source")], ["#007aff", t("Bank / cash")], ["#af52de", t("Project")], ["#ff9500", t("Expense type")]].map(([c, l]) => (
          <span key={l} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: c }} />{l}</span>
        ))}
      </p>
      {!data ? <EmptyState icon={Banknote} title={t("No money moved yet this year")} className="py-8" /> : (
        <div className="h-80" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <Sankey data={data} nodePadding={18} nodeWidth={10} margin={{ top: 8, right: 140, bottom: 8, left: 8 }}
              link={{ stroke: "var(--chart-1)", strokeOpacity: 0.18 }}
              node={(props: any) => {
                const { x, y, width, height, payload } = props;
                return (
                  <g>
                    <rect x={x} y={y} width={width} height={height} rx={3} fill={payload.color} />
                    <text x={x + width + 6} y={y + height / 2} dy="0.35em" fontSize={12} fill="var(--foreground)">{payload.name}</text>
                  </g>
                );
              }}>
              <Tooltip formatter={(v: number) => money(v)} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
            </Sankey>
          </ResponsiveContainer>
        </div>
      )}
    </Section>
  );
}

// ── Transactions ───────────────────────────────────────────────────────────

function Transactions({ onOpen }: { onOpen: (id: number) => void }) {
  const { t, lang } = useI18n();
  const { org } = useOrg();
  const money = useMoney();
  const [kind, setKind] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const projects = useOrgQuery<{ projects: any[] }>("/projects");
  const qs = new URLSearchParams({ ...(kind ? { kind } : {}), ...(status ? { status } : {}), ...(projectId ? { projectId } : {}) }).toString();
  const q = useOrgQuery<{ transactions: any[]; canViewAll: boolean }>(`/finance/transactions${qs ? `?${qs}` : ""}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="w-36"><OptionSelect value={kind} onChange={setKind} allowNone noneLabel={t("All types")} options={Object.keys(TX_KIND).map((k) => ({ value: k, label: t(TX_KIND[k]) }))} /></div>
        <div className="w-44"><OptionSelect value={status} onChange={setStatus} allowNone noneLabel={t("Any status")} options={[{ value: "open", label: t("Open (not posted)") }, { value: "posted", label: t("Posted") }, ...Object.keys(TX_STATUS).map((k) => ({ value: k, label: t(TX_STATUS[k]) }))]} /></div>
        <div className="w-48"><OptionSelect value={projectId} onChange={setProjectId} allowNone noneLabel={t("All projects")} options={(projects.data?.projects ?? []).map((p) => ({ value: p.id, label: p.title }))} /></div>
      </div>
      <Section bodyClassName="p-0">
        {q.isLoading ? <div className="p-4"><LoadingRows /></div> : (q.data?.transactions ?? []).length === 0 ? <EmptyState icon={Receipt} title={t("No entries")} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{t("Date")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("Description")}</th>
                  <th className="hidden px-4 py-3 text-start font-medium md:table-cell">{t("Project")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("Status")}</th>
                  <th className="px-4 py-3 text-end font-medium">{t("Amount")}</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.transactions.map((x) => (
                  <tr key={x.id} onClick={() => onOpen(x.id)} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(x.date, lang, org.timezone)}</td>
                    <td className="max-w-xs px-4 py-3">
                      <span className="block truncate font-medium">{x.description}</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="font-mono">{x.reference}</span>
                        {x.counterparty && <>· {x.counterparty}</>}
                        {(x.status === "paid" || x.status === "received") && x.evidenceCount === 0 && <span className="inline-flex items-center gap-0.5 text-st-red"><Paperclip className="size-3" />{t("no receipt")}</span>}
                        {x.reversedById && <span className="text-st-amber">· {t("reversed")}</span>}
                      </span>
                    </td>
                    <td className="hidden max-w-[12rem] truncate px-4 py-3 text-muted-foreground md:table-cell">{x.projectTitle ?? "—"}</td>
                    <td className="px-4 py-3"><TxStatus status={x.status} /></td>
                    <td className={cn("whitespace-nowrap px-4 py-3 text-end font-semibold tabular", x.direction === "in" ? "text-st-green" : "text-foreground")}>
                      {x.direction === "in" ? "+" : "−"}{money(x.amount, x.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function TransactionDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  return (
    <Sheet open={id != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {id != null && <TransactionDetail id={id} />}
      </SheetContent>
    </Sheet>
  );
}

function TransactionDetail({ id }: { id: number }) {
  const { t, lang } = useI18n();
  const { org, slug } = useOrg();
  const money = useMoney();
  const qc = useQueryClient();
  const q = useOrgQuery<any>(`/finance/transactions/${id}`);
  const accounts = useOrgQuery<{ accounts: any[] }>("/finance/accounts", { enabled: !!q.data && (q.data.canPay || q.data.canReceive) });
  const [mode, setMode] = useState<null | "reject" | "cancel" | "reverse" | "pay" | "receive">(null);
  const [reason, setReason] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [uploading, setUploading] = useState(false);
  const [postFile, setPostFile] = useState<File | null>(null);
  const act = useOrgMutation((v: { action: string; body?: any }, base) => api.post(`${base}/finance/transactions/${id}/${v.action}`, v.body ?? {}), {
    success: "Saved", onSuccess: () => { setMode(null); setReason(""); },
  });
  if (q.isLoading) return <div className="space-y-3 p-6"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-32 w-full" /></div>;
  if (!q.data) return <div className="p-6 text-sm text-muted-foreground">{t("This entry isn't available.")}</div>;
  const { transaction: x, files, history, related } = q.data;

  const upload = async (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) { toast.error(t("Files must be 4 MB or smaller.")); return; }
    setUploading(true);
    try {
      await api.upload(slug, "transaction", x.id, file);
      qc.invalidateQueries({ queryKey: ["org", slug] });
      toast.success(t("Document attached"));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-border p-5 pe-12">
        <div className="mb-2 flex flex-wrap items-center gap-2"><TxStatus status={x.status} /><Pill>{t(TX_KIND[x.kind])}</Pill>{x.reconciled && <Pill tone="green"><Check className="size-3" />{t("Reconciled")}</Pill>}</div>
        <SheetTitle className={cn("text-2xl font-semibold tabular", x.direction === "in" ? "text-st-green" : "")}>{x.direction === "in" ? "+" : "−"}{money(x.amount, x.currency)}</SheetTitle>
        <SheetDescription className="mt-1 text-sm text-foreground">{x.description}</SheetDescription>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{x.reference}</p>
      </div>

      {(q.data.canApprove || q.data.canPay || q.data.canReceive || q.data.canCancel || q.data.canReverse) && (
        <div className="flex flex-wrap gap-2 border-b border-border bg-muted/40 px-5 py-3">
          {q.data.canApprove && <Button size="sm" onClick={() => act.mutate({ action: "approve" })} disabled={act.isPending}><Check />{t("Approve")}</Button>}
          {q.data.canApprove && <Button size="sm" variant="outline" onClick={() => setMode("reject")}><X />{t("Reject")}</Button>}
          {q.data.canPay && <Button size="sm" onClick={() => setMode("pay")}><Banknote />{t("Record payment")}</Button>}
          {q.data.canReceive && <Button size="sm" onClick={() => setMode("receive")}><ArrowDownLeft />{t("Confirm received")}</Button>}
          {q.data.canCancel && <Button size="sm" variant="ghost" onClick={() => setMode("cancel")}><Undo2 />{t("Cancel")}</Button>}
          {q.data.canReverse && <Button size="sm" variant="ghost" onClick={() => setMode("reverse")}><RotateCcw />{t("Reverse")}</Button>}
        </div>
      )}

      <div className="space-y-6 p-5">
        {x.rejectionReason && <p className="rounded-lg bg-st-red/10 p-3 text-sm"><span className="font-medium">{t("Reason")}:</span> {x.rejectionReason}</p>}
        {related.length > 0 && (
          <p className="rounded-lg bg-st-amber/10 p-3 text-sm">
            {x.reversesId ? t("This entry reverses {ref}.", { ref: related[0].reference }) : t("Reversed by {ref}.", { ref: related[0].reference })}
          </p>
        )}
        <dl className="divide-y divide-border rounded-lg border border-border px-4">
          <KeyValue label={t("Date")}>{formatDate(x.date, lang, org.timezone)}</KeyValue>
          {x.counterparty && <KeyValue label={x.direction === "in" ? t("From") : t("Paid to")}>{x.counterparty}</KeyValue>}
          {x.category && <KeyValue label={t("Category")}>{t(x.category)}</KeyValue>}
          {x.fundingType && <KeyValue label={t("Funding type")}>{t(FUNDING_TYPE[x.fundingType] ?? x.fundingType)}</KeyValue>}
          {x.projectTitle && <KeyValue label={t("Project")}>{x.projectTitle}</KeyValue>}
          {x.budgetName && <KeyValue label={t("Budget")}>{x.budgetName}</KeyValue>}
          {x.accountName && <KeyValue label={t("Account")}>{x.accountName}</KeyValue>}
          {x.requestedBy && <KeyValue label={t("Recorded by")}>{x.requestedBy}</KeyValue>}
          {x.approvedBy && <KeyValue label={t("Approved by")}>{x.approvedBy}</KeyValue>}
          {x.externalReference && <KeyValue label={t("External reference")}>{x.externalReference}</KeyValue>}
        </dl>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("Receipts & documents")}</h3>
            {q.data.canAttach && (
              <label className={cn("inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary hover:underline", uploading && "opacity-50")}>
                <Plus className="size-3.5" />{uploading ? t("Uploading…") : t("Attach")}
                <input type="file" className="sr-only" disabled={uploading} accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.csv" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </label>
            )}
          </div>
          {files.length === 0 ? (
            <p className={cn("text-sm", ["paid", "received"].includes(x.status) ? "text-st-red" : "text-muted-foreground")}>
              {["paid", "received"].includes(x.status) ? t("No receipt or document attached yet.") : t("No documents.")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {files.map((f: any) => (
                <li key={f.id}><a href={`${API_URL}/api/org/${slug}/files/${f.id}`} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"><FileText className="size-4 text-muted-foreground" /><span className="flex-1 truncate">{f.fileName}</span><span className="text-xs text-muted-foreground">{Math.max(1, Math.round(f.size / 1024))} KB</span></a></li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("History")}</h3>
          <ol className="relative space-y-3 border-s border-border ps-5">
            {history.map((h: any) => (
              <li key={h.id} className="relative">
                <span className="absolute -start-[25px] top-1 size-2.5 rounded-full border-2 border-card bg-st-neutral" />
                <p className="text-sm"><span className="font-medium">{h.actorName ?? t("System")}</span> {t(AUDIT_ACTION[h.action] ?? h.action)}</p>
                {h.reason && <p className="mt-0.5 rounded bg-muted px-2 py-1 text-xs">“{h.reason}”</p>}
                <p className="text-xs text-muted-foreground">{formatDateTime(h.created_at, lang, org.timezone)}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <FormDialog open={mode === "reject" || mode === "cancel" || mode === "reverse"} onOpenChange={(o) => !o && setMode(null)}
        title={mode === "reverse" ? t("Reverse this entry") : mode === "reject" ? t("Reject expense") : t("Cancel entry")}
        description={mode === "reverse" ? t("A reversal entry cancels its effect. Both entries stay in the books, linked, with your reason.") : undefined}
        submitLabel={mode === "reverse" ? t("Post reversal") : t("Confirm")} busy={act.isPending} disabled={reason.trim().length < 3}
        onSubmit={() => act.mutate({ action: mode!, body: { reason: reason.trim() } })}>
        <Field label={t("Reason")} htmlFor="tx-reason" required><Textarea id="tx-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} autoFocus /></Field>
      </FormDialog>
      <FormDialog open={mode === "pay" || mode === "receive"} onOpenChange={(o) => !o && setMode(null)}
        title={mode === "pay" ? t("Record payment") : t("Confirm income received")} submitLabel={t("Post")} busy={act.isPending || uploading}
        disabled={!accountId || (files.length === 0 && !postFile)}
        description={t("Posting is final and creates the accounting entry. Corrections afterwards are made with a reversal.")}
        onSubmit={async () => {
          if (files.length === 0 && postFile) {
            setUploading(true);
            try { await api.upload(slug, "transaction", x.id, postFile); } catch (err) { toast.error(errorMessage(err)); setUploading(false); return; }
            setUploading(false);
            setPostFile(null);
          }
          act.mutate({ action: mode!, body: { accountId: Number(accountId), date } });
        }}>
        <Field label={t("Account")} required><OptionSelect value={accountId} onChange={setAccountId} options={(accounts.data?.accounts ?? []).filter((a) => !a.archivedAt).map((a) => ({ value: a.id, label: a.name }))} /></Field>
        <Field label={t("Date")} htmlFor="tx-date"><Input id="tx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {files.length === 0 && (
          <Field label={mode === "pay" ? t("Invoice or receipt") : t("Agreement or bank receipt")} required hint={t("Every accounting entry needs its supporting document.")}>
            <EvidencePicker file={postFile} onChange={setPostFile} />
          </Field>
        )}
      </FormDialog>
    </div>
  );
}

// Project, or general administration for running costs: every movement has an analytical home.
function CostCenterSelect({ value, onChange, projects }: { value: string | null; onChange: (v: string | null) => void; projects: any[] }) {
  const { t } = useI18n();
  return (
    <OptionSelect value={value} onChange={onChange} placeholder={t("Choose a project…")}
      options={[{ value: "general", label: t("General administration") }, ...projects.map((p) => ({ value: p.id, label: p.title }))]} />
  );
}

const ACCEPT_DOCS = ".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.csv";

function EvidencePicker({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  const { t } = useI18n();
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted/50">
      <Paperclip className="size-4 shrink-0" />
      <span className="truncate">{file ? file.name : t("Choose a file (PDF or photo, max 4 MB)")}</span>
      <input type="file" className="sr-only" accept={ACCEPT_DOCS} onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </label>
  );
}

const validAmount = (v: string) => /^\d{1,12}([.,]\d{1,2})?$/.test(v) && Number(v.replace(",", ".")) > 0;

function ExpenseDialog({ open, onOpenChange, delegated, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; delegated: any[]; onCreated: (id: number) => void }) {
  const { t } = useI18n();
  const { can, slug } = useOrg();
  const budgets = useOrgQuery<{ budgets: any[] }>("/finance/budgets", { enabled: open });
  const projects = useOrgQuery<{ projects: any[] }>("/projects", { enabled: open });
  const blank = { amount: "", date: todayISO(), category: "Venue", counterparty: "", description: "", budgetId: null as string | null, costCenter: null as string | null, externalReference: "", supplierIce: "", supplierIf: "" };
  const [f, setF] = useState(blank);
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => { if (open) { setF({ ...blank, budgetId: !can("finance.create_expense") && delegated[0] ? String(delegated[0].id) : null }); setFile(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const approved = (budgets.data?.budgets ?? []).filter((b) => b.status === "approved");
  const save = useOrgMutation(async (body: any, base) => {
    const res = await api.post<{ transaction: any }>(`${base}/finance/expenses`, body);
    if (file) await api.upload(slug, "transaction", res.transaction.id, file).catch((err) => toast.error(errorMessage(err)));
    return res;
  }, { success: "Expense submitted for approval", onSuccess: (d) => { onOpenChange(false); onCreated(d.transaction.id); } });
  const iceOk = !f.supplierIce || /^\d{15}$/.test(f.supplierIce);
  const valid = validAmount(f.amount) && f.counterparty.trim() && f.description.trim().length >= 3 && (f.budgetId || f.costCenter) && iceOk && (can("finance.create_expense") || f.budgetId);
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("Submit expense")} description={t("It goes to the treasurer for approval. The invoice is required before payment.")}
      submitLabel={t("Submit")} busy={save.isPending} disabled={!valid} wide
      onSubmit={() => save.mutate({
        amount: f.amount, date: f.date, category: f.category, counterparty: f.counterparty, description: f.description,
        budgetId: f.budgetId ? Number(f.budgetId) : null,
        projectId: !f.budgetId && f.costCenter && f.costCenter !== "general" ? Number(f.costCenter) : null,
        costCenter: !f.budgetId && f.costCenter === "general" ? "general" : null,
        externalReference: f.externalReference.trim() || null, supplierIce: f.supplierIce || null, supplierIf: f.supplierIf || null,
      })}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("Amount")} htmlFor="ex-amt" required><Input id="ex-amt" inputMode="decimal" dir="ltr" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0.00" autoFocus /></Field>
        <Field label={t("Date")} htmlFor="ex-date" required><Input id="ex-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={t("Category")}><OptionSelect value={f.category} onChange={(v) => setF({ ...f, category: v ?? "Other" })} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: t(c) }))} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Budget")} required={!can("finance.create_expense")}>
          <OptionSelect value={f.budgetId} onChange={(v) => setF({ ...f, budgetId: v })} allowNone={can("finance.create_expense")} noneLabel={t("No budget")}
            options={(can("finance.create_expense") ? approved : delegated).map((b) => ({ value: b.id, label: b.name }))} />
        </Field>
        {!f.budgetId && (
          <Field label={t("Project / Cost center")} required>
            <CostCenterSelect value={f.costCenter} onChange={(v) => setF({ ...f, costCenter: v })} projects={projects.data?.projects ?? []} />
          </Field>
        )}
      </div>
      <Field label={t("Supplier / payee")} htmlFor="ex-cp" required><Input id="ex-cp" value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} maxLength={200} /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("Supplier ICE")} htmlFor="ex-ice" hint={iceOk ? t("15 digits — required on invoices by the tax administration") : t("ICE must be 15 digits")}>
          <Input id="ex-ice" inputMode="numeric" dir="ltr" value={f.supplierIce} onChange={(e) => setF({ ...f, supplierIce: e.target.value.replace(/\D/g, "").slice(0, 15) })} placeholder="000000000000000" aria-invalid={!iceOk} />
        </Field>
        <Field label={t("Supplier IF")} htmlFor="ex-if"><Input id="ex-if" inputMode="numeric" dir="ltr" value={f.supplierIf} onChange={(e) => setF({ ...f, supplierIf: e.target.value.replace(/\D/g, "").slice(0, 15) })} /></Field>
        <Field label={t("Invoice number")} htmlFor="ex-ref"><Input id="ex-ref" value={f.externalReference} onChange={(e) => setF({ ...f, externalReference: e.target.value })} maxLength={120} /></Field>
      </div>
      <Field label={t("Purpose")} htmlFor="ex-desc" required><Textarea id="ex-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} /></Field>
      <Field label={t("Invoice or receipt")} hint={t("Optional now — required before the payment is recorded.")}><EvidencePicker file={file} onChange={setFile} /></Field>
    </FormDialog>
  );
}

function IncomeDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: number) => void }) {
  const { t } = useI18n();
  const { slug } = useOrg();
  const accounts = useOrgQuery<{ accounts: any[] }>("/finance/accounts", { enabled: open });
  const projects = useOrgQuery<{ projects: any[] }>("/projects", { enabled: open });
  const sponsors = useOrgQuery<{ sponsors: any[] }>("/sponsors", { enabled: open, retry: false });
  const blank = { amount: "", date: todayISO(), counterparty: "", description: "", fundingType: "sponsorship", status: "received", accountId: null as string | null, costCenter: null as string | null, sponsorId: null as string | null, externalReference: "" };
  const [f, setF] = useState(blank);
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => { if (open) { setF(blank); setFile(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // Received income is recorded as expected, its document attached, then confirmed —
  // so the accounting entry always has its supporting document.
  const save = useOrgMutation(async (body: any, base) => {
    const res = await api.post<{ transaction: any }>(`${base}/finance/income`, { ...body, status: "expected" });
    if (file) await api.upload(slug, "transaction", res.transaction.id, file);
    if (f.status === "received") await api.post(`${base}/finance/transactions/${res.transaction.id}/receive`, { accountId: Number(f.accountId), date: f.date });
    return res;
  }, { success: "Income recorded", onSuccess: (d) => { onOpenChange(false); onCreated(d.transaction.id); } });
  const received = f.status === "received";
  const valid = validAmount(f.amount) && f.counterparty.trim() && f.description.trim().length >= 3 && f.costCenter && (!received || (f.accountId && file));
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("Record income")} submitLabel={t("Save")} busy={save.isPending} disabled={!valid} wide
      onSubmit={() => save.mutate({
        amount: f.amount, date: f.date, counterparty: f.counterparty, description: f.description, fundingType: f.fundingType,
        projectId: f.costCenter && f.costCenter !== "general" ? Number(f.costCenter) : null, costCenter: f.costCenter === "general" ? "general" : null,
        sponsorId: f.sponsorId ? Number(f.sponsorId) : null, externalReference: f.externalReference.trim() || null,
      })}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("Amount")} htmlFor="in-amt" required><Input id="in-amt" inputMode="decimal" dir="ltr" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0.00" autoFocus /></Field>
        <Field label={t("Date")} htmlFor="in-date" required><Input id="in-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={t("Status")}><OptionSelect value={f.status} onChange={(v) => setF({ ...f, status: v ?? "received" })} options={[{ value: "received", label: t("Received") }, { value: "expected", label: t("Expected") }]} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Funding source")} required><OptionSelect value={f.fundingType} onChange={(v) => setF({ ...f, fundingType: v ?? "other" })} options={Object.keys(FUNDING_TYPE).map((k) => ({ value: k, label: t(FUNDING_TYPE[k]) }))} /></Field>
        <Field label={t("Project / Cost center")} required><CostCenterSelect value={f.costCenter} onChange={(v) => setF({ ...f, costCenter: v })} projects={projects.data?.projects ?? []} /></Field>
        <Field label={t("Payer")} htmlFor="in-cp" required><Input id="in-cp" value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} maxLength={200} /></Field>
        {(sponsors.data?.sponsors ?? []).length > 0 && <Field label={t("Sponsor")}><OptionSelect value={f.sponsorId} onChange={(v) => setF({ ...f, sponsorId: v })} allowNone noneLabel={t("None")} options={sponsors.data!.sponsors.map((s) => ({ value: s.id, label: s.name }))} /></Field>}
      </div>
      <Field label={t("Description")} htmlFor="in-desc" required><Textarea id="in-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {received && <Field label={t("Received into")} required><OptionSelect value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} options={(accounts.data?.accounts ?? []).filter((a) => !a.archivedAt).map((a) => ({ value: a.id, label: a.name }))} /></Field>}
        <Field label={t("Reference (agreement, transfer…)")} htmlFor="in-ref"><Input id="in-ref" value={f.externalReference} onChange={(e) => setF({ ...f, externalReference: e.target.value })} maxLength={120} /></Field>
      </div>
      <Field label={t("Agreement or bank receipt")} required={received} hint={received ? t("Every accounting entry needs its supporting document.") : t("Optional until the money is received.")}>
        <EvidencePicker file={file} onChange={setFile} />
      </Field>
    </FormDialog>
  );
}

// ── Budgets ────────────────────────────────────────────────────────────────

function Budgets() {
  const { t, lang } = useI18n();
  const { can, me, org } = useOrg();
  const money = useMoney();
  const q = useOrgQuery<{ budgets: any[] }>("/finance/budgets");
  const [creating, setCreating] = useState(false);
  const [changing, setChanging] = useState<any | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const approve = useOrgMutation((id: number, base) => api.post(`${base}/finance/budgets/${id}/approve`), { success: "Budget approved" });
  return (
    <div className="space-y-4">
      {can("finance.approve") && <div className="flex justify-end"><Button onClick={() => setCreating(true)}><Plus />{t("New budget")}</Button></div>}
      {q.isLoading ? <LoadingRows /> : (q.data?.budgets ?? []).length === 0 ? <Section><EmptyState icon={Wallet} title={t("No budgets yet")} /></Section> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {q.data!.budgets.map((b) => {
            const used = Number(b.spent) + Number(b.committed);
            const pct = Number(b.approvedAmount) ? (used / Number(b.approvedAmount)) * 100 : 0;
            return (
              <Section key={b.id} title={<span className="flex items-center gap-2">{b.name}{b.isMine && <Pill tone="gold">{t("Delegated to you")}</Pill>}</span>}
                action={<Pill tone={b.status === "approved" ? "green" : b.status === "draft" ? "amber" : "neutral"}>{t(BUDGET_STATUS[b.status])}</Pill>}>
                <p className="text-xs text-muted-foreground">
                  {[b.projectTitle, b.committeeName, b.ownerName && t("Owner: {name}", { name: b.ownerName })].filter(Boolean).join(" · ") || t("Organisation-wide")}
                  {b.periodStart && ` · ${formatDate(b.periodStart, lang, org.timezone)} – ${formatDate(b.periodEnd, lang, org.timezone)}`}
                </p>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div><p className="text-xs text-muted-foreground">{t("Approved")}</p><p className="font-semibold tabular">{money(b.approvedAmount, b.currency)}</p></div>
                  <div><p className="text-xs text-muted-foreground">{t("Spent")}</p><p className="font-semibold tabular">{money(b.spent, b.currency)}</p></div>
                  <div><p className="text-xs text-muted-foreground">{t("Remaining")}</p><p className={cn("font-semibold tabular", Number(b.remaining) < 0 ? "text-st-red" : "text-st-green")}>{money(b.remaining, b.currency)}</p></div>
                </div>
                <ProgressBar value={pct} tone={pct > 100 ? "red" : pct > 85 ? "amber" : "blue"} className="mt-3" />
                {Number(b.committed) > 0 && <p className="mt-1 text-xs text-muted-foreground">{t("{amount} committed, awaiting payment", { amount: money(b.committed, b.currency) })}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  {b.status === "draft" && can("finance.approve") && b.createdByMembershipId !== me.membershipId && <Button size="sm" onClick={() => approve.mutate(b.id)}><Check />{t("Approve budget")}</Button>}
                  {b.status === "draft" && b.createdByMembershipId === me.membershipId && <span className="text-xs text-muted-foreground">{t("Waiting for a second person to approve")}</span>}
                  {b.status === "approved" && (can("finance.approve") || b.isMine) && <Button size="sm" variant="outline" onClick={() => setChanging(b)}>{t("Request change")}</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === b.id ? null : b.id)}>
                    {t("Change history")}{b.pendingChanges > 0 && <span className="ms-1 rounded-full bg-st-amber/15 px-1.5 text-xs text-st-amber">{b.pendingChanges}</span>}
                  </Button>
                </div>
                {expanded === b.id && <BudgetChanges budgetId={b.id} currency={b.currency} />}
              </Section>
            );
          })}
        </div>
      )}
      <BudgetDialog open={creating} onOpenChange={setCreating} />
      <ChangeDialog budget={changing} onClose={() => setChanging(null)} />
    </div>
  );
}

function BudgetChanges({ budgetId, currency }: { budgetId: number; currency: string }) {
  const { t, lang } = useI18n();
  const { can, me } = useOrg();
  const money = useMoney();
  const q = useOrgQuery<{ changes: any[] }>(`/finance/budgets/${budgetId}/changes`);
  const decide = useOrgMutation((v: { id: number; decision: string }, base) => api.post(`${base}/finance/budget-changes/${v.id}/decide`, { decision: v.decision }), { success: "Decision recorded" });
  if (q.isLoading) return null;
  const list = q.data?.changes ?? [];
  if (!list.length) return <p className="mt-3 text-xs text-muted-foreground">{t("No changes requested.")}</p>;
  return (
    <ul className="mt-3 space-y-2 border-t border-border pt-3">
      {list.map((c) => (
        <li key={c.id} className="text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular">{money(c.previousAmount, currency)} → <span className="font-semibold">{money(c.newAmount, currency)}</span></span>
            <Pill tone={c.status === "approved" ? "green" : c.status === "rejected" ? "red" : "amber"}>{t(c.status === "pending" ? "Pending" : c.status === "approved" ? "Approved" : "Rejected")}</Pill>
            {c.status === "pending" && can("finance.approve") && c.requestedByMembershipId !== me.membershipId && (
              <span className="ms-auto flex gap-1">
                <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: c.id, decision: "approve" })}>{t("Approve")}</Button>
                <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: c.id, decision: "reject" })}>{t("Reject")}</Button>
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">“{c.reason}” · {c.requestedBy} · {relativeTime(c.createdAt, lang)}</p>
        </li>
      ))}
    </ul>
  );
}

function BudgetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const projects = useOrgQuery<{ projects: any[] }>("/projects", { enabled: open });
  const blank = { name: "", approvedAmount: "", projectId: null as string | null, ownerMembershipId: null as number | null, periodStart: "", periodEnd: "" };
  const [f, setF] = useState(blank);
  useEffect(() => { if (open) setF(blank); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useOrgMutation((body: any, base) => api.post(`${base}/finance/budgets`, body), { success: "Budget proposed — a second person must approve it", onSuccess: () => onOpenChange(false) });
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("New budget")} description={t("Budgets start as drafts and need a second person with approval rights.")}
      submitLabel={t("Propose budget")} busy={save.isPending} disabled={f.name.trim().length < 2 || !/^\d{1,12}([.,]\d{1,2})?$/.test(f.approvedAmount)}
      onSubmit={() => save.mutate({ ...f, projectId: f.projectId ? Number(f.projectId) : null, periodStart: f.periodStart || null, periodEnd: f.periodEnd || null })}>
      <Field label={t("Name")} htmlFor="bu-name" required><Input id="bu-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={160} autoFocus /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Amount")} htmlFor="bu-amt" required><Input id="bu-amt" inputMode="decimal" dir="ltr" value={f.approvedAmount} onChange={(e) => setF({ ...f, approvedAmount: e.target.value })} placeholder="0.00" /></Field>
        <Field label={t("Project")}><OptionSelect value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} allowNone noneLabel={t("Organisation-wide")} options={(projects.data?.projects ?? []).map((p) => ({ value: p.id, label: p.title }))} /></Field>
        <Field label={t("From")} htmlFor="bu-from"><Input id="bu-from" type="date" value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} /></Field>
        <Field label={t("To")} htmlFor="bu-to"><Input id="bu-to" type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></Field>
      </div>
      <Field label={t("Delegate to")} hint={t("This person can see this budget and submit expenses against it — nothing else in finance.")}>
        <PersonPicker value={f.ownerMembershipId} onChange={(v) => setF({ ...f, ownerMembershipId: v })} placeholder={t("No delegate")} />
      </Field>
    </FormDialog>
  );
}

function ChangeDialog({ budget, onClose }: { budget: any | null; onClose: () => void }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const save = useOrgMutation((body: any, base) => api.post(`${base}/finance/budgets/${budget.id}/changes`, body), { success: "Change requested", onSuccess: () => { setAmount(""); setReason(""); onClose(); } });
  return (
    <FormDialog open={!!budget} onOpenChange={(o) => !o && onClose()} title={t("Request budget change")} description={t("Another person with approval rights decides. The previous and new amounts are both kept.")}
      submitLabel={t("Request")} busy={save.isPending} disabled={!/^\d{1,12}([.,]\d{1,2})?$/.test(amount) || reason.trim().length < 3} onSubmit={() => save.mutate({ newAmount: amount, reason: reason.trim() })}>
      <Field label={t("New amount")} htmlFor="ch-amt" required><Input id="ch-amt" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={budget?.approvedAmount} autoFocus /></Field>
      <Field label={t("Reason")} htmlFor="ch-reason" required><Textarea id="ch-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></Field>
    </FormDialog>
  );
}

// ── Accounts ───────────────────────────────────────────────────────────────

function Accounts() {
  const { t, lang } = useI18n();
  const { can, org } = useOrg();
  const money = useMoney();
  const q = useOrgQuery<{ accounts: any[] }>("/finance/accounts");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("bank");
  const [opening, setOpening] = useState("0");
  const [institution, setInstitution] = useState("");
  const [reconciling, setReconciling] = useState<any | null>(null);
  const [through, setThrough] = useState(todayISO());
  const create = useOrgMutation((body: any, base) => api.post(`${base}/finance/accounts`, body), { success: "Account added", onSuccess: () => { setCreating(false); setName(""); setOpening("0"); setInstitution(""); } });
  const reconcile = useOrgMutation((v: any, base) => api.post<{ reconciled: number }>(`${base}/finance/accounts/${reconciling.id}/reconcile`, v), {
    onSuccess: (d) => { toast.success(t("{n} entries marked reconciled", { n: d.reconciled })); setReconciling(null); },
  });
  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 text-xs text-muted-foreground"><Lock className="mt-0.5 size-3.5 shrink-0" />{t("Accounts are labels for your bank and cash. Never enter online-banking passwords or card numbers here.")}</p>
      {can("finance.approve") && <div className="flex justify-end"><Button onClick={() => setCreating(true)}><Plus />{t("Add account")}</Button></div>}
      <Section bodyClassName="p-0">
        {q.isLoading ? <div className="p-4"><LoadingRows rows={3} /></div> : (q.data?.accounts ?? []).length === 0 ? <EmptyState icon={Landmark} title={t("No accounts yet")} /> : (
          <ul className="divide-y divide-border">
            {q.data!.accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
                <Landmark className="size-5 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{a.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(ACCOUNT_KIND[a.kind])}{a.institution && ` · ${a.institution}`} · {a.reconciledThrough ? t("Reconciled through {date}", { date: formatDate(a.reconciledThrough, lang, org.timezone) }) : t("Never reconciled")}
                    {a.unreconciled > 0 && ` · ${t("{n} unreconciled", { n: a.unreconciled })}`}
                  </span>
                </span>
                <span className="text-lg font-semibold tabular">{money(a.balance, a.currency)}</span>
                {can("finance.approve") && <Button size="sm" variant="outline" onClick={() => setReconciling(a)}>{t("Reconcile")}</Button>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <FormDialog open={creating} onOpenChange={setCreating} title={t("Add account")} submitLabel={t("Add")} busy={create.isPending} disabled={name.trim().length < 2 || !/^-?\d{1,12}([.,]\d{1,2})?$/.test(opening)}
        onSubmit={() => create.mutate({ name: name.trim(), kind, openingBalance: opening, institution: institution.trim() || null })}>
        <Field label={t("Name")} htmlFor="ac-name" required><Input id="ac-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Type")}><OptionSelect value={kind} onChange={(v) => setKind(v ?? "bank")} options={Object.keys(ACCOUNT_KIND).map((k) => ({ value: k, label: t(ACCOUNT_KIND[k]) }))} /></Field>
          <Field label={t("Opening balance")} htmlFor="ac-open"><Input id="ac-open" inputMode="decimal" dir="ltr" value={opening} onChange={(e) => setOpening(e.target.value)} /></Field>
        </div>
        <Field label={t("Bank or provider")} htmlFor="ac-inst"><Input id="ac-inst" value={institution} onChange={(e) => setInstitution(e.target.value)} maxLength={120} /></Field>
      </FormDialog>
      <FormDialog open={!!reconciling} onOpenChange={(o) => !o && setReconciling(null)} title={t("Reconcile {name}", { name: reconciling?.name ?? "" })}
        description={t("Marks every posted entry up to this date as matching your bank statement.")} submitLabel={t("Reconcile")} busy={reconcile.isPending} onSubmit={() => reconcile.mutate({ through })}>
        <Field label={t("Statement date")} htmlFor="rc-date"><Input id="rc-date" type="date" value={through} onChange={(e) => setThrough(e.target.value)} /></Field>
      </FormDialog>
    </div>
  );
}

// ── Reports ────────────────────────────────────────────────────────────────

function Reports() {
  const { t } = useI18n();
  const { path } = useOrg();
  const projects = useOrgQuery<{ projects: any[] }>("/projects");
  const [projectId, setProjectId] = useState<string | null>(null);
  return (
    <Section title={t("Project financial report")} icon={FileText}>
      <p className="mb-4 text-sm text-muted-foreground">{t("Budget, income, expenses by category, every posted entry and an index of supporting documents — printable or saved as PDF.")}</p>
      <div className="flex flex-wrap gap-2">
        <div className="w-72"><OptionSelect value={projectId} onChange={setProjectId} options={(projects.data?.projects ?? []).map((p) => ({ value: p.id, label: p.title }))} placeholder={t("Choose a project")} /></div>
        <Button disabled={!projectId} asChild={!!projectId}>{projectId ? <Link href={path(`/finance/report/${projectId}`)}><FileText />{t("Open report")}</Link> : <span><FileText />{t("Open report")}</span>}</Button>
      </div>
    </Section>
  );
}

export function ProjectReportPage({ params }: { params: { projectId: string } }) {
  const { t, lang } = useI18n();
  const { org, path } = useOrg();
  const money = useMoney();
  const q = useOrgQuery<any>(`/finance/reports/project/${params.projectId}`);
  const totals = useMemo(() => q.data?.totals, [q.data]);
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.error || !q.data) return <ErrorState message={t("This report isn't available.")} />;
  const d = q.data;
  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <Link href={path("/finance?tab=reports")} className="text-sm text-muted-foreground hover:text-foreground">← {t("Finance")}</Link>
        <Button onClick={() => window.print()}><Printer />{t("Print / save as PDF")}</Button>
      </div>
      <header>
        <p className="text-sm text-muted-foreground">{org.name} · {t("Project financial report")}</p>
        <h1 className="text-2xl font-semibold">{d.project.title}</h1>
        <p className="text-xs text-muted-foreground">{t("Generated {date}", { date: formatDateTime(d.generatedAt, lang, org.timezone) })}</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t("Income")} value={money(totals.income)} icon={HandCoins} tone="green" />
        <StatCard label={t("Expenses")} value={money(totals.expenses)} icon={Receipt} tone="red" />
        <StatCard label={t("Balance")} value={money(totals.balance)} icon={Wallet} tone="gold" />
      </div>
      {d.budgets.length > 0 && (
        <Section title={t("Budgets")}>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground"><tr><th className="py-1 text-start font-medium">{t("Budget")}</th><th className="text-end font-medium">{t("Approved")}</th><th className="text-end font-medium">{t("Spent")}</th><th className="text-end font-medium">{t("Remaining")}</th></tr></thead>
            <tbody>{d.budgets.map((b: any) => <tr key={b.id} className="border-t border-border"><td className="py-2">{b.name}</td><td className="text-end tabular">{money(b.approvedAmount)}</td><td className="text-end tabular">{money(b.spent)}</td><td className="text-end tabular">{money(b.remaining)}</td></tr>)}</tbody>
          </table>
        </Section>
      )}
      {d.byCategory.length > 0 && (
        <Section title={t("Expenses by category")}>
          <ul className="space-y-1 text-sm">{d.byCategory.map((c: any) => <li key={c.category} className="flex justify-between"><span>{t(c.category)}</span><span className="tabular">{money(c.total)}</span></li>)}</ul>
        </Section>
      )}
      <Section title={t("Posted entries & supporting documents")} bodyClassName="p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-start font-medium">{t("Reference")}</th><th className="px-4 py-2 text-start font-medium">{t("Date")}</th><th className="px-4 py-2 text-start font-medium">{t("Description")}</th><th className="px-4 py-2 text-start font-medium">{t("Documents")}</th><th className="px-4 py-2 text-end font-medium">{t("Amount")}</th></tr></thead>
          <tbody>
            {d.transactions.map((x: any) => (
              <tr key={x.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2 font-mono text-xs">{x.reference}</td>
                <td className="whitespace-nowrap px-4 py-2">{formatDate(x.date, lang, org.timezone)}</td>
                <td className="px-4 py-2">{x.description}{x.counterparty && <span className="text-muted-foreground"> · {x.counterparty}</span>}</td>
                <td className="px-4 py-2 text-xs">{x.files.length ? x.files.map((f: any) => f.fileName).join(", ") : <span className="text-st-red">{t("missing")}</span>}</td>
                <td className={cn("whitespace-nowrap px-4 py-2 text-end tabular", x.direction === "in" && "text-st-green")}>{x.direction === "in" ? "+" : "−"}{money(x.amount, x.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
