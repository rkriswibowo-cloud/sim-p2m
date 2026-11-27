import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export interface Identity {
  name: string;
  email: string;
  institution: string;
  institutionId: number;
  role: "superadmin" | "member";
  canAccess: boolean;
  canMaster: boolean;
  canGrant: boolean;
  canResearch: boolean;
  canCommunity: boolean;
  canDocuments: boolean;
  canReports: boolean;
  canSelection: boolean;
}

export interface InstitutionAccess {
  id: number;
  name: string;
  active: boolean;
  canResearch: boolean;
  canCommunity: boolean;
  canDocuments: boolean;
  canReports: boolean;
  canRead: boolean;
  canAudit: boolean;
  canMasterRead: boolean;
  canVerify?: boolean;
  canReview?: boolean;
  canDecide?: boolean;
}

export const getWorkspaceSession = cache(async () => {
  const session = await cookies();
  const access = session.get("simp2m_access")?.value;
  const login = session.has("simp2m_refresh") ? "/login?renew=1" : "/login";
  if (!access) redirect(login);
  const cookie = `simp2m_access=${encodeURIComponent(access)}`;
  const origin = process.env.SIMP2M_API_ORIGIN ?? "http://127.0.0.1:8080";
  async function request<T>(path: string, signal = AbortSignal.timeout(4000)): Promise<T | undefined> {
    try {
      const response = await fetch(new URL(path, origin), {
        headers: { Cookie: cookie },
        cache: "no-store",
        signal,
      });
      if (response.status === 401) return undefined;
      if (response.ok) return await response.json() as T;
    } catch { /* Keep the workspace usable when a service is temporarily unavailable. */ }
  }
  let response: Response | undefined;
  try {
    response = await fetch(new URL("/api/v1/me", origin), {
      headers: { Cookie: cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
  } catch { /* Report the unavailable service from the layout. */ }
  if (response?.status === 401) redirect(login);
  const user = response?.ok ? await response.json() as Identity : undefined;
  const institutions = user && (user.canAccess || user.canMaster || user.canGrant || user.canResearch || user.canCommunity || user.canDocuments || user.canReports || user.canSelection)
    ? await request<{ items: InstitutionAccess[] }>("/api/v1/iam/institutions")
    : undefined;
  return { user, institutions: institutions?.items ?? [], request };
});
