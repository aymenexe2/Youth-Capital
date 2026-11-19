import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export type Organisation = {
  id: number; slug: string; name: string; description: string | null; logoUrl: string | null; primaryColor: string | null;
  defaultLanguage: string; currency: string; timezone: string; country: string;
  joiningFee?: string; annualFee?: string;
};
export type Me = {
  membershipId: number; title: string | null; regionId: number | null;
  role: { id: number; key: string; name: string };
  scope: "organisation" | "committee" | "region" | "assigned";
  permissions: string[]; committeeIds: number[]; headCommitteeIds: number[]; projectIds: number[]; managedProjectIds: number[];
  verified?: boolean;
};
export type Person = { membershipId: number; fullName: string; avatarUrl: string | null; title: string | null; regionId: number | null };

type OrgCtx = {
  slug: string;
  org: Organisation;
  me: Me;
  can: (perm: string) => boolean;
  orgWide: boolean;
  path: (p?: string) => string;
};

const OrgContext = createContext<OrgCtx | null>(null);

export function OrgProvider({ slug, org, me, children }: { slug: string; org: Organisation; me: Me; children: ReactNode }) {
  const can = useCallback((perm: string) => me.permissions.includes(perm), [me]);
  const value: OrgCtx = {
    slug, org, me, can,
    orgWide: me.scope === "organisation",
    path: (p = "") => `/o/${slug}${p}`,
  };
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used inside OrgProvider");
  return ctx;
}

// GET /api/org/:slug{path}, cached per organisation.
export function useOrgQuery<T = any>(path: string, opts: Partial<UseQueryOptions<T>> = {}) {
  const { slug } = useOrg();
  return useQuery<T>({
    queryKey: ["org", slug, path],
    queryFn: () => api.get<T>(`/api/org/${slug}${path}`),
    staleTime: 20_000,
    ...opts,
  });
}

// Mutations refresh every query for the organisation — lists, counts and the
// dashboard all stay consistent without hand-maintained cache keys.
export function useOrgMutation<TVars = any, TData = any>(
  fn: (vars: TVars, base: string) => Promise<TData>,
  opts: { success?: string; onSuccess?: (data: TData, vars: TVars) => void; silentError?: boolean } = {},
) {
  const { slug } = useOrg();
  const qc = useQueryClient();
  const { t } = useI18n();
  return useMutation({
    mutationFn: (vars: TVars) => fn(vars, `/api/org/${slug}`),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["org", slug] });
      if (opts.success) toast.success(t(opts.success));
      opts.onSuccess?.(data, vars);
    },
    onError: (err) => {
      if (!opts.silentError) toast.error(errorMessage(err, t("Something went wrong")));
    },
  });
}

// Shared lookups used across pages (pickers, names, colours).
export function usePeople() {
  const q = useOrgQuery<{ people: Person[] }>("/people", { staleTime: 60_000 });
  const people = q.data?.people ?? [];
  return { people, byId: new Map(people.map((p) => [p.membershipId, p])), isLoading: q.isLoading };
}

export type Committee = {
  id: number; name: string; description: string | null; kind: string; color: string | null; archivedAt: string | null;
  memberCount: number; activeProjectCount: number; heads: { membershipId: number; fullName: string; avatarUrl: string | null }[]; isMine: boolean;
};
export function useCommittees() {
  const q = useOrgQuery<{ committees: Committee[] }>("/committees", { staleTime: 60_000 });
  const committees = q.data?.committees ?? [];
  return { committees, byId: new Map(committees.map((c) => [c.id, c])), isLoading: q.isLoading };
}

export type Region = { id: number; name: string; kind: string; parentId: number | null; code: string | null; memberCount: number };
export function useRegions() {
  const q = useOrgQuery<{ regions: Region[] }>("/regions", { staleTime: 60_000 });
  const regions = q.data?.regions ?? [];
  return { regions, byId: new Map(regions.map((r) => [r.id, r])), isLoading: q.isLoading };
}

export type Role = { id: number; key: string; name: string; description: string | null; permissions: string[]; scope: string; isSystem: boolean; memberCount: number };
export function useRoles() {
  const q = useOrgQuery<{ roles: Role[] }>("/roles", { staleTime: 60_000 });
  return { roles: q.data?.roles ?? [], isLoading: q.isLoading };
}
