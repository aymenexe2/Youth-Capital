import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Copy, Eye, EyeOff, FileText, Globe, HeartHandshake, Link2, Mail, Megaphone, Paperclip, Pencil, Plus, Share2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { api, errorMessage, MAX_UPLOAD_BYTES } from "@/lib/api";
import { formatDate, formatMoney, relativeTime } from "@/lib/format";
import { UPDATE_VISIBILITY } from "@/lib/labels";
import { useOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, ErrorState, Field, LoadingRows, PageHeader, Pill, Section, StatusPill } from "@/components/primitives";
import { OptionSelect } from "@/components/pickers";
import { FormDialog } from "@/components/forms";

function SponsorLogo({ s, size = 44 }: { s: { name: string; logoUrl?: string | null }; size?: number }) {
  return s.logoUrl
    ? <img src={s.logoUrl} alt="" className="shrink-0 rounded-lg border border-border bg-white object-contain p-1" style={{ width: size, height: size }} referrerPolicy="no-referrer" />
    : <span className="grid shrink-0 place-items-center rounded-lg bg-navy font-semibold text-gold" style={{ width: size, height: size, fontSize: size * 0.32 }}>{s.name.slice(0, 2).toUpperCase()}</span>;
}

export default function SponsorsPage() {
  const { t, lang } = useI18n();
  const { org, path } = useOrg();
  const q = useOrgQuery<{ sponsors: any[]; canManage: boolean }>("/sponsors");
  const [editing, setEditing] = useState<any | null>(null);
  if (q.error) return <ErrorState message={t("You don't have access to sponsors.")} />;
  return (
    <>
      <PageHeader
        title={t("Sponsors")}
        description={t("Partners, the projects they fund, and exactly what each one can see in their portal.")}
        actions={q.data?.canManage && <Button onClick={() => setEditing({})}><Plus />{t("New sponsor")}</Button>}
      />
      {q.isLoading ? <LoadingRows /> : (q.data?.sponsors ?? []).length === 0 ? (
        <Section><EmptyState icon={HeartHandshake} title={t("No sponsors yet")} description={t("Add a sponsor, link the projects they fund, then give their contact portal access.")} /></Section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {q.data!.sponsors.map((s) => (
            <Link key={s.id} href={path(`/sponsors/${s.id}`)} className="rounded-2xl border bg-card p-5 transition-colors hover:border-primary/40">
              <div className="flex items-center gap-3">
                <SponsorLogo s={s} />
                <div className="min-w-0 flex-1"><p className="truncate font-semibold">{s.name}</p><p className="truncate text-xs text-muted-foreground">{s.contactName ?? s.website ?? ""}</p></div>
                {s.status !== "active" && <Pill>{t("Inactive")}</Pill>}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                <div><p className="font-semibold tabular">{s.projectCount}</p><p className="text-xs text-muted-foreground">{t("Projects")}</p></div>
                <div><p className="font-semibold tabular">{formatMoney(s.committed, org.currency, lang)}</p><p className="text-xs text-muted-foreground">{t("Committed")}</p></div>
                <div><p className="font-semibold tabular">{s.portalUsers}</p><p className="text-xs text-muted-foreground">{t("Portal users")}</p></div>
              </div>
            </Link>
          ))}
        </div>
      )}
      <SponsorDialog sponsor={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function SponsorDialog({ sponsor, onClose }: { sponsor: any | null; onClose: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState<any>({});
  useEffect(() => {
    if (sponsor) setF({ name: sponsor.name ?? "", logoUrl: sponsor.logoUrl ?? "", website: sponsor.website ?? "", contactName: sponsor.contactName ?? "", contactEmail: sponsor.contactEmail ?? "", description: sponsor.description ?? "", status: sponsor.status ?? "active" });
  }, [sponsor]);
  const save = useOrgMutation((body: any, base) => (sponsor?.id ? api.patch(`${base}/sponsors/${sponsor.id}`, body) : api.post(`${base}/sponsors`, body)), { success: "Sponsor saved", onSuccess: onClose });
  return (
    <FormDialog open={!!sponsor} onOpenChange={(o) => !o && onClose()} title={sponsor?.id ? t("Edit sponsor") : t("New sponsor")} submitLabel={t("Save")} busy={save.isPending} disabled={!f.name || f.name.trim().length < 2}
      onSubmit={() => save.mutate({ ...f, name: f.name.trim(), logoUrl: f.logoUrl.trim() || null, website: f.website.trim() || null, contactName: f.contactName.trim() || null, contactEmail: f.contactEmail.trim() || null, description: f.description.trim() || null })}>
      <Field label={t("Name")} htmlFor="sp-name" required><Input id="sp-name" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={160} autoFocus /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Logo URL")} htmlFor="sp-logo"><Input id="sp-logo" type="url" dir="ltr" value={f.logoUrl ?? ""} onChange={(e) => setF({ ...f, logoUrl: e.target.value })} placeholder="https://" /></Field>
        <Field label={t("Website")} htmlFor="sp-web"><Input id="sp-web" type="url" dir="ltr" value={f.website ?? ""} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://" /></Field>
        <Field label={t("Contact name")} htmlFor="sp-cn"><Input id="sp-cn" value={f.contactName ?? ""} onChange={(e) => setF({ ...f, contactName: e.target.value })} maxLength={120} /></Field>
        <Field label={t("Contact email")} htmlFor="sp-ce"><Input id="sp-ce" type="email" dir="ltr" value={f.contactEmail ?? ""} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></Field>
      </div>
      <Field label={t("Description")} htmlFor="sp-desc"><Textarea id="sp-desc" rows={2} value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} /></Field>
      {sponsor?.id && <Field label={t("Status")}><OptionSelect value={f.status} onChange={(v) => setF({ ...f, status: v ?? "active" })} options={[{ value: "active", label: t("Active") }, { value: "inactive", label: t("Inactive") }]} /></Field>}
    </FormDialog>
  );
}

export function SponsorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const { org, path, can } = useOrg();
  const q = useOrgQuery<any>(`/sponsors/${id}`);
  const projects = useOrgQuery<{ projects: any[] }>("/projects");
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [composing, setComposing] = useState<any | null>(null);
  const unlink = useOrgMutation((projectId: number, base) => api.del(`${base}/sponsors/${id}/projects/${projectId}`), { success: "Project unlinked" });
  const unshare = useOrgMutation((shareId: number, base) => api.del(`${base}/sponsor-shares/${shareId}`), { success: "No longer shared" });
  const canManage = can("sponsors.manage");
  const canPublish = can("sponsor.publish_update");
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.error || !q.data) return <ErrorState message={t("This sponsor isn't available.")} />;
  const { sponsor: s, projects: funded, contacts, shares, contributions } = q.data;
  const money = (v: any) => formatMoney(v, org.currency, lang);

  return (
    <>
      <Link href={path("/sponsors")} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Sponsors")}</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <SponsorLogo s={s} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{s.name}</h1>
          <div className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
            {s.contactName && <span>{s.contactName}</span>}
            {s.contactEmail && <a href={`mailto:${s.contactEmail}`} className="inline-flex items-center gap-1 text-primary hover:underline" dir="ltr"><Mail className="size-3.5" />{s.contactEmail}</a>}
            {s.website && <a href={s.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><Globe className="size-3.5" />{t("Website")}</a>}
          </div>
        </div>
        {canManage && <Button variant="outline" onClick={() => setEditing(true)}><Pencil />{t("Edit")}</Button>}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title={t("Funded projects")} bodyClassName="p-0" action={canManage && <Button size="sm" variant="ghost" onClick={() => setLinking(true)}><Plus />{t("Link project")}</Button>}>
            {funded.length === 0 ? <EmptyState title={t("No funded projects linked")} description={t("The portal only shows projects linked here.")} /> : (
              <ul className="divide-y divide-border">
                {funded.map((p: any) => (
                  <li key={p.projectId} className="flex items-center gap-3 px-4 py-3">
                    <Link href={path(`/projects/${p.projectId}`)} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">{p.title}</Link>
                    <StatusPill kind="project" status={p.status} />
                    <span className="w-32 text-end text-sm font-semibold tabular">{money(p.committedAmount)}</span>
                    {canManage && <button aria-label={t("Unlink")} onClick={() => unlink.mutate(p.projectId)} className="text-muted-foreground hover:text-destructive"><X className="size-4" /></button>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Updates sponsorId={s.id} fundedProjectIds={funded.map((p: any) => p.projectId)} canPublish={canPublish} onCompose={(u) => setComposing(u)} />
          <Section title={t("Shared with this sponsor")} icon={Share2} bodyClassName="p-0" action={canPublish && funded.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSharing(true)}><Plus />{t("Share a record")}</Button>}>
            {shares.length === 0 ? <EmptyState icon={EyeOff} title={t("Nothing internal is shared")} description={t("Expenditure evidence and documents stay internal until you share them here. Each share is logged.")} /> : (
              <ul className="divide-y divide-border">
                {shares.map((sh: any) => (
                  <li key={sh.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    {sh.entityType === "file" ? <Paperclip className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}
                    <span className="min-w-0 flex-1"><span className="block truncate">{sh.label}</span><span className="block text-xs text-muted-foreground">{t("Shared by {name}", { name: sh.sharedBy ?? "—" })} · {relativeTime(sh.createdAt, lang)}</span></span>
                    {canPublish && <button aria-label={t("Stop sharing")} onClick={() => unshare.mutate(sh.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div className="space-y-6">
          <Section title={t("Portal access")} icon={Eye} action={canManage && <Button size="sm" variant="ghost" onClick={() => setInviting(true)}><Plus />{t("Invite")}</Button>}>
            {contacts.length === 0 ? <p className="text-sm text-muted-foreground">{t("No one from this sponsor has portal access yet.")}</p> : (
              <ul className="space-y-2">{contacts.map((c: any) => <li key={c.membershipId} className="text-sm"><span className="block font-medium">{c.fullName}</span><span className="block text-xs text-muted-foreground" dir="ltr">{c.email}</span></li>)}</ul>
            )}
          </Section>
          {contributions && (
            <Section title={t("Contributions")}>
              {contributions.length === 0 ? <p className="text-sm text-muted-foreground">{t("No income recorded from this sponsor.")}</p> : (
                <ul className="space-y-2 text-sm">
                  {contributions.map((c: any) => (
                    <li key={c.id} className="flex justify-between gap-2"><span className="truncate">{formatDate(c.date, lang, org.timezone)} · {c.description}</span><span className={c.direction === "in" ? "font-medium text-st-green tabular" : "font-medium text-st-red tabular"}>{c.direction === "in" ? "+" : "−"}{money(c.amount)}</span></li>
                  ))}
                </ul>
              )}
            </Section>
          )}
        </div>
      </div>

      <SponsorDialog sponsor={editing ? s : null} onClose={() => setEditing(false)} />
      <LinkProjectDialog open={linking} onOpenChange={setLinking} sponsorId={s.id} projects={(projects.data?.projects ?? []).filter((p) => !funded.some((f: any) => f.projectId === p.id))} />
      <InviteContactDialog open={inviting} onOpenChange={setInviting} sponsorId={s.id} />
      <ShareDialog open={sharing} onOpenChange={setSharing} sponsorId={s.id} fundedProjects={funded} />
      <UpdateDialog update={composing} onClose={() => setComposing(null)} projects={funded.map((p: any) => ({ id: p.projectId, title: p.title }))} sponsorId={s.id} />
    </>
  );
}

function Updates({ sponsorId, fundedProjectIds, canPublish, onCompose }: { sponsorId: number; fundedProjectIds: number[]; canPublish: boolean; onCompose: (u: any) => void }) {
  const { t, lang } = useI18n();
  const q = useOrgQuery<{ updates: any[] }>("/sponsor-updates");
  const publish = useOrgMutation((v: { id: number; publish: boolean }, base) => api.post(`${base}/sponsor-updates/${v.id}/publish`, { publish: v.publish }), { success: "Saved" });
  const list = (q.data?.updates ?? []).filter((u) => (u.visibility === "named" ? u.sponsorIds.includes(sponsorId) : fundedProjectIds.includes(u.projectId)));
  return (
    <Section title={t("Updates visible to this sponsor")} icon={Megaphone} bodyClassName="p-0" action={canPublish && fundedProjectIds.length > 0 && <Button size="sm" variant="ghost" onClick={() => onCompose({})}><Plus />{t("New update")}</Button>}>
      {list.length === 0 ? <EmptyState icon={Megaphone} title={t("No updates yet")} /> : (
        <ul className="divide-y divide-border">
          {list.map((u) => (
            <li key={u.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{u.title}</span>
                <Pill tone={u.status === "published" ? "green" : "neutral"}>{u.status === "published" ? t("Published") : t("Draft")}</Pill>
                <Pill>{t(UPDATE_VISIBILITY[u.visibility])}</Pill>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{u.body}</p>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{u.projectTitle} · {u.publishedAt ? relativeTime(u.publishedAt, lang) : relativeTime(u.createdAt, lang)}</span>
                {canPublish && (
                  <span className="ms-auto flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => onCompose(u)}><Pencil />{t("Edit")}</Button>
                    <Button size="sm" variant={u.status === "published" ? "ghost" : "outline"} onClick={() => publish.mutate({ id: u.id, publish: u.status !== "published" })}>
                      {u.status === "published" ? <><EyeOff />{t("Unpublish")}</> : <><Eye />{t("Publish")}</>}
                    </Button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function UpdateDialog({ update, onClose, projects, sponsorId }: { update: any | null; onClose: () => void; projects: { id: number; title: string }[]; sponsorId: number }) {
  const { t } = useI18n();
  const { slug } = useOrg();
  const qc = useQueryClient();
  const [f, setF] = useState<any>({});
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    if (update) setF({ projectId: update.projectId ?? projects[0]?.id ?? null, title: update.title ?? "", body: update.body ?? "", visibility: update.visibility ?? "project_sponsors", named: (update.sponsorIds ?? []).includes(sponsorId) || update.visibility === "named" });
    setFile(null);
  }, [update]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useOrgMutation(async (body: any, base) => {
    const res: any = update?.id ? await api.patch(`${base}/sponsor-updates/${update.id}`, body) : await api.post(`${base}/sponsor-updates`, body);
    if (file) {
      if (file.size > MAX_UPLOAD_BYTES) throw new Error(t("Files must be 4 MB or smaller."));
      await api.upload(slug, "sponsor_update", res.update.id, file).catch((err) => { toast.error(errorMessage(err)); });
      qc.invalidateQueries({ queryKey: ["org", slug] });
    }
    return res;
  }, { success: "Update saved as draft — publish it when ready", onSuccess: onClose });
  const named = f.visibility === "named";
  return (
    <FormDialog open={!!update} onOpenChange={(o) => !o && onClose()} title={update?.id ? t("Edit update") : t("New sponsor update")} submitLabel={t("Save draft")} busy={save.isPending} wide
      disabled={!f.projectId || (f.title ?? "").trim().length < 2 || (f.body ?? "").trim().length < 3}
      onSubmit={() => save.mutate({
        ...(update?.id ? {} : { projectId: Number(f.projectId) }), title: f.title.trim(), body: f.body.trim(), visibility: f.visibility, sponsorIds: named ? [sponsorId] : [],
      })}>
      {!update?.id && <Field label={t("Project")} required><OptionSelect value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} options={projects.map((p) => ({ value: p.id, label: p.title }))} /></Field>}
      <Field label={t("Title")} htmlFor="up-title" required><Input id="up-title" value={f.title ?? ""} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} autoFocus /></Field>
      <Field label={t("Update")} htmlFor="up-body" required><Textarea id="up-body" rows={6} value={f.body ?? ""} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={10000} /></Field>
      <Field label={t("Who can see it")}>
        <OptionSelect value={f.visibility} onChange={(v) => setF({ ...f, visibility: v ?? "project_sponsors" })} options={Object.keys(UPDATE_VISIBILITY).map((k) => ({ value: k, label: t(UPDATE_VISIBILITY[k]) }))} />
      </Field>
      {named && <p className="text-xs text-muted-foreground">{t("Only this sponsor will see it.")}</p>}
      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted/50">
        <Paperclip className="size-4" /><span className="truncate">{file ? file.name : t("Attach a photo or report (optional, max 4 MB)")}</span>
        <input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.pptx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
    </FormDialog>
  );
}

function LinkProjectDialog({ open, onOpenChange, sponsorId, projects }: { open: boolean; onOpenChange: (o: boolean) => void; sponsorId: number; projects: any[] }) {
  const { t } = useI18n();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const save = useOrgMutation((body: any, base) => api.post(`${base}/sponsors/${sponsorId}/projects`, body), { success: "Project linked", onSuccess: () => { setProjectId(null); setAmount(""); onOpenChange(false); } });
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("Link a funded project")} submitLabel={t("Link")} busy={save.isPending} disabled={!projectId || !/^\d{1,12}([.,]\d{1,2})?$/.test(amount || "0")}
      onSubmit={() => save.mutate({ projectId: Number(projectId), committedAmount: amount || "0" })}>
      <Field label={t("Project")} required><OptionSelect value={projectId} onChange={setProjectId} options={projects.map((p) => ({ value: p.id, label: p.title }))} /></Field>
      <Field label={t("Committed amount")} htmlFor="lp-amt"><Input id="lp-amt" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
    </FormDialog>
  );
}

function InviteContactDialog({ open, onOpenChange, sponsorId }: { open: boolean; onOpenChange: (o: boolean) => void; sponsorId: number }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{ link: string; emailed: boolean } | null>(null);
  const save = useOrgMutation((body: any, base) => api.post<{ link: string; emailed: boolean }>(`${base}/sponsors/${sponsorId}/contacts`, body), { onSuccess: (d) => setResult(d) });
  const close = (o: boolean) => { onOpenChange(o); if (!o) { setEmail(""); setResult(null); } };
  if (result) {
    return (
      <FormDialog open={open} onOpenChange={close} title={t("Portal invitation created")} submitLabel={t("Done")} onSubmit={() => close(false)}>
        <p className="text-sm">{result.emailed ? t("We've emailed the invitation. You can also share this link directly:") : t("Email isn't configured, so share this link with the person directly:")}</p>
        <div className="flex gap-2"><Input readOnly value={result.link} dir="ltr" onFocus={(e) => e.currentTarget.select()} /><Button type="button" variant="outline" onClick={() => { navigator.clipboard.writeText(result.link); toast.success(t("Link copied")); }}><Copy />{t("Copy")}</Button></div>
      </FormDialog>
    );
  }
  return (
    <FormDialog open={open} onOpenChange={close} title={t("Give portal access")} description={t("They'll only see this sponsor's funded projects, published updates and what you explicitly share.")}
      submitLabel={t("Create invitation")} busy={save.isPending} disabled={!/^\S+@\S+\.\S+$/.test(email)} onSubmit={() => save.mutate({ email: email.trim() })}>
      <Field label={t("Email")} htmlFor="ic-email" required><Input id="ic-email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
    </FormDialog>
  );
}

function ShareDialog({ open, onOpenChange, sponsorId, fundedProjects }: { open: boolean; onOpenChange: (o: boolean) => void; sponsorId: number; fundedProjects: any[] }) {
  const { t, lang } = useI18n();
  const { org, can, slug } = useOrg();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ type: string; id: number } | null>(null);
  const txs = useOrgQuery<{ transactions: any[] }>(`/finance/transactions?projectId=${projectId}&status=posted`, { enabled: open && !!projectId && can("finance.view") });
  const save = useOrgMutation((body: any, base) => api.post(`${base}/sponsors/${sponsorId}/shares`, body), { success: "Shared — logged in the activity record", onSuccess: () => { setSelected(null); onOpenChange(false); } });
  const [files, setFiles] = useState<any[]>([]);
  useEffect(() => {
    // Documents attached to the project's posted entries are candidates too.
    if (!txs.data) { setFiles([]); return; }
    Promise.all(txs.data.transactions.map((x) => api.get<{ files: any[] }>(`/api/org/${slug}/files?entityType=transaction&entityId=${x.id}`).then((r) => r.files.map((f) => ({ ...f, reference: x.reference })))))
      .then((all) => setFiles(all.flat())).catch(() => setFiles([]));
  }, [txs.data, slug]);
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("Share a record")} description={t("Financial records need approval rights. The sponsor sees it in their portal straight away.")}
      submitLabel={t("Share")} busy={save.isPending} disabled={!selected} wide onSubmit={() => selected && save.mutate({ entityType: selected.type, entityId: selected.id })}>
      <Field label={t("Project")}><OptionSelect value={projectId} onChange={(v) => { setProjectId(v); setSelected(null); }} options={fundedProjects.map((p) => ({ value: p.projectId, label: p.title }))} /></Field>
      {!can("finance.view") && <p className="text-sm text-muted-foreground">{t("You need finance access to choose financial records.")}</p>}
      {projectId && (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {(txs.data?.transactions ?? []).map((x) => (
            <label key={`t${x.id}`} className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-2 text-sm hover:bg-muted/50">
              <Checkbox checked={selected?.type === "transaction" && selected.id === x.id} onCheckedChange={() => setSelected({ type: "transaction", id: x.id })} />
              <span className="min-w-0 flex-1 truncate">{x.reference} · {x.description}</span>
              <span className="tabular">{formatMoney(x.amount, x.currency, lang)}</span>
            </label>
          ))}
          {files.map((f) => (
            <label key={`f${f.id}`} className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-2 text-sm hover:bg-muted/50">
              <Checkbox checked={selected?.type === "file" && selected.id === f.id} onCheckedChange={() => setSelected({ type: "file", id: f.id })} />
              <Paperclip className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{f.fileName}</span><span className="text-xs text-muted-foreground">{f.reference}</span>
            </label>
          ))}
          {txs.data && txs.data.transactions.length === 0 && <p className="text-sm text-muted-foreground">{t("No posted entries for this project yet.")}</p>}
        </div>
      )}
    </FormDialog>
  );
}
