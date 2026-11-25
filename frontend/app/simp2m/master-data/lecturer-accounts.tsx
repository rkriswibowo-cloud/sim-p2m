"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { workspaceToastOptions } from "../confirm-removal";

interface LecturerAccountRow {
  id: number;
  code: string;
  name: string;
  email: string;
  nuptk: string;
  jafung: string;
  studyProgram: string;
  active: boolean;
  userId: number | null;
  userEmail: string;
}

const jafungLabels: Record<string, string> = {
  "": "Belum diatur",
  tenaga_pengajar: "Tenaga Pengajar",
  asisten_ahli: "Asisten Ahli",
  lektor: "Lektor",
  lektor_kepala: "Lektor Kepala",
  guru_besar: "Guru Besar",
};

export function LecturerAccountsPanel({ institutionId }: { institutionId: number | string }) {
  const [rows, setRows] = useState<LecturerAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [target, setTarget] = useState<LecturerAccountRow | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const loadRows = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch(`/api/v1/iam/institutions/${institutionId}/lecturers-with-accounts`, {
      cache: "no-store",
      signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error ?? "Gagal memuat daftar akun dosen.");
    }
    return Array.isArray(body) ? (body as LecturerAccountRow[]) : [];
  }, [institutionId]);

  useEffect(() => {
    const controller = new AbortController();
    loadRows(controller.signal)
      .then(data => {
        setRows(data);
        setError("");
      })
      .catch(err => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Gagal memuat daftar akun dosen.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loadRows]);

  function openLinkForm(row: LecturerAccountRow) {
    setTarget(row);
    setEmail(row.userEmail || row.email || "");
    setPassword("");
    setError("");
  }

  async function handleLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/iam/institutions/${institutionId}/lecturers/${target.id}/link-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Gagal menghubungkan akun dosen.");
      const updated = await loadRows();
      setRows(updated);
      setTarget(null);
      setPassword("");
      toast.success(`Akun dosen ${target.name} berhasil dihubungkan.`, workspaceToastOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal menghubungkan akun dosen.";
      setError(message);
      toast.error(message, workspaceToastOptions);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="workspace-panel rounded-md">
      <CardHeader>
        <CardTitle>Koneksi Akun Login Dosen (1 Akun = 1 Dosen)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Hubungkan setiap data dosen ke satu akun login agar dosen dapat mengakses menu Penelitian, Pengabdian, Hibah, dan mengedit NUPTK serta Jabatan Fungsional secara mandiri.
        </p>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {target && (
          <form onSubmit={e => void handleLink(e)} className="space-y-3 rounded-md border border-border bg-background p-3">
            <div className="text-sm font-medium">
              Hubungkan akun untuk: {target.name} ({target.code})
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Email akun login"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="dosen@kampus.ac.id"
              />
              <Input
                label="Kata sandi (jika membuat akun baru)"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min. 12 karakter (kosongkan jika akun sudah ada)"
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setTarget(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Menyimpan..." : "Simpan koneksi akun"}
              </Button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Memuat daftar koneksi akun dosen...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada data dosen pada institusi ini.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-3">Kode / NIDN</th>
                  <th className="py-2 pr-3">Nama Dosen</th>
                  <th className="py-2 pr-3">NUPTK</th>
                  <th className="py-2 pr-3">Jabatan Fungsional</th>
                  <th className="py-2 pr-3">Akun Login</th>
                  <th className="py-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs">{row.code}</td>
                    <td className="py-2 pr-3 font-medium">{row.name}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{row.nuptk || "-"}</td>
                    <td className="py-2 pr-3">{jafungLabels[row.jafung] ?? (row.jafung || "Belum diatur")}</td>
                    <td className="py-2 pr-3">
                      {row.userId ? (
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{row.userEmail}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Belum terhubung</span>
                      )}
                    </td>
                    <td className="py-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => openLinkForm(row)}>
                        {row.userId ? "Ganti akun" : "Hubungkan akun"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

