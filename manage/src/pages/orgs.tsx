import { Link, Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, Loader2, LogOut, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSession, useSignOut } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { CenteredPage } from "@/components/centered";
import { EmptyState, ErrorState, Pill } from "@/components/primitives";

type MyOrg = { id: number; slug: string; name: string; logoUrl: string | null; membershipStatus: string; role: { key: string; name: string } };

export default function OrgsPage() {
  const { t } = useI18n();
  const { user } = useSession();
  const signOut = useSignOut();
  const q = useQuery({ queryKey: ["my-orgs"], queryFn: () => api.get<{ organisations: MyOrg[]; canCreate: boolean }>("/api/org") });

  if (q.isLoading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  const orgs = q.data?.organisations ?? [];
  // Most people belong to one organisation — take them straight there.
  if (orgs.length === 1 && !q.data?.canCreate) return <Redirect to={`/o/${orgs[0].slug}`} />;

  return (
    <CenteredPage>
      <h1 className="text-2xl font-semibold tracking-tight">{t("Welcome, {name}", { name: user?.fullName?.split(" ")[0] ?? "" })}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("Choose an organisation workspace.")}</p>
      <div className="mt-6 overflow-hidden rounded-2xl border bg-card">
        {q.error ? (
          <div className="p-4"><ErrorState onRetry={() => q.refetch()} /></div>
        ) : orgs.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={t("You're not part of an organisation yet")}
            description={t("Ask an administrator to invite you using this account's email address.")}
          />
        ) : (
          orgs.map((o) => (
            <Link key={o.id} href={`/o/${o.slug}`} className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-0 hover:bg-muted/60">
              {o.logoUrl
                ? <img src={o.logoUrl} alt="" className="size-10 rounded-lg border border-border object-contain p-1" />
                : <span className="brand-surface grid size-10 place-items-center rounded-xl text-sm font-bold text-white">{o.name.slice(0, 2).toUpperCase()}</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{o.name}</span>
                <span className="block truncate text-sm text-muted-foreground">{o.role.name}</span>
              </span>
              {o.membershipStatus !== "active" && <Pill tone="amber">{t(o.membershipStatus === "suspended" ? "Suspended" : "Inactive")}</Pill>}
              <ChevronRight className="size-4 text-muted-foreground rtl:rotate-180" />
            </Link>
          ))
        )}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        {q.data?.canCreate ? (
          <Button asChild><Link href="/new"><Plus />{t("New organisation")}</Link></Button>
        ) : <span />}
        <Button variant="ghost" onClick={signOut}><LogOut />{t("Sign out")}</Button>
      </div>
    </CenteredPage>
  );
}
