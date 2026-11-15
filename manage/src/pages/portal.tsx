import { CalendarRange, Check, Download, FileText, Flag, Globe, LogOut, MapPin, Megaphone, Paperclip, Printer, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { API_URL } from "@/lib/env";
import { formatDate, formatMoney } from "@/lib/format";
import { useOrg, useOrgQuery } from "@/hooks/use-org";
import { useSession, useSignOut } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingRows, PersonAvatar, ProgressBar, Section, StatusPill } from "@/components/primitives";
import { LanguageMenu, ThemeToggle } from "@/components/shell";

// The sponsor portal: a separate, minimal shell for external sponsor contacts.
// The API only ever returns this sponsor's funded projects, published updates
// and explicitly shared records.

export default function PortalPage() {
  const { t, lang } = useI18n();
  const { slug } = useOrg();
  const { user } = useSession();
  const signOut = useSignOut();
  const q = useOrgQuery<any>("/portal");
  const d = q.data;
  const money = (v: any) => formatMoney(v, d?.organisation.currency ?? "MAD", lang);
  const tz = d?.organisation.timezone;

  return (
    <div className="min-h-screen">
      <header className="glass-bar mx-3 mt-3 rounded-[24px] border border-white/70 shadow-[0_16px_40px_-24px_rgb(30_64_175/0.35)] dark:border-white/10 print:hidden sm:mx-6">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-4 sm:px-6">
          <img src="/youth_capital_logo_dark.svg" alt="Youth Capital" className="h-10 w-auto dark:hidden" />
          <img src="/youth_capital_logo_light.svg" alt="Youth Capital" className="hidden h-10 w-auto dark:block" />
          <div className="min-w-0 flex-1 border-s border-border ps-4">
            <p className="truncate text-[15px] font-semibold">{d?.organisation.name ?? ""}</p>
            <p className="text-[11px] font-medium uppercase tracking-wider text-primary">{t("Sponsor portal")}</p>
          </div>
          <div className="flex items-center gap-1">
            <LanguageMenu /><ThemeToggle />
            <Button variant="ghost" size="sm" onClick={signOut}><LogOut />{t("Sign out")}</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        {q.isLoading ? <LoadingRows rows={6} /> : q.error || !d ? <ErrorState onRetry={() => q.refetch()} /> : (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              {d.sponsor?.logoUrl && <img src={d.sponsor.logoUrl} alt="" className="size-16 rounded-xl border border-border bg-white object-contain p-1.5" referrerPolicy="no-referrer" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted-foreground">{t("Welcome, {name}", { name: user?.fullName?.split(" ")[0] ?? "" })}</p>
                <h1 className="text-2xl font-semibold tracking-tight">{d.sponsor?.name}</h1>
                {d.sponsor?.website && <a href={d.sponsor.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><Globe className="size-3.5" />{d.sponsor.website.replace(/^https?:\/\//, "")}</a>}
              </div>
              <Button variant="outline" onClick={() => window.print()} className="print:hidden"><Printer />{t("Download report")}</Button>
            </div>

            {d.projects.length === 0 ? <Section><EmptyState icon={Flag} title={t("No projects to show yet")} description={t("Projects you fund will appear here once the organisation links them.")} /></Section> : (
              d.projects.map((p: any) => {
                const spentPct = Number(p.funding.approvedBudget) ? (Number(p.funding.reportedSpend) / Number(p.funding.approvedBudget)) * 100 : 0;
                return (
                  <Section key={p.id} title={<span className="flex flex-wrap items-center gap-2">{p.title}<StatusPill kind="project" status={p.status} /></span>}>
                    <div className="grid gap-6 lg:grid-cols-3">
                      <div className="space-y-4 lg:col-span-2">
                        {p.objective && <p className="flex gap-2 text-sm"><Target className="mt-0.5 size-4 shrink-0 text-gold" />{p.objective}</p>}
                        {p.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{p.description}</p>}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {(p.startDate || p.endDate) && <span className="inline-flex items-center gap-1"><CalendarRange className="size-3.5" />{formatDate(p.startDate, lang, tz)} – {formatDate(p.endDate, lang, tz)}</span>}
                          {p.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{p.location}</span>}
                        </div>
                        <div>
                          <div className="mb-1 flex justify-between text-sm"><span>{t("Progress")}</span><span className="font-semibold tabular">{p.progress}%</span></div>
                          <ProgressBar value={p.progress} />
                        </div>
                        {p.milestones.length > 0 && (
                          <ol className="space-y-2">
                            {p.milestones.map((m: any) => (
                              <li key={m.id} className="flex items-center gap-3 text-sm">
                                <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border", m.completedAt ? "border-st-green bg-st-green text-white" : "border-border")}>{m.completedAt && <Check className="size-3" />}</span>
                                <span className={cn("flex-1", m.completedAt && "text-muted-foreground")}>{m.title}</span>
                                <span className="text-xs text-muted-foreground">{formatDate(m.dueDate, lang, tz)}</span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                      <div className="space-y-3 rounded-lg bg-muted/60 p-4 text-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("Funding")}</p>
                        <Row label={t("Your commitment")} value={money(p.funding.committed)} />
                        <Row label={t("Received from you")} value={money(p.funding.received)} />
                        <div className="border-t border-border pt-3" />
                        <Row label={t("Approved budget")} value={money(p.funding.approvedBudget)} />
                        <Row label={t("Reported spend")} value={money(p.funding.reportedSpend)} />
                        <ProgressBar value={spentPct} tone={spentPct > 100 ? "red" : "gold"} />
                        <Row label={t("Remaining allocation")} value={money(p.funding.remaining)} strong />
                      </div>
                    </div>
                  </Section>
                );
              })
            )}

            <Section title={t("Updates")} icon={Megaphone}>
              {d.updates.length === 0 ? <p className="text-sm text-muted-foreground">{t("No updates published yet.")}</p> : (
                <ol className="space-y-6">
                  {d.updates.map((u: any) => (
                    <li key={u.id} className="border-s-2 border-gold/60 ps-4">
                      <p className="text-xs text-muted-foreground">{formatDate(u.publishedAt, lang, tz)} · {u.projectTitle}</p>
                      <h3 className="font-semibold">{u.title}</h3>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{u.body}</p>
                      {u.files.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {u.files.map((f: any) => (
                            <a key={f.id} href={`${API_URL}/api/org/${slug}/portal/files/${f.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-primary hover:bg-muted"><Paperclip className="size-3.5" />{f.fileName}</a>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            <div className="grid gap-6 lg:grid-cols-2">
              <Section title={t("Your contributions")}>
                {d.contributions.length === 0 ? <p className="text-sm text-muted-foreground">{t("No contributions recorded yet.")}</p> : (
                  <ul className="divide-y divide-border text-sm">
                    {d.contributions.map((c: any) => (
                      <li key={c.reference} className="flex items-center justify-between gap-3 py-2">
                        <span className="min-w-0"><span className="block truncate">{c.description}</span><span className="block font-mono text-xs text-muted-foreground">{c.reference} · {formatDate(c.date, lang, tz)}</span></span>
                        <span className={cn("font-semibold tabular", c.direction === "in" ? "text-st-green" : "text-st-red")}>{c.direction === "in" ? "" : "−"}{money(c.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title={t("Shared expenditure & documents")} icon={FileText}>
                {d.shared.transactions.length === 0 && d.shared.files.length === 0 ? <p className="text-sm text-muted-foreground">{t("Nothing has been shared with you yet.")}</p> : (
                  <ul className="space-y-2 text-sm">
                    {d.shared.transactions.map((x: any) => (
                      <li key={`t${x.id}`} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                        <span className="min-w-0"><span className="block truncate">{x.description}</span><span className="block text-xs text-muted-foreground">{x.reference} · {formatDate(x.date, lang, tz)}{x.category && ` · ${t(x.category)}`}</span></span>
                        <span className="font-semibold tabular">{money(x.amount)}</span>
                      </li>
                    ))}
                    {d.shared.files.map((f: any) => (
                      <li key={`f${f.id}`}>
                        <a href={`${API_URL}/api/org/${slug}/portal/files/${f.id}`} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-primary hover:bg-muted"><Download className="size-4" /><span className="flex-1 truncate">{f.fileName}</span></a>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
            <p className="flex items-center justify-center gap-2 pb-4 text-xs text-muted-foreground"><PersonAvatar name={user?.fullName} url={user?.avatarUrl} size={18} />{user?.email}</p>
          </>
        )}
      </main>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className={cn("tabular", strong ? "font-semibold text-foreground" : "font-medium")}>{value}</span></div>;
}
