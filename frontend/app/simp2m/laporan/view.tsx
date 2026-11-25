"use client";

import { CircleCheck, ClipboardList, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmRemoval, workspaceToastOptions } from "../confirm-removal";
import { FinalAttachments } from "./final-attachments";

const sections = {
  progress: [
    ["introduction", "Pendahuluan"], ["method", "Metode"], ["progress", "Kemajuan penelitian"],
    ["nextPlan", "Rencana tahapan berikutnya"], ["budgetNotes", "Catatan anggaran"], ["references", "Daftar pustaka"],
  ],
  final: [
    ["abstract", "Abstrak"], ["keywords", "Kata kunci"], ["introduction", "A. Pendahuluan"], ["literature", "B. Tinjauan Pustaka"],
    ["method", "C. Metode"], ["results", "D. Hasil dan Pembahasan"], ["conclusion", "E. Kesimpulan dan Saran"],
    ["references", "F. Daftar Pustaka"], ["fundUse", "Catatan tambahan LPJ (opsional)"],
  ],
} as const;
const kinds = ["progress", "final"] as const;
const labels = { progress: "Laporan kemajuan", final: "Laporan akhir" };
type Kind = keyof typeof sections;
type OutputTarget = { kind: string; status: string; year: number };
type OutputProgress = { status: string; result: string; evidence: string; followUp: string };
const blankProgress: OutputProgress = { status: "", result: "", evidence: "", followUp: "" };
type Row = {
  proposalId: number; title: string; kind: Kind | ""; revision: number;
  data: Record<string, string>; source: Record<string, string>;
  allowProgressReport?: boolean; allowFinalReport?: boolean; progressUploaded?: boolean;
  outputTargets?: OutputTarget[] | null; outputProgress?: OutputProgress[] | null;
  owner: string; scheme: string; year: number; team: string[]; methodDiagram: boolean; poster: boolean;
};
type Editor = Omit<Row, "kind"> & { kind: Kind };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 401) window.location.replace("/login?renew=1");
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message ?? (response.status === 403 ? "Akun belum punya izin Laporan." : "Permintaan laporan gagal diproses."));
  }
  return response.json() as Promise<T>;
}

type Summary = { submitted: number; disbursed: number; completed: number; institutionWide: boolean; proposedBudget: string };
type SubmissionPage = { items: { id: number; lecturer: string; title: string; budget: string }[]; hasNext: boolean; start: number };
const metrics = [
  { key: "submitted", label: "Pengajuan", description: "Usulan yang sudah dikirim", icon: ClipboardList, tone: "blue" },
  { key: "disbursed", label: "Sudah cair", description: "Minimal satu tahap dana ditransfer", icon: Wallet, tone: "amber" },
  { key: "completed", label: "Sudah terlaksana", description: "Proyek dengan status selesai", icon: CircleCheck, tone: "mint" },
] as const;
const numberFormat = new Intl.NumberFormat("id-ID");
const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

function SubmissionHistory({ endpoint, total }: { endpoint: string; total?: string }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SubmissionPage>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void request<SubmissionPage>(`${endpoint}/submissions?page=${page}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [endpoint, page]);

  function move(next: number) {
    setData(undefined);
    setFailed(false);
    setPage(next);
  }

  return <Card className="workspace-panel rounded-md">
    <CardHeader className="flex flex-wrap items-start justify-between gap-2 sm:flex-row">
      <CardTitle>Riwayat Pengajuan Dosen</CardTitle>
      <dl className="rounded-md border border-border bg-muted/40 px-3 py-2 sm:text-right">
        <dt className="text-xs text-muted-foreground">Total RAB seluruh usulan yang ditampilkan dalam rekap</dt>
        <dd className="font-semibold tabular-nums">{total === undefined ? "–" : rupiah.format(BigInt(total))}</dd>
      </dl>
    </CardHeader>
    <CardContent className="space-y-3">
      {failed && <p role="alert" className="text-sm text-destructive">Riwayat pengajuan gagal dimuat.</p>}
      {!failed && !data && <p role="status" className="text-sm text-muted-foreground">Memuat riwayat pengajuan…</p>}
      {data?.items.length === 0 && <p className="text-sm text-muted-foreground">Belum ada usulan pada halaman ini.</p>}
      {!!data?.items.length && <div className="overflow-x-auto">
        <table className="workspace-table w-full min-w-[34rem] text-left text-sm" aria-label="Riwayat Pengajuan Dosen">
          <thead><tr>
            <th scope="col" className="w-12">No.</th><th scope="col">Nama Dosen</th>
            <th scope="col">Judul Usulan</th><th scope="col" className="text-right">Total RAB</th>
          </tr></thead>
          <tbody>{data.items.map((item, index) => <tr key={item.id}>
            <td className="tabular-nums">{data.start + index}</td><td>{item.lecturer}</td>
            <td className="wrap-anywhere">{item.title}</td><td className="whitespace-nowrap text-right tabular-nums">{rupiah.format(BigInt(item.budget))}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {(page > 1 || data?.hasNext) && <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Halaman {page}</span>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={page === 1} onClick={() => move(page - 1)}>Sebelumnya</Button>
          <Button type="button" size="sm" variant="outline" disabled={!data?.hasNext} onClick={() => move(page + 1)}>Berikutnya</Button>
        </div>
      </div>}
    </CardContent>
  </Card>;
}

function ReportSummary({ endpoint }: { endpoint: string }) {
  const [summary, setSummary] = useState<Summary>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void request<Summary>(endpoint + "/summary", { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setSummary(data); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [endpoint]);

  return <section aria-labelledby="report-summary-title" className="space-y-3">
    <div className="flex flex-wrap items-baseline justify-between gap-1">
      <h2 id="report-summary-title" className="text-base font-semibold">Rekap usulan penelitian</h2>
      {summary && <p className="text-xs text-muted-foreground">{summary.institutionWide ? "Seluruh usulan institusi" : "Usulan saya"}</p>}
    </div>
    {failed ? <p role="alert" className="text-sm text-destructive">Rekap usulan gagal dimuat.</p> :
      <div className="grid gap-3 sm:grid-cols-3" aria-busy={!summary}>
        {metrics.map(({ key, label, description, icon: Icon, tone }) => <Card key={key} className="workspace-metric min-w-0 gap-0 rounded-md" data-tone={tone}>
          <CardContent className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-medium">{label}</h3>
              <p className="my-1 text-2xl font-semibold tabular-nums">{summary ? numberFormat.format(summary[key]) : "–"}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            <Icon size={19} className="shrink-0 text-[color:var(--metric-tone)]" aria-hidden="true" />
          </CardContent>
        </Card>)}
      </div>}
    <SubmissionHistory endpoint={endpoint} total={summary?.proposedBudget} />
  </section>;
}

export function ReportsPanel({ institutions, onlyKind }: { institutions: { id: number; name: string }[]; onlyKind?: Kind }) {
  const [tenant, setTenant] = useState(institutions[0]?.id ?? 0);
  const [items, setItems] = useState<Row[]>();
  const [editor, setEditor] = useState<Editor>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const endpoint = `/api/v1/iam/institutions/${tenant}/reports`;
  const proposals = [...new Map(items?.map(row => [row.proposalId, row])).values()];

  useEffect(() => {
    if (!tenant) return;
    const controller = new AbortController();
    void request<Row[]>(endpoint, { signal: controller.signal }).then(rows => {
      if (!controller.signal.aborted) setItems(rows);
    }).catch((err: Error) => {
      if (!controller.signal.aborted) setError(err.message);
    });
    return () => controller.abort();
  }, [endpoint, tenant, refresh]);

  function open(proposal: Row, kind: Kind) {
    const existing = items?.find(row => row.proposalId === proposal.proposalId && row.kind === kind);
    const data = existing?.data ?? Object.fromEntries(sections[kind].map(([key]) => [key, proposal.source[key] ?? ""]));
    setError("");
    const outputTargets = proposal.outputTargets ?? [];
    const outputProgress = kind === "progress" ? outputTargets.map((_, index) => existing?.outputProgress?.[index] ?? blankProgress) : undefined;
    setEditor({ ...proposal, revision: existing?.revision ?? 0, kind, data, outputTargets, outputProgress });
  }

  async function change(row: Editor, method: "PUT" | "DELETE") {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      if (method === "DELETE" && !(await confirmRemoval("Hapus draf laporan?", row.title))) return;
      await request(`${endpoint}/${row.proposalId}/${row.kind}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: row.revision, data: method === "PUT" ? row.data : undefined, outputProgress: method === "PUT" ? row.outputProgress : undefined }),
      });
      setEditor(undefined);
      setItems(undefined);
      setRefresh(value => value + 1);
      toast.success(method === "PUT" ? "Draf laporan disimpan." : "Draf laporan dihapus.", workspaceToastOptions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editor) void change(editor, "PUT");
  }

  async function uploadProgress(id: number, file: File) {
    if (pending) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Ukuran PDF maksimal 5 MB.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const form = new FormData();
      form.set("report", file);
      await request(`${endpoint}/${id}/progress-file`, { method: "POST", body: form });
      setRefresh(value => value + 1);
      toast.success("Laporan kemajuan terunggah. Sisa dana bisa diproses oleh LPPM.", workspaceToastOptions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return <section className="space-y-4">
    {!onlyKind && <h1 className="text-2xl font-semibold tracking-tight">Laporan</h1>}
    {institutions.length > 1 && <label className="flex flex-wrap items-center gap-2 text-sm">
      Institusi <select value={tenant} disabled={pending || !!editor} onChange={event => {
        setItems(undefined); setError(""); setTenant(Number(event.target.value));
      }}>
        {institutions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>}
    {!onlyKind && !!tenant && <ReportSummary key={tenant} endpoint={endpoint} />}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {editor ? <Card>
      <CardHeader><CardTitle>{labels[editor.kind]}</CardTitle><p className="text-sm text-muted-foreground">{editor.title}</p></CardHeader>
      <CardContent><form onSubmit={save} data-research-editing={onlyKind ? "" : undefined} className="space-y-3">
        {editor.kind === "final" && <section className="space-y-2 rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">Identitas sampul dan halaman pengesahan</h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {[["Judul penelitian", editor.title], ["Ketua peneliti", editor.owner], ["Anggota", editor.team?.join(", ") || "–"],
              ["Skema dan tahun", `${editor.scheme} · ${editor.year}`]].map(([label, value]) => <div className="min-w-0" key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt><dd className="wrap-anywhere">{value}</dd>
            </div>)}
          </dl>
        </section>}
        <fieldset className="grid gap-3" disabled={pending}>
          {sections[editor.kind].map(([key, label]) => <div key={key} className="space-y-1">
            <label className="block space-y-1 text-sm">
              <span>{label}</span>
              {editor.kind === "final" && key === "abstract" && <span className="block text-xs text-muted-foreground">Ringkas latar belakang, tujuan, metode, hasil, dan kesimpulan.</span>}
              {editor.kind === "final" && key === "keywords" ? <input type="text" maxLength={300} value={editor.data[key] ?? ""}
                placeholder="3–5 kata kunci, pisahkan dengan koma" onChange={event => setEditor({ ...editor, data: { ...editor.data, [key]: event.target.value } })}
                className="block w-full rounded-md border border-input bg-background p-2" /> :
                <textarea rows={4} maxLength={16000} value={editor.data[key] ?? ""}
                  onChange={event => setEditor({ ...editor, data: { ...editor.data, [key]: event.target.value } })}
                  className="block w-full rounded-md border border-input bg-background p-2" />}
            </label>
            {editor.kind === "final" && key === "method" && editor.methodDiagram && <a className="text-xs text-brand underline"
              href={`${endpoint}/${editor.proposalId}/method-diagram`} target="_blank" rel="noreferrer">Lihat diagram metode dari usulan</a>}
          </div>)}
        </fieldset>
        {editor.kind === "progress" && <OutputProgressFields editor={editor} disabled={pending}
          onChange={outputProgress => setEditor({ ...editor, outputProgress })} />}
        {editor.kind === "final" && <FinalAttachments endpoint={`${endpoint}/${editor.proposalId}`} poster={editor.poster} disabled={pending}
          onUpload={uploading => { setPending(uploading); if (!uploading) setRefresh(value => value + 1); }} />}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>Simpan draf</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => { setEditor(undefined); setError(""); }}>Batal</Button>
        </div>
      </form></CardContent>
    </Card> : <Card>
      <CardHeader><CardTitle>{onlyKind ? labels[onlyKind] : "Draf laporan penelitian"}</CardTitle></CardHeader>
      <CardContent>
        {!tenant && <p>Belum ada institusi aktif dengan izin Laporan.</p>}
        {!!tenant && !items && !error && <p role="status">Memuat usulan…</p>}
        {items?.length === 0 && <p className="text-sm text-muted-foreground">Usulan penelitian yang sudah Anda kirim akan muncul di sini.</p>}
        {!!proposals.length && <ul className="divide-y divide-border">
          {proposals.map(proposal => <li className="space-y-2 py-3" key={proposal.proposalId}>
            <p className="wrap-anywhere font-medium">{proposal.title}</p>
            <div className="grid gap-2 md:grid-cols-2">
              {(onlyKind ? [onlyKind] : kinds).map(kind => {
                const existing = items?.find(row => row.proposalId === proposal.proposalId && row.kind === kind);
                const enabled = kind === "progress" ? proposal.allowProgressReport !== false : proposal.allowFinalReport !== false;
                return <div key={kind} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2">
                  <div>
                    <span className="text-sm">{labels[kind]}</span>
                    {kind === "progress" && <div className="mt-1 space-y-1 text-xs">
                      <p className="text-muted-foreground">{proposal.outputTargets?.length ?? 0} target luaran · isi kemajuannya di draf laporan</p>
                      {proposal.progressUploaded ? <a className="text-brand underline" href={`${endpoint}/${proposal.proposalId}/progress-file`}>Unduh PDF yang diunggah</a> :
                        <p className="text-muted-foreground">Unggah PDF laporan untuk membuka pencairan sisa 25%.</p>}
                      {enabled && <label className="block">
                        {proposal.progressUploaded ? "Ganti PDF laporan" : "Unggah PDF laporan"}
                        <input className="mt-1 block max-w-full" type="file" accept="application/pdf,.pdf" disabled={pending}
                          onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadProgress(proposal.proposalId, file); }} />
                      </label>}
                    </div>}
                    {!enabled && <p className="text-xs text-muted-foreground">Belum diaktifkan Admin/Superadmin</p>}
                  </div>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="sm" disabled={pending || !enabled} onClick={() => open(proposal, kind)} aria-label={`${existing ? "Ubah" : "Buat"} ${labels[kind]}`}>
                      {existing ? <Pencil size={15} /> : <Plus size={15} />} {existing ? "Ubah draf" : "Buat draf"}
                    </Button>
                    {existing && <Button type="button" variant="ghost" size="icon-sm" disabled={pending || !enabled} className="text-destructive" aria-label={`Hapus draf ${labels[kind]}`}
                      onClick={() => void change({ ...existing, kind }, "DELETE")}><Trash2 size={15} /></Button>}
                  </div>
                </div>;
              })}
            </div>
          </li>)}
        </ul>}
      </CardContent>
    </Card>}
  </section>;
}

function OutputProgressFields({ editor, disabled, onChange }: { editor: Editor; disabled: boolean; onChange: (value: OutputProgress[]) => void }) {
  const targets = editor.outputTargets ?? [];
  const progress = editor.outputProgress ?? [];
  return <fieldset className="space-y-3 rounded-lg border border-border p-3" disabled={disabled}>
    <legend className="px-1 text-sm font-semibold">Kemajuan Luaran</legend>
    {!targets.length && <p className="text-sm text-muted-foreground">Usulan ini tidak memiliki target luaran untuk dilaporkan.</p>}
    {targets.map((target, index) => {
      const item = progress[index] ?? blankProgress;
      function update(key: keyof OutputProgress, value: string) {
        onChange(targets.map((_, position) => position === index ? { ...item, [key]: value } : progress[position] ?? blankProgress));
      }
      return <div className="space-y-2 rounded-md border border-border p-3" key={index}>
        <h3 className="text-sm font-semibold">{index + 1}. {target.kind}</h3>
        <p className="text-xs text-muted-foreground">Target usulan · {target.status} · {target.year}</p>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="block text-sm">Status aktual
            <select className="mt-1 block w-full" value={item.status} onChange={event => update("status", event.target.value)}>
              <option value="">Pilih status</option>
              <option value="not_started">Belum dimulai</option>
              <option value="in_progress">Dalam proses</option>
              <option value="achieved">Tercapai</option>
            </select>
          </label>
          <label className="block text-sm">Tautan bukti
            <input className="mt-1 block w-full rounded-md border border-input bg-background p-2" type="url" maxLength={2048}
              value={item.evidence} onChange={event => update("evidence", event.target.value)} placeholder="https://…" />
          </label>
          {([["result", "Hasil yang dicapai"], ["followUp", "Kendala dan tindak lanjut"]] as const).map(([key, label]) => <label className="block text-sm" key={key}>{label}
            <textarea className="mt-1 block w-full rounded-md border border-input bg-background p-2" maxLength={2000} rows={3}
              value={item[key]} onChange={event => update(key, event.target.value)} />
          </label>)}
        </div>
      </div>;
    })}
  </fieldset>;
}
