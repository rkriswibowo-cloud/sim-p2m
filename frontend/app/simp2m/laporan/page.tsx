import { getWorkspaceSession } from "../session";
import { ReportsPanel } from "./view";

export const metadata = { title: "Laporan SIM-P2M" };

export default async function ReportsPage() {
  const { user, institutions } = await getWorkspaceSession();
  if (!user?.canReports) return <p role="alert">Akun ini belum punya izin Laporan.</p>;
  return <ReportsPanel institutions={institutions.filter(item => item.active && item.canReports)} />;
}
