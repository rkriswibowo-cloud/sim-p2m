"use client";

import { ArrowLeft, Download, Eye, Pencil, Plus, Save, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, fieldClass } from "@/components/ui/input";
import { confirmRemoval, workspaceToastOptions } from "../confirm-removal";
import { api, json } from "./view";

type Institution = { id: number; name: string };
type Project = { id: number; title: string; scheme: string; year: number; budget: string | null; writable: boolean; count: number; progress: number | null };
type Category = { id: number; name: string };
type Overview = { items: Project[]; categories: Category[] };
type Entry = {
  id: number; date: string; activity: string; result: string; obstacle: string; revision: number;
  progress: number | null; fileNumber: string; category: string; amount: string; evidenceCount: number;
};
const dateFormat = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "UTC" });
const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const monthFormat = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
const empty: Entry = { id: 0, date: "", activity: "", result: "", obstacle: "", revision: 0, progress: null, fileNumber: "", category: "", amount: "", evidenceCount: 0 };

async function encodeEvidence(file: File) {
  const content = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(new Error("Berkas bukti tidak dapat dibaca."));
    reader.readAsDataURL(file);
  });
  return { name: file.name, content };
}

export function ResearchJournal({ institutions }: { institutions: Institution[] }) {
  const [tenant, setTenant] = useState(institutions[0]?.id ?? 0);
  const [year, setYear] = useState("");
  const [project, setProject] = useState<Project>();
  const [overview, setOverview] = useState<Overview>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const base = `/api/v1/iam/institutions/${tenant}/research`;
  useEffect(() => {
    if (!tenant || project) return;
    const controller = new AbortController();
    void api<Overview>(base + "/journal-overview", { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setOverview(data); })
      .catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [base, tenant, project, refresh]);

  if (project) return <JournalDetail project={project} categories={overview?.categories ?? []}
    endpoint={`${base}/${project.id}/journal`} onBack={() => { setProject(undefined); setOverview(undefined); setRefresh(value => value + 1); }} />;

  const years = [...new Set(overview?.items.map(item => item.year))];
  const projects = overview?.items.filter(item => !year || item.year === Number(year));
  return <Card className="workspace-panel">
    <CardHeader><CardTitle>Catatan Harian Penelitian</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {institutions.length > 1 && <Field id="journal-institution" label="Institusi">
          <select id="journal-institution" className={fieldClass} value={tenant} onChange={event => {
            setTenant(Number(event.target.value)); setYear(""); setOverview(undefined); setError("");
          }}>{institutions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </Field>}
        <Field id="journal-year" label="Tahun pelaksanaan" className="sm:col-start-2">
          <select id="journal-year" className={fieldClass} value={year} onChange={event => setYear(event.target.value)}>
            <option value="">Semua tahun</option>{years.map(item => <option key={item}>{item}</option>)}
          </select>
        </Field>
      </div>
      <p className="rounded-md border border-border bg-muted p-3 text-sm text-foreground">Persentase capaian mengikuti catatan yang terakhir ditambahkan.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!tenant && <p>Belum ada institusi aktif dengan izin Penelitian.</p>}
      {!!tenant && !projects && !error && <p role="status">Memuat daftar usulan…</p>}
      {projects?.length === 0 && <p className="text-sm text-muted-foreground">Belum ada usulan penelitian terkirim untuk tahun ini.</p>}
      {!!projects?.length && <div className="overflow-x-auto"><table className="workspace-table w-full min-w-[44rem] text-left text-sm">
        <thead><tr>{["No.", "Skema", "Tahun", "Judul Usulan", "Keterangan", "Aksi"].map(value => <th key={value} scope="col">{value}</th>)}</tr></thead>
        <tbody>{projects.map((item, index) => <tr key={item.id}>
          <td>{index + 1}</td><td>{item.scheme}</td><td>{item.year}</td>
          <td><p className="font-medium">{item.title}</p><p className="text-xs text-muted-foreground">Dana disetujui · {item.budget === null ? "Belum ditetapkan" : money.format(BigInt(item.budget))}</p></td>
          <td className="text-xs"><p>{item.count} catatan</p><p>Capaian {item.progress === null ? "–" : `${item.progress}%`}</p></td>
          <td><Button data-action-tone="info" size="sm" variant="outline" onClick={() => setProject(item)}><Eye size={15} aria-hidden="true" /> Buka catatan</Button></td>
        </tr>)}</tbody>
      </table></div>}
    </CardContent>
  </Card>;
}

function JournalDetail({ project, categories, endpoint, onBack }: { project: Project; categories: Category[]; endpoint: string; onBack: () => void }) {
  const [entries, setEntries] = useState<Entry[]>();
  const [editor, setEditor] = useState<Entry>();
  const dialog = useRef<HTMLDialogElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [month, setMonth] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void api<Entry[]>(endpoint, { signal: controller.signal }).then(items => {
      if (!controller.signal.aborted) setEntries(items);
    }).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [endpoint, refresh]);
  useEffect(() => {
    if (editor && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [editor]);

  async function change(entry: Entry, remove = false) {
    if (pending) return;
    setPending(true);
    try {
      if (remove && !await confirmRemoval("Hapus catatan harian?", entry.activity)) return;
      setError("");
      const path = entry.id ? `${endpoint}/${entry.id}` : endpoint;
      const payload = remove ? { revision: entry.revision } : { ...entry, files: await Promise.all(files.map(encodeEvidence)) };
      await api(path, json(remove ? "DELETE" : entry.id ? "PUT" : "POST", payload));
      dialog.current?.close();
      setRefresh(value => value + 1);
      toast.success(remove ? "Catatan dihapus." : "Catatan disimpan.", workspaceToastOptions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  function edit(entry: Entry) {
    setError(""); setFiles([]); setEditor(entry);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editor) void change(editor);
  }

  const months = [...new Set(entries?.map(entry => entry.date.slice(0, 7)))];
  const visible = entries?.filter(entry => !month || entry.date.startsWith(month));
  return <Card className="workspace-panel">
    <CardHeader><CardTitle>{project.title}</CardTitle>
      <p className="text-sm text-muted-foreground">{project.scheme} · Tahun pelaksanaan {project.year}</p>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={pending || !!editor} onClick={onBack}><ArrowLeft size={15} aria-hidden="true" /> Kembali</Button>
          {project.writable && <Button data-action-tone="positive" size="sm" disabled={pending || !!editor || !entries} onClick={() => edit(empty)}><Plus size={15} aria-hidden="true" /> Tambah catatan</Button>}
        </div>
        <Field id="journal-month" label="Bulan kegiatan">
          <select id="journal-month" className={fieldClass} value={month} onChange={event => setMonth(event.target.value)}>
            <option value="">Semua bulan</option>
            {months.map(value => <option key={value} value={value}>{monthFormat.format(new Date(value + "-01"))}</option>)}
          </select>
        </Field>
      </div>
      {!project.writable && <p className="text-sm text-muted-foreground">Pengisian catatan harian belum diaktifkan untuk periode ini.</p>}
      {error && !editor && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {editor && <dialog ref={dialog} aria-labelledby="journal-form-title"
        className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-5xl overflow-y-auto rounded-lg border border-border bg-card p-4 text-foreground backdrop:bg-black/55 sm:p-5"
        onCancel={event => { event.preventDefault(); if (!pending) dialog.current?.close(); }}
        onClose={() => { setEditor(undefined); setFiles([]); setError(""); }}>
        <form onSubmit={save} data-research-editing="" className="space-y-4">
        <h3 id="journal-form-title" className="text-base font-semibold">{editor.id ? "Ubah catatan" : "Tambah catatan dan bukti"}</h3>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <fieldset disabled={pending} className="grid min-w-0 gap-4 lg:grid-cols-2">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Input label="Tanggal kegiatan" type="date" required value={editor.date} onChange={event => setEditor({ ...editor, date: event.target.value })} />
            <Input label="Persentase capaian (%)" type="number" min={0} max={100} step={1} value={editor.progress ?? ""}
              onChange={event => setEditor({ ...editor, progress: event.target.value === "" ? null : Number(event.target.value) })} />
            <Field id="journal-category" label="Kelompok biaya">
              <select id="journal-category" className={fieldClass} value={editor.category} onChange={event => setEditor({ ...editor, category: event.target.value })}>
                <option value="">Pilih kelompok biaya</option>
                {categories.map(category => <option key={category.id}>{category.name}</option>)}
                {editor.category && !categories.some(item => item.name === editor.category) && <option>{editor.category}</option>}
              </select>
            </Field>
            <Input label="Nominal (Rp)" inputMode="numeric" pattern="[0-9]*" maxLength={15} value={editor.amount} placeholder="0" onChange={event => setEditor({ ...editor, amount: event.target.value })} />
            <Input label="Nomor berkas" maxLength={100} value={editor.fileNumber} onChange={event => setEditor({ ...editor, fileNumber: event.target.value })} />
            {([["activity", "Uraian kegiatan", 2000], ["result", "Hasil", 4000], ["obstacle", "Kendala", 2000]] as const).map(([key, label, max]) => (
              <label key={key} className="block text-sm sm:col-span-2">{label}
                <textarea className={`${fieldClass} mt-1 block w-full`} rows={key === "activity" ? 3 : 2} required={key === "activity"} maxLength={max}
                  value={editor[key]} onChange={event => setEditor({ ...editor, [key]: event.target.value })} />
              </label>
            ))}
          </div>
          <div className="min-w-0 space-y-3 self-start rounded-md border border-border p-3">
            <h4 className="text-sm font-semibold">Berkas bukti biaya</h4>
            <p className="text-xs text-muted-foreground">Unggah kuitansi, tiket, atau invoice. Maksimal 3 PDF, JPG, atau PNG, masing-masing 2 MB.</p>
            {!!editor.evidenceCount && <EvidenceLinks endpoint={endpoint} entry={editor} />}
            <Input icon={<Upload size={15} aria-hidden="true" />} label="Tambah berkas bukti" type="file" accept="application/pdf,image/jpeg,image/png" multiple disabled={editor.evidenceCount + files.length >= 3}
              onChange={event => {
                const selected = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (editor.evidenceCount + files.length + selected.length > 3 || selected.some(file => file.size > 2 * 1024 * 1024)) {
                  setError("Maksimal 3 berkas per catatan, masing-masing 2 MB."); return;
                }
                setError(""); setFiles(previous => [...previous, ...selected]);
              }} />
            {files.map((file, index) => <div key={index} className="flex items-center justify-between gap-2 text-xs">
              <span className="wrap-anywhere">{file.name}</span>
              <Button data-action-tone="danger" type="button" size="icon-sm" variant="ghost" aria-label={`Lepas ${file.name}`} onClick={() => setFiles(previous => previous.filter((_, i) => i !== index))}><Trash2 size={15} aria-hidden="true" /></Button>
            </div>)}
          </div>
        </fieldset>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="outline" disabled={pending} onClick={() => dialog.current?.close()}>Batal</Button>
          <Button data-action-tone="positive" type="submit" disabled={pending}><Save size={15} aria-hidden="true" /> {pending ? "Menyimpan…" : "Simpan catatan"}</Button>
        </div>
      </form></dialog>}
      {!entries && !error && <p role="status">Memuat catatan…</p>}
      {visible?.length === 0 && <p className="text-sm text-muted-foreground">Belum ada catatan untuk filter ini.</p>}
      {!!visible?.length && <div className="overflow-x-auto"><table className="workspace-table w-full min-w-[64rem] text-left text-sm">
        <thead><tr>{["No.", "Tanggal", "Kegiatan", "Capaian", "Total Berkas", "No. Berkas", "Kelompok Biaya", "Nominal", "Aksi"].map(value => <th key={value} scope="col">{value}</th>)}</tr></thead>
        <tbody>{visible.map((entry, index) => <tr key={entry.id}>
          <td>{index + 1}</td><td className="whitespace-nowrap">{dateFormat.format(new Date(entry.date))}</td>
          <td className="wrap-anywhere">{entry.activity}{entry.result && <p className="text-xs text-muted-foreground">Hasil · {entry.result}</p>}{entry.obstacle && <p className="text-xs text-muted-foreground">Kendala · {entry.obstacle}</p>}</td>
          <td>{entry.progress === null ? "–" : `${entry.progress}%`}</td><td>{entry.evidenceCount}<EvidenceLinks endpoint={endpoint} entry={entry} /></td>
          <td>{entry.fileNumber || "–"}</td><td>{entry.category || "–"}</td><td className="whitespace-nowrap">{money.format(BigInt(entry.amount))}</td>
          <td>{project.writable && <div className="flex gap-1">
            <Button data-action-tone="edit" size="icon-sm" variant="outline" aria-label={`Ubah ${entry.activity}`} disabled={pending || !!editor} onClick={() => edit(entry)}><Pencil size={15} aria-hidden="true" /></Button>
            <Button data-action-tone="danger" size="icon-sm" variant="ghost" className="text-destructive" aria-label={`Hapus ${entry.activity}`} disabled={pending || !!editor} onClick={() => void change(entry, true)}><Trash2 size={15} aria-hidden="true" /></Button>
          </div>}</td>
        </tr>)}</tbody>
      </table></div>}
    </CardContent>
  </Card>;
}

function EvidenceLinks({ endpoint, entry }: { endpoint: string; entry: Entry }) {
  return <div className="flex flex-wrap gap-2">
    {Array.from({ length: entry.evidenceCount }, (_, index) => <a key={index} href={`${endpoint}/${entry.id}/evidence/${index + 1}`}
      className="inline-flex items-center gap-1 text-xs text-brand underline" download><Download size={13} aria-hidden="true" /> Bukti {index + 1}</a>)}
  </div>;
}
