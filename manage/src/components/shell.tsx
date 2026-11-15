import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useTheme } from "next-themes";
import {
  Activity, Bell, Building2, CalendarDays, Check, CheckSquare, ChevronsUpDown, FolderKanban, Globe, HandCoins,
  HeartHandshake, LayoutDashboard, LogOut, Menu, Moon, Plus, Search, Settings, Sun, Trophy, Users, UsersRound, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGS, useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/format";
import { api } from "@/lib/api";
import { useOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org";
import { useSession, useSignOut } from "@/hooks/use-session";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DialogTitle } from "@/components/ui/dialog";
import { IconTile, PersonAvatar, type Tone } from "./primitives";

type NavItem = { href: string; label: string; icon: LucideIcon; tone: Tone; show?: boolean };

function useNav() {
  const { t } = useI18n();
  const { path, can } = useOrg();
  const main: NavItem[] = [
    { href: path(""), label: t("Dashboard"), icon: LayoutDashboard, tone: "blue" },
    { href: path("/members"), label: t("Members"), icon: Users, tone: "indigo" },
    { href: path("/committees"), label: t("Committees"), icon: UsersRound, tone: "violet" },
    { href: path("/projects"), label: t("Projects"), icon: FolderKanban, tone: "teal" },
    { href: path("/events"), label: t("Events"), icon: CalendarDays, tone: "pink" },
    { href: path("/tasks"), label: t("Tasks"), icon: CheckSquare, tone: "green" },
    { href: path("/performance"), label: t("Performance"), icon: Trophy, tone: "amber" },
    { href: path("/finance"), label: t("Finance"), icon: HandCoins, tone: "gold" },
    { href: path("/sponsors"), label: t("Sponsors"), icon: HeartHandshake, tone: "red", show: can("sponsors.manage") || can("sponsor.publish_update") || can("finance.view") },
    { href: path("/activity"), label: t("Activity"), icon: Activity, tone: "neutral" },
    { href: path("/settings"), label: t("Settings"), icon: Settings, tone: "neutral", show: can("org.manage") || can("roles.manage") || can("regions.manage") },
  ];
  return { main: main.filter((i) => i.show !== false) };
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const { org, me, path } = useOrg();
  const [location] = useLocation();
  const { main } = useNav();
  const isActive = (href: string) => (href === path("") ? location === href || location === `${href}/` : location.startsWith(href));

  return (
    // Frosted glass: white in light mode with the blue logo, dark in dark mode with the white logo.
    <div className="relative flex h-full flex-col overflow-hidden border border-white/70 bg-white/60 text-foreground backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-[rgb(24_26_36/0.6)] lg:rounded-[28px] lg:shadow-[0_20px_50px_-24px_rgb(30_64_175/0.35)]">
      <div className="px-5 pb-4 pt-6">
        <img src="/youth_capital_logo_dark.svg" alt="Youth Capital" className="h-11 w-auto dark:hidden" />
        <img src="/youth_capital_logo_light.svg" alt="Youth Capital" className="hidden h-11 w-auto dark:block" />
        <div className="mt-4 flex items-center gap-2.5 rounded-2xl bg-muted p-2">
          {org.logoUrl
            ? <img src={org.logoUrl} alt="" className="size-8 rounded-[10px] bg-white object-contain p-0.5 ring-1 ring-black/5" />
            : <span className="brand-surface grid size-8 place-items-center rounded-[10px] text-xs font-bold text-white">{org.name.slice(0, 2).toUpperCase()}</span>}
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold leading-tight">{org.name}</div>
            <div className="text-[11px] font-medium text-muted-foreground">{t("Workspace")}</div>
          </div>
        </div>
      </div>

      <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-3 pb-3" aria-label={t("Main navigation")}>
        {main.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-2xl px-2 py-1.5 text-[14px] font-medium transition-all duration-200",
                active ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/15 dark:bg-white/10 dark:text-white dark:ring-white/15" : "text-foreground/80 hover:bg-muted hover:text-foreground",
              )}
            >
              <IconTile icon={item.icon} tone={item.tone} size={30} />
              <span className={cn(active && "font-semibold")}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3">
        <div className="rounded-2xl bg-muted px-3 py-2.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("Your role")}</div>
          <div className="truncate text-sm font-semibold">{me.role.name}</div>
          {me.title && me.title !== me.role.name && <div className="truncate text-xs text-muted-foreground">{me.title}</div>}
        </div>
      </div>
    </div>
  );
}

function NotificationsButton() {
  const { t, lang } = useI18n();
  const { path } = useOrg();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const q = useOrgQuery<{ notifications: any[]; unread: number }>("/notifications", { refetchInterval: 60_000 });
  const markRead = useOrgMutation((ids: number[] | undefined, base) => api.post(`${base}/notifications/read`, { ids }), { silentError: true });
  const unread = q.data?.unread ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="relative grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("Notifications")}>
          <Bell className="size-[18px]" />
          {unread > 0 && (
            <span className="absolute end-1 top-1 grid min-w-4 place-items-center rounded-full bg-st-red px-1 text-[10px] font-semibold leading-4 text-white">{unread > 9 ? "9+" : unread}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">{t("Notifications")}</span>
          {unread > 0 && (
            <button className="text-xs font-medium text-primary hover:underline" onClick={() => markRead.mutate(undefined)}>{t("Mark all as read")}</button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {(q.data?.notifications ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("You're all caught up.")}</p>
          ) : (
            q.data!.notifications.map((n) => (
              <button
                key={n.id}
                className={cn("flex w-full gap-3 border-b border-border px-4 py-3 text-start last:border-0 hover:bg-muted/60", !n.readAt && "bg-primary/[0.04]")}
                onClick={() => {
                  if (!n.readAt) markRead.mutate([n.id]);
                  if (n.link) navigate(path(n.link));
                  setOpen(false);
                }}
              >
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} />
                <span className="min-w-0">
                  <span className="block text-sm text-foreground">{n.title}</span>
                  {n.body && <span className="line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>}
                  <span className="mt-0.5 block text-xs text-muted-foreground">{relativeTime(n.createdAt, lang)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { path } = useOrg();
  const [, navigate] = useLocation();
  const { main } = useNav();
  const projects = useOrgQuery<{ projects: any[] }>("/projects", { enabled: open });
  const tasks = useOrgQuery<{ tasks: any[] }>("/tasks?open=true", { enabled: open });
  const people = useOrgQuery<{ people: any[] }>("/people", { enabled: open });
  const go = (href: string) => { navigate(href); onOpenChange(false); };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle className="sr-only">{t("Search")}</DialogTitle>
      <CommandInput placeholder={t("Search pages, projects, tasks, people…")} />
      <CommandList>
        <CommandEmpty>{t("No results.")}</CommandEmpty>
        <CommandGroup heading={t("Go to")}>
          {main.map((i) => (
            <CommandItem key={i.href} value={`page ${i.label}`} onSelect={() => go(i.href)}><i.icon className="size-4" />{i.label}</CommandItem>
          ))}
        </CommandGroup>
        {(projects.data?.projects ?? []).length > 0 && (
          <CommandGroup heading={t("Projects")}>
            {projects.data!.projects.slice(0, 30).map((p) => (
              <CommandItem key={p.id} value={`project ${p.title} ${p.id}`} onSelect={() => go(path(`/projects/${p.id}`))}><FolderKanban className="size-4" />{p.title}</CommandItem>
            ))}
          </CommandGroup>
        )}
        {(tasks.data?.tasks ?? []).length > 0 && (
          <CommandGroup heading={t("Open tasks")}>
            {tasks.data!.tasks.slice(0, 40).map((x) => (
              <CommandItem key={x.id} value={`task ${x.title} ${x.id}`} onSelect={() => go(path(`/tasks/${x.id}`))}><CheckSquare className="size-4" />{x.title}</CommandItem>
            ))}
          </CommandGroup>
        )}
        {(people.data?.people ?? []).length > 0 && (
          <CommandGroup heading={t("People")}>
            {people.data!.people.slice(0, 40).map((p) => (
              <CommandItem key={p.membershipId} value={`person ${p.fullName} ${p.membershipId}`} onSelect={() => go(path(`/members/${p.membershipId}`))}>
                <PersonAvatar name={p.fullName} url={p.avatarUrl} size={18} />{p.fullName}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}

function OrgUserMenu() {
  const { t } = useI18n();
  const { org } = useOrg();
  const { user } = useSession();
  const signOut = useSignOut();
  const [, navigate] = useLocation();
  const orgs = useQuery({ queryKey: ["my-orgs"], queryFn: () => api.get<{ organisations: any[]; canCreate: boolean }>("/api/org") });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-2 rounded-full bg-muted py-1 pe-2.5 ps-1 text-sm transition-colors hover:bg-secondary">
          <PersonAvatar name={user?.fullName} url={user?.avatarUrl} size={28} />
          <span className="hidden max-w-36 truncate font-medium md:inline">{user?.fullName}</span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{user?.fullName}</div>
          <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{t("Organisations")}</DropdownMenuLabel>
        {(orgs.data?.organisations ?? []).map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => navigate(`/o/${o.slug}`)}>
            <Building2 className="size-4" />
            <span className="flex-1 truncate">{o.name}</span>
            {o.slug === org.slug && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        {orgs.data?.canCreate && (
          <DropdownMenuItem onSelect={() => navigate("/new")}><Plus className="size-4" />{t("New organisation")}</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} className="text-destructive focus:text-destructive"><LogOut className="size-4" />{t("Sign out")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LanguageMenu({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn("flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground", className)} aria-label={t("Language")}>
          <Globe className="size-[18px]" />
          <span className="text-xs font-semibold uppercase">{lang}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LANGS.map((l) => (
          <DropdownMenuItem key={l.code} onSelect={() => setLang(l.code)}>
            <span className="flex-1">{l.label}</span>
            {lang === l.code && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThemeToggle() {
  const { t } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={dark ? t("Switch to light mode") : t("Switch to dark mode")}
    >
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t, dir } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [location]);
  const isMac = useMemo(() => /Mac|iPhone|iPad/.test(navigator.platform), []);

  return (
    <div className="flex min-h-screen">
      {/* Floating glass-blue sidebar, inset from the window edge like macOS. */}
      <aside className="sticky top-0 hidden h-screen w-[17.5rem] shrink-0 p-3 pe-0 lg:block print:hidden"><SidebarBody /></aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side={dir === "rtl" ? "right" : "left"} className="w-72 border-none bg-transparent p-0">
          <SheetTitle className="sr-only">{t("Navigation")}</SheetTitle>
          <SidebarBody onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass-bar sticky top-0 z-30 mx-3 mt-3 flex h-14 items-center gap-2 rounded-2xl border border-white/60 px-2 shadow-[0_8px_24px_-12px_rgb(30_64_175/0.25)] dark:border-white/10 sm:mx-6 sm:px-3 print:hidden">
          <button type="button" className="grid size-9 place-items-center rounded-xl text-muted-foreground hover:bg-muted lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t("Open menu")}>
            <Menu className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl bg-muted px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary sm:max-w-md"
          >
            <Search className="size-4 shrink-0" />
            <span className="truncate">{t("Search anything…")}</span>
            <kbd className="ms-auto hidden rounded border border-border bg-muted px-1.5 font-mono text-[10px] sm:inline">{isMac ? "⌘" : "Ctrl"} K</kbd>
          </button>
          <div className="ms-auto flex items-center gap-1">
            <NotificationsButton />
            <LanguageMenu className="hidden sm:flex" />
            <ThemeToggle />
            <div className="ms-1"><OrgUserMenu /></div>
          </div>
        </header>
        <main className="flex-1 px-3 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1400px] space-y-6">{children}</div>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

