"use client";

import { Eye, Link2, Pencil, Plus, RotateCcw, Save, Settings2, ShieldCheck, Trash2, UserCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { confirmRemoval, workspaceToastOptions } from "../confirm-removal";

type Institution = { id: number; name: string; code: string; active: boolean; canRead: boolean; canAudit: boolean };
type Account = { id: number; name: string; email: string; active: boolean; membership: boolean; roles: number[]; superadmin: boolean; permissions: string[] | null };
type Role = { id: number; name: string; active: boolean; permissions: string[] };
type Workspace = { users: Account[]; roles: Role[]; permissions: string[]; canCreateUser: boolean };
type Audit = { id: number; actor: number; action: string; mode: string; role: string; subject: string; when: string };
type Mode = "production" | "trial-admin" | "trial-reader";

const menuPermissions: Record<string, string> = {
  "iam.read": "Lihat Manajemen User",
  "iam.manage": "Tambah pengguna",
  "masterdata.read": "Lihat Master Data",
  "masterdata.manage": "Kelola Master Data",
  "audit.read": "Lihat Audit",
  "grants.read": "Lihat Hibah",
  "grants.manage": "Kelola Hibah",
  "research.apply": "Buat dan kirim Usulan Penelitian",
  "research.verify": "Verifikasi syarat & seleksi administrasi",
  "research.review": "Nilai usulan sebagai Reviewer",
  "research.decide": "Tetapkan keputusan pendanaan",
  "community.draft": "Kelola draf usulan Pengabdian kepada Masyarakat",
  "documents.read": "Lihat dan unduh template dokumen",
  "reports.draft": "Kelola draf laporan penelitian",
};
const accountMenus = [
  { name: "Manajemen User", read: "iam.read", manage: "iam.manage", action: "Tambah pengguna" },
  { name: "Master Data", read: "masterdata.read", manage: "masterdata.manage", action: "Tambah, ubah, hapus" },
  { name: "Audit", read: "audit.read" },
  { name: "Hibah", read: "grants.read", manage: "grants.manage", action: "Kelola periode dan skema" },
  { name: "Penelitian", read: "research.apply", manage: "research.verify", action: "Verifikasi & seleksi" },
  { name: "Review Substansi", read: "research.review" },
  { name: "Penetapan Pendanaan", read: "research.decide" },
  { name: "Pengabdian kepada Masyarakat", read: "community.draft" },
  { name: "Dokumen", read: "documents.read" },
  { name: "Laporan", read: "reports.draft" },
] as const;
type AccessDraft = { roles: number[]; permissions: string[] | null };
const emptyAccess: AccessDraft = { roles: [], permissions: null };

function effectivePermissions(draft: AccessDraft, roles: Role[]) {
  return new Set(draft.permissions ?? roles.filter(role => role.active && draft.roles.includes(role.id)).flatMap(role => role.permissions));
}

function permissionPayload(draft: AccessDraft) {
  return draft.permissions === null ? { roles: draft.roles, followRoles: true } : { roles: draft.roles, permissions: draft.permissions };
}

function togglePermission(draft: AccessDraft, roles: Role[], code: string, checked: boolean) {
  const permissions = effectivePermissions(draft, roles);
  if (checked) permissions.add(code); else permissions.delete(code);
  for (const menu of accountMenus) {
    if ("manage" in menu && permissions.has(menu.manage)) permissions.add(menu.read);
  }
  return { ...draft, permissions: Array.from(permissions) };
}

function RoleChoices({ roles, value, onChange, disabled }: {
  roles: Role[]; value: number[]; onChange: (value: number[]) => void; disabled: boolean;
}) {
  const choices = roles.filter(role => role.active || value.includes(role.id));
  if (!choices.length) return <p className="text-xs text-muted-foreground">Belum ada role.</p>;
  return <ul className="space-y-1.5">
    {choices.map(role => <li key={role.id}>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={value.includes(role.id)} disabled={disabled || (!role.active && !value.includes(role.id))}
          onChange={event => onChange(event.target.checked ? [...value, role.id] : value.filter(id => id !== role.id))} className="mt-0.5 shrink-0" />
        <span className="break-words">{role.name}{role.active ? "" : " (nonaktif)"}</span>
      </label>
    </li>)}
  </ul>;
}

function MenuChecks({ menu, permissions, disabled, onChange }: {
  menu: typeof accountMenus[number]; permissions: Set<string>; disabled: boolean;
  onChange: (code: string, checked: boolean) => void;
}) {
  const canManage = "manage" in menu && permissions.has(menu.manage);
  const accessLabel = menu.read.endsWith(".draft") ? "Kelola draf" : menu.read === "documents.read" ? "Unduh template" : "Lihat";
  return <div className="space-y-1.5 text-xs">
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={permissions.has(menu.read)} disabled={disabled || canManage}
        onChange={event => onChange(menu.read, event.target.checked)} aria-label={`${accessLabel} ${menu.name}`} />
      {accessLabel}
    </label>
    {"manage" in menu && <label className="flex items-center gap-2">
      <input type="checkbox" checked={canManage} disabled={disabled}
        onChange={event => onChange(menu.manage, event.target.checked)} aria-label={`${menu.action} di ${menu.name}`} />
      {menu.action}
    </label>}
  </div>;
}

async function request<T>(path: string, payload?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(path, payload === undefined ? {} : {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (response.status === 401) {
    window.location.replace("/login?renew=1");
    throw new Error("Sesi berakhir.");
  }
  if (response.status === 403) throw new Error("Akun atau peran ini tidak memiliki izin.");
  if (response.status === 409) throw new Error("Perubahan diblokir karena akun Superadmin harus tetap aktif.");
  if (response.status === 404) throw new Error("Data atau lingkungan yang dipilih belum tersedia.");
  if (response.status === 400) throw new Error("Periksa isian formulir.");
  if (!response.ok) throw new Error("Layanan belum dapat menyimpan atau memuat data.");
  return response.json();
}

export function AccessPanel({ section }: { section: "access" | "institutions" | "audit" }) {
  const [mode, setMode] = useState<Mode>("production");
  const base = mode === "production" ? "/api/v1/iam" : `/api/v1/trial/${mode}/iam`;
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [id, setID] = useState(0);
  const [system, setSystem] = useState(false);
  const [canTrial, setCanTrial] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>();
  const [audit, setAudit] = useState<Audit[]>();
  const auditRequest = useRef(0);
  const [error, setError] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [pending, setPending] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, AccessDraft>>({});
  const [newAccess, setNewAccess] = useState<AccessDraft>(emptyAccess);
  const [profileID, setProfileID] = useState(0);
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const endpoint = `${base}/institutions/${id}`;
  const selected = institutions.find(item => item.id === id);
  const canRead = selected?.canRead ?? false;

  useEffect(() => {
    let active = true;
    void request<{ items: Institution[]; system: boolean }>(base + "/institutions").then(data => {
      if (!active) return;
      const allowed = data.items.filter(item => (showInactive || item.active) && (section === "institutions" || (section === "audit" ? item.canAudit : item.canRead)));
      setInstitutions(allowed);
      setSystem(data.system);
      if (mode === "production") setCanTrial(data.system);
      setID(previous => allowed.some(item => item.id === previous) ? previous : (allowed[0]?.id ?? 0));
      setReady(true);
    }).catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [base, mode, revision, section, showInactive]);

  useEffect(() => {
    if (!id || !canRead || section !== "access") return;
    let active = true;
    void request<Workspace>(endpoint + "/workspace").then(data => {
      if (active) setWorkspace(data);
    }).catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [endpoint, id, canRead, revision, section, showInactive]);

  const submit = useCallback(async (event: FormEvent<HTMLFormElement>, action: (data: FormData) => Promise<unknown>, reset = false) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    setPending(true);
    try {
      await action(data);
      if (reset) form.reset();
      setWorkspace(undefined);
      auditRequest.current++;
      setAudit(undefined);
      setRevision(previous => previous + 1);
      toast.success("Perubahan disimpan.", workspaceToastOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Perubahan gagal disimpan.";
      setError(message);
      toast.error(message, workspaceToastOptions);
    } finally { setPending(false); }
  }, []);

  function clearEditors() {
    setDrafts({});
    setNewAccess(emptyAccess);
    setProfileID(0);
  }

  async function removeEntry(path: string, title: string, detail: string) {
    setPending(true);
    try {
      if (!await confirmRemoval(title, detail)) return;
      await request(path, null, "DELETE");
      setError("");
      setWorkspace(undefined);
      auditRequest.current++;
      setAudit(undefined);
      setRevision(previous => previous + 1);
      toast.success("Data dihapus dari daftar aktif.", workspaceToastOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Data gagal dihapus.";
      setError(message);
      toast.error(message, workspaceToastOptions);
    } finally {
      setPending(false);
    }
  }

  async function switchMode(value: Mode) {
    if (value === mode) return;
    if (value !== "production") {
      setPending(true);
      try {
        await request(`/api/v1/trial/${value}/iam/enter`, {});
      } catch (err) {
        setError(err instanceof Error ? err.message : "Trial belum tersedia.");
        return;
      } finally {
        setPending(false);
      }
    }
    auditRequest.current++;
    setMode(value); setID(0); setInstitutions([]); setSystem(false); setWorkspace(undefined);
    setAudit(undefined); setError(""); setReady(false);
    clearEditors();
  }

  async function loadAudit(before?: number) {
    const requestID = ++auditRequest.current;
    setError("");
    try {
      const rows = await request<Audit[]>(endpoint + "/audit" + (before ? `?before=${before}` : ""));
      if (requestID === auditRequest.current) setAudit(previous => before && previous ? [...previous, ...rows] : rows);
    } catch (err) {
      if (requestID === auditRequest.current) setError(err instanceof Error ? err.message : "Audit gagal dimuat.");
    }
  }

  const visibleUsers = workspace?.users.filter(item => showInactive || (item.active && item.membership)) ?? [];
  const profile = visibleUsers.find(item => item.id === profileID);

  return (
    <>
      <header className="workspace-heading">
        <h1 className="text-2xl font-semibold tracking-tight">{section === "institutions" ? "Institusi" : section === "audit" ? "Audit" : "Manajemen User"}</h1>
        {mode !== "production" && <p className="mt-1 text-sm font-medium text-brand">Mode trial · database terpisah</p>}
      </header>
      <div className="workspace-toolbar grid gap-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,24rem)]">
        {canTrial && <div className="min-w-0"><label htmlFor="access-mode" className="mb-1 block">Lingkungan dan peran</label>
          <select id="access-mode" value={mode} onChange={event => void switchMode(event.target.value as Mode)} disabled={pending} className="w-full">
            <option value="production">Operasional</option>
            <option value="trial-admin">Trial · Pengelola</option>
            <option value="trial-reader">Trial · Pembaca</option>
          </select>
        </div>}
        <div className="min-w-0"><label htmlFor="access-institution" className="mb-1 block">Institusi</label>
          <select id="access-institution" value={id} onChange={event => { auditRequest.current++; clearEditors(); setID(Number(event.target.value)); setWorkspace(undefined); setAudit(undefined); setError(""); }} disabled={pending || !institutions.length} className="w-full">
            {!institutions.length && <option value={0}>Belum ada institusi</option>}
            {institutions.map(item => <option key={item.id} value={item.id}>{item.name} ({item.code}){item.active ? "" : " · Nonaktif"}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" checked={showInactive} disabled={pending} onChange={event => {
            auditRequest.current++;
            setWorkspace(undefined);
            setAudit(undefined);
            setShowInactive(event.target.checked);
          }} />
          Sertakan data nonaktif
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {section === "institutions" && ready && system && (
        <Card className="workspace-panel rounded-md">
          <CardHeader><CardTitle>Tambah institusi</CardTitle></CardHeader>
          <CardContent>
            <form method="post" onSubmit={event => void submit(event, data => request(base + "/institutions", { code: data.get("code"), name: data.get("name") }), true)} className="workspace-fields grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
              <Input label="Kode institusi baru" name="code" required maxLength={32} />
              <Input label="Nama institusi baru" name="name" required maxLength={200} />
              <Button data-action-tone="positive" disabled={pending}><Plus size={15} aria-hidden="true" /> Tambah institusi</Button>
            </form>
            {id > 0 && <form key={id} method="post" onSubmit={event => void submit(event, data => request(endpoint, { name: data.get("name"), active: data.has("active") }, "PUT"))} className="workspace-fields mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <Input label="Nama institusi terpilih" name="name" required maxLength={200} defaultValue={institutions.find(item => item.id === id)?.name} />
              <label className="self-center text-sm"><input type="checkbox" name="active" defaultChecked={selected?.active} /> Institusi aktif</label>
              <Button data-action-tone="positive" variant="outline" disabled={pending}><Save size={15} aria-hidden="true" /> Simpan institusi</Button>
              {selected?.active && <Button data-action-tone="danger" type="button" variant="outline" className="text-destructive" disabled={pending} onClick={() => void removeEntry(endpoint, `Hapus institusi ${selected.name}?`, "Institusi akan dinonaktifkan. Keanggotaan dan riwayatnya tetap tersimpan.")}>
                <Trash2 size={15} aria-hidden="true" /> Hapus institusi
              </Button>}
            </form>}
          </CardContent>
        </Card>
      )}
      {section === "audit" && selected?.canAudit && <Card className="workspace-panel rounded-md">
        <CardHeader><CardTitle>Audit</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Button data-action-tone="info" variant="outline" onClick={() => void loadAudit()}><Eye size={15} aria-hidden="true" /> Lihat audit</Button>
          {audit?.length === 0 && <p className="text-sm">Belum ada peristiwa audit.</p>}
          {audit?.map(row => <p key={row.id} className="text-sm">{row.when} UTC · {row.action} · {row.role || "Tanpa sesi"} · {row.subject}</p>)}
          {!!audit?.length && audit.length % 50 === 0 && <Button data-action-tone="info" variant="outline" onClick={() => void loadAudit(audit.at(-1)?.id)}><Eye size={15} aria-hidden="true" /> Muat audit sebelumnya</Button>}
        </CardContent>
      </Card>}
      {section === "access" && workspace && (
        <>
          <Card className="workspace-panel rounded-md">
            <CardHeader><CardTitle>Pengguna institusi</CardTitle></CardHeader>
            <CardContent className="workspace-fields space-y-3">
              {workspace.canCreateUser && <details className="rounded-md border border-border bg-background">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium"><UserPlus size={15} className="mr-1 inline shrink-0 align-text-bottom" aria-hidden="true" /> Tambah pengguna</summary>
                <form method="post" onSubmit={event => void submit(event, async data => {
                  await request(endpoint + "/users", {
                    ...Object.fromEntries(data),
                    ...(system ? permissionPayload(newAccess) : {}),
                  });
                  setNewAccess(emptyAccess);
                }, true)} className="grid gap-3 px-3 pb-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input label="Nama pengguna baru" name="name" required maxLength={160} />
                    <Input label="Email pengguna baru" name="email" type="email" required maxLength={254} />
                    <Input label="Kata sandi awal" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} />
                  </div>
                  {system && <>
                    <fieldset className="rounded-md border border-border p-2">
                      <legend className="px-1 text-xs font-semibold">Paket izin pengguna baru (role)</legend>
                      <RoleChoices roles={workspace.roles} value={newAccess.roles} disabled={pending}
                        onChange={roles => setNewAccess({ ...newAccess, roles })} />
                    </fieldset>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {accountMenus.map(menu => <fieldset key={menu.read} className="min-w-0 rounded-md border border-border p-2">
                        <legend className="px-1 text-xs font-semibold">{menu.name}</legend>
                        <MenuChecks menu={menu} permissions={effectivePermissions(newAccess, workspace.roles)} disabled={pending}
                          onChange={(code, checked) => setNewAccess(togglePermission(newAccess, workspace.roles, code, checked))} />
                      </fieldset>)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {newAccess.permissions === null ? "Centang menu mengikuti role yang dipilih." : "Centang menu disesuaikan untuk akun ini."}
                      {newAccess.permissions !== null && <button data-action-tone="attention" type="button" className="ml-2 text-brand underline"
                        onClick={() => setNewAccess({ ...newAccess, permissions: null })}><RotateCcw size={15} className="mr-1 inline shrink-0 align-text-bottom" aria-hidden="true" /> Ikuti role lagi</button>}
                    </p>
                  </>}
                  <Button data-action-tone="positive" disabled={pending} className="justify-self-start"><Save size={15} aria-hidden="true" /> Simpan pengguna</Button>
                </form>
              </details>}
              {system && <details className="rounded-md border border-border bg-background">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium"><Link2 size={15} className="mr-1 inline shrink-0 align-text-bottom" aria-hidden="true" /> Hubungkan akun yang sudah ada</summary>
                <form method="post" onSubmit={event => void submit(event, data => request(endpoint + "/memberships", { email: data.get("email") }), true)} className="flex flex-wrap items-end gap-3 px-3 pb-3">
                  <Input label="Email akun yang sudah ada" name="email" type="email" required />
                  <Button data-action-tone="positive" variant="outline" disabled={pending}><UserPlus size={15} aria-hidden="true" /> Tambahkan ke institusi</Button>
                </form>
              </details>}
              {!visibleUsers.length ? <p className="text-sm">Belum ada pengguna dalam daftar ini.</p> : <>
                {system && <p className="text-xs text-muted-foreground">Role memberi izin awal. Mengubah centang membuat izin khusus untuk akun tersebut. Simpan setiap baris yang diubah.</p>}
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="workspace-table w-full min-w-[47rem] text-left text-sm">
                    <caption className="sr-only">Matriks akses menu per akun</caption>
                    <thead><tr>
                      <th scope="col">Akun</th><th scope="col">Paket izin</th>
                      {accountMenus.map(menu => <th key={menu.read} scope="col">{menu.name}</th>)}
                      {system && <th scope="col">Aksi</th>}
                    </tr></thead>
                    <tbody>{visibleUsers.map(item => {
                      const draft = drafts[item.id] ?? { roles: item.roles, permissions: item.permissions };
                      const permissions = item.superadmin ? new Set(workspace.permissions) : effectivePermissions(draft, workspace.roles);
                      const locked = pending || !system || item.superadmin;
                      const changeDraft = (value: AccessDraft) => setDrafts(previous => ({ ...previous, [item.id]: value }));
                      const savedRoles = workspace.roles.filter(role => item.roles.includes(role.id));
                      return <tr key={item.id} className="align-top">
                        <th scope="row" className="max-w-56">
                          <p className="break-words font-semibold">{item.name}</p>
                          <p className="break-all text-xs font-normal text-muted-foreground">{item.email}</p>
                          {(!item.active || !item.membership) && <p className="mt-1 text-xs font-normal text-muted-foreground">{item.active ? "Keanggotaan nonaktif" : "Akun nonaktif"}</p>}
                        </th>
                        <td className="max-w-48 text-xs">
                          {item.superadmin ? <span className="font-medium text-brand">Superadmin · semua menu</span>
                            : system ? <>
                              <details><summary className="cursor-pointer">Pilih role ({draft.roles.length})</summary>
                                <div className="pt-2"><RoleChoices roles={workspace.roles} value={draft.roles} disabled={pending} onChange={roles => changeDraft({ ...draft, roles })} /></div>
                              </details>
                              {draft.permissions !== null && <button data-action-tone="attention" type="button" disabled={pending}
                                className="mt-2 text-brand underline" onClick={() => changeDraft({ ...draft, permissions: null })}><RotateCcw size={15} className="mr-1 inline shrink-0 align-text-bottom" aria-hidden="true" /> Ikuti role lagi</button>}
                              {savedRoles.length > 0 && <p className="mt-1 break-words text-muted-foreground">{savedRoles.map(role => role.name).join(", ")}</p>}
                            </> : <span className="break-words">{savedRoles.map(role => role.name).join(", ") || "—"}</span>}
                        </td>
                        {accountMenus.map(menu => <td key={menu.read}>
                          <MenuChecks menu={menu} permissions={permissions} disabled={locked} onChange={(code, checked) =>
                            changeDraft(togglePermission(draft, workspace.roles, code, checked))} />
                        </td>)}
                        {system && <td><div className="flex flex-wrap gap-1">
                          {!item.superadmin && <form method="post" onSubmit={event => void submit(event, async () => {
                            await request(`${endpoint}/users/${item.id}`, { active: item.membership, ...permissionPayload(draft) }, "PUT");
                            setDrafts(previous => { const next = { ...previous }; delete next[item.id]; return next; });
                          })}><Button data-action-tone="positive" size="sm" disabled={pending || !drafts[item.id]}><Save size={15} aria-hidden="true" /> Simpan izin</Button></form>}
                          <Button data-action-tone="edit" type="button" size="sm" variant="outline" disabled={pending} onClick={() => setProfileID(profileID === item.id ? 0 : item.id)}>
                            <Pencil size={14} aria-hidden="true" /> Profil
                          </Button>
                        </div></td>}
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              </>}
              {system && profile && <Card className="rounded-md">
                <CardHeader><CardTitle>Profil {profile.name}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <form key={profile.id} method="post" className="flex flex-wrap items-end gap-2" onSubmit={event =>
                    void submit(event, data => request(`${base}/users/${profile.id}/profile`, Object.fromEntries(data), "PUT"))}>
                    <Input id="profile-name" label="Nama akun" name="name" defaultValue={profile.name} required maxLength={160} />
                    <Input id="profile-email" label="Email akun" name="email" type="email" defaultValue={profile.email} required maxLength={254} />
                    <Button data-action-tone="positive" variant="outline" disabled={pending}><Save size={15} aria-hidden="true" /> Simpan profil</Button>
                  </form>
                  <div className="flex flex-wrap gap-2 border-t border-border pt-2">
                    {profile.active ? <Button data-action-tone="danger" type="button" variant="outline" size="sm" className="text-destructive" disabled={pending}
                      onClick={() => void removeEntry(`${base}/users/${profile.id}`, `Hapus akun ${profile.name}?`, "Akun akan dinonaktifkan dan sesi aktif dicabut.")}><Trash2 size={15} aria-hidden="true" /> Hapus akun</Button>
                      : <form method="post" onSubmit={event => void submit(event, () => request(`${base}/users/${profile.id}/active`, { active: true }, "PUT"))}><Button data-action-tone="positive" size="sm" variant="outline" disabled={pending}><UserCheck size={15} aria-hidden="true" /> Aktifkan akun</Button></form>}
                    {profile.membership ? <Button data-action-tone="danger" type="button" variant="outline" size="sm" className="text-destructive" disabled={pending}
                      onClick={() => void removeEntry(`${endpoint}/users/${profile.id}`, `Hapus keanggotaan ${profile.name}?`, "Akses pengguna ke institusi ini akan dinonaktifkan.")}><Trash2 size={15} aria-hidden="true" /> Hapus keanggotaan</Button>
                      : <form method="post" onSubmit={event => void submit(event, () => request(`${endpoint}/users/${profile.id}`, { active: true, roles: profile.roles }, "PUT"))}><Button data-action-tone="positive" size="sm" variant="outline" disabled={pending}><UserCheck size={15} aria-hidden="true" /> Aktifkan keanggotaan</Button></form>}
                    <form method="post" onSubmit={event => void submit(event, () => request(`${base}/users/${profile.id}/superadmin`, { granted: !profile.superadmin }, "PUT"))}>
                      <Button data-action-tone="edit" variant="outline" size="sm" disabled={pending}><ShieldCheck size={15} aria-hidden="true" /> {profile.superadmin ? "Cabut akses Superadmin" : "Jadikan Superadmin"}</Button>
                    </form>
                  </div>
                </CardContent>
              </Card>}
            </CardContent>
          </Card>
          <details className="rounded-md border border-border bg-card px-3 py-2.5">
            <summary className="cursor-pointer text-sm font-semibold"><Settings2 size={15} className="mr-1 inline shrink-0 align-text-bottom" aria-hidden="true" /> Atur paket izin (role)</summary>
            <div className="workspace-fields mt-3 space-y-3">
              {system && [undefined, ...workspace.roles.filter(role => showInactive || role.active)].map(role => (
                <form key={role?.id ?? "new"} method="post" onSubmit={event => void submit(event, data => request(endpoint + "/roles" + (role ? `/${role.id}` : ""), { name: data.get("name"), active: data.has("active"), permissions: data.getAll("permission") }, role ? "PUT" : "POST"), !role)} className="flex flex-wrap items-end gap-3 border-b border-border pb-4 text-sm">
                  <Input id={`role-${role?.id ?? "new"}`} label={role ? "Nama role" : "Nama role baru"} name="name" defaultValue={role?.name} required maxLength={64} />
                  <label><input type="checkbox" name="active" defaultChecked={role?.active ?? true} /> Aktif</label>
                  {workspace.permissions.map(permission => <label key={permission} className="flex items-center gap-1.5"><input type="checkbox" name="permission" value={permission} defaultChecked={role?.permissions.includes(permission)} /> {menuPermissions[permission] ?? permission}</label>)}
                  <Button data-action-tone="positive" disabled={pending}>{role ? <Save size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />} {role ? "Simpan role" : "Tambah role"}</Button>
                  {role?.active && <Button data-action-tone="danger" type="button" variant="outline" className="text-destructive" disabled={pending} onClick={() => void removeEntry(`${endpoint}/roles/${role.id}`, `Hapus role ${role.name}?`, "Role dan izin yang diberikan lewat role ini akan dinonaktifkan. Riwayat penetapannya tetap tersimpan.")}>
                    <Trash2 size={15} aria-hidden="true" /> Hapus role
                  </Button>}
                </form>
              ))}
              {!system && workspace.roles.filter(role => showInactive || role.active).map(role => <p key={role.id} className="text-sm">{role.name} · {role.permissions.map(permission => menuPermissions[permission] ?? permission).join(", ")}</p>)}
            </div>
          </details>
        </>
      )}
    </>
  );
}
