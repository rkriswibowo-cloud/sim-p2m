"use client";

import { KeyRound, LockKeyhole, LockOpen, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { workspaceToastOptions } from "../confirm-removal";

type LecturerAccount = {
  id: number;
  code: string;
  name: string;
  email: string;
  active: boolean;
  userId: number | null;
  userEmail: string;
  needsPassword: boolean;
  profileLocked: boolean;
};

const pageSize = 25;

export function LecturerAccountsPanel({ endpoint, canManage }: { endpoint: string; canManage: boolean }) {
  const [rows, setRows] = useState<LecturerAccount[]>();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [target, setTarget] = useState<LecturerAccount>();
  const [password, setPassword] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${endpoint}/lecturers-with-accounts`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Gagal memuat akun dosen.");
        return await response.json() as LecturerAccount[];
      }).then(items => {
        if (!controller.signal.aborted) setRows(items);
      }).catch((err: Error) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [endpoint]);

  useEffect(() => {
    if (target && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [target]);

  async function changeAccount(row: LecturerAccount, action: "profile-lock" | "initial-password", value: object) {
    const response = await fetch(`${endpoint}/lecturers/${row.id}/${action}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(body?.message ?? "Perubahan akun dosen gagal disimpan.");
    }
  }

  async function changeLock(row: LecturerAccount) {
    const locked = !row.profileLocked;
    setPending(true);
    setError("");
    try {
      await changeAccount(row, "profile-lock", { locked });
      setRows(items => items?.map(item => item.id === row.id ? { ...item, profileLocked: locked } : item));
      toast.success(locked ? "Profil dosen dikunci." : "Kunci profil dosen dibuka.", workspaceToastOptions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  function openPassword(row: LecturerAccount) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    setPassword(Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""));
    setPasswordSaved(false);
    setError("");
    setTarget(row);
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || passwordSaved) return;
    setPending(true);
    setError("");
    try {
      await changeAccount(target, "initial-password", { password });
      setRows(items => items?.map(item => item.id === target.id ? { ...item, needsPassword: false } : item));
      setPasswordSaved(true);
      toast.success("Sandi awal tersimpan.", workspaceToastOptions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  const query = search.trim().toLowerCase();
  const filtered = rows?.filter(row => [row.name, row.code, row.email, row.userEmail]
    .some(value => value.toLowerCase().includes(query)));
  const visible = filtered?.slice(page * pageSize, (page + 1) * pageSize);

  return <Card className="workspace-panel rounded-md">
    <CardHeader>
      <CardTitle>Akun Login Dosen</CardTitle>
      <p className="text-sm text-muted-foreground">Akun dibuat saat data dosen aktif disimpan dengan email. Kunci profil untuk menghentikan perubahan dari akun dosen.</p>
    </CardHeader>
    <CardContent className="space-y-4">
      <Input label="Cari nama, kode, atau email" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} />
      {!rows && !error && <p role="status" className="text-sm">Memuat akun dosen…</p>}
      {error && !target && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {visible?.length === 0 && <p className="text-sm text-muted-foreground">Tidak ada data yang cocok.</p>}
      {!!visible?.length && <div className="overflow-x-auto">
        <table className="workspace-table data-table w-full text-left text-sm">
          <thead><tr><th>Dosen</th><th>Email Login</th><th>Status Profil</th>{canManage && <th>Aksi</th>}</tr></thead>
          <tbody>{visible.map(row => <tr key={row.id}>
            <td><p className="font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{row.code}</p></td>
            <td>{row.userEmail || (row.email ? "Periksa email di Data Dosen" : "Email belum diisi")}
              {row.needsPassword && <p className="text-xs text-muted-foreground">Menunggu sandi awal</p>}</td>
            <td>{row.profileLocked ? "Terkunci" : "Terbuka"}</td>
            {canManage && <td><div className="flex flex-wrap gap-2">
              <Button data-action-tone="attention" type="button" variant="outline" size="sm" disabled={pending} onClick={() => void changeLock(row)}>
                {row.profileLocked ? <LockOpen size={15} aria-hidden="true" /> : <LockKeyhole size={15} aria-hidden="true" />}
                {row.profileLocked ? "Buka Kunci Profil" : "Kunci Profil"}
              </Button>
              {row.active && row.needsPassword && <Button data-action-tone="attention" type="button" variant="outline" size="sm" disabled={pending} onClick={() => openPassword(row)}>
                <KeyRound size={15} aria-hidden="true" />
                Siapkan Sandi Awal
              </Button>}
            </div></td>}
          </tr>)}</tbody>
        </table>
      </div>}
      {!!filtered && filtered.length > pageSize && <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Sebelumnya</Button>
        <Button variant="outline" size="sm" disabled={(page + 1) * pageSize >= filtered.length} onClick={() => setPage(page + 1)}>Berikutnya</Button>
      </div>}
      {target && <dialog ref={dialog} aria-labelledby="lecturer-password-title"
        className="m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-xl border border-border bg-card p-5 text-foreground backdrop:bg-black/55"
        onCancel={event => { if (pending) event.preventDefault(); }}
        onClose={() => { setTarget(undefined); setPassword(""); setError(""); }}>
        <form onSubmit={savePassword} className="space-y-4">
          <h3 id="lecturer-password-title" className="text-lg font-semibold">Sandi Awal Dosen</h3>
          <p className="text-sm text-muted-foreground">{target.name} · {target.userEmail}</p>
          <Input label="Kata sandi awal" value={password} readOnly={passwordSaved} disabled={pending}
            required minLength={12} maxLength={256} autoComplete="new-password" onChange={event => setPassword(event.target.value)} />
          {passwordSaved && <p role="status" className="text-sm">Sandi tersimpan. Salin sandi ini dan berikan langsung kepada dosen melalui kanal pribadi.</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => dialog.current?.close()}>{passwordSaved ? "Tutup" : "Batal"}</Button>
            {!passwordSaved && <Button data-action-tone="positive" type="submit" disabled={pending}><Save size={15} aria-hidden="true" /> {pending ? "Menyimpan…" : "Simpan sandi"}</Button>}
          </div>
        </form>
      </dialog>}
    </CardContent>
  </Card>;
}
