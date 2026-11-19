import { useEffect, useState, type FormEvent } from "react";
import { Redirect, useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2, ShieldCheck, FolderKanban, Users, CheckCircle2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { API_URL, SITE_URL } from "@/lib/env";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, IconTile } from "@/components/primitives";
import { LanguageMenu, ThemeToggle } from "@/components/shell";
import { Splash } from "@/components/splash";

const OAUTH_ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  email_not_verified: "Your provider didn't confirm your email address.",
  banned: "This account is not active.",
  provider_unavailable: "That sign-in option isn't available.",
};

// Only same-app paths are allowed as a post-login destination.
const safeNext = (v: string | null) => (v && v.startsWith("/") && !v.startsWith("//") ? v : "/");

export default function LoginPage() {
  const { t } = useI18n();
  const { user, isLoading } = useSession();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [entering, setEntering] = useState(false);
  const providers = useQuery({ queryKey: ["oauth-providers"], queryFn: () => api.get<{ google: boolean; linkedin: boolean }>("/api/auth/oauth/providers") });

  useEffect(() => {
    const code = params.get("oauth_error");
    if (code) setError(t(OAUTH_ERRORS[code] ?? "Sign-in failed. Please try again."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coming back with the browser's Back button from Google restores this page from cache: drop the splash.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setEntering(false); };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  if (!isLoading && user) return <Redirect to={next} />;
  // While we check for an existing session (or right after signing in), show the splash, not a flash of the form.
  if (isLoading || entering) return <Splash />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { email: email.trim(), password });
      setEntering(true);
      await qc.invalidateQueries({ queryKey: ["session"] });
      navigate(next);
    } catch (err) {
      const msg = errorMessage(err, t("Sign-in failed. Please try again."));
      setError(msg === "Invalid credentials" ? t("Incorrect email or password.") : msg);
    } finally {
      setBusy(false);
    }
  };

  // Pass the destination through the provider round trip (e.g. back to an invitation).
  const oauth = (p: "google" | "linkedin") => {
    setEntering(true);
    window.location.href = `${API_URL}/api/auth/oauth/${p}?${new URLSearchParams({ app: "manage", ...(next !== "/" ? { next } : {}) })}`;
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="brand-surface relative m-3 hidden overflow-hidden rounded-[32px] p-12 text-white shadow-[0_30px_60px_-30px_rgb(11_42_107/0.8)] lg:flex lg:flex-col">
        <div className="absolute -end-24 -top-24 size-96 rounded-full bg-[#5ac8fa]/25 blur-3xl" />
        <div className="absolute -bottom-32 -start-16 size-96 rounded-full bg-[#af52de]/30 blur-3xl" />
        <img src="/youth_capital_logo_dark.svg" alt="Youth Capital" className="relative h-14 w-auto self-start" />
        <div className="relative mt-auto max-w-lg">
          <span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-white ring-1 ring-inset ring-white/25 backdrop-blur-md">{t("Organisation workspace")}</span>
          <h1 className="mt-4 text-[44px] font-bold leading-[1.08] tracking-tight">{t("Organise, coordinate and deliver — in one place.")}</h1>
          <ul className="mt-10 grid gap-3">
            {([
              [Users, t("Members, committees and regions with clear roles"), "indigo"],
              [FolderKanban, t("Projects, events and tasks with owners and deadlines"), "teal"],
              [CheckCircle2, t("Every completed task validated and recorded"), "green"],
              [ShieldCheck, t("Private by default — you only see what your role allows"), "amber"],
            ] as const).map(([Icon, text, tone], i) => (
              <li key={i} className="flex items-center gap-3 rounded-2xl bg-white/10 p-2.5 pe-4 text-[15px] text-white/95 ring-1 ring-inset ring-white/15 backdrop-blur-md">
                <IconTile icon={Icon} tone={tone} size={36} />{text}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex flex-col">
        <div className="flex justify-end gap-1 p-4"><LanguageMenu /><ThemeToggle /></div>
        <div className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-sm rounded-[28px] border bg-card p-7 sm:p-8">
            <img src="/youth_capital_logo_light.svg" alt="Youth Capital" className="mb-8 h-10 w-auto dark:hidden lg:hidden" />
            <img src="/youth_capital_logo_dark.svg" alt="Youth Capital" className="mb-8 hidden h-10 w-auto dark:block lg:dark:hidden" />
            <h2 className="text-[28px] font-bold tracking-tight">{t("Sign in")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("Use your Youth Capital account.")}</p>

            {(providers.data?.google || providers.data?.linkedin) && (
              <div className="mt-6 grid gap-2">
                {providers.data.google && <Button variant="outline" type="button" onClick={() => oauth("google")}>{t("Continue with Google")}</Button>}
                {providers.data.linkedin && <Button variant="outline" type="button" onClick={() => oauth("linkedin")}>{t("Continue with LinkedIn")}</Button>}
                <div className="my-2 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />{t("or")}<span className="h-px flex-1 bg-border" /></div>
              </div>
            )}

            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
              <Field label={t("Email")} htmlFor="email">
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label={t("Password")} htmlFor="password">
                <div className="relative">
                  <Input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="pe-11" />
                  <button type="button" onClick={() => setShowPassword((s) => !s)} aria-pressed={showPassword}
                    aria-label={showPassword ? t("Hide password") : t("Show password")}
                    className="absolute end-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
              {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy || !email || !password}>
                {busy && <Loader2 className="animate-spin" />}{t("Sign in")}
              </Button>
            </form>

            <div className="mt-6 flex justify-between text-sm">
              <a className="text-primary hover:underline" href={`${SITE_URL}/forgot-password`}>{t("Forgot password?")}</a>
              <a className="text-primary hover:underline" href={`${SITE_URL}/apply`}>{t("Create an account")}</a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
