import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CenteredPage } from "@/components/centered";
import { Field } from "@/components/primitives";
import { OptionSelect } from "@/components/pickers";

const slugify = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

export default function NewOrgPage() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [defaultLanguage, setDefaultLanguage] = useState("fr");
  const [currency, setCurrency] = useState("MAD");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { organisation } = await api.post<{ organisation: { slug: string } }>("/api/org", {
        name, slug: slug || undefined, description: description || null, defaultLanguage, currency,
      });
      await qc.invalidateQueries({ queryKey: ["my-orgs"] });
      toast.success(t("Organisation created"));
      navigate(`/o/${organisation.slug}/settings`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenteredPage>
      <Link href="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Back")}</Link>
      <h1 className="text-2xl font-semibold tracking-tight">{t("New organisation")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("You'll be its first administrator. Committees, regions and roles can be set up next.")}</p>
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border bg-card p-5">
        <Field label={t("Name")} htmlFor="org-name" required>
          <Input id="org-name" value={name} onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} required minLength={2} maxLength={120} />
        </Field>
        <Field label={t("Workspace address")} htmlFor="org-slug" hint={t("Lowercase letters, numbers and dashes.")}>
          <div className="flex items-center rounded-md border border-input shadow-xs focus-within:ring-1 focus-within:ring-ring">
            <span className="ps-3 text-sm text-muted-foreground" dir="ltr">/o/</span>
            <input id="org-slug" dir="ltr" className="h-9 flex-1 bg-transparent px-1 text-sm outline-none" value={slug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} />
          </div>
        </Field>
        <Field label={t("Description")} htmlFor="org-desc">
          <Textarea id="org-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Default language")}>
            <OptionSelect value={defaultLanguage} onChange={(v) => setDefaultLanguage(v ?? "fr")} options={[{ value: "fr", label: "Français" }, { value: "en", label: "English" }, { value: "ar", label: "العربية" }]} />
          </Field>
          <Field label={t("Currency")}>
            <OptionSelect value={currency} onChange={(v) => setCurrency(v ?? "MAD")} options={[{ value: "MAD", label: "MAD — Dirham" }, { value: "EUR", label: "EUR — Euro" }, { value: "USD", label: "USD — Dollar" }]} />
          </Field>
        </div>
        <Button type="submit" className="w-full" disabled={busy || name.trim().length < 2}>{busy && <Loader2 className="animate-spin" />}{t("Create organisation")}</Button>
      </form>
    </CenteredPage>
  );
}
