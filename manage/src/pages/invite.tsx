import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MailWarning } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSession, useSignOut } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { CenteredPage } from "@/components/centered";
import { EmptyState } from "@/components/primitives";

type Invitation = { organisation: { name: string; slug: string; logoUrl: string | null }; role: string; email: string; state: string; emailMatches: boolean };

const STATE_MESSAGE: Record<string, string> = {
  accepted: "It has already been accepted.",
  expired: "It has expired. Ask for a new invitation.",
  revoked: "It was revoked.",
};

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { t } = useI18n();
  const { user } = useSession();
  const signOut = useSignOut();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["invitation", token], queryFn: () => api.get<Invitation>(`/api/org/invitations/${encodeURIComponent(token)}`), retry: false });
  const back = <Button asChild variant="outline"><Link href="/">{t("Go to my workspaces")}</Link></Button>;

  const accept = async () => {
    setBusy(true);
    try {
      const { organisation } = await api.post<{ organisation: { slug: string } }>(`/api/org/invitations/${encodeURIComponent(token)}/accept`);
      await qc.invalidateQueries({ queryKey: ["my-orgs"] });
      navigate(`/o/${organisation.slug}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenteredPage>
      <div className="rounded-2xl border bg-card p-6 text-center">
        {q.isLoading ? (
          <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
        ) : !q.data ? (
          <EmptyState icon={MailWarning} title={t("Invitation not found")} description={t("The link may be incomplete. Ask for a new invitation.")} action={back} />
        ) : q.data.state !== "pending" ? (
          <EmptyState icon={MailWarning} title={t("This invitation is no longer valid")} description={t(STATE_MESSAGE[q.data.state] ?? "")} action={back} />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("You've been invited to join")}</p>
            <h1 className="mt-1 text-2xl font-semibold">{q.data.organisation.name}</h1>
            <p className="mt-2 text-sm">{t("Role")}: <span className="font-medium">{q.data.role}</span></p>
            {q.data.emailMatches ? (
              <Button className="mt-6 w-full" onClick={accept} disabled={busy}>{busy && <Loader2 className="animate-spin" />}{t("Accept invitation")}</Button>
            ) : (
              <div className="mt-6 rounded-lg bg-st-amber/10 p-4 text-start text-sm">
                <p>{t("This invitation was sent to {invited}, but you're signed in as {current}.", { invited: q.data.email, current: user?.email ?? "" })}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={signOut}>{t("Sign in with another account")}</Button>
              </div>
            )}
          </>
        )}
      </div>
    </CenteredPage>
  );
}
