"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { confirmRemoval, workspaceToastOptions } from "../confirm-removal";

type DraftData = { partner: string; location: string; need: string; plan: string; outcome: string; budget: string };
type Draft = { id: number; title: string; revision: number; data: DraftData; updatedAt: string };
type Institution = { id: number; name: string };

const blank: Draft = { id: 0, title: "", revision: 0, updatedAt: "", data: { partner: "", location: "", need: "", plan: "", outcome: "", budget: "" } };
const dates = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" });
const narratives = [["need", "Kebutuhan mitra"], ["plan", "Rencana kegiatan"], ["outcome", "Target hasil"]] as const;

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
    <h1 className="text-2xl font-semibold tracking-tight">Pengabdian kepada Masyarakat</h1>
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

  useEffect(() => {
    const controller = new AbortController();
    void request<Draft[]>(endpoint, controller.signal).then(setItems).catch((err: Error) => {
      if (!controller.signal.aborted) setError(err.message);
    });
    return () => controller.abort();
  }, [endpoint]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || pending) return;
    const current = draft;
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

  function update(key: keyof DraftData, value: string) {
    setDraft(previous => previous && { ...previous, data: { ...previous.data, [key]: value } });
  }

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
              <p className="break-words text-xs text-muted-foreground">{item.data.partner && `${item.data.partner} · `}{dates.format(new Date(item.updatedAt))}</p></div>
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
      <CardContent><form onSubmit={save} className="space-y-3">
        <fieldset disabled={pending} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Input id="pkm-title" label="Judul kegiatan" required maxLength={300} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
          <Input id="pkm-partner" label="Nama mitra" maxLength={200} value={draft.data.partner} onChange={event => update("partner", event.target.value)} />
          <Input id="pkm-location" label="Lokasi kegiatan" maxLength={300} value={draft.data.location} onChange={event => update("location", event.target.value)} />
          <Input id="pkm-budget" label="Estimasi anggaran (Rp)" inputMode="numeric" pattern="[0-9]{1,15}" maxLength={15} value={draft.data.budget} onChange={event => update("budget", event.target.value)} />
          {narratives.map(([key, label]) => <label key={key} className="space-y-1 text-sm sm:col-span-2">
            <span>{label}</span><textarea rows={3} maxLength={3000} value={draft.data[key]} onChange={event => update(key, event.target.value)} className="block w-full rounded-md border border-input bg-background p-2" />
          </label>)}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>{pending ? "Menyimpan…" : "Simpan draf"}</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => { setDraft(undefined); setError(""); }}>Batal</Button>
        </div>
      </form></CardContent>
    </Card>}
  </div>;
}
