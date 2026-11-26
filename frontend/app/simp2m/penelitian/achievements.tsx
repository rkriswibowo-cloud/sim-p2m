"use client";

import { Download, ExternalLink, Pencil, Save, Trash2, Upload } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, fieldClass } from "@/components/ui/input";
import { confirmRemoval, workspaceToastOptions } from "../confirm-removal";
import { api } from "./view";

type Institution = { id: number; name: string };
type Proposal = { id: number; title: string; period: string };
type Attachment = { slot: string; driveUrl: string; hasFile: boolean };
type Achievements = { outputs: { key: string; kind: string; status: string; year: number }[]; attachments: Attachment[] };

const documents = [
  { slot: "proposal", label: "Proposal Penelitian" },
  { slot: "progress", label: "Laporan Kemajuan" },
  { slot: "final", label: "Laporan Akhir" },
];

export function ResearchAchievements({ institutions }: { institutions: Institution[] }) {
  const [tenant, setTenant] = useState(institutions[0]?.id ?? 0);

  return <Card className="workspace-panel">
    <CardHeader><CardTitle>Capaian Penelitian Terkini</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      {institutions.length > 1 && <Field id="achievement-institution" label="Institusi">
        <select id="achievement-institution" className={fieldClass} value={tenant}
          onChange={event => setTenant(Number(event.target.value))}>
          {institutions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>}
      {tenant ? <ProposalAchievements key={tenant} endpoint={`/api/v1/iam/institutions/${tenant}/research`} /> :
        <p className="text-sm text-muted-foreground">Belum ada institusi aktif dengan izin Penelitian.</p>}
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
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void api<Achievements>(endpoint, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch((err: Error) => {
      if (!controller.signal.aborted) setError(err.message);
    });
    return () => controller.abort();
  }, [endpoint]);

  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (!data) return <p role="status" className="text-sm">Memuat capaian penelitian…</p>;

  function renderAttachment(slot: string, label: string, detail?: string) {
    return <AchievementForm key={slot} endpoint={`${endpoint}/${slot}`} label={label} detail={detail}
      initial={data?.attachments.find(item => item.slot === slot)} />;
  }

  return <>
    <section className="space-y-3" aria-label="Dokumen Penelitian">
      <h2 className="font-semibold">Dokumen Penelitian</h2>
      <p className="text-sm text-muted-foreground">Gunakan tautan Google Drive untuk menghemat penyimpanan. Berikan akses Drive kepada pihak yang perlu membuka dokumen.</p>
      {documents.map(({ slot, label }) => renderAttachment(slot, label))}
    </section>
    <section className="space-y-3" aria-label="Unggahan Hasil Luaran yang Dijanjikan">
      <h2 className="font-semibold">Unggahan Hasil Luaran yang Dijanjikan</h2>
      {data.outputs.length ? data.outputs.map((output, index) =>
        renderAttachment(output.key, `${index + 1}. ${output.kind}`, [output.status, output.year].filter(Boolean).join(" · "))) :
        <p className="text-sm text-muted-foreground">Belum ada luaran yang dijanjikan pada usulan ini.</p>}
    </section>
  </>;
}

function AchievementForm({ endpoint, label, detail, initial }: { endpoint: string; label: string; detail?: string; initial?: Attachment }) {
  const id = useId();
  const [saved, setSaved] = useState<Pick<Attachment, "driveUrl" | "hasFile"> | undefined>(initial);
  const [mode, setMode] = useState(initial?.hasFile ? "file" : "drive");
  const [driveUrl, setDriveUrl] = useState(initial?.driveUrl ?? "");
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
      setSaved({ driveUrl: mode === "drive" ? url : "", hasFile: mode === "file" });
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
      setSaved(undefined);
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
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
      {saved && <div className="flex items-center gap-3 text-sm">
        {saved.hasFile ? <a className="text-primary underline" href={endpoint}><Download size={15} className="mr-1 inline shrink-0 align-text-bottom" aria-hidden="true" /> Unduh berkas</a> :
          <a className="text-primary underline" href={saved.driveUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} className="mr-1 inline shrink-0 align-text-bottom" aria-hidden="true" /> Buka di Google Drive</a>}
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
