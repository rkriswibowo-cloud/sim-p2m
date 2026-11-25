"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { confirmRemoval, workspaceToastOptions } from "../confirm-removal";

const datasets = {
  faculties: { name: "Fakultas" },
  "study-programs": { name: "Program studi", parent: "faculties", relation: "Fakultas", required: true },
  units: { name: "Unit" },
  lecturers: { name: "Dosen", parent: "study-programs", relation: "Program studi", contact: true, codeLabel: "Kode dosen / NIDN / NUPTK" },
  students: { name: "Mahasiswa", parent: "study-programs", relation: "Program studi", required: true, contact: true, codeLabel: "NIM" },
  reviewers: { name: "Reviewer", contact: true },
  "funding-sources": { name: "Sumber dana" },
  "scheme-groups": { name: "Kelompok skema" },
  schemes: { name: "Skema", parent: "scheme-groups", relation: "Kelompok skema", required: true },
  "research-fields": { name: "Bidang riset" },
  "budget-categories": { name: "Kategori RAB" },
} satisfies Record<string, { name: string; parent?: string; relation?: string; required?: boolean; contact?: boolean; codeLabel?: string }>;

type Kind = keyof typeof datasets;
type Dataset = { name: string; parent?: string; relation?: string; required?: boolean; contact?: boolean; codeLabel?: string };
type Institution = { id: number; name: string; canMasterRead: boolean; canMasterManage: boolean };
type Row = { id: number; code: string; name: string; active: boolean; parentId: number | null; parentName: string; email: string };
type Rows = { items: Row[]; next: number };
type Mode = "production" | "trial-admin" | "trial-reader";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (response.status === 401) {
    window.location.replace("/login?renew=1");
    throw new Error("Sesi berakhir.");
  }
  if (response.status === 403) throw new Error("Akun atau peran ini tidak memiliki izin.");
  if (response.status === 400) throw new Error("Periksa kode, nama, dan relasi yang dipilih.");
  if (response.status === 409) throw new Error("Kode ini sudah digunakan di institusi tersebut.");
  if (!response.ok) throw new Error("Master data belum dapat dimuat atau disimpan.");
  return response.json();
}

export function MasterDataPanel({ initialKind }: { initialKind?: string }) {
  const [mode, setMode] = useState<Mode>("production");
  const [system, setSystem] = useState(false);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [institution, setInstitution] = useState(0);
  const [kind, setKind] = useState<Kind>(initialKind && Object.hasOwn(datasets, initialKind) ? initialKind as Kind : "faculties");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [cursors, setCursors] = useState([0]);
  const [result, setResult] = useState<Rows>();
  const [parents, setParents] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row>();
  const [adding, setAdding] = useState(false);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dataset: Dataset = datasets[kind];
  const base = mode === "production" ? "/api/v1/iam" : `/api/v1/trial/${mode}/iam`;
  const collection = `${base}/institutions/${institution}/master-data`;
  const cursor = cursors.at(-1) ?? 0;
  const selected = institutions.find(item => item.id === institution);

  useEffect(() => {
    const controller = new AbortController();
    void api<{ items: Institution[]; system: boolean }>(base + "/institutions", { signal: controller.signal }).then(response => {
      const allowed = response.items.filter(item => item.canMasterRead);
      setInstitutions(allowed);
      setInstitution(allowed[0]?.id ?? 0);
      if (mode === "production") setSystem(response.system);
    }).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [base, mode]);

  useEffect(() => {
    if (!institution) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ q: search, status, after: String(cursor) });
    void api<Rows>(`${collection}/${kind}?${params}`, { signal: controller.signal })
      .then(setResult)
      .catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [collection, cursor, institution, kind, revision, search, status]);

  useEffect(() => {
    if (!institution || !dataset.parent || !selected?.canMasterManage) return;
    const controller = new AbortController();
    const parent = dataset.parent;
    async function loadParents() {
      const all: Row[] = [];
      let after = 0;
      do {
        const page = await api<Rows>(`${collection}/${parent}?after=${after}`, { signal: controller.signal });
        all.push(...page.items);
        after = page.next;
      } while (after && !controller.signal.aborted);
      if (!controller.signal.aborted) setParents(all);
    }
    void loadParents().catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [collection, dataset.parent, institution, selected?.canMasterManage]);

  function resetContext() {
    setResult(undefined);
    setParents([]);
    setEdit(undefined);
    setAdding(false);
    setCursors([0]);
    setError("");
  }

  async function chooseMode(value: Mode) {
    if (mode === value) return;
    setPending(true);
    try {
      if (value !== "production") {
        await api(`/api/v1/trial/${value}/iam/enter`, { method: "POST" });
      }
      setInstitution(0);
      setInstitutions([]);
      resetContext();
      setMode(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trial belum dapat dibuka.");
    } finally {
      setPending(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const parent = fields.get("parent");
    setPending(true);
    setError("");
    try {
      await api(collection + "/" + kind + (edit ? `/${edit.id}` : ""), {
        method: edit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: fields.get("code"), name: fields.get("name"), active: fields.has("active"),
          email: fields.get("email") || "", parentId: parent ? Number(parent) : null,
        }),
      });
      form.reset();
      setEdit(undefined);
      setAdding(false);
      setRevision(previous => previous + 1);
      toast.success("Master data disimpan.", workspaceToastOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Master data gagal disimpan.";
      setError(message);
      toast.error(message, workspaceToastOptions);
    } finally {
      setPending(false);
    }
  }

  async function remove(row: Row) {
    setPending(true);
    try {
      if (!await confirmRemoval(`Hapus ${row.name}?`, "Data akan dipindahkan dari daftar aktif. Riwayat dan relasinya tetap tersimpan.")) return;
      await api(`${collection}/${kind}/${row.id}`, { method: "DELETE" });
      if (edit?.id === row.id) setEdit(undefined);
      setResult(undefined);
      setCursors([0]);
      setRevision(previous => previous + 1);
      setError("");
      toast.success("Data dihapus dari daftar aktif.", workspaceToastOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Data gagal dihapus.";
      setError(message);
      toast.error(message, workspaceToastOptions);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <header className="workspace-heading flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Master Data</h1>
          {mode !== "production" && <p className="mt-1 text-sm font-medium text-brand">Mode trial · database terpisah</p>}
        </div>
        {selected?.canMasterManage && !adding && !edit && <Button onClick={() => setAdding(true)} disabled={pending}>Tambah data</Button>}
      </header>
      <div className="workspace-toolbar grid gap-2 sm:grid-cols-3">
        {system && <div>
          <label htmlFor="master-mode" className="block text-sm">Lingkungan dan peran</label>
          <select id="master-mode" value={mode} disabled={pending} onChange={event => void chooseMode(event.target.value as Mode)} className="w-full rounded border border-input bg-card p-2">
            <option value="production">Operasional</option><option value="trial-admin">Trial · Pengelola</option><option value="trial-reader">Trial · Pembaca</option>
          </select>
        </div>}
        <div>
          <label htmlFor="master-institution" className="block text-sm">Institusi</label>
          <select id="master-institution" value={institution} disabled={pending} onChange={event => { resetContext(); setInstitution(Number(event.target.value)); }} className="w-full rounded border border-input bg-card p-2">
            {!institutions.length && <option value={0}>Belum ada institusi yang dapat diakses</option>}
            {institutions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="master-kind" className="block text-sm">Jenis data</label>
          <select id="master-kind" value={kind} disabled={pending} onChange={event => { resetContext(); setKind(event.target.value as Kind); }} className="w-full rounded border border-input bg-card p-2">
            {Object.entries(datasets).map(([key, value]) => <option key={key} value={key}>{value.name}</option>)}
          </select>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {selected?.canMasterManage && (adding || edit) && <Card className="workspace-panel rounded-md">
        <CardHeader><CardTitle>{edit ? "Ubah data" : "Tambah data"} · {dataset.name}</CardTitle></CardHeader>
        <CardContent>
          <form key={`${collection}/${kind}/${edit?.id ?? "new"}`} method="post" onSubmit={event => void save(event)} className="workspace-fields grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Input label={dataset.codeLabel ?? "Kode"} name="code" defaultValue={edit?.code} required maxLength={64} />
            <Input label="Nama" name="name" defaultValue={edit?.name} required maxLength={200} />
            {dataset.contact && <Input label="Email" name="email" type="email" defaultValue={edit?.email} maxLength={254} />}
            {dataset.parent && <div>
              <label htmlFor="master-parent" className="block text-sm">{dataset.relation}</label>
              <select id="master-parent" name="parent" defaultValue={edit?.parentId ?? ""} required={dataset.required} className="w-full rounded border border-input bg-card p-2">
                <option value="">Pilih {dataset.relation?.toLowerCase()}</option>
                {parents.map(parent => <option key={parent.id} value={parent.id}>{parent.name}{parent.active ? "" : " (nonaktif)"}</option>)}
              </select>
            </div>}
            <label className="flex min-h-8 items-center gap-2"><input type="checkbox" name="active" defaultChecked={edit?.active ?? true} /> Aktif</label>
            <div className="workspace-form-actions">
              <Button type="button" variant="outline" disabled={pending} onClick={() => { setEdit(undefined); setAdding(false); }}>Batal</Button>
              <Button type="submit" disabled={pending}>Simpan</Button>
            </div>
          </form>
        </CardContent>
      </Card>}
      {institution > 0 && <Card className="workspace-panel rounded-md">
        <CardHeader><CardTitle>{dataset.name}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <form className="workspace-table-tools flex flex-wrap items-end gap-2" onSubmit={event => {
            event.preventDefault();
            const value = new FormData(event.currentTarget);
            setSearch(String(value.get("search") ?? ""));
            setStatus(String(value.get("status") ?? ""));
            setCursors([0]);
          }}>
            <Input label="Cari kode atau nama" name="search" maxLength={200} />
            <div>
              <label htmlFor="master-status" className="block text-sm">Status</label>
              <select name="status" id="master-status" defaultValue={status} className="rounded border border-input bg-card p-2">
                <option value="">Semua</option><option value="active">Aktif</option><option value="inactive">Nonaktif</option>
              </select>
            </div>
            <Button variant="outline">Cari</Button>
          </form>
          {!result && !error && <p className="text-sm">Memuat data…</p>}
          {result?.items.length === 0 && <p className="text-sm">Tidak ada data yang cocok.</p>}
          {!!result?.items.length && <div className="overflow-x-auto">
            <table className="workspace-table w-full text-left text-sm">
              <thead><tr><th>Kode</th><th>Nama</th>{dataset.parent && <th>{dataset.relation}</th>}<th>Status</th>{selected?.canMasterManage && <th>Aksi</th>}</tr></thead>
              <tbody>{result.items.map(row => <tr key={row.id}>
                <td className="break-words">{row.code}</td><td className="break-words">{row.name}</td>{dataset.parent && <td>{row.parentName || "–"}</td>}<td><span className="workspace-status" data-active={row.active}>{row.active ? "Aktif" : "Nonaktif"}</span></td>
                {selected?.canMasterManage && <td><div className="flex flex-wrap gap-1.5">
                  <Button type="button" variant="outline" size="sm" aria-label={`Ubah ${row.name}`} disabled={pending} onClick={() => { setAdding(false); setEdit(row); }}>Ubah</Button>
                  {row.active && <Button type="button" variant="ghost" size="icon-sm" className="text-destructive" title="Hapus" aria-label={`Hapus ${row.name}`} disabled={pending} onClick={() => void remove(row)}><Trash2 size={15} aria-hidden="true" /></Button>}
                </div></td>}
              </tr>)}</tbody>
            </table>
          </div>}
          <div className="flex gap-2">
            {cursors.length > 1 && <Button type="button" variant="outline" onClick={() => setCursors(previous => previous.slice(0, -1))}>Sebelumnya</Button>}
            {!!result?.next && <Button type="button" variant="outline" onClick={() => setCursors(previous => [...previous, result.next])}>Berikutnya</Button>}
          </div>
        </CardContent>
      </Card>}
    </>
  );
}
