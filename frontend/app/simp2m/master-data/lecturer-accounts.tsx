"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link2, RefreshCw } from "lucide-react";
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
  studyProgram: string;
  userId: number | null;
  userEmail: string;
}

interface SystemUserOption {
  id: number;
  email: string;
  name: string;
  linkedLecturerId: number | null;
}

const pageSize = 25;

export function LecturerAccountsPanel({ endpoint, canManage }: { endpoint: string; canManage: boolean }) {
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
  const dialog = useRef<HTMLDialogElement>(null);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    const [lectRes, userRes] = await Promise.all([
      fetch(`${endpoint}/lecturers-with-accounts`, { cache: "no-store", signal }),
      canManage ? fetch(`${endpoint}/system-user-options`, { cache: "no-store", signal }) : undefined,
    ]);
    const lectBody = await lectRes.json().catch(() => ({}));
    if (!lectRes.ok) {
      throw new Error(lectBody.error ?? "Gagal memuat daftar akun dosen.");
    }
    if (userRes && !userRes.ok) throw new Error("Daftar akun login gagal dimuat. Buka kembali tab Akun Login Dosen untuk mencoba lagi.");
    const userBody = await userRes?.json().catch(() => []);
    return {
      lecturers: Array.isArray(lectBody) ? (lectBody as LecturerAccountRow[]) : [],
      systemUsers: userRes?.ok && Array.isArray(userBody) ? (userBody as SystemUserOption[]) : [],
    };
  }, [endpoint, canManage]);

  useEffect(() => {
    const element = dialog.current;
    if (target && element && !element.open) element.showModal();
  }, [target]);

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

  const availableUsers = users.filter(user => !user.linkedLecturerId || user.linkedLecturerId === target?.id);
  const filteredUsers = (() => {
    const q = userQuery.trim().toLowerCase();
    const list = q
      ? availableUsers.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      : availableUsers;
    const visible = list.slice(0, 200);
    const selected = availableUsers.find(user => String(user.id) === selectedUserId);
    return selected && !visible.includes(selected) ? [selected, ...visible] : visible;
  })();

  function openLinkForm(row: LecturerAccountRow) {
    setTarget(row);
    setEmail(row.userEmail || row.email || "");
    setPassword("");
    setUserQuery("");
    setError("");
    const allowed = users.filter(u => !u.linkedLecturerId || u.linkedLecturerId === row.id);
    const emailMatch = allowed.find(u => u.id === row.userId) ??
      allowed.find(u => row.email && u.email.toLowerCase() === row.email.trim().toLowerCase());
    if (allowed.length > 0) {
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
      const { default: Swal } = await import("sweetalert2");
      const theme = document.querySelector<HTMLElement>(".workspace-shell")?.dataset.mode === "light" ? "light" : "dark";
      const confirm = await Swal.fire({
        titleText: "Sinkronkan akun berdasarkan email?",
        text: "Pencocokan berlaku untuk seluruh dosen yang belum terhubung di institusi ini. Email dosen harus sama dengan email akun aktif.",
        theme, showCancelButton: true, confirmButtonText: "Sinkronkan", cancelButtonText: "Batal", focusCancel: true,
      });
      if (!confirm.isConfirmed) return;
      const res = await fetch(`${endpoint}/lecturers/sync-accounts`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Gagal menyinkronkan akun dosen.");
      const updated = await loadData();
      setRows(updated.lecturers);
      setUsers(updated.systemUsers);
      toast.success(body.synced ? `${body.synced} dosen berhasil ditautkan.` : "Tidak ada pasangan email baru yang cocok.", workspaceToastOptions);
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
      const res = await fetch(`${endpoint}/lecturers/${target.id}/link-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? body.error ?? "Gagal menghubungkan akun dosen.");
      const updated = await loadData();
      setRows(updated.lecturers);
      setUsers(updated.systemUsers);
      dialog.current?.close();
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
        <CardTitle>Akun Login Dosen</CardTitle>
        <p className="text-sm text-muted-foreground">Setiap dosen dapat ditautkan ke satu akun login di institusi ini.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!loading && (!error || !!rows.length) && <dl className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border">
          {[["Total dosen", rows.length], ["Terhubung", linkedCount], ["Belum terhubung", rows.length - linkedCount]].map(([label, value]) => (
            <div key={label} className="min-w-0 px-2 py-3 sm:px-4">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>}
        {canManage && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <div>
            <h3 className="text-sm font-semibold">Sinkronisasi massal</h3>
            <p className="mt-1 text-xs text-muted-foreground">Tautkan dosen yang belum terhubung ke akun aktif dengan email yang sama.</p>
          </div>
          <Button type="button" size="sm" variant="outline" disabled={syncing || loading || rows.length === linkedCount} onClick={() => void handleSync()}>
            <RefreshCw size={15} aria-hidden="true" className={syncing ? "animate-spin" : undefined} />
            {syncing ? "Menyinkronkan…" : "Sinkronkan email"}
          </Button>
        </div>}

        {error && !target && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {target && (
          <dialog ref={dialog} aria-labelledby="lecturer-link-title" className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-4 text-foreground backdrop:bg-black/55 sm:p-5"
            onCancel={event => { event.preventDefault(); if (!saving) dialog.current?.close(); }}
            onClose={() => { setTarget(null); setError(""); setPassword(""); }}>
          <form onSubmit={e => void handleLink(e)} className="space-y-4">
            <header>
              <h3 id="lecturer-link-title" className="text-lg font-semibold">{target.userId ? "Ganti akun dosen" : "Tautkan akun dosen"}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{target.name} · {target.code}</p>
            </header>
            <fieldset disabled={saving} className="min-w-0 space-y-3">
              <legend className="mb-1 text-sm font-medium">Sumber akun</legend>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setLinkMode("existing")}
                  aria-pressed={linkMode === "existing"}
                  className={`rounded-md border p-2 text-sm ${linkMode === "existing" ? "border-brand bg-muted font-medium text-foreground" : "border-border text-muted-foreground"}`}
                >
                  Akun yang sudah ada
                </button>
                <button
                  type="button"
                  onClick={() => setLinkMode("new")}
                  aria-pressed={linkMode === "new"}
                  className={`rounded-md border p-2 text-sm ${linkMode === "new" ? "border-brand bg-muted font-medium text-foreground" : "border-border text-muted-foreground"}`}
                >
                  Buat akun baru
                </button>
              </div>

            {linkMode === "existing" ? (
              <div className="grid gap-3">
                <Input
                  label="Cari nama atau email akun"
                  value={userQuery}
                  onChange={e => setUserQuery(e.target.value)}
                  placeholder="Cari akun"
                />
                <Field id="select-system-user" label="Akun yang akan ditautkan">
                  <select
                    id="select-system-user"
                    required
                    value={selectedUserId}
                    onChange={e => setSelectedUserId(e.target.value)}
                    className={cn(fieldClass, "flex h-9 bg-background px-3 py-1")}
                  >
                    <option value="">Pilih akun</option>
                    {filteredUsers.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </select>
                </Field>
                {filteredUsers.length === 0 && <p className="text-xs text-muted-foreground">Tidak ada akun yang cocok dan tersedia untuk ditautkan.</p>}
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
            </fieldset>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
              <Button type="button" variant="outline" disabled={saving} onClick={() => dialog.current?.close()}>
                Batal
              </Button>
              <Button type="submit" disabled={saving || (linkMode === "existing" && !selectedUserId)}>
                {saving ? "Menyimpan…" : linkMode === "new" ? "Buat dan tautkan" : "Tautkan akun"}
              </Button>
            </div>
          </form>
          </dialog>
        )}

        <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
          <Input
            label="Cari dosen"
            placeholder="Nama, NIDN, email, atau NUPTK"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
          <Field id="lecturer-account-status" label="Status tautan"><select
            id="lecturer-account-status"
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
          </select></Field>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Memuat daftar koneksi akun dosen...</p>
        ) : visibleRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tidak ada data dosen yang sesuai filter.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="workspace-table w-full min-w-[34rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                    <th>Dosen</th>
                    <th>Email dosen</th>
                    <th>Akun login</th>
                    {canManage && <th>Aksi</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(row => (
                    <tr key={row.id} className="border-b border-border/60 last:border-0">
                      <td><div className="font-medium">{row.name}</div><div className="text-xs text-muted-foreground">{row.code}{row.studyProgram && ` · ${row.studyProgram}`}</div></td>
                      <td className="wrap-anywhere">{row.email || "Belum diisi"}</td>
                      <td className="py-2 pr-3">
                        {row.userId ? (
                          <div className="space-y-1"><span className="workspace-status" data-active="true">Terhubung</span><div className="wrap-anywhere text-xs">{row.userEmail}</div></div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Belum terhubung</span>
                        )}
                      </td>
                      {canManage && <td>
                        <Button type="button" size="sm" variant="outline" disabled={syncing} onClick={() => openLinkForm(row)} aria-label={`${row.userId ? "Ganti akun" : "Tautkan akun"} ${row.name}`}>
                          <Link2 size={15} aria-hidden="true" /> {row.userId ? "Ganti akun" : "Tautkan akun"}
                        </Button>
                      </td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
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
