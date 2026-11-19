import { useI18n } from "@/lib/i18n";

// Same markup/styles as the splash in index.html, so loading the app → checking the
// session → signing in → opening the organisation reads as one continuous screen.
export function Splash() {
  const { t } = useI18n();
  return (
    <div className="yc-splash" role="status" aria-label={t("Loading")}>
      <img src="/youth_capital_logo_dark.svg" alt="Youth Capital" />
      <div className="yc-splash-label">{t("Workspace")}</div>
      <div className="yc-splash-bar" />
    </div>
  );
}
