import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorStatus } from "@/lib/api";

export type SessionUser = { id: number; email: string; fullName: string; avatarUrl?: string | null; role: string };

// The signed-in Youth Capital account — the same session as the public site.
export function useSession() {
  const q = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        return await api.get<SessionUser>("/api/auth/me");
      } catch (err) {
        if (errorStatus(err) === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return { user: q.data ?? null, isLoading: q.isLoading, error: q.error };
}

export function useSignOut() {
  const qc = useQueryClient();
  return async () => {
    await api.post("/api/auth/logout").catch(() => {});
    qc.clear();
    window.location.href = "/login";
  };
}
