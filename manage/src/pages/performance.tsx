import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import {
  Award, Flame, Heart, Medal, MessageSquareText, Minus, Plus, Rocket, Scale, Shield, Sparkles, Star, Trophy, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { formatDate, formatNumber, relativeTime } from "@/lib/format";
import { MEMBERSHIP_STATUS, PERIOD, POINT_RULE, REVIEW_DECISION, REVIEW_STATUS, REVIEW_TRIGGER } from "@/lib/labels";
import { useCommittees, useOrg, useOrgMutation, useOrgQuery, useRegions } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Field, LoadingRows, PageHeader, PersonAvatar, Pill, Section, StatCard } from "@/components/primitives";
import { OptionSelect, PersonPicker } from "@/components/pickers";
import { FormDialog } from "@/components/forms";

export const BADGE_ICONS: Record<string, LucideIcon> = { award: Award, trophy: Trophy, star: Star, medal: Medal, flame: Flame, rocket: Rocket, heart: Heart, shield: Shield };

export function Badge({ badge, size = 40 }: { badge: { name: string; icon: string; color?: string | null }; size?: number }) {
  const Icon = BADGE_ICONS[badge.icon] ?? Award;
  return (
    <span className="inline-grid shrink-0 place-items-center rounded-full ring-1 ring-inset ring-black/5" title={badge.name}
      style={{ width: size, height: size, background: `${badge.color ?? "#c9a84c"}22`, color: badge.color ?? "var(--gold)" }}>
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export default function PerformancePage() {
  const { t } = useI18n();
  const { can, orgWide } = useOrg();
  const params = new URLSearchParams(useSearch());
  const [tab, setTab] = useState(params.get("tab") ?? "overview");
  const [awarding, setAwarding] = useState(false);
  const canManage = can("performance.manage");
  const canReview = can("performance.review");
  return (
    <>
      <PageHeader
        title={t("Performance")}
        description={t("Recognition for contribution. Points are transparent and traceable — they never decide anyone's membership on their own.")}
        actions={canManage && <Button onClick={() => setAwarding(true)}><Sparkles />{t("Award points")}</Button>}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">{t("My performance")}</TabsTrigger>
          <TabsTrigger value="leaderboard">{t("Leaderboard")}</TabsTrigger>
          <TabsTrigger value="badges">{t("Badges")}</TabsTrigger>
          {canReview && <TabsTrigger value="reviews">{t("Review cases")}</TabsTrigger>}
          {canManage && orgWide && <TabsTrigger value="rules">{t("Rules")}</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview" className="mt-4"><Overview /></TabsContent>
        <TabsContent value="leaderboard" className="mt-4"><Leaderboard /></TabsContent>
        <TabsContent value="badges" className="mt-4"><Badges /></TabsContent>
        {canReview && <TabsContent value="reviews" className="mt-4"><Reviews /></TabsContent>}
        {canManage && orgWide && <TabsContent value="rules" className="mt-4"><Rules /></TabsContent>}
      </Tabs>
      <AwardDialog open={awarding} onOpenChange={setAwarding} />
    </>
  );
}

function Overview() {
  const { t, lang } = useI18n();
  const { org } = useOrg();
  const q = useOrgQuery<any>("/performance/me");
  const [response, setResponse] = useState("");
  const respond = useOrgMutation((v: { id: number; response: string }, base) => api.post(`${base}/performance/reviews/${v.id}/respond`, { response: v.response }), {
    success: "Response sent", onSuccess: () => setResponse(""),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const d = q.data;
  const openCase = d.reviewCases.find((c: any) => c.status !== "resolved");
  return (
    <div className="space-y-6">
      {openCase && (
        <Section title={t("Membership review")} icon={Scale} className="border-st-amber/40">
          <p className="text-sm">{t("A review was opened: {detail}", { detail: openCase.detail ?? t(REVIEW_TRIGGER[openCase.trigger]) })}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("No decision has been made. You can explain your situation — a person will read it before deciding anything.")}</p>
          {openCase.memberResponse ? (
            <p className="mt-3 rounded-lg bg-muted p-3 text-sm"><span className="font-medium">{t("Your response")}:</span> {openCase.memberResponse}</p>
          ) : (
            <div className="mt-3 space-y-2">
              <Textarea rows={3} value={response} onChange={(e) => setResponse(e.target.value)} placeholder={t("Explain your situation…")} maxLength={3000} />
              <Button size="sm" disabled={response.trim().length < 3 || respond.isPending} onClick={() => respond.mutate({ id: openCase.id, response: response.trim() })}>{t("Send response")}</Button>
            </div>
          )}
        </Section>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t("Your points")} value={formatNumber(d.total, lang)} icon={Trophy} tone="gold" />
        <StatCard label={t("Your rank")} value={`#${d.rank}`} icon={Medal} tone="blue" />
        <StatCard label={t("Badges earned")} value={d.badges.length} icon={Award} tone="violet" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title={t("Points history")} className="lg:col-span-2" bodyClassName="p-0">
          {d.history.length === 0 ? <EmptyState icon={Trophy} title={t("No points yet")} description={t("Complete tasks and get them approved to start earning points.")} /> : (
            <ul className="divide-y divide-border">
              {d.history.map((h: any) => (
                <li key={h.id} className="flex items-start gap-3 px-4 py-3">
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold tabular", h.points >= 0 ? "bg-st-green/10 text-st-green" : "bg-st-red/10 text-st-red")}>
                    {h.points >= 0 ? <Plus className="size-3.5" /> : <Minus className="size-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{h.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      {h.ruleKey ? t(POINT_RULE[h.ruleKey]?.label ?? h.ruleKey) : t("Manual adjustment")}
                      {h.actorName ? ` · ${t("by {name}", { name: h.actorName })}` : ` · ${t("automatic")}`} · {relativeTime(h.createdAt, lang)}
                    </p>
                  </div>
                  <span className={cn("text-sm font-semibold tabular", h.points >= 0 ? "text-st-green" : "text-st-red")}>{signed(h.points)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <div className="space-y-6">
          <Section title={t("Your badges")}>
            {d.badges.length === 0 ? <p className="text-sm text-muted-foreground">{t("No badges yet.")}</p> : (
              <ul className="space-y-3">
                {d.badges.map((b: any) => (
                  <li key={b.id} className="flex items-center gap-3">
                    <Badge badge={b} size={36} />
                    <span className="min-w-0"><span className="block truncate text-sm font-medium">{b.name}</span><span className="block text-xs text-muted-foreground">{formatDate(b.awardedAt, lang, org.timezone)}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title={t("How points work here")}>
            {!d.settings.enabled ? <p className="text-sm text-muted-foreground">{t("Points are switched off in this organisation.")}</p> : (
              <>
                <ul className="space-y-2.5">
                  {d.rules.filter((r: any) => r.enabled).map((r: any) => (
                    <li key={r.key} className="flex items-start justify-between gap-3 text-sm">
                      <span><span className="block">{t(POINT_RULE[r.key]?.label ?? r.key)}</span><span className="block text-xs text-muted-foreground">{t(POINT_RULE[r.key]?.description ?? "")}</span></span>
                      <span className={cn("font-semibold tabular", r.points >= 0 ? "text-st-green" : "text-st-red")}>{signed(r.points)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                  {t("A score of {threshold} or {days} days without activity opens a review where you can explain — never an automatic decision.", { threshold: d.settings.reviewThreshold, days: d.settings.inactivityDays })}
                </p>
              </>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Leaderboard() {
  const { t, lang } = useI18n();
  const { me } = useOrg();
  const { regions } = useRegions();
  const { committees } = useCommittees();
  const [period, setPeriod] = useState("month");
  const [regionId, setRegionId] = useState<string | null>(null);
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const qs = new URLSearchParams({ period, ...(regionId ? { regionId } : {}), ...(committeeId ? { committeeId } : {}) }).toString();
  const q = useOrgQuery<{ leaderboard: any[] }>(`/performance/leaderboard?${qs}`);
  const medal = ["text-gold", "text-st-neutral", "text-st-amber"];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="w-44"><OptionSelect value={period} onChange={(v) => setPeriod(v ?? "month")} options={Object.keys(PERIOD).map((k) => ({ value: k, label: t(PERIOD[k]) }))} /></div>
        {regions.length > 0 && <div className="w-48"><OptionSelect value={regionId} onChange={setRegionId} allowNone noneLabel={t("All regions")} options={regions.filter((r) => !r.parentId).map((r) => ({ value: r.id, label: r.name }))} /></div>}
        {committees.length > 0 && <div className="w-48"><OptionSelect value={committeeId} onChange={setCommitteeId} allowNone noneLabel={t("All committees")} options={committees.map((c) => ({ value: c.id, label: c.name }))} /></div>}
      </div>
      <Section bodyClassName="p-0">
        {q.isLoading ? <div className="p-4"><LoadingRows /></div> : (q.data?.leaderboard ?? []).length === 0 ? <EmptyState icon={Trophy} title={t("No one here yet")} /> : (
          <ol className="divide-y divide-border">
            {q.data!.leaderboard.map((r) => (
              <li key={r.membershipId} className={cn("flex items-center gap-4 px-4 py-3", r.membershipId === me.membershipId && "bg-gold-soft/50")}>
                <span className={cn("w-7 text-center text-sm font-semibold tabular", medal[r.rank - 1] ?? "text-muted-foreground")}>{r.rank <= 3 ? <Trophy className="mx-auto size-4" /> : r.rank}</span>
                <PersonAvatar name={r.fullName} url={r.avatarUrl} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.fullName}{r.membershipId === me.membershipId && <span className="ms-2 text-xs text-gold">({t("you")})</span>}</span>
                  {r.title && <span className="block truncate text-xs text-muted-foreground">{r.title}</span>}
                </span>
                {r.badges > 0 && <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex"><Award className="size-3.5" />{r.badges}</span>}
                <span className="w-20 text-end text-sm font-semibold tabular">{formatNumber(r.points, lang)} <span className="text-xs font-normal text-muted-foreground">{t("pts")}</span></span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

function Badges() {
  const { t } = useI18n();
  const { can } = useOrg();
  const q = useOrgQuery<{ achievements: any[] }>("/performance/achievements");
  const [editing, setEditing] = useState<any | null>(null);
  const [awarding, setAwarding] = useState<any | null>(null);
  const canManage = can("performance.manage");
  const list = (q.data?.achievements ?? []).filter((a) => canManage || !a.archivedAt);
  return (
    <div className="space-y-4">
      {canManage && <div className="flex justify-end"><Button onClick={() => setEditing({})}><Plus />{t("New badge")}</Button></div>}
      {q.isLoading ? <LoadingRows rows={3} /> : list.length === 0 ? (
        <Section><EmptyState icon={Award} title={t("No badges yet")} description={canManage ? t("Create badges to recognise milestones — automatically at a points or task threshold, or awarded by hand.") : undefined} /></Section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => (
            <div key={a.id} className={cn("flex gap-4 rounded-xl border border-border bg-card p-4", a.archivedAt && "opacity-60")}>
              <Badge badge={a} size={48} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{a.name}</p>
                {a.description && <p className="text-sm text-muted-foreground">{a.description}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  {a.autoRule ? t(a.autoRule.type === "points" ? "Automatic at {n} points" : "Automatic after {n} approved tasks", { n: a.autoRule.threshold }) : t("Awarded by managers")}
                  {" · "}{t("{n} holders", { n: a.holders })}
                </p>
                {canManage && (
                  <div className="mt-2 flex gap-2">
                    {!a.archivedAt && <Button size="sm" variant="outline" onClick={() => setAwarding(a)}>{t("Award")}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>{t("Edit")}</Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <BadgeDialog badge={editing} onClose={() => setEditing(null)} />
      <AwardBadgeDialog badge={awarding} onClose={() => setAwarding(null)} />
    </div>
  );
}

function BadgeDialog({ badge, onClose }: { badge: any | null; onClose: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState<any>({});
  useEffect(() => {
    if (badge) setF({ name: badge.name ?? "", description: badge.description ?? "", icon: badge.icon ?? "award", color: badge.color ?? "#c9a84c", auto: badge.autoRule?.type ?? "manual", threshold: badge.autoRule?.threshold ?? 100, archived: !!badge.archivedAt });
  }, [badge]);
  const save = useOrgMutation((body: any, base) => (badge?.id ? api.patch(`${base}/performance/achievements/${badge.id}`, body) : api.post(`${base}/performance/achievements`, body)), { success: "Badge saved", onSuccess: onClose });
  const submit = () => save.mutate({
    name: f.name.trim(), description: f.description.trim() || null, icon: f.icon, color: f.color,
    autoRule: f.auto === "manual" ? null : { type: f.auto, threshold: Number(f.threshold) }, ...(badge?.id ? { archived: f.archived } : {}),
  });
  return (
    <FormDialog open={!!badge} onOpenChange={(o) => !o && onClose()} title={badge?.id ? t("Edit badge") : t("New badge")} submitLabel={t("Save")} onSubmit={submit} busy={save.isPending} disabled={!f.name || f.name.trim().length < 2}>
      <Field label={t("Name")} htmlFor="b-name" required><Input id="b-name" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} autoFocus /></Field>
      <Field label={t("Description")} htmlFor="b-desc"><Input id="b-desc" value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} /></Field>
      <Field label={t("Icon")}>
        <div className="flex flex-wrap gap-2">
          {Object.entries(BADGE_ICONS).map(([k, I]) => (
            <button key={k} type="button" aria-label={k} aria-pressed={f.icon === k} onClick={() => setF({ ...f, icon: k })} className="grid size-9 place-items-center rounded-lg border border-border aria-pressed:border-primary aria-pressed:bg-primary/10"><I className="size-4" /></button>
          ))}
          <input type="color" aria-label={t("Colour")} value={f.color ?? "#c9a84c"} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-transparent" />
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("How it's earned")}>
          <OptionSelect value={f.auto} onChange={(v) => setF({ ...f, auto: v ?? "manual" })} options={[{ value: "manual", label: t("Awarded by managers") }, { value: "points", label: t("Automatically at a points total") }, { value: "tasks", label: t("Automatically after approved tasks") }]} />
        </Field>
        {f.auto !== "manual" && <Field label={t("Threshold")} htmlFor="b-th"><Input id="b-th" type="number" min={1} value={f.threshold ?? 100} onChange={(e) => setF({ ...f, threshold: e.target.value })} /></Field>}
      </div>
      {badge?.id && <label className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">{t("Archived")}<Switch checked={!!f.archived} onCheckedChange={(v) => setF({ ...f, archived: v })} /></label>}
    </FormDialog>
  );
}

function AwardBadgeDialog({ badge, onClose }: { badge: any | null; onClose: () => void }) {
  const { t } = useI18n();
  const { me } = useOrg();
  const [who, setWho] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const save = useOrgMutation((v: any, base) => api.post(`${base}/performance/achievements/${badge.id}/award`, v), { success: "Badge awarded", onSuccess: () => { setWho(null); setReason(""); onClose(); } });
  return (
    <FormDialog open={!!badge} onOpenChange={(o) => !o && onClose()} title={t("Award “{name}”", { name: badge?.name ?? "" })} submitLabel={t("Award")} onSubmit={() => save.mutate({ membershipId: who, reason: reason.trim() })} busy={save.isPending} disabled={!who || reason.trim().length < 3}>
      <Field label={t("Member")} required><PersonPicker value={who} onChange={setWho} exclude={[me.membershipId]} /></Field>
      <Field label={t("Reason")} htmlFor="ab-reason" required><Textarea id="ab-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
    </FormDialog>
  );
}

function AwardDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { me } = useOrg();
  const rules = useOrgQuery<{ rules: any[] }>("/performance/rules", { enabled: open });
  const [who, setWho] = useState<number | null>(null);
  const [mode, setMode] = useState("project_contribution");
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const manualRules = (rules.data?.rules ?? []).filter((r) => !r.auto && r.enabled);
  const save = useOrgMutation((body: any, base) => api.post(`${base}/performance/adjustments`, body), {
    success: "Points recorded", onSuccess: () => { onOpenChange(false); setWho(null); setPoints(""); setReason(""); setEvidenceUrl(""); },
  });
  const isManual = mode === "manual";
  const submit = () => save.mutate({
    membershipId: who, reason: reason.trim(), evidenceUrl: evidenceUrl.trim() || null,
    ...(isManual ? { points: Number(points) } : { ruleKey: mode }),
  });
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("Award points")} description={t("Every award and adjustment is recorded with your name and reason, and the member can see it.")}
      submitLabel={t("Record")} onSubmit={submit} busy={save.isPending} disabled={!who || reason.trim().length < 3 || (isManual && (!Number(points) || Math.abs(Number(points)) > 1000))}>
      <Field label={t("Member")} required><PersonPicker value={who} onChange={setWho} exclude={[me.membershipId]} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("For")}>
          <OptionSelect value={mode} onChange={(v) => setMode(v ?? "manual")} options={[
            ...manualRules.map((r) => ({ value: r.key, label: `${t(POINT_RULE[r.key]?.label ?? r.key)} (${signed(r.points)})` })),
            { value: "manual", label: t("Manual adjustment") },
          ]} />
        </Field>
        {isManual && <Field label={t("Points")} htmlFor="aw-pts" hint={t("Use a negative number for a deduction.")}><Input id="aw-pts" type="number" min={-1000} max={1000} value={points} onChange={(e) => setPoints(e.target.value)} /></Field>}
      </div>
      <Field label={t("Reason")} htmlFor="aw-reason" required><Textarea id="aw-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></Field>
      <Field label={t("Evidence link")} htmlFor="aw-ev"><Input id="aw-ev" type="url" dir="ltr" placeholder="https://" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} /></Field>
    </FormDialog>
  );
}

function Reviews() {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState("active");
  const q = useOrgQuery<{ cases: any[] }>(`/performance/reviews?status=${status}`);
  const [deciding, setDeciding] = useState<any | null>(null);
  const [opening, setOpening] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-44"><OptionSelect value={status} onChange={(v) => setStatus(v ?? "active")} options={[{ value: "active", label: t("Open cases") }, { value: "resolved", label: t("Resolved") }, { value: "all", label: t("All cases") }]} /></div>
        <Button variant="outline" onClick={() => setOpening(true)}><Plus />{t("Open a case")}</Button>
      </div>
      <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground"><Scale className="mt-0.5 size-4 shrink-0" />{t("Cases open automatically after long inactivity or a low score. Nothing happens to anyone's membership until a person records a decision here, following your bylaws.")}</p>
      <Section bodyClassName="p-0">
        {q.isLoading ? <div className="p-4"><LoadingRows rows={3} /></div> : (q.data?.cases ?? []).length === 0 ? <EmptyState icon={Scale} title={t("No review cases")} /> : (
          <ul className="divide-y divide-border">
            {q.data!.cases.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <PersonAvatar name={c.fullName} url={c.avatarUrl} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{c.fullName} <span className="font-normal text-muted-foreground">· {formatNumber(c.points, lang)} {t("pts")} · {t(MEMBERSHIP_STATUS[c.membershipStatus])}</span></p>
                  <p className="text-sm">{c.detail}</p>
                  {c.memberResponse && <p className="mt-1 flex gap-1.5 rounded bg-muted px-2 py-1 text-xs"><MessageSquareText className="size-3.5 shrink-0" />{c.memberResponse}</p>}
                  {c.decision && <p className="mt-1 text-xs text-muted-foreground">{t(REVIEW_DECISION[c.decision])}: {c.decisionNote}</p>}
                  <p className="mt-0.5 text-xs text-muted-foreground">{t(REVIEW_TRIGGER[c.trigger] ?? c.trigger)} · {relativeTime(c.createdAt, lang)}</p>
                </div>
                <Pill tone={c.status === "resolved" ? "green" : c.status === "responded" ? "violet" : "amber"}>{t(REVIEW_STATUS[c.status])}</Pill>
                {c.status !== "resolved" && <Button size="sm" onClick={() => setDeciding(c)}>{t("Decide")}</Button>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <DecideDialog rc={deciding} onClose={() => setDeciding(null)} />
      <OpenCaseDialog open={opening} onOpenChange={setOpening} />
    </div>
  );
}

function DecideDialog({ rc, onClose }: { rc: any | null; onClose: () => void }) {
  const { t } = useI18n();
  const [decision, setDecision] = useState("no_action");
  const [note, setNote] = useState("");
  const [newStatus, setNewStatus] = useState<string | null>(null);
  const save = useOrgMutation((v: any, base) => api.post(`${base}/performance/reviews/${rc.id}/decide`, v), { success: "Decision recorded", onSuccess: () => { setNote(""); setDecision("no_action"); onClose(); } });
  return (
    <FormDialog open={!!rc} onOpenChange={(o) => !o && onClose()} title={t("Decide review for {name}", { name: rc?.fullName ?? "" })}
      description={rc && !rc.memberResponse ? t("The member hasn't responded yet. Consider giving them time to explain first.") : undefined}
      submitLabel={t("Record decision")} busy={save.isPending} disabled={note.trim().length < 3 || (decision === "status_change" && !newStatus)}
      onSubmit={() => save.mutate({ decision, note: note.trim(), ...(decision === "status_change" ? { newStatus } : {}) })}>
      <Field label={t("Decision")}><OptionSelect value={decision} onChange={(v) => setDecision(v ?? "no_action")} options={Object.keys(REVIEW_DECISION).map((k) => ({ value: k, label: t(REVIEW_DECISION[k]) }))} /></Field>
      {decision === "status_change" && <Field label={t("New membership status")} required><OptionSelect value={newStatus} onChange={setNewStatus} options={Object.keys(MEMBERSHIP_STATUS).map((k) => ({ value: k, label: t(MEMBERSHIP_STATUS[k]) }))} /></Field>}
      <Field label={t("Decision note")} htmlFor="d-note" required hint={t("Shared with the member and kept in the audit log.")}><Textarea id="d-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={3000} /></Field>
    </FormDialog>
  );
}

function OpenCaseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { me } = useOrg();
  const [who, setWho] = useState<number | null>(null);
  const [detail, setDetail] = useState("");
  const save = useOrgMutation((v: any, base) => api.post(`${base}/performance/reviews`, v), { success: "Review case opened", onSuccess: () => { setWho(null); setDetail(""); onOpenChange(false); } });
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("Open a review case")} submitLabel={t("Open case")} busy={save.isPending} disabled={!who || detail.trim().length < 3}
      onSubmit={() => save.mutate({ membershipId: who, detail: detail.trim() })}>
      <Field label={t("Member")} required><PersonPicker value={who} onChange={setWho} exclude={[me.membershipId]} /></Field>
      <Field label={t("Why")} htmlFor="oc-detail" required hint={t("The member will see this and can respond.")}><Textarea id="oc-detail" rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={2000} /></Field>
    </FormDialog>
  );
}

function Rules() {
  const { t } = useI18n();
  const q = useOrgQuery<{ rules: any[]; settings: any }>("/performance/rules");
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (q.data) setF({ ...q.data.settings, rules: q.data.rules.map((r) => ({ ...r })) }); }, [q.data]);
  const save = useOrgMutation((body: any, base) => api.patch(`${base}/performance/rules`, body), { success: "Rules saved" });
  if (!f) return <LoadingRows rows={4} />;
  const setRule = (key: string, patch: any) => setF({ ...f, rules: f.rules.map((r: any) => (r.key === key ? { ...r, ...patch } : r)) });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title={t("Point values")}>
        <ul className="space-y-3">
          {f.rules.map((r: any) => (
            <li key={r.key} className="flex items-center gap-3 rounded-lg border border-border p-3">
              <Switch checked={r.enabled} onCheckedChange={(v) => setRule(r.key, { enabled: v })} aria-label={t(POINT_RULE[r.key]?.label ?? r.key)} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{t(POINT_RULE[r.key]?.label ?? r.key)}</span>
                <span className="block text-xs text-muted-foreground">{t(POINT_RULE[r.key]?.description ?? "")}</span>
              </span>
              <Input type="number" className="w-20 text-end" value={r.points} min={-1000} max={1000} onChange={(e) => setRule(r.key, { points: Number(e.target.value) })} disabled={!r.enabled} />
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("Review safeguards")}>
        <div className="space-y-4">
          <label className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">{t("Points and review triggers enabled")}<Switch checked={f.enabled} onCheckedChange={(v) => setF({ ...f, enabled: v })} /></label>
          <Field label={t("Open a review after this many days without activity")} htmlFor="r-in"><Input id="r-in" type="number" min={14} max={730} value={f.inactivityDays} onChange={(e) => setF({ ...f, inactivityDays: Number(e.target.value) })} /></Field>
          <Field label={t("Open a review when a score falls to")} htmlFor="r-th"><Input id="r-th" type="number" max={0} value={f.reviewThreshold} onChange={(e) => setF({ ...f, reviewThreshold: Number(e.target.value) })} /></Field>
          <Field label={t("Grace days before a missed deadline counts")} htmlFor="r-gr"><Input id="r-gr" type="number" min={0} max={60} value={f.missedDeadlineGraceDays} onChange={(e) => setF({ ...f, missedDeadlineGraceDays: Number(e.target.value) })} /></Field>
          <p className="text-xs text-muted-foreground">{t("These only open a review case and notify the member. Any change to membership is recorded by a person.")}</p>
          <Button disabled={save.isPending} onClick={() => save.mutate({
            enabled: f.enabled, inactivityDays: f.inactivityDays, reviewThreshold: f.reviewThreshold, missedDeadlineGraceDays: f.missedDeadlineGraceDays,
            rules: f.rules.map((r: any) => ({ key: r.key, points: r.points, enabled: r.enabled })),
          })}>{t("Save rules")}</Button>
        </div>
      </Section>
    </div>
  );
}
