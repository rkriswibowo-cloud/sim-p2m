import { getWorkspaceSession } from "../session";
import { GrantPanel } from "./view";

export default async function GrantPage() {
  const { user } = await getWorkspaceSession();
  if (!user?.canGrant) return <p role="alert" className="text-sm text-destructive">Akun ini belum punya izin melihat Hibah.</p>;
  return <GrantPanel />;
}
