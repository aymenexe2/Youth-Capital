// Public URLs this app links to. VITE_API_URL is the shared backend; the
// public site hosts account creation and password reset.
export const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
export const SITE_URL = (import.meta.env.VITE_SITE_URL || "https://www.youthcapital.org").replace(/\/+$/, "");
