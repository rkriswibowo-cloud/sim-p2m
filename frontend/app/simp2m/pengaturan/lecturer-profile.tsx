"use client";

import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, fieldClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { workspaceToastOptions } from "../confirm-removal";

interface LecturerProfile {
  linked: boolean;
  lecturerId: number;
  code: string;
  name: string;
  email: string;
  phone: string;
  nuptk: string;
  jafung: string;
  studyProgram: string;
  active: boolean;
  profileLocked: boolean;
}

export const jafungOptions = [
  { value: "", label: "Belum diatur" },
  { value: "tenaga_pengajar", label: "Tenaga Pengajar" },
  { value: "asisten_ahli", label: "Asisten Ahli" },
  { value: "lektor", label: "Lektor" },
  { value: "lektor_kepala", label: "Lektor Kepala" },
  { value: "guru_besar", label: "Guru Besar" },
] as const;

export function LecturerProfileSettings({ institutionId }: { institutionId: number }) {
  const [profile, setProfile] = useState<LecturerProfile | null>(null);
  const [nuptk, setNuptk] = useState("");
  const [phone, setPhone] = useState("");
  const [jafung, setJafung] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/iam/institutions/${institutionId}/my-lecturer-profile`, { cache: "no-store" })
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Gagal memuat profil dosen.");
        return body as LecturerProfile;
      })
      .then(data => {
        if (cancelled) return;
        setProfile(data);
        setNuptk(data.nuptk ?? "");
        setPhone(data.phone ?? "");
        setJafung(data.jafung ?? "");
        setError("");
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Gagal memuat profil dosen.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [institutionId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/iam/institutions/${institutionId}/my-lecturer-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nuptk: nuptk.trim(), phone: phone.trim(), jafung }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? body.error ?? "Gagal menyimpan profil dosen.");
      setProfile(current => current && { ...current, nuptk: nuptk.trim(), phone: phone.trim(), jafung });
      toast.success("Profil dosen berhasil diperbarui.", workspaceToastOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal menyimpan profil dosen.";
      setError(message);
      toast.error(message, workspaceToastOptions);
    } finally {
      setSaving(false);
    }
  }

  const editable = !!profile?.active && !profile.profileLocked;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profil Dosen (NUPTK &amp; Jabatan Fungsional)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <p className="text-sm text-muted-foreground">Memuat profil dosen...</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!loading && profile && !profile.linked && (
          <p className="text-sm text-muted-foreground">
            Profil dosen belum tersedia. Hubungi admin untuk memeriksa data dan email Anda di Master Data Dosen.
          </p>
        )}
        {!loading && profile?.linked && (
          <>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Nama Dosen</dt>
                <dd className="font-medium">{profile.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Kode / NIDN</dt>
                <dd className="font-medium">{profile.code}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Program Studi</dt>
                <dd className="font-medium">{profile.studyProgram || "-"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Email Dosen</dt>
                <dd className="font-medium break-all">{profile.email || "-"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status Dosen</dt>
                <dd className="font-medium">{profile.active ? "Aktif" : "Nonaktif"}</dd>
              </div>
            </dl>
            {profile.profileLocked && <p className="text-sm font-medium">Profil dikunci oleh admin.</p>}
            <form onSubmit={e => void handleSubmit(e)} className="space-y-3 border-t border-border pt-3">
              <Input
                label="NUPTK"
                name="nuptk"
                value={nuptk}
                onChange={e => setNuptk(e.target.value)}
                maxLength={64}
                disabled={!editable || saving}
                placeholder="Masukkan NUPTK dosen"
                hint="Diperlukan untuk pengecekan kelayakan otomatis saat pengajuan skema hibah."
              />
              <Input
                label="Nomor HP"
                name="phone"
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                maxLength={32}
                disabled={!editable || saving}
                placeholder="08xxxxxxxxxx"
              />
              <Field id="lecturer-jafung" label="Jabatan Fungsional">
                <select
                  id="lecturer-jafung"
                  name="jafung"
                  disabled={!editable || saving}
                  value={jafung}
                  onChange={e => setJafung(e.target.value)}
                  className={cn(fieldClass, "flex h-9 bg-background px-3 py-1")}
                >
                  {jafungOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              {editable && <Button data-action-tone="positive" type="submit" disabled={saving}>
                <Save size={15} aria-hidden="true" />
                {saving ? "Menyimpan..." : "Simpan profil dosen"}
              </Button>}
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}

