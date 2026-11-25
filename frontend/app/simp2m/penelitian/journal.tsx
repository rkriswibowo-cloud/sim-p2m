"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { confirmRemoval, workspaceToastOptions } from "../confirm-removal";
import { api, json } from "./view";

type Proposal = { id: number; title: string; status: string };
type Institution = { id: number; name: string };
type Entry = { id: number; date: string; activity: string; result: string; obstacle: string; revision: number };
const fields = [["activity", "Uraian kegiatan", 2000], ["result", "Hasil", 4000], ["obstacle", "Kendala", 2000]] as const;
const dateFormat = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "UTC" });

export function ResearchJournal({ institutions }: { institutions: Institution[] }) {
  const [tenant, setTenant] = useState(institutions[0]?.id ?? 0);
  const [proposals, setProposals] = useState<Proposal[]>();
  const [proposalID, setProposalID] = useState(0);
  const [entries, setEntries] = useState<Entry[]>();
  const [editor, setEditor] = useState<Entry>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const researchURL = `/api/v1/iam/institutions/${tenant}/research`;
  const journalURL = `${researchURL}/${proposalID}/journal`;

  useEffect(() => {
    if (!tenant) return;
    const controller = new AbortController();
    void api<Proposal[]>(researchURL, { signal: controller.signal }).then(items => {
      if (controller.signal.aborted) return;
      const submitted = items.filter(item => item.status === "submitted");
      setProposals(submitted);
      setProposalID(submitted[0]?.id ?? 0);
    }).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [tenant, researchURL]);

  useEffect(() => {
    if (!proposalID) return;
    const controller = new AbortController();
    void api<Entry[]>(journalURL, { signal: controller.signal }).then(items => {
      if (!controller.signal.aborted) setEntries(items);
    }).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [proposalID, journalURL]);

  async function change(entry: Entry, remove = false) {
    if (pending) return;
    setPending(true);
    try {
      if (remove && !await confirmRemoval("Hapus catatan harian?", entry.activity)) return;
      setError("");
      const path = entry.id ? `${journalURL}/${entry.id}` : journalURL;
      const saved = await api<{ id: number }>(path, json(remove ? "DELETE" : entry.id ? "PUT" : "POST", entry));
      setEntries(previous => {
        const rest = (previous ?? []).filter(item => item.id !== saved.id);
        if (remove) return rest;
        return [...rest, { ...entry, activity: entry.activity.trim(), id: saved.id, revision: entry.revision + 1 }]
          .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
      });
      setEditor(undefined);
      toast.success(remove ? "Catatan dihapus." : "Catatan disimpan.", workspaceToastOptions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editor) void change(editor);
  }

  return <Card>
    <CardHeader><CardTitle>Catatan harian penelitian</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      {institutions.length > 1 && <label className="block space-y-1 text-sm">
        <span>Institusi</span><select className="block w-full" value={tenant} disabled={pending || !!editor} onChange={event => {
          setTenant(Number(event.target.value)); setProposalID(0); setProposals(undefined); setEntries(undefined); setError("");
        }}>{institutions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </label>}
      {!!proposals?.length && <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 space-y-1 text-sm">
          <span>Usulan penelitian</span><select className="block w-full" value={proposalID} disabled={pending || !!editor} onChange={event => {
            setProposalID(Number(event.target.value)); setEntries(undefined); setError("");
          }}>{proposals.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
        </label>
        <Button type="button" size="sm" disabled={pending || !!editor || !entries} onClick={() => {
          const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
          setEditor({ id: 0, revision: 0, date, activity: "", result: "", obstacle: "" });
        }}><Plus size={16} aria-hidden="true" /> Tambah catatan</Button>
      </div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!tenant && <p>Belum ada institusi aktif dengan izin Penelitian.</p>}
      {!!tenant && !error && (!proposals || (!!proposalID && !entries)) && <p role="status">Memuat catatan…</p>}
      {proposals?.length === 0 && <p className="text-sm text-muted-foreground">Catatan harian tersedia untuk usulan penelitian yang sudah Anda kirim.</p>}
      {editor && <form onSubmit={save} data-research-editing="" className="space-y-3 rounded-lg border border-border p-3">
        <fieldset className="space-y-3" disabled={pending}>
          <Input id="journal-date" label="Tanggal kegiatan" type="date" required value={editor.date}
            onChange={event => setEditor({ ...editor, date: event.target.value })} />
          {fields.map(([key, label, limit]) => <label key={key} className="block space-y-1 text-sm">
            <span>{label}</span><textarea className="block w-full rounded-md border border-input bg-background p-2" rows={3}
              required={key === "activity"} maxLength={limit} value={editor[key]} onChange={event => setEditor({ ...editor, [key]: event.target.value })} />
          </label>)}
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Simpan catatan</Button>
            <Button type="button" variant="outline" onClick={() => { setEditor(undefined); setError(""); }}>Batal</Button>
          </div>
        </fieldset>
      </form>}
      {entries?.length === 0 && !editor && <p className="text-sm text-muted-foreground">Belum ada catatan harian.</p>}
      {!!entries?.length && <ul className="divide-y divide-border">
        {entries.map(entry => <li className="space-y-2 py-3" key={entry.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <time dateTime={entry.date} className="text-sm font-medium">{dateFormat.format(new Date(entry.date))}</time>
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="ghost" disabled={pending || !!editor} onClick={() => setEditor(entry)}><Pencil size={15} aria-hidden="true" /> Ubah</Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending || !!editor} className="text-destructive" onClick={() => void change(entry, true)}><Trash2 size={15} aria-hidden="true" /> Hapus</Button>
            </div>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-3">{fields.filter(([key]) => entry[key]).map(([key, label]) => <div key={key}>
            <dt className="text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap wrap-anywhere">{entry[key]}</dd>
          </div>)}</dl>
        </li>)}
      </ul>}
    </CardContent>
  </Card>;
}
