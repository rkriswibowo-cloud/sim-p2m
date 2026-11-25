"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { confirmRemoval, workspaceToastOptions } from "../confirm-removal";
import { ProposalFields } from "../penelitian/proposal-fields";
import type { Choice, ProposalData } from "../penelitian/proposal-fields";

type Schedule = { activity: string; from: number; to: number };
type Cost = { category: string; item: string; reason: string; quantity: number; price: string };
type Target = { solution: string; output: string; indicator: string };
type DraftData = { partner: string; location: string; need: string; plan: string; outcome: string; budget: string; audience?: string; indicator?: string; startsOn?: string; endsOn?: string;
  introduction?: string; solution?: string; technology?: string; references?: string; schedule?: Schedule[] | null;
  costs?: Cost[] | null; targets?: Target[] | null; team?: string; locationMap?: string;
  members?: ProposalData["team"] | null; students?: ProposalData["students"] | null };
type Draft = { id: number; title: string; revision: number; data: DraftData; updatedAt: string;
  grantVersionId?: number | null; scheme?: string; period?: string; grantBudget?: string };
type GrantOption = { id: number; scheme: string; period: string; year: number; budget: string };
type Institution = { id: number; name: string };
type TeamOptions = { chair: Choice; lecturers: Choice[]; students: Choice[] };

const blank: Draft = { id: 0, title: "", revision: 0, updatedAt: "", data: { partner: "", location: "", need: "", plan: "", outcome: "", budget: "" } };
const dates = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" });
const budgetFormat = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const budgetGroups = [
  { key: "materials", label: "Bahan Habis Pakai", share: 40 },
  { key: "copies", label: "Penggandaan", share: 10 },
  { key: "support", label: "Penunjang", share: 30 },
  { key: "other", label: "Lain-Lain", share: 20 },
];
function costTotal(row: Cost) {
  return BigInt(/^[0-9]+$/.test(row.price) ? row.price : "0") * BigInt(Number.isSafeInteger(row.quantity) && row.quantity > 0 ? row.quantity : 0);
}
function totalCosts(rows: Cost[]) {
  return rows.reduce((total, row) => total + costTotal(row), BigInt(0));
}

async function request<T>(path: string, signal?: AbortSignal, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { signal, method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (response.status === 401) window.location.replace("/login?renew=1");
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(result?.message ?? (response.status === 403 ? "Akun belum punya izin untuk tindakan ini." : "Layanan draf belum dapat memproses permintaan."));
  }
  return response.json() as Promise<T>;
}

export function CommunityPanel({ institutions }: { institutions: Institution[] }) {
  const [tenant, setTenant] = useState(institutions[0]?.id ?? 0);
  return <section className="space-y-4">
    {institutions.length > 1 && <label className="flex flex-wrap items-center gap-2 text-sm">
      Institusi <select value={tenant} onChange={event => setTenant(Number(event.target.value))}>
        {institutions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>}
    {tenant ? <Drafts key={tenant} endpoint={`/api/v1/iam/institutions/${tenant}/community`} /> : <p>Belum ada institusi aktif dengan izin PkM.</p>}
  </section>;
}

function Drafts({ endpoint }: { endpoint: string }) {
  const [items, setItems] = useState<Draft[]>();
  const [draft, setDraft] = useState<Draft>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [teamOptions, setTeamOptions] = useState<TeamOptions>();
  const [teamFailed, setTeamFailed] = useState(false);
  const [grantOptions, setGrantOptions] = useState<GrantOption[]>();
  const [grantsFailed, setGrantsFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void request<Draft[]>(endpoint, controller.signal).then(setItems).catch((err: Error) => {
      if (!controller.signal.aborted) setError(err.message);
    });
    return () => controller.abort();
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    void request<GrantOption[]>(endpoint + "/grant-options", controller.signal)
      .then(result => { if (!controller.signal.aborted) setGrantOptions(result); })
      .catch(() => { if (!controller.signal.aborted) setGrantsFailed(true); });
    void request<TeamOptions>(endpoint + "/team-options", controller.signal)
      .then(result => { if (!controller.signal.aborted) setTeamOptions(result); })
      .catch(() => { if (!controller.signal.aborted) setTeamFailed(true); });
    return () => controller.abort();
  }, [endpoint]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || pending) return;
    const current = draft.data.costs ? { ...draft, data: { ...draft.data, budget: totalCosts(draft.data.costs).toString() } } : draft;
    setPending(true);
    setError("");
    try {
      const result = await request<{ id: number }>(current.id ? `${endpoint}/${current.id}` : endpoint, undefined, current.id ? "PUT" : "POST", current);
      const saved = { ...current, id: result.id, title: current.title.trim(), revision: current.revision + 1, updatedAt: new Date().toISOString() };
      setItems(previous => [saved, ...(previous ?? []).filter(item => item.id !== saved.id)]);
      setDraft(undefined);
      toast.success("Draf PkM disimpan.", workspaceToastOptions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function remove(item: Draft) {
    if (pending) return;
    setPending(true);
    try {
      if (!(await confirmRemoval("Hapus draf PkM?", item.title))) return;
      setError("");
      await request(`${endpoint}/${item.id}`, undefined, "DELETE", { revision: item.revision });
      setItems(previous => previous?.filter(row => row.id !== item.id));
      if (draft?.id === item.id) setDraft(undefined);
      toast.success("Draf PkM dihapus.", workspaceToastOptions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  function update<K extends keyof DraftData>(key: K, value: DraftData[K]) {
    setDraft(previous => previous && { ...previous, data: { ...previous.data, [key]: value } });
  }

  function narrative(key: "need" | "plan" | "outcome" | "indicator" | "introduction" | "solution" | "technology" | "references",
    label: string, hint?: string, maxWords?: number) {
    const value = draft?.data[key] ?? "";
    const words = value.trim().split(/\s+/).filter(Boolean).length;
    return <label className="space-y-1 text-sm sm:col-span-2">
      <span>{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      <textarea rows={4} maxLength={key === "outcome" || key === "indicator" ? 3000 : 12000} value={value} onChange={event => update(key, event.target.value)}
        className="block w-full rounded-md border border-input bg-background p-2" />
      {maxWords !== undefined && <span className={words > maxWords ? "block text-xs text-destructive" : "block text-xs text-muted-foreground"}>{words} / {maxWords} kata</span>}
    </label>;
  }

  const schedule = draft?.data.schedule ?? [];
  const costs = draft?.data.costs ?? [];
  const targets = draft?.data.targets ?? [];

  return <div className="space-y-4">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Draf usulan</CardTitle>
        <Button type="button" size="sm" disabled={pending || !!draft || !items} onClick={() => setDraft(blank)}><Plus size={16} /> Tambah draf</Button>
      </CardHeader>
      <CardContent>
        {!items && !error && <p role="status" className="text-sm text-muted-foreground">Memuat draf…</p>}
        {items?.length === 0 && <p className="text-sm text-muted-foreground">Belum ada draf usulan PkM.</p>}
        {!!items?.length && <ul className="divide-y divide-border">
          {items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0"><p className="break-words font-medium">{item.title}</p>
              <p className="break-words text-xs text-muted-foreground">{item.data.partner && `${item.data.partner} · `}{dates.format(new Date(item.updatedAt))}</p>
              {item.scheme && <p className="mt-1 text-xs text-brand">{item.scheme} · {item.period}</p>}
              {item.data.budget && <p className="mt-1 text-xs text-muted-foreground">Estimasi {budgetFormat.format(BigInt(item.data.budget))}</p>}
            </div>
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(item)} disabled={pending || !!draft}><Pencil size={15} /> Ubah</Button>
              <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => void remove(item)} disabled={pending || !!draft}><Trash2 size={15} /> Hapus</Button>
            </div>
          </li>)}
        </ul>}
      </CardContent>
    </Card>
    {draft && <Card>
      <CardHeader><CardTitle>{draft.id ? "Ubah draf" : "Draf baru"}</CardTitle></CardHeader>
      <CardContent><form onSubmit={save} data-community-editing="" className="space-y-3">
        <Input id="pkm-title" label="Judul kegiatan" required maxLength={300} disabled={pending} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
        <fieldset disabled={pending || !grantOptions} className="min-w-0 space-y-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold">Skema Hibah Pengabdian</legend>
          <label className="block text-sm">Skema dan periode
            <select className="mt-1 block w-full" required={!!grantOptions?.length} value={draft.grantVersionId || ""} onChange={event => {
              const option = grantOptions?.find(item => item.id === Number(event.target.value));
              setDraft({ ...draft, grantVersionId: option?.id ?? 0, scheme: option?.scheme ?? "", period: option?.period ?? "", grantBudget: option?.budget ?? "" });
            }}>
              <option value="">Pilih skema</option>
              {grantOptions?.map(option => <option key={option.id} value={option.id}>{option.scheme} · {option.period} ({option.year})</option>)}
              {!!draft.grantVersionId && !grantOptions?.some(option => option.id === draft.grantVersionId) &&
                <option value={draft.grantVersionId}>{draft.scheme} · {draft.period} (pilihan tersimpan)</option>}
            </select>
          </label>
          {grantsFailed && <p role="alert" className="text-xs text-destructive">Daftar skema gagal dimuat. Muat ulang halaman untuk mencoba lagi.</p>}
          {grantOptions?.length === 0 && <p className="text-xs text-muted-foreground">Belum ada skema pada periode Pengabdian yang terbuka.</p>}
          {draft.grantBudget && <p className="text-sm text-muted-foreground">Pagu skema <strong className="text-foreground">{budgetFormat.format(BigInt(draft.grantBudget))}</strong></p>}
          {draft.grantBudget && (draft.data.costs ? totalCosts(costs) : BigInt(draft.data.budget || "0")) > BigInt(draft.grantBudget) &&
            <p className="text-sm text-destructive">Total RAB melampaui pagu skema.</p>}
        </fieldset>
        <fieldset disabled={pending} className="min-w-0 space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold">Identitas Tim Pengusul</legend>
          {teamFailed && <p role="alert" className="text-sm text-destructive">Daftar tim gagal dimuat. Muat ulang halaman untuk memilih anggota.</p>}
          {!teamOptions && !teamFailed && <p role="status" className="text-sm text-muted-foreground">Memuat data ketua dan anggota…</p>}
          {teamOptions && <>
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Ketua pelaksana · akun pengusul</p>
              <p className="wrap-anywhere text-sm font-semibold">{teamOptions.chair.name}</p>
              {!teamOptions.chair.id && <p className="text-xs text-muted-foreground">Akun ini belum ditautkan ke dosen aktif di Master Data.</p>}
            </div>
            {!teamOptions.lecturers.some(item => item.id !== teamOptions.chair.id) && <p className="text-xs text-muted-foreground">Belum ada dosen aktif lain di Master Data untuk dipilih sebagai anggota.</p>}
            {!teamOptions.students.length && <p className="text-xs text-muted-foreground">Belum ada mahasiswa aktif di Master Data.</p>}
            <ProposalFields step={1} title="" field={null} budget="0" disabled={pending} onTitle={() => {}} onField={() => {}}
              communityTeam
              teamHint="Pilih maksimal 3 anggota dosen dari Master Data."
              data={{ team: draft.data.members ?? [], students: draft.data.students ?? [] }}
              options={{ fields: [], budgetCategories: [], lecturers: teamOptions.lecturers.filter(item => item.id !== teamOptions.chair.id), students: teamOptions.students }}
              onData={data => setDraft(previous => previous && { ...previous, data: { ...previous.data, members: data.team, students: data.students } })} />
          </>}
          {draft.data.team && <details className="text-xs text-muted-foreground">
            <summary>Catatan tim dari draf lama</summary>
            <p className="mt-1 whitespace-pre-wrap wrap-anywhere">{draft.data.team}</p>
          </details>}
        </fieldset>
        <fieldset disabled={pending} className="grid min-w-0 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">Mitra dan Sasaran</legend>
          <Input id="pkm-partner" label="Nama mitra" maxLength={200} value={draft.data.partner} onChange={event => update("partner", event.target.value)} />
          <Input id="pkm-location" label="Lokasi kegiatan" maxLength={300} value={draft.data.location} onChange={event => update("location", event.target.value)} />
          <Input id="pkm-audience" label="Kelompok sasaran" maxLength={300} value={draft.data.audience ?? ""} onChange={event => update("audience", event.target.value)} />
          <Input id="pkm-map" label="Tautan peta lokasi (opsional)" type="url" maxLength={2048} value={draft.data.locationMap ?? ""} onChange={event => update("locationMap", event.target.value)} />
        </fieldset>
        <fieldset disabled={pending} className="grid min-w-0 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">A–D. Rencana Usulan</legend>
          {narrative("introduction", "A. Pendahuluan", "Jelaskan kondisi mitra, tujuan kegiatan, dan kaitannya dengan MBKM atau IKU bila relevan.", 1000)}
          {narrative("need", "B. Permasalahan prioritas", "Uraikan masalah yang disepakati bersama mitra.", 500)}
          {narrative("solution", "B. Solusi yang ditawarkan", "Hubungkan solusi dengan masalah prioritas dan luaran yang ditargetkan.", 1500)}
          <div className="space-y-2 sm:col-span-2">
            <h3 className="text-sm font-medium">Target per solusi</h3>
            {targets.map((row, index) => <div className="grid items-end gap-2 rounded-md border border-border p-2 lg:grid-cols-[1fr_1fr_1fr_auto]" key={index}>
              {([["solution", "Solusi"], ["output", "Target luaran"], ["indicator", "Indikator capaian"]] as const).map(([key, label]) => <Input
                key={key} label={`${label} ${index + 1}`} required maxLength={300} value={row[key]}
                onChange={event => update("targets", targets.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item))} />)}
              <Button type="button" variant="ghost" className="text-destructive" aria-label={`Hapus target ${index + 1}`}
                onClick={() => update("targets", targets.filter((_, i) => i !== index))}><Trash2 size={16} aria-hidden="true" /></Button>
            </div>)}
            <Button type="button" size="sm" variant="outline" disabled={targets.length >= 30}
              onClick={() => update("targets", [...targets, { solution: "", output: "", indicator: "" }])}><Plus size={16} aria-hidden="true" /> Tambah target</Button>
          </div>
          {narrative("plan", "C. Metode pelaksanaan", "Jelaskan tahapan, partisipasi mitra, peran tim, evaluasi, dan keberlanjutan.", 1500)}
          {narrative("technology", "D. Gambaran IPTEKS", "Jelaskan bentuk, spesifikasi, kegunaan, dan manfaat IPTEKS bagi mitra.", 500)}
        </fieldset>
        <fieldset disabled={pending} className="min-w-0 space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold">E. Anggaran Biaya</legend>
          <p className="text-xs text-muted-foreground">Rinci kebutuhan dan justifikasi setiap pengeluaran. Honor pelaksana tidak diperbolehkan.</p>
          {draft.data.costs == null && draft.data.budget && <p className="text-sm text-muted-foreground">Estimasi draf sebelumnya: {budgetFormat.format(BigInt(draft.data.budget))}</p>}
          <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {budgetGroups.map(group => <div key={group.key} className="rounded border border-border p-2">
              <dt className="text-xs text-muted-foreground">{group.label} · {group.share}% di template</dt>
              <dd className="text-sm font-medium tabular-nums">{budgetFormat.format(totalCosts(costs.filter(row => row.category === group.key)))}</dd>
            </div>)}
          </dl>
          {costs.map((row, index) => <div key={index} className="grid min-w-0 items-end gap-2 rounded-md border border-border p-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.25fr)_minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,0.65fr)_minmax(0,1.2fr)]">
            <label className="block text-sm">Kelompok biaya {index + 1}
              <select className="mt-1 block w-full" value={row.category} required
                onChange={event => update("costs", costs.map((item, i) => i === index ? { ...item, category: event.target.value } : item))}>
                <option value="">Pilih kelompok</option>{budgetGroups.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </label>
            {([["item", "Kebutuhan", 300], ["reason", "Justifikasi anggaran", 500], ["price", "Harga satuan (Rp)", 15]] as const).map(([key, label, max]) => <Input key={key}
              label={label} required maxLength={max} inputMode={key === "price" ? "numeric" : undefined} pattern={key === "price" ? "[0-9]{1,15}" : undefined}
              value={row[key]} onChange={event => update("costs", costs.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item))} />)}
            <Input label="Jumlah" type="number" required min={1} max={100000} value={row.quantity || ""}
              onChange={event => update("costs", costs.map((item, i) => i === index ? { ...item, quantity: Number(event.target.value) } : item))} />
            <div className="flex min-w-0 items-end justify-between gap-1 text-sm"><span className="min-w-0"><span className="block text-xs text-muted-foreground">Subtotal</span><span className="wrap-anywhere tabular-nums">{budgetFormat.format(costTotal(row))}</span></span>
              <Button type="button" size="icon-sm" variant="ghost" className="shrink-0 text-destructive" aria-label={`Hapus baris RAB ${index + 1}`}
                onClick={() => update("costs", costs.filter((_, i) => i !== index))}><Trash2 size={16} aria-hidden="true" /></Button>
            </div>
          </div>)}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" size="sm" variant="outline" disabled={costs.length >= 40}
              onClick={() => update("costs", [...costs, { category: "", item: "", reason: "", quantity: 1, price: "" }])}><Plus size={16} aria-hidden="true" /> Tambah rincian RAB</Button>
            <strong className="text-sm tabular-nums">Total RAB {budgetFormat.format(totalCosts(costs))}</strong>
          </div>
        </fieldset>
        <fieldset disabled={pending} className="grid min-w-0 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">F. Jadwal Pelaksanaan</legend>
          <Input id="pkm-start" label="Rencana mulai" type="date" value={draft.data.startsOn ?? ""} onChange={event => update("startsOn", event.target.value)} />
          <Input id="pkm-end" label="Rencana selesai" type="date" min={draft.data.startsOn || undefined} value={draft.data.endsOn ?? ""} onChange={event => update("endsOn", event.target.value)} />
          <div className="space-y-2 sm:col-span-2">
            {schedule.map((row, index) => <div key={index} className="grid items-end gap-2 rounded-md border border-border p-2 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_auto]">
              <Input label={`Kegiatan ${index + 1}`} maxLength={300} required value={row.activity}
                onChange={event => update("schedule", schedule.map((item, i) => i === index ? { ...item, activity: event.target.value } : item))} />
              {(["from", "to"] as const).map(key => <Input label={key === "from" ? "Bulan mulai" : "Bulan selesai"} key={key}
                type="number" min={key === "to" ? row.from : 1} max={8} required value={row[key] || ""}
                onChange={event => update("schedule", schedule.map((item, i) => i === index ? { ...item, [key]: Number(event.target.value) } : item))} />)}
              <Button type="button" variant="ghost" className="text-destructive" onClick={() => update("schedule", schedule.filter((_, i) => i !== index))}
                aria-label={`Hapus kegiatan ${index + 1}`}><Trash2 size={16} aria-hidden="true" /></Button>
            </div>)}
            <Button type="button" size="sm" variant="outline" disabled={schedule.length >= 30}
              onClick={() => update("schedule", [...schedule, { activity: "", from: 1, to: 1 }])}><Plus size={16} aria-hidden="true" /> Tambah kegiatan</Button>
          </div>
        </fieldset>
        <fieldset disabled={pending} className="grid min-w-0 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">G. Produk atau Luaran</legend>
          {narrative("outcome", "Target produk atau luaran", "Contohnya modul, produk teknologi tepat guna, publikasi, atau HKI.")}
          {narrative("indicator", "Indikator keberhasilan", "Tulis ukuran capaian untuk masing-masing solusi atau luaran.")}
        </fieldset>
        <fieldset disabled={pending} className="min-w-0 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold">H. Daftar Pustaka</legend>
          {narrative("references", "Pustaka yang dikutip", "Gunakan nomor menurut urutan pengutipan (gaya Vancouver).")}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>{pending ? "Menyimpan…" : "Simpan draf"}</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => { setDraft(undefined); setError(""); }}>Batal</Button>
        </div>
      </form></CardContent>
    </Card>}
  </div>;
}
