import Link from "next/link";
import { ArrowUpRight, Building2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getWorkspaceSession } from "../session";
import { AppearanceSettings } from "./view";
import { LecturerProfileSettings } from "./lecturer-profile";

export const metadata = { title: "Pengaturan SIM-P2M" };

export default async function SettingsPage() {
  const { user } = await getWorkspaceSession();
  if (!user) return null;

  return <section className="space-y-4">
    <h1 className="text-2xl font-semibold tracking-tight">Pengaturan</h1>
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <div className="space-y-4">
        <AppearanceSettings />
        <LecturerProfileSettings institutionId={user.institutionId} />
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Akun dan institusi</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {[
                ["Nama", user.name],
                ["Email", user.email],
                ["Institusi", user.institution],
                ["Jenis akun", user.role === "superadmin" ? "Superadmin" : "Anggota"],
              ].map(([label, value]) => <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="wrap-anywhere font-medium">{value}</dd>
              </div>)}
            </dl>
          </CardContent>
        </Card>
        {user.role === "superadmin" && <Card>
          <CardHeader><CardTitle>Administrasi</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            <Link href="/simp2m/akses?section=institutions" className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm hover:bg-muted">
              <Building2 size={17} aria-hidden="true" /> Kelola institusi <ArrowUpRight className="ml-auto" size={15} aria-hidden="true" />
            </Link>
            <Link href="/simp2m/akses" className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm hover:bg-muted">
              <ShieldCheck size={17} aria-hidden="true" /> Kelola pengguna dan izin <ArrowUpRight className="ml-auto" size={15} aria-hidden="true" />
            </Link>
          </CardContent>
        </Card>}
      </div>
    </div>
  </section>;
}
