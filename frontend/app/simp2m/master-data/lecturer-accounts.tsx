"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, fieldClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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

interface SystemUserOption {
  id: number;
  email: string;
  name: string;
  linkedLecturerId: number | null;
  linkedLecturerName: string;
}

const jafungLabels: Record<string, string> = {
  "": "Belum diatur",
  tenaga_pengajar: "Tenaga Pengajar",
  asisten_ahli: "Asisten Ahli",
  lektor: "Lektor",
  lektor_kepala: "Lektor Kepala",
  guru_besar: "Guru Besar",
};

const pageSize = 25;

export function LecturerAccountsPanel({ institutionId }: { institutionId: number | string }) {
  const [rows, setRows] = useState<LecturerAccountRow[]>([]);
  const [users, setUsers] = useState<SystemUserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "unlinked" | "linked">("all");
  const [page, setPage] = useState(0);

  const [target, setTarget] = useState<LecturerAccountRow | null>(null);
  const [linkMode, setLinkMode] = useState<"existing" | "new">("existing");
  const [userQuery, setUserQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    const [lectRes, userRes] = await Promise.all([
      fetch(`/api/v1/iam/institutions/${institutionId}/lecturers-with-accounts`, { cache: "no-store", signal }),
      fetch(`/api/v1/iam/institutions/${institutionId}/system-user-options`, { cache: "no-store", signal }),
    ]);
    const lectBody = await lectRes.json().catch(() => ({}));
    if (!lectRes.ok) {
      throw new Error(lectBody.error ?? "Gagal memuat daftar akun dosen.");
    }
    const userBody = await userRes.json().catch(() => []);
    return {
      lecturers: Array.isArray(lectBody) ? (lectBody as LecturerAccountRow[]) : [],
      systemUsers: userRes.ok && Array.isArray(userBody) ? (userBody as SystemUserOption[]) : [],
    };
  }, [institutionId]);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal)
      .then(({ lecturers, systemUsers }) => {
        setRows(lecturers);
        setUsers(systemUsers);
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
  }, [loadData]);

  const linkedCount = useMemo(() => rows.filter(r => r.userId !== null).length, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      if (statusFilter === "linked" && !row.userId) return false;
      if (statusFilter === "unlinked" && row.userId) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.code.toLowerCase().includes(q) ||
        row.email.toLowerCase().includes(q) ||
        row.userEmail.toLowerCase().includes(q) ||
        row.nuptk.toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleRows = filteredRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    const list = q
      ? users.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      : users;
    return list.slice(0, 200);
  }, [users, userQuery]);

  function openLinkForm(row: LecturerAccountRow) {
    setTarget(row);
    setEmail(row.userEmail || row.email || "");
    setPassword("");
    setUserQuery("");
    setError("");
    const emailMatch = users.find(
      u => u.id === row.userId || (row.email && u.email.toLowerCase() === row.email.trim().toLowerCase()),
    );
    if (users.length > 0) {
      setLinkMode("existing");
      setSelectedUserId(emailMatch ? String(emailMatch.id) : "");
    } else {
      setLinkMode("new");
      setSelectedUserId("");
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/iam/institutions/${institutionId}/lecturers/sync-accounts`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Gagal menyinkronkan akun dosen.");
      const updated = await loadData();
      setRows(updated.lecturers);
      setUsers(updated.systemUsers);
      toast.success(`Sinkronisasi selesai: ${body.synced ?? 0} akun dosen terhubung.`, workspaceToastOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal menyinkronkan akun dosen.";
      setError(message);
      toast.error(message, workspaceToastOptions);
    } finally {
      setSyncing(false);
    }
  }

  async function handleLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;
    setSaving(true);
    setError("");
    try {
      const payload =
        linkMode === "existing"
          ? { userId: Number(selectedUserId) }
          : { email: email.trim(), password };
      if (linkMode === "existing" && (!payload.userId || payload.userId < 1)) {
        throw new Error("Pilih salah satu user sistem terlebih dahulu.");
      }
      const res = await fetch(`/api/v1/iam/institutions/${institutionId}/lecturers/${target.id}/link-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? body.error ?? "Gagal menghubungkan akun dosen.");
      const updated = await loadData();
      setRows(updated.lecturers);
      setUsers(updated.systemUsers);
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
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Koneksi Akun Login Dosen (1 Akun = 1 Dosen)</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Terhubung: <strong>{linkedCount}</strong> dari <strong>{rows.length}</strong> dosen.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={syncing || loading} onClick={() => void handleSync()}>
          {syncing ? "Menyinkronkan..." : "Sinkronkan otomatis (email sama)"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Hubungkan setiap data dosen ke satu akun login user sistem agar dosen dapat mengakses menu Penelitian, Pengabdian, Hibah, serta memperbarui NUPTK dan Jabatan Fungsional.
        </p>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {target && (
          <form onSubmit={e => void handleLink(e)} className="space-y-3 rounded-md border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">
                Hubungkan akun untuk: {target.name} ({target.code})
              </div>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setLinkMode("existing")}
                  className={`rounded border px-2.5 py-1 ${linkMode === "existing" ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground"}`}
                >
                  Pilih User Sistem ({users.length})
                </button>
                <button
                  type="button"
                  onClick={() => setLinkMode("new")}
                  className={`rounded border px-2.5 py-1 ${linkMode === "new" ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground"}`}
                >
                  Buat Akun Baru
                </button>
              </div>
            </div>

            {linkMode === "existing" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Cari user sistem (nama / email)"
                  value={userQuery}
                  onChange={e => setUserQuery(e.target.value)}
                  placeholder="Ketik nama atau email user..."
                />
                <Field id="select-system-user" label="Pilih Akun User Sistem">
                  <select
                    id="select-system-user"
                    required
                    value={selectedUserId}
                    onChange={e => setSelectedUserId(e.target.value)}
                    className={cn(fieldClass, "flex h-9 bg-background px-3 py-1")}
                  >
                    <option value="">-- Pilih user sistem ({filteredUsers.length} tampil) --</option>
                    {filteredUsers.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email}){u.linkedLecturerId && u.linkedLecturerId !== target.id ? ` — terhubung: ${u.linkedLecturerName}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Email akun login baru"
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="dosen@kampus.ac.id"
                />
                <Input
                  label="Kata sandi akun baru"
                  type="password"
                  required
                  minLength={12}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Minimal 12 karakter"
                />
              </div>
            )}

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

        <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
          <Input
            aria-label="Cari dosen"
            placeholder="Cari dosen (nama, NIDN, email, NUPTK)..."
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
          <select
            aria-label="Filter status koneksi"
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value as "all" | "unlinked" | "linked");
              setPage(0);
            }}
            className={cn(fieldClass, "flex h-9 bg-background px-3 py-1")}
          >
            <option value="all">Semua ({rows.length})</option>
            <option value="unlinked">Belum terhubung ({rows.length - linkedCount})</option>
            <option value="linked">Sudah terhubung ({linkedCount})</option>
          </select>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Memuat daftar koneksi akun dosen...</p>
        ) : visibleRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tidak ada data dosen yang sesuai filter.</p>
        ) : (
          <>
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
                  {visibleRows.map(row => (
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
            {totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Halaman {currentPage + 1} dari {totalPages} ({filteredRows.length} dosen)</span>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
                    Sebelumnya
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={currentPage + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>
                    Berikutnya
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
