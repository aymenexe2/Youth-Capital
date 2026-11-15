import { useEffect, useState } from "react";
import { Lock, MapPin, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { PERMISSION_GROUP_LABEL, PERMISSION_LABEL, REGION_KIND, SCOPE } from "@/lib/labels";
import { useOrg, useOrgMutation, useOrgQuery, useRegions, useRoles, type Region, type Role } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, Field, PageHeader, Pill, Section } from "@/components/primitives";
import { OptionSelect } from "@/components/pickers";
import { FormDialog } from "@/components/forms";

export default function SettingsPage() {
  const { t } = useI18n();
  const { can } = useOrg();
  const tabs = [
    can("org.manage") && { key: "general", label: t("General") },
    can("regions.manage") && { key: "regions", label: t("Regions") },
    can("roles.manage") && { key: "roles", label: t("Roles & permissions") },
  ].filter(Boolean) as { key: string; label: string }[];
  if (!tabs.length) return <EmptyState icon={Lock} title={t("You don't have access to settings")} />;
  return (
    <>
      <PageHeader title={t("Settings")} description={t("Configure your organisation's identity, structure and access.")} />
      <Tabs defaultValue={tabs[0].key}>
        <TabsList>{tabs.map((x) => <TabsTrigger key={x.key} value={x.key}>{x.label}</TabsTrigger>)}</TabsList>
        <TabsContent value="general" className="mt-4"><General /></TabsContent>
        <TabsContent value="regions" className="mt-4"><Regions /></TabsContent>
        <TabsContent value="roles" className="mt-4"><Roles /></TabsContent>
      </Tabs>
    </>
  );
}

function General() {
  const { t } = useI18n();
  const { org } = useOrg();
  const [f, setF] = useState<any>({});
  useEffect(() => {
    setF({ name: org.name, description: org.description ?? "", logoUrl: org.logoUrl ?? "", primaryColor: org.primaryColor ?? "", defaultLanguage: org.defaultLanguage, currency: org.currency, timezone: org.timezone });
  }, [org]);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const save = useOrgMutation((body: any, base) => api.patch(`${base}`, body), { success: "Settings saved" });
  return (
    <Section title={t("Organisation")}>
      <form className="max-w-2xl space-y-4" onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ name: f.name.trim(), description: f.description.trim() || null, logoUrl: f.logoUrl.trim() || null, primaryColor: f.primaryColor || null, defaultLanguage: f.defaultLanguage, currency: f.currency, timezone: f.timezone });
      }}>
        <Field label={t("Name")} htmlFor="s-name" required><Input id="s-name" value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} maxLength={120} /></Field>
        <Field label={t("Description")} htmlFor="s-desc"><Textarea id="s-desc" rows={3} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} maxLength={2000} /></Field>
        <Field label={t("Logo URL")} htmlFor="s-logo" hint={t("A square image works best.")}><Input id="s-logo" type="url" dir="ltr" placeholder="https://" value={f.logoUrl ?? ""} onChange={(e) => set("logoUrl", e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("Default language")}><OptionSelect value={f.defaultLanguage} onChange={(v) => set("defaultLanguage", v ?? "fr")} options={[{ value: "fr", label: "Français" }, { value: "en", label: "English" }, { value: "ar", label: "العربية" }]} /></Field>
          <Field label={t("Currency")}><OptionSelect value={f.currency} onChange={(v) => set("currency", v ?? "MAD")} options={["MAD", "EUR", "USD"].map((c) => ({ value: c, label: c }))} /></Field>
          <Field label={t("Timezone")}><OptionSelect value={f.timezone} onChange={(v) => set("timezone", v ?? "Africa/Casablanca")} options={["Africa/Casablanca", "Europe/Paris", "Europe/Brussels", "Europe/Madrid", "UTC"].map((z) => ({ value: z, label: z }))} /></Field>
        </div>
        <Button type="submit" disabled={save.isPending || !f.name || f.name.trim().length < 2}>{t("Save changes")}</Button>
      </form>
    </Section>
  );
}

function Regions() {
  const { t } = useI18n();
  const { regions } = useRegions();
  const [editing, setEditing] = useState<null | Partial<Region>>(null);
  const remove = useOrgMutation((id: number, base) => api.del(`${base}/regions/${id}`), { success: "Region deleted" });
  const roots = regions.filter((r) => !r.parentId);
  const children = (id: number) => regions.filter((r) => r.parentId === id);

  const Row = ({ r, depth }: { r: Region; depth: number }) => (
    <>
      <li className="flex items-center gap-3 px-4 py-2.5" style={{ paddingInlineStart: 16 + depth * 24 }}>
        <MapPin className="size-4 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium">{r.name}{r.code && <span className="ms-2 text-xs text-muted-foreground">{r.code}</span>}</span>
        <Pill>{t(REGION_KIND[r.kind])}</Pill>
        <span className="w-20 text-end text-xs text-muted-foreground">{t("{n} members", { n: r.memberCount })}</span>
        <button aria-label={t("Add sub-region")} className="text-muted-foreground hover:text-foreground" onClick={() => setEditing({ parentId: r.id, kind: r.kind === "region" ? "province" : "local" })}><Plus className="size-4" /></button>
        <button aria-label={t("Edit")} className="text-muted-foreground hover:text-foreground" onClick={() => setEditing(r)}><Pencil className="size-3.5" /></button>
        <button aria-label={t("Delete")} className="text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(r.id)}><Trash2 className="size-3.5" /></button>
      </li>
      {children(r.id).map((c) => <Row key={c.id} r={c} depth={depth + 1} />)}
    </>
  );

  return (
    <Section title={t("Geographic structure")} bodyClassName="p-0" action={<Button size="sm" onClick={() => setEditing({ kind: "region" })}><Plus />{t("Add region")}</Button>}>
      {regions.length === 0 ? <EmptyState icon={MapPin} title={t("No regions yet")} description={t("Add regions, then provinces and local units under them. Regional coordinators are scoped to a region and everything beneath it.")} /> : (
        <ul className="divide-y divide-border">{roots.map((r) => <Row key={r.id} r={r} depth={0} />)}</ul>
      )}
      <RegionDialog region={editing} onClose={() => setEditing(null)} regions={regions} />
    </Section>
  );
}

function RegionDialog({ region, onClose, regions }: { region: Partial<Region> | null; onClose: () => void; regions: Region[] }) {
  const { t } = useI18n();
  const [f, setF] = useState<any>({});
  useEffect(() => { if (region) setF({ name: region.name ?? "", kind: region.kind ?? "region", code: region.code ?? "", parentId: region.parentId ?? null }); }, [region]);
  const save = useOrgMutation((body: any, base) => (region?.id ? api.patch(`${base}/regions/${region.id}`, body) : api.post(`${base}/regions`, body)), { onSuccess: onClose });
  return (
    <FormDialog open={!!region} onOpenChange={(o) => !o && onClose()} title={region?.id ? t("Edit region") : t("Add region")} submitLabel={t("Save")}
      busy={save.isPending} disabled={!f.name?.trim()} onSubmit={() => save.mutate({ name: f.name.trim(), kind: f.kind, code: f.code.trim() || null, parentId: f.parentId ? Number(f.parentId) : null })}>
      <Field label={t("Name")} htmlFor="r-name" required><Input id="r-name" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus maxLength={120} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Type")}><OptionSelect value={f.kind} onChange={(v) => setF({ ...f, kind: v ?? "region" })} options={Object.keys(REGION_KIND).map((k) => ({ value: k, label: t(REGION_KIND[k]) }))} /></Field>
        <Field label={t("Code")} htmlFor="r-code"><Input id="r-code" value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value })} maxLength={20} /></Field>
      </div>
      <Field label={t("Part of")}><OptionSelect value={f.parentId} onChange={(v) => setF({ ...f, parentId: v })} allowNone noneLabel={t("Top level")} options={regions.filter((r) => r.id !== region?.id).map((r) => ({ value: r.id, label: r.name }))} /></Field>
    </FormDialog>
  );
}

function Roles() {
  const { t } = useI18n();
  const { roles } = useRoles();
  const meta = useOrgQuery<{ permissionGroups: { key: string; permissions: string[]; available: boolean }[]; scopes: string[] }>("/meta", { staleTime: Infinity });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = roles.find((r) => r.id === selectedId) ?? roles[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <Section bodyClassName="p-2" title={t("Roles")} action={<Button size="sm" variant="ghost" onClick={() => setCreating(true)}><Plus />{t("New")}</Button>}>
        <ul className="space-y-0.5">
          {roles.map((r) => (
            <li key={r.id}>
              <button onClick={() => setSelectedId(r.id)} className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm", selected?.id === r.id ? "bg-secondary font-medium" : "hover:bg-muted")}>
                <span className="flex-1 truncate">{r.name}</span>
                <span className="text-xs text-muted-foreground tabular">{r.memberCount}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
      {selected && meta.data && <RoleEditor key={selected.id} role={selected} groups={meta.data.permissionGroups} scopes={meta.data.scopes} />}
      <RoleCreateDialog open={creating} onOpenChange={setCreating} scopes={meta.data?.scopes ?? []} onCreated={(id) => setSelectedId(id)} />
    </div>
  );
}

function RoleEditor({ role, groups, scopes }: { role: Role; groups: { key: string; permissions: string[]; available: boolean }[]; scopes: string[] }) {
  const { t } = useI18n();
  const locked = role.key === "org_admin";
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [scope, setScope] = useState(role.scope);
  const [perms, setPerms] = useState(new Set(role.permissions));
  const save = useOrgMutation((body: any, base) => api.patch(`${base}/roles/${role.id}`, body), { success: "Role saved" });
  const del = useOrgMutation((_: void, base) => api.del(`${base}/roles/${role.id}`), { success: "Role deleted" });
  const toggle = (p: string) => setPerms((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const dirty = name !== role.name || description !== (role.description ?? "") || scope !== role.scope || perms.size !== role.permissions.length || role.permissions.some((p) => !perms.has(p));

  return (
    <Section
      title={<span className="flex items-center gap-2">{role.name}{role.isSystem && <Pill tone="neutral">{t("Built-in")}</Pill>}</span>}
      action={!role.isSystem && <Button size="sm" variant="ghost" className="text-destructive" disabled={role.memberCount > 0} title={role.memberCount > 0 ? t("Reassign this role's members before deleting it") : undefined} onClick={() => del.mutate()}><Trash2 />{t("Delete")}</Button>}
    >
      {locked && <p className="mb-4 flex items-center gap-2 rounded-lg bg-muted p-3 text-sm"><ShieldCheck className="size-4 text-st-green" />{t("Administrators always have every permission across the whole organisation, so nobody can be locked out.")}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Name")} htmlFor="role-name"><Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
        <Field label={t("Scope")} hint={t("Where this role's permissions apply.")}>
          <OptionSelect value={scope} onChange={(v) => setScope(v ?? scope)} options={scopes.map((s) => ({ value: s, label: t(SCOPE[s]) }))} />
        </Field>
      </div>
      <div className="mt-4"><Field label={t("Description")} htmlFor="role-desc"><Input id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} /></Field></div>
      <div className="mt-6 space-y-5">
        {groups.map((g) => (
          <fieldset key={g.key} disabled={locked}>
            <legend className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(PERMISSION_GROUP_LABEL[g.key] ?? g.key)}{!g.available && <Pill tone="gold">{t("Coming soon")}</Pill>}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {g.permissions.map((p) => (
                <label key={p} className={cn("flex items-start gap-3 rounded-lg border border-border p-3 text-sm", !locked && "cursor-pointer hover:bg-muted/50")}>
                  <Checkbox checked={perms.has(p)} onCheckedChange={() => toggle(p)} disabled={locked} className="mt-0.5" />
                  <span><span className="block font-medium">{t(PERMISSION_LABEL[p] ?? p)}</span><span className="block font-mono text-[11px] text-muted-foreground" dir="ltr">{p}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="mt-6 flex justify-end">
        <Button disabled={!dirty || save.isPending || name.trim().length < 2} onClick={() => save.mutate(locked ? { name: name.trim(), description: description.trim() || null } : { name: name.trim(), description: description.trim() || null, scope, permissions: [...perms] })}>
          {t("Save role")}
        </Button>
      </div>
    </Section>
  );
}

function RoleCreateDialog({ open, onOpenChange, scopes, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; scopes: string[]; onCreated: (id: number) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [scope, setScope] = useState("assigned");
  const save = useOrgMutation((body: any, base) => api.post<{ role: Role }>(`${base}/roles`, body), {
    success: "Role created", onSuccess: (d) => { onOpenChange(false); setName(""); onCreated(d.role.id); },
  });
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("New role")} description={t("It starts with view-only access; choose what else this role can do.")} submitLabel={t("Create role")}
      busy={save.isPending} disabled={name.trim().length < 2} onSubmit={() => save.mutate({ name: name.trim(), scope, permissions: ["projects.view", "events.view", "tasks.view"] })}>
      <Field label={t("Name")} htmlFor="nr-name" required><Input id="nr-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus /></Field>
      <Field label={t("Scope")}><OptionSelect value={scope} onChange={(v) => setScope(v ?? "assigned")} options={scopes.map((s) => ({ value: s, label: t(SCOPE[s]) }))} /></Field>
    </FormDialog>
  );
}
