"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { confirmRemoval, workspaceToastOptions } from "../confirm-removal";

type Mode = "production" | "trial-admin" | "trial-reader";
type Choice = { id: number; name: string };
type Institution = Choice & { active: boolean; canGrantRead: boolean };
type Period = Choice & {
  code: string; proposalYear: number; projectYear: number; budgetYear: number;
  opensAt: string; closesAt: string; state: "scheduled" | "open" | "closed";
};
type Version = {
  id: number; periodId: number; schemeId: number; sourceId: number; version: number;
  scheme: string; source: string; budget: string; quota: number; duration: number;
  activeLecturer: boolean; requireNuptk?: boolean; minJafung?: string; manual: string; publishedAt: string;
};

const jafungLabels: Record<string, string> = {
  "": "Semua jabatan fungsional",
  tenaga_pengajar: "Tenaga Pengajar",
  asisten_ahli: "Asisten Ahli",
  lektor: "Lektor",
  lektor_kepala: "Lektor Kepala",
  guru_besar: "Guru Besar",
};
type Answer = { result: "eligible" | "ineligible" | "manual"; reasons: string[] };
type Overview = { periods: Period[]; versions: Version[]; canManage: boolean };
type Options = { schemes: Choice[]; sources: Choice[] };
const statusLabels = { scheduled: "Terjadwal", open: "Terbuka", closed: "Ditutup" };
const verdictLabels = { eligible: "Memenuhi syarat awal", ineligible: "Tidak memenuhi syarat", manual: "Perlu verifikasi" };
const localDate = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (response.status === 401) {
    window.location.replace("/login?renew=1");
    throw new Error("Sesi berakhir.");
  }
  if (response.status === 403) throw new Error("Akun Anda belum punya izin untuk tindakan ini.");
  if (response.status === 404) throw new Error("Data tidak tersedia atau sudah digantikan.");
  if (response.status === 409) {
    const body = await response.json() as {error?: string};
    throw new Error(body.error === "published_period" ? "Jadwal terkunci setelah skema pertama diterbitkan." : "Kode periode sudah digunakan.");
  }
  if (response.status === 400) throw new Error("Periksa jadwal dan isian. Versi baru hanya dapat diterbitkan untuk periode yang belum ditutup.");
  if (!response.ok) throw new Error("Layanan Hibah belum dapat memproses permintaan.");
  return response.json() as Promise<T>;
}

function dateWithOffset(value: FormDataEntryValue | null) {
  return `${value}:00+07:00`;
}

function dateForInput(value?: string) {
  return value ? new Date(new Date(value).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0,16) : undefined;
}

export function GrantPanel() {
  const [mode, setMode] = useState<Mode>("production");
  const [system, setSystem] = useState(false);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [institution, setInstitution] = useState(0);
  const [overview, setOverview] = useState<Overview>();
  const [options, setOptions] = useState<Options>();
  const [period, setPeriod] = useState(0);
  const [create, setCreate] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<Period>();
  const [revision, setRevision] = useState(0);
  const [revisionForm, setRevisionForm] = useState<{ previous?: Version }>();
  const [answers, setAnswers] = useState<Record<number,Answer>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const base = mode === "production" ? "/api/v1/iam" : `/api/v1/trial/${mode}/iam`;
  const endpoint = `${base}/institutions/${institution}/grants`;
  const selected = overview?.periods.find(item => item.id === period);

  useEffect(() => {
    const controller = new AbortController();
    void api<{items: Institution[]; system: boolean}>(base + "/institutions", { signal: controller.signal }).then(response => {
      if (controller.signal.aborted) return;
      const allowed = response.items.filter(item => item.active && item.canGrantRead);
      setInstitutions(allowed);
      setInstitution(allowed[0]?.id ?? 0);
      if (mode === "production") setSystem(response.system);
    }).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [base, mode]);

  useEffect(() => {
    if (!institution) return;
    const controller = new AbortController();
    async function load() {
      const data = await api<Overview>(endpoint, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setOverview(data);
      setPeriod(previous => data.periods.some(item => item.id === previous) ? previous : data.periods[0]?.id ?? 0);
      if (data.canManage) {
        const values = await api<Options>(endpoint + "/options", { signal: controller.signal });
        if (!controller.signal.aborted) setOptions(values);
      }
    }
    void load().catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [endpoint, institution, revision]);

  function clearScope() {
    setOverview(undefined);
    setOptions(undefined);
    setPeriod(0);
    setCreate(false);
    setEditingPeriod(undefined);
    setRevisionForm(undefined);
    setAnswers({});
    setError("");
  }

  async function chooseMode(value: Mode) {
    if (value === mode) return;
    setPending(true);
    try {
      if (value !== "production") await api(`/api/v1/trial/${value}/iam/enter`, {method:"POST"});
      clearScope();
      setInstitutions([]);
      setInstitution(0);
      setMode(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trial belum dapat dibuka.");
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>, kind: "period" | "version") {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const payload = kind === "period" ? {
        code: fields.get("code"), name: fields.get("name"),
        proposalYear: Number(fields.get("proposalYear")), projectYear: Number(fields.get("projectYear")),
        budgetYear: Number(fields.get("budgetYear")), opensAt: dateWithOffset(fields.get("opensAt")), closesAt: dateWithOffset(fields.get("closesAt")),
      } : {
        schemeId: Number(fields.get("schemeId")), sourceId: Number(fields.get("sourceId")),
        budget: fields.get("budget"), quota: Number(fields.get("quota")), duration: Number(fields.get("duration")),
        activeLecturer: fields.has("activeLecturer"), requireNuptk: fields.has("requireNuptk"), minJafung: fields.get("minJafung"), manual: fields.get("manual"),
      };
      const path = kind === "period"
        ? "/periods" + (editingPeriod ? `/${editingPeriod.id}` : "")
        : previous ? `/versions/${previous.id}` : `/periods/${period}/versions`;
      const method = (kind === "period" && editingPeriod) || (kind === "version" && previous) ? "PUT" : "POST";
      const response = await api<{id:number}>(endpoint + path, {
        method, headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload),
      });
      if (kind === "period") {
        setCreate(false);
        setEditingPeriod(undefined);
        setPeriod(response.id);
      } else {
        setRevisionForm(undefined);
        setAnswers({});
      }
      setRevision(previousRevision => previousRevision + 1);
      toast.success(
        kind === "period" ? "Periode hibah disimpan." : previous ? "Skema hibah diperbarui." : "Skema hibah ditambahkan.",
        workspaceToastOptions,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Perubahan gagal disimpan.";
      setError(message);
      toast.error(message, workspaceToastOptions);
    } finally {
      setPending(false);
    }
  }

  async function removeScheme(item: Version) {
    if (!await confirmRemoval("Hapus skema?", `Skema "${item.scheme}" akan dihapus dari periode ini.`)) return;
    setPending(true);
    setError("");
    try {
      await api(`${endpoint}/versions/${item.id}`, { method: "DELETE" });
      if (previous?.id === item.id) setRevisionForm(undefined);
      setRevision(previousRevision => previousRevision + 1);
      toast.success("Skema hibah dihapus.", workspaceToastOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Skema gagal dihapus.";
      setError(message);
      toast.error(message, workspaceToastOptions);
    } finally {
      setPending(false);
    }
  }

  async function check(version: number) {
    setPending(true);
    setError("");
    try {
      const result = await api<Answer>(endpoint + `/versions/${version}/eligibility`);
      setAnswers(previous => ({...previous,[version]:result}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kelayakan belum dapat diperiksa.");
    } finally {
      setPending(false);
    }
  }

  const versions = overview?.versions.filter(item => item.periodId === period) ?? [];
  const latest = versions.filter((item,index) => versions.findIndex(version => version.schemeId === item.schemeId) === index);
  const previous = revisionForm?.previous;

  return (
    <section className="space-y-4">
      <header className="workspace-heading flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hibah</h1>
          {mode !== "production" && <p className="mt-1 text-sm text-brand">Mode trial · database terpisah</p>}
        </div>
        {overview?.canManage && !create && <Button disabled={pending} onClick={() => {setEditingPeriod(undefined);setRevisionForm(undefined);setCreate(true);}}>Buat periode</Button>}
      </header>

      <div className="workspace-toolbar grid gap-2 sm:grid-cols-3">
        {system && <div className="min-w-0">
          <label htmlFor="grant-mode" className="mb-1 block">Lingkungan dan peran</label>
          <select id="grant-mode" className="w-full" value={mode} disabled={pending} onChange={event => void chooseMode(event.target.value as Mode)}>
            <option value="production">Operasional</option><option value="trial-admin">Trial · Pengelola</option><option value="trial-reader">Trial · Pembaca</option>
          </select>
        </div>}
        <div className="min-w-0">
          <label htmlFor="grant-institution" className="mb-1 block">Institusi</label>
          <select id="grant-institution" className="w-full" value={institution} disabled={pending} onChange={event => {clearScope();setInstitution(Number(event.target.value));}}>
            {!institutions.length && <option value={0}>Belum ada institusi yang dapat diakses</option>}
            {institutions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor="grant-period" className="mb-1 block">Periode hibah</label>
          <select id="grant-period" className="w-full" value={period} disabled={pending} onChange={event => {setCreate(false);setEditingPeriod(undefined);setRevisionForm(undefined);setAnswers({});setPeriod(Number(event.target.value));}}>
            {!overview?.periods.length && <option value={0}>Belum ada periode</option>}
            {overview?.periods.map(item => <option key={item.id} value={item.id}>{item.name} · {statusLabels[item.state]}</option>)}
          </select>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {create && overview?.canManage && <Card className="workspace-panel rounded-md">
        <CardHeader><CardTitle>{editingPeriod ? "Ubah periode" : "Periode baru"}</CardTitle></CardHeader>
        <CardContent>
          <form key={editingPeriod?.id ?? "new"} method="post" onSubmit={event => void submit(event,"period")} className="workspace-fields grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Input label="Kode periode" name="code" maxLength={64} required defaultValue={editingPeriod?.code} />
            <Input label="Nama periode" name="name" maxLength={200} required defaultValue={editingPeriod?.name} />
            <Input label="Tahun usulan" name="proposalYear" type="number" min={2000} max={2200} required defaultValue={editingPeriod?.proposalYear} />
            <Input label="Tahun pelaksanaan" name="projectYear" type="number" min={2000} max={2200} required defaultValue={editingPeriod?.projectYear} />
            <Input label="Tahun anggaran" name="budgetYear" type="number" min={2000} max={2200} required defaultValue={editingPeriod?.budgetYear} />
            <Input label="Mulai pendaftaran (WIB)" name="opensAt" type="datetime-local" required defaultValue={dateForInput(editingPeriod?.opensAt)} />
            <Input label="Tutup pendaftaran (WIB)" name="closesAt" type="datetime-local" required defaultValue={dateForInput(editingPeriod?.closesAt)} />
            <div className="workspace-form-actions"><Button type="button" variant="outline" disabled={pending} onClick={() => setCreate(false)}>Batal</Button><Button disabled={pending}>Simpan periode</Button></div>
          </form>
        </CardContent>
      </Card>}

      {!selected && overview && <p className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
        {overview.canManage ? "Belum ada periode hibah. Buat periode untuk mulai mengatur skema." : "Belum ada hibah yang terbuka untuk institusi ini."}
      </p>}

      {selected && <Card className="workspace-panel rounded-md">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{selected.name}</CardTitle>
            <span className="workspace-status" data-active={selected.state === "open"}>{statusLabels[selected.state]}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">{localDate.format(new Date(selected.opensAt))} – {localDate.format(new Date(selected.closesAt))} WIB</p>
          <p className="text-xs text-muted-foreground">{selected.code} · Usulan {selected.proposalYear} · Pelaksanaan {selected.projectYear} · Anggaran {selected.budgetYear}</p>
          <div className="flex flex-wrap gap-2">
            {overview?.canManage && !create && <Button size="sm" variant="outline" disabled={pending} onClick={() => {setRevisionForm(undefined);setEditingPeriod(selected);setCreate(true);}}>Edit periode</Button>}
            {overview?.canManage && selected.state !== "closed" && !revisionForm && <Button size="sm" variant="outline" disabled={pending} onClick={() => {setCreate(false);setRevisionForm({});}}>Tambah skema</Button>}
          </div>
        </CardContent>
      </Card>}

      {revisionForm && options && selected && <Card className="workspace-panel rounded-md">
        <CardHeader><CardTitle>{previous ? `Edit skema · ${previous.scheme}` : "Tambah skema untuk periode ini"}</CardTitle></CardHeader>
        <CardContent>
          {(!options.schemes.length || !options.sources.length) && <p role="status" className="mb-3 text-sm">Tambahkan skema dan sumber dana aktif di Master Data sebelum menerbitkan.</p>}
          <form key={`${period}:${previous?.id ?? "new"}`} method="post" onSubmit={event => void submit(event,"version")} className="workspace-fields grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="min-w-0"><label htmlFor="scheme" className="mb-1 block">Skema</label>
              <select id="scheme" name="schemeId" className="w-full" required defaultValue={previous?.schemeId ?? ""}>
                <option value="">Pilih skema</option>{options.schemes.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </div>
            <div className="min-w-0"><label htmlFor="source" className="mb-1 block">Sumber dana</label>
              <select id="source" name="sourceId" className="w-full" required defaultValue={previous?.sourceId ?? ""}>
                <option value="">Pilih sumber dana</option>{options.sources.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </div>
            <Input label="Pagu anggaran skema (rupiah)" name="budget" inputMode="numeric" pattern="[0-9]+" defaultValue={previous?.budget} required maxLength={19} />
            <Input label="Kuota kegiatan" name="quota" type="number" min={1} max={1000000} defaultValue={previous?.quota} required />
            <Input label="Durasi kegiatan (bulan)" name="duration" type="number" min={1} max={120} defaultValue={previous?.duration} required />
            <div className="min-w-0"><label htmlFor="minJafung" className="mb-1 block">Jabatan fungsional minimal</label>
              <select id="minJafung" name="minJafung" className="w-full" defaultValue={previous?.minJafung ?? ""}>
                {Object.entries(jafungLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" name="activeLecturer" defaultChecked={previous?.activeLecturer} /> Pengusul wajib dosen aktif</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="requireNuptk" defaultChecked={previous?.requireNuptk} /> Pengusul wajib memiliki NUPTK</label>
            <div className="sm:col-span-2 xl:col-span-3"><label htmlFor="manual" className="mb-1 block">Syarat yang diverifikasi admin atau LPPM</label>
              <textarea id="manual" name="manual" rows={3} maxLength={1000} defaultValue={previous?.manual} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
            </div>
            <div className="workspace-form-actions"><Button type="button" variant="outline" disabled={pending} onClick={() => setRevisionForm(undefined)}>Batal</Button>
              <Button disabled={pending || !options.schemes.length || !options.sources.length}>{previous ? "Simpan perubahan" : "Simpan skema"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>}

      {selected && <div className="grid gap-3 lg:grid-cols-2">
        {latest.length === 0 && <p className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">Belum ada skema yang diterbitkan untuk periode ini.</p>}
        {latest.map(item => <Card key={item.id} className="workspace-panel min-w-0 rounded-md">
          <CardHeader><CardTitle>{item.scheme}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">{item.source}</p>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Pagu</dt><dd className="break-words font-medium">{rupiah.format(BigInt(item.budget))}</dd></div>
              <div><dt className="text-muted-foreground">Kuota</dt><dd>{item.quota}</dd></div>
              <div><dt className="text-muted-foreground">Durasi</dt><dd>{item.duration} bulan</dd></div>
            </dl>
            {item.activeLecturer && <p className="text-xs text-muted-foreground">Wajib berstatus dosen aktif.</p>}
            <p className="text-xs text-muted-foreground">{item.requireNuptk ? "Wajib memiliki NUPTK." : "Dapat diikuti tanpa NUPTK (skema pemula)."}</p>
            {item.minJafung && <p className="text-xs text-muted-foreground">Jabatan fungsional minimal: {jafungLabels[item.minJafung] ?? item.minJafung}.</p>}
            {item.manual && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{item.manual}</p>}
            <div className="flex flex-wrap gap-2">
              {selected.state === "open" && <Button size="sm" variant="outline" disabled={pending} onClick={() => void check(item.id)}>Cek kelayakan saya</Button>}
              {overview?.canManage && selected.state !== "closed" && <Button size="sm" variant="outline" disabled={pending} onClick={() => setRevisionForm({previous:item})}>Edit</Button>}
              {overview?.canManage && selected.state !== "closed" && <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => void removeScheme(item)}>Hapus</Button>}
            </div>
            {answers[item.id] && <div className="rounded-md border border-border bg-background p-2 text-sm" role="status">
              <strong>{verdictLabels[answers[item.id].result]}</strong>
              <ul className="mt-1 list-inside list-disc text-muted-foreground">{answers[item.id].reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
            </div>}
          </CardContent>
        </Card>)}
      </div>}
    </section>
  );
}
