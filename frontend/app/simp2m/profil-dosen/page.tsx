import { getWorkspaceSession } from "../session";
import { LecturerProfileSettings } from "../pengaturan/lecturer-profile";

export const metadata = { title: "Profil Dosen SIM-P2M" };

export default async function LecturerProfilePage() {
  const { user, institutions } = await getWorkspaceSession();
  if (!user) return null;
  const institutionId = user.institutionId || institutions[0]?.id || 0;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profil Dosen</h1>
        <p className="text-sm text-muted-foreground">
          Kelola NUPTK dan Jabatan Fungsional untuk pengecekan kelayakan otomatis saat pengajuan hibah penelitian dan pengabdian.
        </p>
      </div>
      {institutionId > 0 ? (
        <div className="max-w-2xl">
          <LecturerProfileSettings institutionId={institutionId} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Akun Anda belum terhubung ke institusi aktif mana pun. Hubungi admin institusi untuk menghubungkan akun Anda.
        </p>
      )}
    </section>
  );
}

