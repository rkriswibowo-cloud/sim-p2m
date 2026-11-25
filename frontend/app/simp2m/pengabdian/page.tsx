import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getWorkspaceSession } from "../session";
import { ResearchTabs } from "../penelitian/tabs";
import { CommunityPanel } from "./view";

export default async function CommunityPage({ searchParams }: PageProps<"/simp2m/pengabdian">) {
  const { user, institutions } = await getWorkspaceSession();
  if (!user?.canCommunity) return <p role="alert" className="text-sm text-destructive">Akun ini belum punya izin Pengabdian kepada Masyarakat.</p>;
  const { tab } = await searchParams;
  const active = tab === "catatan-harian" || tab === "laporan-akhir" ? tab : "usulan";
  return <section className="space-y-4">
    <h1 className="text-2xl font-semibold tracking-tight">Pengabdian kepada Masyarakat</h1>
    <ResearchTabs active={active} community />
    {active === "usulan" ? <CommunityPanel institutions={institutions.filter(item => item.active && item.canCommunity)} /> :
      <Card className="workspace-panel">
        <CardHeader><CardTitle>{active === "catatan-harian" ? "Catatan Harian Pengabdian" : "Laporan Akhir Pengabdian"}</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">
          {active === "catatan-harian" ? "Pengisian catatan harian menunggu alur pelaksanaan PkM." : "Pengisian laporan akhir menunggu alur pelaporan PkM."}
        </p></CardContent>
      </Card>}
  </section>;
}
