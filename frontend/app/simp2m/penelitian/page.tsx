import { ReportsPanel } from "../laporan/view";
import { getWorkspaceSession } from "../session";
import { ResearchAchievements } from "./achievements";
import { ResearchJournal } from "./journal";
import { ResearchPanel } from "./view";
import { ResearchTabs } from "./tabs";

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { user, institutions } = await getWorkspaceSession();
  if (!user?.canResearch) return <p role="alert" className="text-sm text-destructive">Akun ini belum punya izin Penelitian.</p>;
  const { tab } = await searchParams;
  const active = tab === "catatan-harian" || tab === "laporan-kemajuan" || tab === "laporan-akhir" || tab === "capaian-terkini" ? tab : "usulan";
  const researchInstitutions = institutions.filter(item => item.active && item.canResearch);
  return <section className="space-y-4">
    <h1 className="text-2xl font-semibold tracking-tight">Penelitian</h1>
    <ResearchTabs active={active} />
    {active === "usulan" ? <ResearchPanel /> : active === "catatan-harian" ?
      <ResearchJournal institutions={researchInstitutions} /> : active === "capaian-terkini" ?
      <ResearchAchievements institutions={researchInstitutions} /> :
      user.canReports ? <ReportsPanel key={active} institutions={institutions.filter(item => item.active && item.canResearch && item.canReports)} onlyKind={active === "laporan-kemajuan" ? "progress" : "final"} /> :
      <p role="alert" className="text-sm text-muted-foreground">Akun ini memerlukan izin Laporan untuk mengelola draf.</p>}
  </section>;
}
