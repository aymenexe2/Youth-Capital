import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Copy, Download, Mail, Search, ShieldAlert, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { downloadFile, formatDate, relativeTime, toCsv } from "@/lib/format";
import { MEMBERSHIP_STATUS, SCOPE } from "@/lib/labels";
import { useCommittees, useOrg, useOrgMutation, useOrgQuery, useRegions, useRoles } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Field, LoadingRows, PageHeader, PersonAvatar, Pill, Section, StatusPill, VerifiedBadge } from "@/components/primitives";
import { OptionSelect } from "@/components/pickers";
import { FormDialog } from "@/components/forms";

export default function MembersPage() {
  const { t } = useI18n();
  const { can, me } = useOrg();
  const [inviting, setInviting] = useState(false);
  return (
    <>
      <PageHeader
        title={t("Members")}
        description={me.scope === "organisation" ? t("Everyone in the organisation, their roles and where they serve.") : t("People within your scope: {scope}.", { scope: t(SCOPE[me.scope]).toLowerCase() })}
        actions={can("members.invite") && <Button onClick={() => setInviting(true)}><UserPlus />{t("Invite member")}</Button>}
      />
      {can("members.invite") ? (
        <Tabs defaultValue="directory">
          <TabsList><TabsTrigger value="directory">{t("Directory")}</TabsTrigger><TabsTrigger value="invitations">{t("Pending invitations")}</TabsTrigger></TabsList>
          <TabsContent value="directory" className="mt-4"><Directory /></TabsContent>
          <TabsContent value="invitations" className="mt-4"><Invitations /></TabsContent>
        </Tabs>
      ) : <Directory />}
      <InviteDialog open={inviting} onOpenChange={setInviting} />
    </>
  );
}

function Directory() {
  const { t, lang } = useI18n();
  const { org, path, can } = useOrg();
  const [, navigate] = useLocation();
  const { byId: regionById, regions } = useRegions();
  const { byId: committeeById, committees } = useCommittees();
  const q = useOrgQuery<{ members: any[] }>("/members");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>("active");
  const [regionId, setRegionId] = useState<string | null>(null);
  const [committeeId, setCommitteeId] = useState<string | null>(null);

  const members = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.members ?? []).filter((m) =>
      (!status || m.status === status) &&
      (!regionId || String(m.regionId) === regionId) &&
      (!committeeId || m.committees.some((c: any) => String(c.committeeId) === committeeId)) &&
      (!s || `${m.fullName} ${m.email} ${m.title ?? ""} ${m.roleName}`.toLowerCase().includes(s)));
  }, [q.data, search, status, regionId, committeeId]);

  const exportCsv = () => downloadFile(`members-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(
    members.map((m) => ({
      name: m.fullName, email: m.email, phone: m.phone ?? "", role: m.roleName, title: m.title ?? "", status: t(MEMBERSHIP_STATUS[m.status]),
      region: m.regionId ? regionById.get(m.regionId)?.name ?? "" : "", committees: m.committees.map((c: any) => committeeById.get(c.committeeId)?.name).filter(Boolean).join("; "),
      joined: m.joinedAt?.slice(0, 10),
    })),
    [
      { key: "name", label: t("Name") }, { key: "email", label: t("Email") }, { key: "phone", label: t("Phone") }, { key: "role", label: t("Role") },
      { key: "title", label: t("Position") }, { key: "status", label: t("Status") }, { key: "region", label: t("Region") }, { key: "committees", label: t("Committees") },
      { key: "joined", label: t("Joined") },
    ],
  ));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="ps-9" placeholder={t("Search by name, email, role…")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-36"><OptionSelect value={status} onChange={setStatus} allowNone noneLabel={t("Any status")} options={Object.keys(MEMBERSHIP_STATUS).filter((k) => k !== "left").map((k) => ({ value: k, label: t(MEMBERSHIP_STATUS[k]) }))} /></div>
        {regions.length > 0 && <div className="w-44"><OptionSelect value={regionId} onChange={setRegionId} allowNone noneLabel={t("All regions")} options={regions.map((r) => ({ value: r.id, label: r.name }))} /></div>}
        {committees.length > 0 && <div className="w-48"><OptionSelect value={committeeId} onChange={setCommitteeId} allowNone noneLabel={t("All committees")} options={committees.map((c) => ({ value: c.id, label: c.name }))} /></div>}
        {can("members.view") && <Button variant="outline" onClick={exportCsv} disabled={!members.length}><Download />{t("Export CSV")}</Button>}
      </div>

      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState onRetry={() => q.refetch()} /> : members.length === 0 ? (
        <Section><EmptyState icon={Users} title={t("No members match")} /></Section>
      ) : (
        <Section bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{t("Member")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("Role")}</th>
                  <th className="hidden px-4 py-3 text-start font-medium md:table-cell">{t("Region")}</th>
                  <th className="hidden px-4 py-3 text-start font-medium lg:table-cell">{t("Committees")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("Status")}</th>
                  <th className="hidden px-4 py-3 text-start font-medium xl:table-cell">{t("Last active")}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.membershipId} onClick={() => navigate(path(`/members/${m.membershipId}`))} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <PersonAvatar name={m.fullName} url={m.avatarUrl} size={34} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 font-medium"><span className="truncate">{m.fullName}</span><VerifiedBadge verified={m.verified} /></div>
                          <div className="truncate text-xs text-muted-foreground" dir="ltr">{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><div className="font-medium">{m.roleName}</div>{m.title && m.title !== m.roleName && <div className="text-xs text-muted-foreground">{m.title}</div>}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{m.regionId ? regionById.get(m.regionId)?.name : "—"}</td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {m.committees.slice(0, 2).map((c: any) => <Pill key={c.committeeId} tone={c.role === "head" ? "gold" : "neutral"}>{committeeById.get(c.committeeId)?.name}</Pill>)}
                        {m.committees.length > 2 && <Pill>+{m.committees.length - 2}</Pill>}
                      </div>
                    </td>
                    <td className="px-4 py-3"><StatusPill kind="membership" status={m.status} /></td>
                    <td className="hidden px-4 py-3 text-xs text-muted-foreground xl:table-cell" title={formatDate(m.lastActiveAt, lang, org.timezone)}>{m.lastActiveAt ? relativeTime(m.lastActiveAt, lang) : t("Never")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

function Invitations() {
  const { t, lang } = useI18n();
  const { org } = useOrg();
  const q = useOrgQuery<{ invitations: any[] }>("/invitations");
  const revoke = useOrgMutation((id: number, base) => api.del(`${base}/invitations/${id}`), { success: "Invitation revoked" });
  if (q.isLoading) return <LoadingRows rows={3} />;
  const list = q.data?.invitations ?? [];
  return (
    <Section bodyClassName="p-0">
      {list.length === 0 ? <EmptyState icon={Mail} title={t("No pending invitations")} /> : (
        <ul className="divide-y divide-border">
          {list.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground"><Mail className="size-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium" dir="ltr">{i.email}</span>
                <span className="block text-xs text-muted-foreground">{i.roleName} · {t("Invited by {name}", { name: i.invitedBy ?? "—" })} · {formatDate(i.createdAt, lang, org.timezone)}</span>
              </span>
              {i.expired ? <Pill tone="red">{t("Expired")}</Pill> : <Pill tone="amber">{t("Pending")}</Pill>}
              <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}><Trash2 />{t("Revoke")}</Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { can, me, orgWide } = useOrg();
  const { roles } = useRoles();
  const { regions } = useRegions();
  const { committees } = useCommittees();
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState<string | null>(null);
  const [regionId, setRegionId] = useState<string | null>(null);
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<{ link: string; emailed: boolean } | null>(null);

  // Without roles.manage only the Member role can be granted (enforced server-side too).
  const roleOptions = roles.filter((r) => can("roles.manage") || r.key === "member").map((r) => ({ value: r.id, label: r.name }));
  const regionOptions = regions.filter((r) => orgWide || me.scope !== "region" || r.id === me.regionId).map((r) => ({ value: r.id, label: r.name }));
  const effectiveRole = roleId ?? (roleOptions.length === 1 ? String(roleOptions[0].value) : null);

  const send = useOrgMutation((body: any, base) => api.post<{ link: string; emailed: boolean }>(`${base}/invitations`, body), {
    onSuccess: (d) => setResult({ link: d.link, emailed: d.emailed }),
  });
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) { setEmail(""); setRoleId(null); setRegionId(null); setCommitteeId(null); setTitle(""); setResult(null); }
  };

  if (result) {
    return (
      <FormDialog open={open} onOpenChange={close} title={t("Invitation created")} submitLabel={t("Done")} onSubmit={() => close(false)}>
        <p className="text-sm">{result.emailed ? t("We've emailed the invitation. You can also share this link directly:") : t("Email isn't configured, so share this link with the person directly:")}</p>
        <div className="flex gap-2">
          <Input readOnly value={result.link} dir="ltr" onFocus={(e) => e.currentTarget.select()} />
          <Button type="button" variant="outline" onClick={() => { navigator.clipboard.writeText(result.link); toast.success(t("Link copied")); }}><Copy />{t("Copy")}</Button>
        </div>
        <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldAlert className="mt-0.5 size-3.5 shrink-0" />{t("The link only works for the invited email address and expires in 14 days.")}</p>
      </FormDialog>
    );
  }

  return (
    <FormDialog
      open={open} onOpenChange={close} title={t("Invite member")} description={t("They'll sign in with their Youth Capital account (or create one with this email) to join.")}
      submitLabel={t("Send invitation")} busy={send.isPending} disabled={!/^\S+@\S+\.\S+$/.test(email) || !effectiveRole || (me.scope === "region" && !orgWide && !regionId)}
      onSubmit={() => send.mutate({ email: email.trim(), roleId: Number(effectiveRole), regionId: regionId ? Number(regionId) : null, committeeId: committeeId ? Number(committeeId) : null, title: title.trim() || null })}
    >
      <Field label={t("Email")} htmlFor="inv-email" required><Input id="inv-email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Role")} required><OptionSelect value={effectiveRole} onChange={setRoleId} options={roleOptions} /></Field>
        <Field label={t("Position")} htmlFor="inv-title" hint={t("e.g. Regional Coordinator, Ambassador")}><Input id="inv-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></Field>
        {regionOptions.length > 0 && <Field label={t("Region")} required={me.scope === "region" && !orgWide}><OptionSelect value={regionId} onChange={setRegionId} options={regionOptions} allowNone={orgWide || me.scope !== "region"} /></Field>}
        {committees.length > 0 && <Field label={t("Committee")}><OptionSelect value={committeeId} onChange={setCommitteeId} options={committees.filter((c) => !c.archivedAt).map((c) => ({ value: c.id, label: c.name }))} allowNone /></Field>}
      </div>
    </FormDialog>
  );
}
