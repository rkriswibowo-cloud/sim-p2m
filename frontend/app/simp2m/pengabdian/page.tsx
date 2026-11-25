import { getWorkspaceSession } from "../session";
import { CommunityPanel } from "./view";

export default async function CommunityPage() {
  const { user, institutions } = await getWorkspaceSession();
  if (!user?.canCommunity) return <p role="alert" className="text-sm text-destructive">Akun ini belum punya izin Pengabdian kepada Masyarakat.</p>;
  return <CommunityPanel institutions={institutions.filter(item => item.active && item.canCommunity)} />;
}
