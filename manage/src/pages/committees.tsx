import { useState } from "react";
import { Link } from "wouter";
import { FolderKanban, Plus, Users, UsersRound } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { COMMITTEE_KIND } from "@/lib/labels";
import { useCommittees, useOrg, useOrgMutation } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AvatarStack, EmptyState, Field, LoadingRows, PageHeader, Pill, Section } from "@/components/primitives";
import { OptionSelect } from "@/components/pickers";
import { FormDialog } from "@/components/forms";

export const COMMITTEE_COLORS = ["#2563eb", "#16a34a", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#b45309", "#475569"];

export default function CommitteesPage() {
  const { t } = useI18n();
  const { path, can } = useOrg();
  const { committees, isLoading } = useCommittees();
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const list = committees.filter((c) => showArchived || !c.archivedAt);
  const groups = (["governance", "committee", "working_group"] as const).map((k) => ({ kind: k, items: list.filter((c) => c.kind === k) })).filter((g) => g.items.length);

  return (
    <>
      <PageHeader
        title={t("Committees")}
        description={t("Governance bodies, thematic committees and working groups.")}
        actions={
          <>
            {committees.some((c) => c.archivedAt) && <Button variant="ghost" onClick={() => setShowArchived((s) => !s)}>{showArchived ? t("Hide archived") : t("Show archived")}</Button>}
            {can("committees.manage") && <Button onClick={() => setCreating(true)}><Plus />{t("New committee")}</Button>}
          </>
        }
      />
      {isLoading ? <LoadingRows /> : groups.length === 0 ? (
        <Section><EmptyState icon={UsersRound} title={t("No committees yet")} description={t("Committees let you organise members and give heads responsibility for their own projects.")}
          action={can("committees.manage") && <Button onClick={() => setCreating(true)}><Plus />{t("New committee")}</Button>} /></Section>
      ) : groups.map((g) => (
        <div key={g.kind} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t(COMMITTEE_KIND[g.kind])}</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {g.items.map((c) => (
              <Link key={c.id} href={path(`/committees/${c.id}`)} className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40">
                <span className="absolute inset-y-0 start-0 w-1" style={{ background: c.color ?? "var(--st-blue)" }} />
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold group-hover:text-primary">{c.name}</h3>
                  <div className="flex gap-1">{c.isMine && <Pill tone="gold">{t("Yours")}</Pill>}{c.archivedAt && <Pill>{t("Archived")}</Pill>}</div>
                </div>
                {c.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{c.description}</p>}
                <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><Users className="size-4" />{c.memberCount}</span>
                  <span className="inline-flex items-center gap-1.5"><FolderKanban className="size-4" />{c.activeProjectCount}</span>
                  {c.heads.length > 0 && <span className="ms-auto flex items-center gap-2"><span className="text-xs">{t("Head")}</span><AvatarStack people={c.heads} max={3} size={24} /></span>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
      <CommitteeDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

export function CommitteeDialog({ open, onOpenChange, committee }: { open: boolean; onOpenChange: (o: boolean) => void; committee?: any }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("committee");
  const [color, setColor] = useState(COMMITTEE_COLORS[0]);
  const [initFor, setInitFor] = useState<unknown>(null);
  if (open && initFor !== (committee ?? "new")) {
    setInitFor(committee ?? "new");
    setName(committee?.name ?? ""); setDescription(committee?.description ?? ""); setKind(committee?.kind ?? "committee"); setColor(committee?.color ?? COMMITTEE_COLORS[0]);
  }
  if (!open && initFor !== null) setInitFor(null);
  const save = useOrgMutation((body: any, base) => (committee ? api.patch(`${base}/committees/${committee.id}`, body) : api.post(`${base}/committees`, body)), {
    success: committee ? "Committee updated" : "Committee created", onSuccess: () => onOpenChange(false),
  });
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={committee ? t("Edit committee") : t("New committee")} submitLabel={committee ? t("Save changes") : t("Create committee")}
      busy={save.isPending} disabled={name.trim().length < 2} onSubmit={() => save.mutate({ name: name.trim(), description: description.trim() || null, kind, color })}>
      <Field label={t("Name")} htmlFor="c-name" required><Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus /></Field>
      <Field label={t("Type")}><OptionSelect value={kind} onChange={(v) => setKind(v ?? "committee")} options={Object.keys(COMMITTEE_KIND).map((k) => ({ value: k, label: t(COMMITTEE_KIND[k]) }))} /></Field>
      <Field label={t("Description")} htmlFor="c-desc"><Textarea id="c-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></Field>
      <Field label={t("Colour")}>
        <div className="flex flex-wrap gap-2">
          {COMMITTEE_COLORS.map((c) => (
            <button key={c} type="button" aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)}
              className="size-7 rounded-full ring-offset-2 ring-offset-card aria-pressed:ring-2 aria-pressed:ring-foreground" style={{ background: c }} />
          ))}
        </div>
      </Field>
    </FormDialog>
  );
}
