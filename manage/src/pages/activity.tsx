import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Activity, Download, Loader2, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { downloadFile, formatDateTime, toCsv } from "@/lib/format";
import { AUDIT_ACTION } from "@/lib/labels";
import { useOrg } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingRows, PageHeader, PersonAvatar, Section } from "@/components/primitives";
import { OptionSelect } from "@/components/pickers";

const ENTITY_TYPES: Record<string, string> = {
  task: "Tasks", project: "Projects", event: "Events", membership: "Memberships", invitation: "Invitations",
  committee: "Committees", region: "Regions", role: "Roles", organisation: "Organisation",
};

export default function ActivityPage() {
  const { t, lang } = useI18n();
  const { slug, org } = useOrg();
  const [entityType, setEntityType] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: ["org", slug, "/activity", entityType],
    queryFn: ({ pageParam }) => api.get<{ events: any[]; full: boolean }>(`/api/org/${slug}/activity?limit=50${pageParam ? `&before=${pageParam}` : ""}${entityType ? `&entityType=${entityType}` : ""}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.events.length === 50 ? last.events.at(-1)!.id : undefined),
  });
  const events = q.data?.pages.flatMap((p) => p.events) ?? [];
  const full = q.data?.pages[0]?.full;

  const exportCsv = () => downloadFile(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(
    events.map((e) => ({ at: e.createdAt, actor: e.actorName ?? "", action: e.action, entity: `${e.entityType}#${e.entityId ?? ""}`, summary: e.summary ?? "", reason: e.reason ?? "", before: JSON.stringify(e.before ?? ""), after: JSON.stringify(e.after ?? "") })),
    [{ key: "at", label: "timestamp" }, { key: "actor", label: "actor" }, { key: "action", label: "action" }, { key: "entity", label: "entity" }, { key: "summary", label: "summary" }, { key: "reason", label: "reason" }, { key: "before", label: "before" }, { key: "after", label: "after" }],
  ));

  return (
    <>
      <PageHeader
        title={t("Activity")}
        description={full ? t("The organisation's audit log: who changed what, when and why. Entries can't be edited or deleted.") : t("Your own actions in this organisation.")}
        actions={
          <>
            <div className="w-44"><OptionSelect value={entityType} onChange={setEntityType} allowNone noneLabel={t("Everything")} options={Object.keys(ENTITY_TYPES).map((k) => ({ value: k, label: t(ENTITY_TYPES[k]) }))} /></div>
            {full && <Button variant="outline" onClick={exportCsv} disabled={!events.length}><Download />{t("Export CSV")}</Button>}
          </>
        }
      />
      {full && <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-st-green" />{t("Append-only record")}</p>}
      {q.isLoading ? <LoadingRows rows={8} /> : q.error ? <ErrorState onRetry={() => q.refetch()} /> : events.length === 0 ? (
        <Section><EmptyState icon={Activity} title={t("No activity yet")} /></Section>
      ) : (
        <Section bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3 px-4 py-3">
                <PersonAvatar name={e.actorName} url={e.actorAvatar} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm"><span className="font-medium">{e.actorName ?? t("System")}</span> <span className="text-muted-foreground">{t(AUDIT_ACTION[e.action] ?? e.action)}</span>{e.summary && <> · {e.summary}</>}</p>
                  {e.reason && <p className="mt-1 rounded bg-muted px-2 py-1 text-xs">“{e.reason}”</p>}
                  {e.after && Object.keys(e.after).length > 0 && e.before && (
                    <p className="mt-1 truncate text-xs text-muted-foreground" dir="ltr">
                      {Object.keys(e.after).slice(0, 3).map((k) => `${k}: ${String(e.before?.[k] ?? "—")} → ${String(e.after[k] ?? "—")}`).join(" · ")}
                    </p>
                  )}
                </div>
                <time className="shrink-0 text-xs text-muted-foreground" dateTime={e.createdAt}>{formatDateTime(e.createdAt, lang, org.timezone)}</time>
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <div className="border-t border-border p-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage && <Loader2 className="animate-spin" />}{t("Load more")}</Button>
            </div>
          )}
        </Section>
      )}
    </>
  );
}
