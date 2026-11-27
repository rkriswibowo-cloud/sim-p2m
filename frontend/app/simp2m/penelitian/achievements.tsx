"use client";

import { Check, Download, ExternalLink, Pencil, RefreshCw, Save, Trash2, Upload } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { AdvancedTable } from "@/components/ui/advanced-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, fieldClass } from "@/components/ui/input";
import { confirmRemoval, workspaceToastOptions } from "../confirm-removal";
import { api } from "./view";

type Institution = { id: number; name: string; canResearch: boolean; canVerify?: boolean };
type Proposal = { id: number; title: string; period: string };
type Attachment = { slot: string; driveUrl: string; hasFile: boolean; approved: boolean };
type AchievementReview = Attachment & { proposalId: number; title: string; owner: string; label: string; version: string };
type Achievements = { outputs: { key: string; kind: string; status: string; year: number }[]; attachments: Attachment[] };

const documents = [
  { slot: "proposal", label: "Proposal Penelitian" },
  { slot: "progress", label: "Laporan Kemajuan" },
  { slot: "final", label: "Laporan Akhir" },
];

export function ResearchAchievements({ institutions }: { institutions: Institution[] }) {
  const [tenant, setTenant] = useState(institutions[0]?.id ?? 0);
  const institution = institutions.find(item => item.id === tenant);
  const endpoint = `/api/v1/iam/institutions/${tenant}`;

  return <Card className="workspace-panel">
    <CardHeader><CardTitle>Capaian Penelitian Terkini</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      {institutions.length > 1 && <Field id="achievement-institution" label="Institusi">
        <select id="achievement-institution" className={fieldClass} value={tenant}
          onChange={event => setTenant(Number(event.target.value))}>
          {institutions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>}
      {institution?.canResearch && <ProposalAchievements key={tenant} endpoint={`${endpoint}/research`} />}
      {institution?.canVerify && <AchievementReviews key={tenant} endpoint={`${endpoint}/achievement-reviews`} />}
      {!institution && <p className="text-sm text-muted-foreground">Belum ada institusi aktif dengan izin Penelitian.</p>}
    </CardContent>
  </Card>;
}

function ProposalAchievements({ endpoint }: { endpoint: string }) {
  const [proposals, setProposals] = useState<Proposal[]>();
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void api<Proposal[]>(endpoint, { signal: controller.signal }).then(items => {
      if (!controller.signal.aborted) setProposals(items);
    }).catch((err: Error) => {
      if (!controller.signal.aborted) setError(err.message);
    });
    return () => controller.abort();
  }, [endpoint]);

  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (!proposals) return <p role="status" className="text-sm">Memuat usulan penelitian…</p>;
  if (!proposals.length) return <p className="text-sm text-muted-foreground">Belum ada usulan penelitian.</p>;

  const proposalId = selected || proposals[0].id;
  return <>
    <Field id="achievement-proposal" label="Usulan penelitian">
      <select id="achievement-proposal" className={fieldClass} value={proposalId}
        onChange={event => setSelected(Number(event.target.value))}>
        {proposals.map(item => <option key={item.id} value={item.id}>{item.title} · {item.period}</option>)}
      </select>
    </Field>
    <AchievementForms key={proposalId} endpoint={`${endpoint}/${proposalId}/achievements`} />
  </>;
}

function AchievementForms({ endpoint }: { endpoint: string }) {
  const [data, setData] = useState<Achievements>();
  const [editing, setEditing] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void api<Achievements>(endpoint, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) {
        setData(result);
        setError("");
      }
    }).catch((err: Error) => {
      if (!controller.signal.aborted) setError(err.message);
    });
    return () => controller.abort();
  }, [endpoint, refresh]);

  if (error && !data) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (!data) return <p role="status" className="text-sm">Memuat capaian penelitian…</p>;

  const rows = [
    ...documents.map(document => ({ ...document, category: "Dokumen Penelitian", detail: "" })),
    ...data.outputs.map(output => ({
      slot: output.key, label: output.kind, category: "Luaran", detail: [output.status, output.year].filter(Boolean).join(" · "),
    })),
  ].map(row => ({
    ...row,
    attachment: data.attachments.find(item => item.slot === row.slot),
  }));
  const selected = rows.find(row => row.slot === editing);

  function updateAttachment(slot: string, attachment?: Attachment) {
    setData(current => current && {
      ...current,
      attachments: [
        ...current.attachments.filter(item => item.slot !== slot),
        ...(attachment ? [attachment] : []),
      ],
    });
  }

  return <>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <AdvancedTable
      title="Dokumen dan Luaran Penelitian"
      searchPlaceholder="Cari dokumen atau luaran…"
      actions={<Button type="button" variant="outline" size="sm" disabled={Boolean(editing)}
        onClick={() => setRefresh(current => current + 1)}>
        <RefreshCw size={15} aria-hidden="true" /> Muat ulang
      </Button>}
      data={rows}
      columns={[
        { key: "category", header: "Kategori", sortable: true },
        { key: "label", header: "Dokumen / Luaran", sortable: true, cell: row => <>
          <p className="font-medium">{row.label}</p>
          {row.detail && <p className="text-xs text-muted-foreground">{row.detail}</p>}
        </> },
        { key: "upload", header: "Status Unggah", cell: row => <UploadStatus attachment={row.attachment} /> },
        { key: "action", header: "Berkas", cell: row => <div className="flex flex-wrap items-center gap-2">
          {row.attachment && <AttachmentLink attachment={row.attachment} endpoint={`${endpoint}/${row.slot}`} />}
          <Button type="button" size="sm" variant="outline" aria-expanded={editing === row.slot}
            onClick={() => setEditing(current => current === row.slot ? "" : row.slot)}>
            {row.attachment ? "Kelola" : "Unggah"}
          </Button>
        </div> },
        { key: "approval", header: "Konfirmasi LPPM", cell: row => <ApprovalStatus attachment={row.attachment} /> },
      ]}
    />
    {selected && <AchievementForm key={selected.slot} endpoint={`${endpoint}/${selected.slot}`}
      slot={selected.slot} label={selected.label} saved={selected.attachment}
      onChange={attachment => updateAttachment(selected.slot, attachment)} />}
  </>;
}

function UploadStatus({ attachment }: { attachment?: Attachment }) {
  return <Badge variant={attachment ? "success" : "secondary"}>{attachment ? "Sudah upload" : "Belum upload"}</Badge>;
}

function ApprovalStatus({ attachment }: { attachment?: Attachment }) {
  if (!attachment) return <span className="text-muted-foreground">—</span>;
  return <Badge variant={attachment.approved ? "success" : "warning"}>
    {attachment.approved ? "Selesai" : "Menunggu konfirmasi LPPM"}
  </Badge>;
}

function AttachmentLink({ attachment, endpoint }: { attachment: Attachment; endpoint: string }) {
  return attachment.hasFile ?
    <a className="text-primary underline" href={endpoint}><Download size={15} className="mr-1 inline" aria-hidden="true" />Unduh berkas</a> :
    <a className="text-primary underline" href={attachment.driveUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} className="mr-1 inline" aria-hidden="true" />Buka di Google Drive</a>;
}

function AchievementReviews({ endpoint }: { endpoint: string }) {
  const [items, setItems] = useState<AchievementReview[]>();
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState("");
  const [loadError, setLoadError] = useState("");
  const [approvalError, setApprovalError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void api<AchievementReview[]>(endpoint, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) {
        setItems(result);
        setLoadError("");
      }
    }).catch((err: Error) => {
      if (!controller.signal.aborted) setLoadError(err.message);
    });
    return () => controller.abort();
  }, [endpoint, refresh]);

  async function approve(item: AchievementReview) {
    const key = `${item.proposalId}/${item.slot}`;
    setPending(key);
    setApprovalError("");
    try {
      await api(`${endpoint}/${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: item.version }),
      });
      setItems(current => current?.map(row => row === item ? { ...row, approved: true } : row));
      toast.success("Capaian dikonfirmasi LPPM.", workspaceToastOptions);
    } catch (err) {
      setApprovalError((err as Error).message);
    } finally {
      setRefresh(current => current + 1);
      setPending("");
    }
  }

  return <section className="space-y-3" aria-label="Konfirmasi LPPM">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">Konfirmasi LPPM</h2>
      <Button type="button" variant="outline" size="sm" disabled={Boolean(pending)}
        onClick={() => { setApprovalError(""); setRefresh(current => current + 1); }}>
        <RefreshCw size={15} aria-hidden="true" /> Muat ulang
      </Button>
    </div>
    {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
    {approvalError && <p role="alert" className="text-sm text-destructive">{approvalError}</p>}
    {items ? <AdvancedTable
      searchPlaceholder="Cari usulan, ketua peneliti, atau dokumen…"
      emptyMessage="Belum ada unggahan untuk dikonfirmasi."
      data={items}
      columns={[
        { key: "title", header: "Usulan Penelitian", sortable: true },
        { key: "owner", header: "Ketua Peneliti", sortable: true },
        { key: "label", header: "Dokumen / Luaran", sortable: true },
        { key: "upload", header: "Status Unggah", cell: item => <UploadStatus attachment={item} /> },
        { key: "file", header: "Berkas", cell: item => <AttachmentLink attachment={item} endpoint={`${endpoint}/${item.proposalId}/${item.slot}`} /> },
        { key: "approval", header: "Konfirmasi LPPM", cell: item => <div className="flex flex-wrap items-center gap-2">
          <ApprovalStatus attachment={item} />
          {!item.approved && <Button type="button" size="sm" variant="outline" disabled={Boolean(pending)}
            onClick={() => void approve(item)}>
            <Check size={15} aria-hidden="true" /> {pending === `${item.proposalId}/${item.slot}` ? "Memproses…" : "Setujui"}
          </Button>}
        </div> },
      ]}
    /> : !loadError && <p role="status" className="text-sm">Memuat unggahan untuk konfirmasi…</p>}
  </section>;
}

function AchievementForm({ endpoint, slot, label, saved, onChange }: {
  endpoint: string; slot: string; label: string; saved?: Attachment; onChange: (attachment?: Attachment) => void;
}) {
  const id = useId();
  const [mode, setMode] = useState(saved?.hasFile ? "file" : "drive");
  const [driveUrl, setDriveUrl] = useState(saved?.driveUrl ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    const url = driveUrl.trim();
    const file = body.get("file");
    if (file instanceof File && file.size > 5 * 1024 * 1024) {
      setError("Ukuran berkas maksimal 5 MB.");
      return;
    }
    if (mode === "drive") body.set("driveUrl", url);
    setPending(true);
    setError("");
    try {
      await api(endpoint, { method: "PUT", body });
      onChange({ slot, driveUrl: mode === "drive" ? url : "", hasFile: mode === "file", approved: false });
      if (mode === "file") form.reset();
      toast.success("Unggahan tersimpan.", workspaceToastOptions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!await confirmRemoval("Hapus unggahan", `Hapus unggahan untuk ${label}?`)) return;
    setPending(true);
    setError("");
    try {
      await api(endpoint, { method: "DELETE" });
      onChange();
      setDriveUrl("");
      toast.success("Unggahan terhapus.", workspaceToastOptions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return <form onSubmit={save} className="space-y-3 rounded-md border border-border p-3" aria-labelledby={id + "-label"}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 id={id + "-label"} className="font-medium">{label}</h3>
        <p className="text-xs text-muted-foreground">Untuk tautan Google Drive, pastikan admin LPPM dapat membuka dokumen.</p>
      </div>
      {saved && <div className="flex items-center gap-3 text-sm">
        <Button data-action-tone="danger" type="button" size="sm" variant="outline" disabled={pending} onClick={remove}><Trash2 size={15} aria-hidden="true" /> Hapus</Button>
      </div>}
    </div>
    <div className="grid gap-3 sm:grid-cols-[minmax(9rem,12rem)_1fr_auto] sm:items-start">
      <Field id={id + "-mode"} label="Metode unggahan">
        <select id={id + "-mode"} className={`${fieldClass} h-9 px-2`} value={mode} disabled={pending}
          onChange={event => { setMode(event.target.value); setError(""); }}>
          <option value="drive">Tautan Google Drive</option>
          <option value="file">Unggah berkas</option>
        </select>
      </Field>
      {mode === "drive" ? <Input id={id + "-url"} label="Tautan Google Drive" name="driveUrl" type="url"
        required maxLength={2048} placeholder="https://drive.google.com/…" value={driveUrl} disabled={pending}
        onChange={event => setDriveUrl(event.target.value)} /> :
        <Input id={id + "-file"} icon={<Upload size={15} aria-hidden="true" />} label="Berkas (PDF, JPG, PNG · maks. 5 MB)" name="file" type="file"
          accept="application/pdf,image/jpeg,image/png" required disabled={pending} />}
      <Button data-action-tone={saved ? "edit" : "positive"} type="submit" className="sm:mt-5" disabled={pending}>{saved ? <Pencil size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />} {pending ? "Memproses…" : saved ? "Ganti" : "Simpan"}</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
}
