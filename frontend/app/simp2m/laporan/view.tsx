"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmRemoval, workspaceToastOptions } from "../confirm-removal";

const sections = {
  progress: [
    ["introduction", "Pendahuluan"], ["method", "Metode"], ["progress", "Kemajuan penelitian"],
    ["nextPlan", "Rencana tahapan berikutnya"], ["budgetNotes", "Catatan anggaran"], ["references", "Daftar pustaka"],
  ],
  final: [
    ["abstract", "Abstrak"], ["keywords", "Kata kunci"], ["introduction", "Pendahuluan"], ["literature", "Tinjauan pustaka"],
    ["method", "Metode"], ["results", "Hasil dan pembahasan"], ["conclusion", "Kesimpulan dan saran"],
    ["references", "Daftar pustaka"], ["fundUse", "Catatan penggunaan dana aktual"],
  ],
} as const;
const kinds = ["progress", "final"] as const;
const labels = { progress: "Laporan kemajuan", final: "Laporan akhir" };
type Kind = keyof typeof sections;
type Row = {
  proposalId: number; title: string; kind: Kind | ""; revision: number;
  data: Record<string, string>; source: Record<string, string>;
  allowProgressReport?: boolean; allowFinalReport?: boolean;
};
type Editor = Pick<Row, "proposalId" | "title" | "revision" | "data"> & { kind: Kind };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 401) window.location.replace("/login?renew=1");
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message ?? (response.status === 403 ? "Akun belum punya izin Laporan." : "Permintaan laporan gagal diproses."));
  }
  return response.json() as Promise<T>;
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
    setEditor({ proposalId: proposal.proposalId, title: proposal.title, revision: existing?.revision ?? 0, kind, data });
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
        body: JSON.stringify({ revision: row.revision, data: method === "PUT" ? row.data : undefined }),
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

  return <section className="space-y-4">
    {!onlyKind && <h1 className="text-2xl font-semibold tracking-tight">Laporan</h1>}
    {institutions.length > 1 && <label className="flex flex-wrap items-center gap-2 text-sm">
      Institusi <select value={tenant} disabled={pending || !!editor} onChange={event => {
        setItems(undefined); setError(""); setTenant(Number(event.target.value));
      }}>
        {institutions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {editor ? <Card>
      <CardHeader><CardTitle>{labels[editor.kind]}</CardTitle><p className="text-sm text-muted-foreground">{editor.title}</p></CardHeader>
      <CardContent><form onSubmit={save} data-research-editing={onlyKind ? "" : undefined} className="space-y-3">
        <fieldset className="grid gap-3" disabled={pending}>
          {sections[editor.kind].map(([key, label]) => <label key={key} className="block space-y-1 text-sm">
            <span>{label}</span><textarea rows={4} maxLength={16000} value={editor.data[key] ?? ""}
              onChange={event => setEditor({ ...editor, data: { ...editor.data, [key]: event.target.value } })}
              className="block w-full rounded-md border border-input bg-background p-2" />
          </label>)}
        </fieldset>
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
