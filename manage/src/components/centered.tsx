import type { ReactNode } from "react";
import { LanguageMenu, ThemeToggle } from "./shell";

// Layout for pages outside an organisation (picker, invitation, creation).
export function CenteredPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <img src="/youth_capital_logo_light.svg" alt="Youth Capital" className="h-9 w-auto dark:hidden" />
        <img src="/youth_capital_logo_dark.svg" alt="Youth Capital" className="hidden h-9 w-auto dark:block" />
        <div className="flex gap-1"><LanguageMenu /><ThemeToggle /></div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-8 sm:pt-16">
        <div className="w-full max-w-lg">{children}</div>
      </main>
    </div>
  );
}
