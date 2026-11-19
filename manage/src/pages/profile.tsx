import { Link } from "wouter";
import { ExternalLink, Mail, Phone } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { SITE_URL } from "@/lib/env";
import { formatDate, relativeTime } from "@/lib/format";
import { useOrg, useOrgQuery, useRegions } from "@/hooks/use-org";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KeyValue, PageHeader, PersonAvatar, Pill, Section, StatusPill, VerifiedBadge } from "@/components/primitives";
import { MembershipDues } from "@/components/dues";

// "My profile" inside an organisation: who I am here, my membership and my dues.
export default function ProfilePage() {
  const { t, lang } = useI18n();
  const { org, me, path } = useOrg();
  const { user } = useSession();
  const { byId: regionById } = useRegions();
  const q = useOrgQuery<any>(`/members/${me.membershipId}`);
  const m = q.data?.member;

  return (
    <>
      <PageHeader eyebrow={org.name} title={t("My profile")} description={t("Your membership, your fees and your status in this organisation.")} />

      <Section>
        {!m ? (
          <div className="flex items-center gap-5"><Skeleton className="size-20 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-6 w-48" /><Skeleton className="h-3 w-64" /></div></div>
        ) : (
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <PersonAvatar name={m.fullName} url={m.avatarUrl ?? user?.avatarUrl} size={80} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="flex items-center gap-1.5 text-2xl font-bold tracking-tight">{m.fullName}<VerifiedBadge verified={m.verified} /></h1>
                <StatusPill kind="membership" status={m.status} />
              </div>
              <p className="text-sm text-muted-foreground">{m.title ?? m.roleName}{m.regionId && ` · ${regionById.get(m.regionId)?.name ?? ""}`}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground" dir="ltr"><Mail className="size-3.5" />{m.email}</span>
                {m.phone && <span className="inline-flex items-center gap-1.5 text-muted-foreground" dir="ltr"><Phone className="size-3.5" />{m.phone}</span>}
              </div>
            </div>
            <Button variant="outline" asChild>
              <a href={`${SITE_URL}/profile`} target="_blank" rel="noreferrer"><ExternalLink />{t("Edit account")}</a>
            </Button>
          </div>
        )}
      </Section>

      <MembershipDues showSchedule />

      {m && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title={t("Membership")}>
            <dl className="divide-y divide-border">
              <KeyValue label={t("Role")}>{m.roleName}</KeyValue>
              <KeyValue label={t("Position")}>{m.title ?? "—"}</KeyValue>
              <KeyValue label={t("Region")}>{m.regionId ? regionById.get(m.regionId)?.name : "—"}</KeyValue>
              <KeyValue label={t("Joined")}>{formatDate(m.joinedAt, lang, org.timezone)}</KeyValue>
              <KeyValue label={t("Last active")}>{m.lastActiveAt ? relativeTime(m.lastActiveAt, lang) : t("Never")}</KeyValue>
            </dl>
          </Section>
          <Section title={t("Committees & projects")}>
            {m.committees.length === 0 && m.projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("You're not in any committee or project yet.")}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {m.committees.map((c: any) => <Link key={`c${c.id}`} href={path(`/committees/${c.id}`)}><Pill tone="indigo">{c.name}{c.role === "head" && ` · ${t("Head")}`}</Pill></Link>)}
                {m.projects.map((p: any) => <Link key={`p${p.id}`} href={path(`/projects/${p.id}`)}><Pill tone="teal">{p.title}</Pill></Link>)}
              </div>
            )}
          </Section>
        </div>
      )}
    </>
  );
}
