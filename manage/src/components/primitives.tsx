import type { ReactNode } from "react";
import { AlertTriangle, Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { initials } from "@/lib/format";
import { EVENT_STATUS, MEMBERSHIP_STATUS, PRIORITY, PROJECT_STATUS, TASK_STATUS } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export type Tone = "neutral" | "blue" | "violet" | "amber" | "green" | "red" | "gold" | "teal" | "indigo" | "pink";

const TONE: Record<Tone, string> = {
  neutral: "text-st-neutral bg-st-neutral/10 ring-st-neutral/20",
  blue: "text-st-blue bg-st-blue/10 ring-st-blue/20",
  violet: "text-st-violet bg-st-violet/10 ring-st-violet/25",
  amber: "text-st-amber bg-st-amber/10 ring-st-amber/25",
  green: "text-st-green bg-st-green/10 ring-st-green/20",
  red: "text-st-red bg-st-red/10 ring-st-red/20",
  gold: "text-gold bg-gold-soft ring-gold/25",
  teal: "text-st-teal bg-st-teal/10 ring-st-teal/20",
  indigo: "text-st-indigo bg-st-indigo/10 ring-st-indigo/20",
  pink: "text-st-pink bg-st-pink/10 ring-st-pink/20",
};

// iOS-style gradient icon tiles and soft tinted card washes per tone.
const ICON_GRADIENT: Record<Tone, string> = {
  neutral: "from-[#a1a1a6] to-[#6e6e73]",
  blue: "from-[#5ac8fa] to-[#007aff]",
  violet: "from-[#da8fff] to-[#af52de]",
  amber: "from-[#ffcc00] to-[#ff9500]",
  green: "from-[#7ee787] to-[#34c759]",
  red: "from-[#ff8a80] to-[#ff3b30]",
  gold: "from-[#ffd60a] to-[#c8962b]",
  teal: "from-[#64d2ff] to-[#30b0c7]",
  indigo: "from-[#7d7aff] to-[#5856d6]",
  pink: "from-[#ff8fab] to-[#ff2d55]",
};
const CARD_WASH: Record<Tone, string> = {
  neutral: "from-white/0", blue: "from-[#007aff]/[0.10]", violet: "from-[#af52de]/[0.10]", amber: "from-[#ff9500]/[0.10]",
  green: "from-[#34c759]/[0.10]", red: "from-[#ff3b30]/[0.10]", gold: "from-[#ffcc00]/[0.12]", teal: "from-[#30b0c7]/[0.10]",
  indigo: "from-[#5856d6]/[0.10]", pink: "from-[#ff2d55]/[0.10]",
};

export function IconTile({ icon: Icon, tone = "blue", size = 44 }: { icon: LucideIcon; tone?: Tone; size?: number }) {
  return (
    <span
      className={cn("grid shrink-0 place-items-center bg-gradient-to-br text-white shadow-[0_4px_12px_-4px_rgb(0_0_0/0.25)] ring-1 ring-inset ring-white/20", ICON_GRADIENT[tone])}
      style={{ width: size, height: size, borderRadius: size * 0.28 }}
    >
      <Icon style={{ width: size * 0.46, height: size * 0.46 }} strokeWidth={2.2} />
    </span>
  );
}
export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-st-neutral", blue: "bg-st-blue", violet: "bg-st-violet", amber: "bg-st-amber", green: "bg-st-green", red: "bg-st-red", gold: "bg-gold",
  teal: "bg-st-teal", indigo: "bg-st-indigo", pink: "bg-st-pink",
};

export function Pill({ tone = "neutral", children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONE[tone], className)}>
      {dot && <span className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />}
      {children}
    </span>
  );
}

export const TASK_TONE: Record<string, Tone> = {
  backlog: "neutral", todo: "neutral", in_progress: "blue", in_review: "violet", completed: "green", blocked: "red", cancelled: "neutral",
};
export const PROJECT_TONE: Record<string, Tone> = {
  draft: "neutral", planned: "blue", active: "green", on_hold: "amber", completed: "violet", cancelled: "neutral",
};
const EVENT_TONE: Record<string, Tone> = { planned: "blue", confirmed: "green", completed: "violet", cancelled: "neutral" };
const MEMBERSHIP_TONE: Record<string, Tone> = { active: "green", inactive: "amber", suspended: "red", left: "neutral" };
export const PRIORITY_TONE: Record<string, Tone> = { low: "neutral", medium: "blue", high: "amber", urgent: "red" };

const STATUS_SETS = {
  task: [TASK_STATUS, TASK_TONE],
  project: [PROJECT_STATUS, PROJECT_TONE],
  event: [EVENT_STATUS, EVENT_TONE],
  membership: [MEMBERSHIP_STATUS, MEMBERSHIP_TONE],
} as const;

export function StatusPill({ kind, status }: { kind: keyof typeof STATUS_SETS; status: string }) {
  const { t } = useI18n();
  const [labels, tones] = STATUS_SETS[kind];
  return <Pill tone={(tones as Record<string, Tone>)[status] ?? "neutral"} dot>{t((labels as Record<string, string>)[status] ?? status)}</Pill>;
}

export function PriorityPill({ priority }: { priority: string }) {
  const { t } = useI18n();
  return <Pill tone={PRIORITY_TONE[priority] ?? "neutral"}>{t(PRIORITY[priority] ?? priority)}</Pill>;
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium text-muted-foreground">{eyebrow}</div>}
        <h1 className="text-[28px] font-bold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, action, children, className, bodyClassName, icon: Icon }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; icon?: LucideIcon;
}) {
  return (
    <section className={cn("rounded-2xl border bg-card", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3.5 sm:px-5">
          <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-foreground">
            {Icon && <Icon className="size-[18px] shrink-0 text-primary" />}
            <span className="truncate">{title}</span>
          </h2>
          {action}
        </header>
      )}
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatCard({ label, value, icon: Icon, tone = "blue", hint, onClick }: {
  label: string; value: ReactNode; icon: LucideIcon; tone?: Tone; hint?: ReactNode; onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-4 overflow-hidden rounded-2xl border bg-card bg-gradient-to-br to-transparent p-4 text-start",
        CARD_WASH[tone],
        onClick && "transition-transform duration-200 hover:-translate-y-0.5 focus-visible:-translate-y-0.5",
      )}
    >
      <IconTile icon={Icon} tone={tone} size={48} />
      <span className="min-w-0">
        <span className="block text-[26px] font-bold leading-tight tracking-tight tabular text-foreground">{value}</span>
        <span className="block truncate text-[13px] font-medium text-muted-foreground">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </Comp>
  );
}

export function PersonAvatar({ name, url, size = 28, className }: { name?: string | null; url?: string | null; size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-secondary font-semibold text-secondary-foreground ring-2 ring-card", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
      title={name ?? undefined}
    >
      {url ? <img src={url} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : initials(name)}
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 26 }: { people: { fullName: string; avatarUrl?: string | null }[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  return (
    <span className="flex items-center -space-x-1.5 rtl:space-x-reverse">
      {shown.map((p, i) => <PersonAvatar key={i} name={p.fullName} url={p.avatarUrl} size={size} />)}
      {people.length > max && (
        <span className="inline-grid place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-card" style={{ width: size, height: size }}>
          +{people.length - max}
        </span>
      )}
    </span>
  );
}

export function ProgressBar({ value, tone = "blue", className }: { value: number; tone?: Tone; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full bg-gradient-to-r transition-[width] duration-500", ICON_GRADIENT[tone])} style={{ width: `${v}%` }} />
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: {
  icon?: LucideIcon; title: string; description?: string; action?: ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      <IconTile icon={Icon} tone="neutral" size={44} />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-8 text-center">
      <AlertTriangle className="size-5 text-destructive" />
      <p className="text-sm text-foreground">{message || t("This couldn't be loaded.")}</p>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>{t("Try again")}</Button>}
    </div>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor, required }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
        {label}{required && <span className="text-destructive"> *</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-end font-medium text-foreground">{children}</dd>
    </div>
  );
}
