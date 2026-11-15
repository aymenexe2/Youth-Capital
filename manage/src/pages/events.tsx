import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { CalendarDays, ChevronLeft, ChevronRight, List, MapPin, Plus, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n, type Lang } from "@/lib/i18n";
import { formatDate, formatDateTime } from "@/lib/format";
import { EVENT_TYPE } from "@/lib/labels";
import { useOrg, useOrgQuery } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pill, Section, StatusPill } from "@/components/primitives";
import { EventFormDialog } from "@/components/forms";

const localeOf = (lang: Lang) => (lang === "fr" ? "fr-MA" : lang === "ar" ? "ar-MA" : "en-GB");
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function EventsPage() {
  const { t } = useI18n();
  const { path } = useOrg();
  const [, navigate] = useLocation();
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [creating, setCreating] = useState<null | { startsAt?: string }>(null);
  const q = useOrgQuery<{ events: any[]; canCreate: boolean }>("/events");

  return (
    <>
      <PageHeader
        title={t("Events")}
        description={t("Meetings, workshops, forums and campaigns across the organisation.")}
        actions={
          <>
            <div className="flex rounded-lg border border-border bg-card p-0.5">
              <button aria-pressed={view === "calendar"} onClick={() => setView("calendar")} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm", view === "calendar" ? "bg-secondary" : "text-muted-foreground")}><CalendarDays className="size-4" />{t("Calendar")}</button>
              <button aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm", view === "list" ? "bg-secondary" : "text-muted-foreground")}><List className="size-4" />{t("List")}</button>
            </div>
            {q.data?.canCreate && <Button onClick={() => setCreating({})}><Plus />{t("New event")}</Button>}
          </>
        }
      />
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState onRetry={() => q.refetch()} /> : view === "calendar" ? (
        <MonthCalendar events={q.data!.events} onCreate={q.data?.canCreate ? (date) => setCreating({ startsAt: `${date}T09:00:00` }) : undefined} />
      ) : (
        <EventList events={q.data!.events} canCreate={!!q.data?.canCreate} onCreate={() => setCreating({})} />
      )}
      <EventFormDialog open={!!creating} onOpenChange={(o) => !o && setCreating(null)} defaults={{ startsAt: creating?.startsAt }} onSaved={(e) => navigate(path(`/events/${e.id}`))} />
    </>
  );
}

function MonthCalendar({ events, onCreate }: { events: any[]; onCreate?: (date: string) => void }) {
  const { t, lang } = useI18n();
  const { path } = useOrg();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const start = new Date(cursor);
  start.setDate(1 - ((start.getDay() + 6) % 7)); // weeks start on Monday
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const from = days[0], to = days[41];
  const tasks = useOrgQuery<{ tasks: any[] }>(`/calendar?from=${ymd(from)}&to=${ymd(to)}T23:59:59`);

  const byDay = useMemo(() => {
    const map = new Map<string, { events: any[]; tasks: any[] }>();
    const slot = (k: string) => map.get(k) ?? (map.set(k, { events: [], tasks: [] }), map.get(k)!);
    for (const e of events) slot(ymd(new Date(e.startsAt))).events.push(e);
    for (const x of tasks.data?.tasks ?? []) if (x.dueDate && !["completed", "cancelled"].includes(x.status)) slot(x.dueDate).tasks.push(x);
    return map;
  }, [events, tasks.data]);

  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(localeOf(lang), { weekday: "short" }).format(new Date(2024, 0, 1 + i)));
  const today = ymd(new Date());
  const shift = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));

  return (
    <Section bodyClassName="p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold capitalize">{new Intl.DateTimeFormat(localeOf(lang), { month: "long", year: "numeric" }).format(cursor)}</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label={t("Previous month")}><ChevronLeft className="rtl:rotate-180" /></Button>
          <Button variant="outline" size="sm" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }}>{t("Today")}</Button>
          <Button variant="ghost" size="icon" onClick={() => shift(1)} aria-label={t("Next month")}><ChevronRight className="rtl:rotate-180" /></Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[720px] grid-cols-7">
          {weekdays.map((w) => <div key={w} className="border-b border-border px-2 py-2 text-xs font-medium uppercase text-muted-foreground">{w}</div>)}
          {days.map((d) => {
            const k = ymd(d);
            const slot = byDay.get(k);
            const inMonth = d.getMonth() === cursor.getMonth();
            return (
              <div key={k} className={cn("group min-h-28 border-b border-e border-border p-1.5 [&:nth-child(7n)]:border-e-0", !inMonth && "bg-muted/40")}>
                <div className="mb-1 flex items-center justify-between">
                  <span className={cn("grid size-6 place-items-center rounded-full text-xs tabular", k === today ? "bg-primary font-semibold text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground")}>{d.getDate()}</span>
                  {onCreate && <button aria-label={t("New event")} onClick={() => onCreate(k)} className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100 focus:opacity-100"><Plus className="size-3.5" /></button>}
                </div>
                <div className="space-y-1">
                  {slot?.events.slice(0, 3).map((e) => (
                    <Link key={e.id} href={path(`/events/${e.id}`)} className={cn("block truncate rounded px-1.5 py-0.5 text-xs font-medium", e.status === "cancelled" ? "bg-muted text-muted-foreground line-through" : "bg-st-violet/12 text-st-violet hover:bg-st-violet/20")}>
                      {new Intl.DateTimeFormat(localeOf(lang), { hour: "2-digit", minute: "2-digit" }).format(new Date(e.startsAt))} {e.title}
                    </Link>
                  ))}
                  {slot?.tasks.slice(0, 2).map((x) => (
                    <Link key={`t${x.id}`} href={path(`/tasks/${x.id}`)} className="block truncate rounded border border-dashed border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground">
                      ✓ {x.title}
                    </Link>
                  ))}
                  {slot && slot.events.length + slot.tasks.length > 5 && <span className="block px-1.5 text-[11px] text-muted-foreground">+{slot.events.length + slot.tasks.length - 5}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

function EventList({ events, canCreate, onCreate }: { events: any[]; canCreate: boolean; onCreate: () => void }) {
  const { t, lang } = useI18n();
  const { org, path } = useOrg();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const now = Date.now();
  const list = events
    .filter((e) => (tab === "upcoming" ? new Date(e.endsAt ?? e.startsAt).getTime() >= now : new Date(e.endsAt ?? e.startsAt).getTime() < now))
    .sort((a, b) => (tab === "upcoming" ? 1 : -1) * (new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()));
  return (
    <Section bodyClassName="p-0" title={
      <span className="flex gap-1">
        {(["upcoming", "past"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={cn("rounded-md px-2.5 py-1 text-sm", tab === k ? "bg-secondary font-semibold" : "font-normal text-muted-foreground")}>{k === "upcoming" ? t("Upcoming") : t("Past")}</button>
        ))}
      </span>
    }>
      {list.length === 0 ? (
        <EmptyState icon={CalendarDays} title={tab === "upcoming" ? t("No upcoming events") : t("No past events")} action={canCreate && tab === "upcoming" && <Button size="sm" onClick={onCreate}><Plus />{t("New event")}</Button>} />
      ) : (
        <ul className="divide-y divide-border">
          {list.map((e) => (
            <li key={e.id}>
              <Link href={path(`/events/${e.id}`)} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50">
                <span className="grid w-14 shrink-0 place-items-center rounded-lg border border-border bg-gold-soft py-1.5 text-center">
                  <span className="text-lg font-semibold leading-none tabular">{formatDate(e.startsAt, lang, org.timezone, { day: "numeric" })}</span>
                  <span className="text-[10px] font-medium uppercase text-gold">{formatDate(e.startsAt, lang, org.timezone, { month: "short" })}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span>{formatDateTime(e.startsAt, lang, org.timezone)}</span>
                    {e.venue && <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{e.venue}</span>}
                    {e.onlineUrl && <span className="inline-flex items-center gap-1"><Video className="size-3" />{t("Online")}</span>}
                    {e.committeeName && <span>{e.committeeName}</span>}
                  </span>
                </span>
                <Pill tone="violet" className="hidden sm:inline-flex">{t(EVENT_TYPE[e.type] ?? e.type)}</Pill>
                <StatusPill kind="event" status={e.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
