import { BrandCredit } from "@/components/layout/footer";
import { cookies } from "next/headers";
import { getWorkspaceSession } from "./session";
import { WorkspaceShell } from "./workspace-shell";
import { WorkspacePreferences } from "./workspace-preferences";
import "./workspace.css";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { user, institutions } = await getWorkspaceSession();
  const preferences = await cookies();
  const theme = preferences.get("simp2m_theme")?.value;
  const date = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeZone: "Asia/Jakarta" }).format(new Date());
  return (
    <WorkspacePreferences initialTheme={theme === "light" || theme === "system" ? theme : "dark"} initialCollapsed={preferences.get("simp2m_sidebar")?.value === "collapsed"}>
    <WorkspaceShell
      name={user?.name}
      institution={user?.institution}
      system={user?.role === "superadmin"}
      canAccess={institutions.some(item => item.canRead) || user?.role === "superadmin"}
      canAudit={institutions.some(item => item.canAudit) || user?.role === "superadmin"}
      canMaster={user?.canMaster ?? false}
      canGrant={user?.canGrant ?? false}
      canResearch={user?.canResearch ?? false}
      canCommunity={user?.canCommunity ?? false}
      canDocuments={user?.canDocuments ?? false}
      canReports={user?.canReports ?? false}
      canSelection={user?.canSelection ?? false}
      date={date}
      footer={<BrandCredit />}
    >
      {user ? children : <p role="alert" className="rounded-xl border border-border bg-card p-5 text-destructive">Layanan akun belum dapat dihubungi. Muat ulang halaman untuk mencoba lagi.</p>}
    </WorkspaceShell>
    </WorkspacePreferences>
  );
}
