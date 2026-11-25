"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { workspaceToastOptions } from "../confirm-removal";
import { api, json } from "../penelitian/view";

type Mode = "production" | "trial-admin" | "trial-reader";
type Institution = { id: number; name: string; active: boolean; canResearch: boolean; canReports: boolean; canVerify?: boolean; canReview?: boolean; canDecide?: boolean };
type MonevReview = {
  id: number; proposalId: number; reviewerName: string; stage: "progress" | "final"; score: number;
  decision: "accepted" | "revision_needed"; notes: string; correctiveAction: string;
  followUpStatus: "none" | "pending" | "resolved"; followUpNote: string; createdAt: string;
};
type OutputItem = {
  id: number; proposalId: number; kind: string; title: string; publicationName: string; identifier: string;
  outputYear: number; status: string; url: string; hasProof: boolean; verifiedStatus: "pending" | "verified" | "rejected"; verifiedNote: string;
};
type ExpenseItem = {
  id: number; proposalId: number; category: string; itemName: string; justification: string;
  quantity: string; unit: string; unitPrice: string; total: string; spentAt: string;
};
type MonevProposal = {
  proposalId: number; projectId?: number; projectStatus: string; contractNumber: string;
  title: string; owner: string; ownerId: number; scheme: string; period: string;
  approvedBudget: string; totalSpent: string; hasProgress: boolean; hasFinal: boolean; hasPoster: boolean;
  monevReviews: MonevReview[]; outputs: OutputItem[]; expenses: ExpenseItem[];
};

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export function MonevPanel() {
  const [mode, setMode] = useState<Mode>("production");
  const [system, setSystem] = useState(false);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [tenant, setTenant] = useState(0);
  const [items, setItems] = useState<MonevProposal[]>([]);
  const [canMonev, setCanMonev] = useState(false);
  const [canVerify, setCanVerify] = useState(false);
  const [canClose, setCanClose] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(0);
  const [selected, setSelected] = useState<MonevProposal | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  // Monev form
  const [stage, setStage] = useState<"progress" | "final">("progress");
  const [score, setScore] = useState("85");
  const [decision, setDecision] = useState<"accepted" | "revision_needed">("accepted");
  const [notes, setNotes] = useState("");
  const [corrective, setCorrective] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");

  // Expense form
  const [expCat, setExpCat] = useState("Bahan Habis Pakai");
  const [expItem, setExpItem] = useState("");
  const [expJust, setExpJust] = useState("");
  const [expQty, setExpQty] = useState("1");
  const [expUnit, setExpUnit] = useState("paket");
  const [expPrice, setExpPrice] = useState("");
  const [expDate, setExpDate] = useState(new Date().toISOString().slice(0, 10));

  // Output form
  const [outKind, setOutKind] = useState("Publikasi Artikel Jurnal Nasional Terakreditasi");
  const [outTitle, setOutTitle] = useState("");
  const [outPub, setOutPub] = useState("");
  const [outId, setOutId] = useState("");
  const [outYear, setOutYear] = useState(String(new Date().getFullYear()));
  const [outStatus, setOutStatus] = useState("submitted");
  const [outUrl, setOutUrl] = useState("");

  const base = mode === "production" ? "/api/v1/iam" : `/api/v1/trial/${mode}/iam`;
  const readOnly = mode === "trial-reader";

  useEffect(() => {
    const controller = new AbortController();
    void api<{ items: Institution[]; system: boolean }>(base + "/institutions", { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        const allowed = res.items.filter((i) => i.active && (res.system || i.canResearch || i.canReports || i.canVerify || i.canReview || i.canDecide));
        setInstitutions(allowed);
        setTenant(allowed[0]?.id ?? 0);
        if (mode === "production") setSystem(res.system);
      })
      .catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [base, mode]);

  useEffect(() => {
    if (!tenant) return;
    const controller = new AbortController();
    void api<{ items: MonevProposal[]; canMonev: boolean; canVerify: boolean; canClose: boolean; currentUserId: number }>(
      `${base}/institutions/${tenant}/monev/proposals`,
      { signal: controller.signal }
    )
      .then((res) => {
        if (controller.signal.aborted) return;
        setItems(res.items);
        setCanMonev(res.canMonev);
        setCanVerify(res.canVerify);
        setCanClose(res.canClose);
        setCurrentUserId(res.currentUserId);
        setSelected((prev) => (prev ? res.items.find((p) => p.proposalId === prev.proposalId) ?? null : null));
      })
      .catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [base, tenant, tick]);

  async function run(work: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await work();
      setTick((t) => t + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Terjadi kesalahan.";
      setError(msg);
      toast.error(msg, workspaceToastOptions);
    } finally {
      setPending(false);
    }
  }

  function uploadPoster(proposalId: number, file?: File) {
    if (!file) return;
    const form = new FormData();
    form.set("image", file);
    form.set("revision", "1");
    void run(async () => {
      await api(`${base}/institutions/${tenant}/research/${proposalId}/images/poster`, { method: "PUT", body: form });
      toast.success("Poster penelitian diunggah.", workspaceToastOptions);
    });
  }

  function uploadOutputProof(outId: number, file?: File) {
    if (!file) return;
    const form = new FormData();
    form.set("proof", file);
    void run(async () => {
      await api(`${base}/institutions/${tenant}/monev/outputs/${outId}/proof`, { method: "PUT", body: form });
      toast.success("Bukti luaran diunggah.", workspaceToastOptions);
    });
  }

  const isOwner = selected ? selected.ownerId === currentUserId : false;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Monitoring, Realisasi, Luaran &amp; Penutupan Proyek</h1>
          <p className="text-xs text-muted-foreground">Evaluasi monev, tindak lanjut, realisasi penggunaan dana aktual, unggah poster, verifikasi luaran, dan penutupan proyek.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {system && (
            <select aria-label="Mode workspace" value={mode} onChange={(e) => { setMode(e.target.value as Mode); setSelected(null); }}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs">
              <option value="production">Operasional</option>
              <option value="trial-admin">Trial · Pengelola</option>
              <option value="trial-reader">Trial · Pembaca</option>
            </select>
          )}
          <select aria-label="Pilih institusi" value={tenant} onChange={(e) => { setTenant(Number(e.target.value)); setSelected(null); }}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs">
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
      </div>

      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="workspace-panel rounded-md lg:col-span-4">
          <CardHeader><CardTitle>Proyek Didanai ({items.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {!items.length && <p className="text-sm text-muted-foreground">Belum ada proyek penelitian yang didanai.</p>}
            {items.map((p) => (
              <button key={p.proposalId} type="button" onClick={() => setSelected(p)}
                className={`w-full rounded-md border p-3 text-left text-sm transition ${selected?.proposalId === p.proposalId ? "border-brand bg-accent/40" : "border-border hover:bg-muted/40"}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold line-clamp-2">{p.title}</p>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${p.projectStatus === "completed" ? "bg-emerald-500/15 text-emerald-600" : "bg-muted"}`}>
                    {p.projectStatus === "completed" ? "Selesai" : p.projectStatus === "active" ? "Aktif" : "Belum Kontrak"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{p.owner} · {p.contractNumber || "Tanpa kontrak"}</p>
                <p className="mt-1 text-xs">Realisasi: {money.format(BigInt(p.totalSpent))} / {money.format(BigInt(p.approvedBudget))}</p>
                <p className="text-[11px] text-muted-foreground">
                  Kemajuan: {p.hasProgress ? "Ada" : "Belum"} · Akhir: {p.hasFinal ? "Ada" : "Belum"} · Luaran: {p.outputs.length}
                </p>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="workspace-panel rounded-md lg:col-span-8">
          <CardHeader><CardTitle>{selected ? selected.title : "Pilih Proyek"}</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            {!selected ? (
              <p className="text-muted-foreground">Pilih salah satu proyek didanai di sebelah kiri.</p>
            ) : (
              <>
                {/* Ringkasan & Poster & Penutupan */}
                <div className="rounded-md border border-border p-3 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p>Ketua: <strong>{selected.owner}</strong> · {selected.scheme} ({selected.period})</p>
                      <p>Kontrak: <strong>{selected.contractNumber || "-"}</strong> · Status Proyek: <strong>{selected.projectStatus === "completed" ? "Selesai (Ditutup)" : selected.projectStatus}</strong></p>
                      <p>Laporan Kemajuan: <strong>{selected.hasProgress ? "Sudah diisi" : "Belum"}</strong> · Laporan Akhir: <strong>{selected.hasFinal ? "Sudah diisi" : "Belum"}</strong> · Poster: <strong>{selected.hasPoster ? "Terunggah" : "Belum"}</strong></p>
                    </div>
                    {canClose && !readOnly && selected.projectStatus === "active" && (
                      <Button size="sm" disabled={pending} onClick={() => void run(async () => {
                        await api(`${base}/institutions/${tenant}/monev/proposals/${selected.proposalId}/close`, { method: "POST" });
                        toast.success("Proyek resmi ditutup (Selesai).", workspaceToastOptions);
                      })}>Tutup Proyek (Selesai)</Button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 border-t border-border pt-2">
                    {selected.hasPoster && (
                      <a target="_blank" rel="noopener" href={`${base}/institutions/${tenant}/research/${selected.proposalId}/images/poster`} className="text-brand underline font-medium">
                        Lihat Poster Penelitian
                      </a>
                    )}
                    {isOwner && !readOnly && selected.projectStatus !== "completed" && (
                      <label className="inline-flex items-center gap-2">
                        <span>Unggah Poster (JPG/PNG, maks. 2 MB):</span>
                        <input type="file" accept="image/png,image/jpeg" disabled={pending}
                          onChange={(e) => { uploadPoster(selected.proposalId, e.target.files?.[0]); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                </div>

                {/* Monev & Tindak Lanjut */}
                <div className="rounded-md border border-border p-3 space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monitoring &amp; Evaluasi (Monev)</h4>
                  {!selected.monevReviews.length && <p className="text-xs text-muted-foreground">Belum ada catatan monev.</p>}
                  {selected.monevReviews.map((mv) => (
                    <div key={mv.id} className="rounded border border-border p-2 text-xs space-y-1">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="font-semibold">{mv.stage === "progress" ? "Monev Kemajuan" : "Monev Akhir"} · Skor {mv.score} ({mv.decision === "accepted" ? "Diterima" : "Perlu Tindak Lanjut"})</span>
                        <span className="text-muted-foreground">Reviewer: {mv.reviewerName}</span>
                      </div>
                      <p>{mv.notes}</p>
                      {mv.correctiveAction && <p className="text-amber-600 dark:text-amber-400">Rekomendasi perbaikan: {mv.correctiveAction}</p>}
                      {mv.followUpStatus === "resolved" && <p className="text-emerald-600">Tindak lanjut pengusul: {mv.followUpNote}</p>}
                      {mv.followUpStatus === "pending" && isOwner && !readOnly && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Input id={`fu-${mv.id}`} label="Keterangan Tindak Lanjut" value={followUpNote} onChange={(e) => setFollowUpNote(e.target.value)} />
                          <Button size="sm" className="self-end" disabled={pending} onClick={() => void run(async () => {
                            await api(`${base}/institutions/${tenant}/monev/reviews/${mv.id}/follow-up`, json("POST", { note: followUpNote }));
                            setFollowUpNote("");
                            toast.success("Tindak lanjut dikirim.", workspaceToastOptions);
                          })}>Kirim Tindak Lanjut</Button>
                        </div>
                      )}
                    </div>
                  ))}
                  {canMonev && !readOnly && selected.projectStatus !== "completed" && (
                    <div className="grid grid-cols-1 gap-2 border-t border-border pt-2 sm:grid-cols-3">
                      <div>
                        <label htmlFor="mv-stage" className="block text-xs mb-1">Tahap Monev</label>
                        <select id="mv-stage" value={stage} onChange={(e) => setStage(e.target.value as "progress" | "final")} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs">
                          <option value="progress">Laporan Kemajuan</option>
                          <option value="final">Laporan Akhir</option>
                        </select>
                      </div>
                      <Input id="mv-score" label="Skor Monev (0-100)" type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} />
                      <div>
                        <label htmlFor="mv-dec" className="block text-xs mb-1">Keputusan</label>
                        <select id="mv-dec" value={decision} onChange={(e) => setDecision(e.target.value as "accepted" | "revision_needed")} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs">
                          <option value="accepted">Diterima</option>
                          <option value="revision_needed">Perlu Tindak Lanjut / Perbaikan</option>
                        </select>
                      </div>
                      <Input id="mv-notes" label="Catatan Monev" value={notes} onChange={(e) => setNotes(e.target.value)} />
                      <Input id="mv-corr" label="Tindakan Korektif (opsional)" value={corrective} onChange={(e) => setCorrective(e.target.value)} />
                      <Button size="sm" className="self-end" disabled={pending} onClick={() => void run(async () => {
                        await api(`${base}/institutions/${tenant}/monev/proposals/${selected.proposalId}`, json("POST", {
                          stage, score: Number(score), decision, notes, correctiveAction: corrective,
                        }));
                        setNotes(""); setCorrective("");
                        toast.success("Hasil monev disimpan.", workspaceToastOptions);
                      })}>Simpan Monev</Button>
                    </div>
                  )}
                </div>

                {/* Realisasi Dana (Lampiran L.1) */}
                <div className="rounded-md border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Laporan Penggunaan Dana Aktual (L.1)</h4>
                    <span className="text-xs font-semibold">Total Realisasi: {money.format(BigInt(selected.totalSpent))}</span>
                  </div>
                  {!selected.expenses.length && <p className="text-xs text-muted-foreground">Belum ada catatan pengeluaran aktual.</p>}
                  {selected.expenses.map((ex) => (
                    <div key={ex.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1 text-xs">
                      <div>
                        <span className="font-semibold">{ex.itemName}</span> ({ex.category}) · {ex.quantity} {ex.unit} × {money.format(BigInt(ex.unitPrice))} = <strong>{money.format(BigInt(ex.total))}</strong>
                        {ex.justification && <p className="text-muted-foreground">{ex.justification}</p>}
                      </div>
                      {isOwner && !readOnly && selected.projectStatus !== "completed" && (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-destructive" disabled={pending} onClick={() => void run(async () => {
                          await api(`${base}/institutions/${tenant}/monev/expenses/${ex.id}`, { method: "DELETE" });
                          toast.success("Item pengeluaran dihapus.", workspaceToastOptions);
                        })}>Hapus</Button>
                      )}
                    </div>
                  ))}
                  {isOwner && !readOnly && selected.projectStatus !== "completed" && (
                    <div className="grid grid-cols-1 gap-2 border-t border-border pt-2 sm:grid-cols-3">
                      <Input id="ex-cat" label="Kategori" value={expCat} onChange={(e) => setExpCat(e.target.value)} />
                      <Input id="ex-item" label="Item Pengeluaran" value={expItem} onChange={(e) => setExpItem(e.target.value)} />
                      <Input id="ex-just" label="Justifikasi" value={expJust} onChange={(e) => setExpJust(e.target.value)} />
                      <Input id="ex-qty" label="Kuantitas" value={expQty} onChange={(e) => setExpQty(e.target.value)} />
                      <Input id="ex-unit" label="Satuan" value={expUnit} onChange={(e) => setExpUnit(e.target.value)} />
                      <Input id="ex-price" label="Harga Satuan (Rp)" type="number" value={expPrice} onChange={(e) => setExpPrice(e.target.value)} />
                      <Input id="ex-date" label="Tanggal Belanja" type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} />
                      <Button size="sm" className="self-end" disabled={pending} onClick={() => void run(async () => {
                        await api(`${base}/institutions/${tenant}/monev/proposals/${selected.proposalId}/expenses`, json("POST", {
                          category: expCat, itemName: expItem, justification: expJust, quantity: expQty, unit: expUnit, unitPrice: expPrice, spentAt: expDate,
                        }));
                        setExpItem(""); setExpJust(""); setExpPrice("");
                        toast.success("Pengeluaran aktual ditambahkan.", workspaceToastOptions);
                      })}>Tambah Pengeluaran</Button>
                    </div>
                  )}
                </div>

                {/* Capaian Luaran & Verifikasi */}
                <div className="rounded-md border border-border p-3 space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Capaian Luaran Aktual &amp; Verifikasi</h4>
                  {!selected.outputs.length && <p className="text-xs text-muted-foreground">Belum ada capaian luaran dicatat.</p>}
                  {selected.outputs.map((out) => (
                    <div key={out.id} className="rounded border border-border p-2 text-xs space-y-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold">{out.title} ({out.outputYear})</p>
                          <p className="text-muted-foreground">{out.kind} · {out.publicationName || "-"} · Status: {out.status} {out.identifier ? `· ${out.identifier}` : ""}</p>
                        </div>
                        <span className={out.verifiedStatus === "verified" ? "font-semibold text-emerald-600" : out.verifiedStatus === "rejected" ? "font-semibold text-destructive" : "text-amber-600 font-medium"}>
                          {out.verifiedStatus === "verified" ? "Terverifikasi LPPM" : out.verifiedStatus === "rejected" ? "Ditolak" : "Menunggu Verifikasi"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        {out.hasProof && <a target="_blank" rel="noopener" href={`${base}/institutions/${tenant}/monev/outputs/${out.id}/proof`} className="text-brand underline">Lihat Bukti Luaran</a>}
                        {isOwner && !readOnly && selected.projectStatus !== "completed" && (
                          <label className="inline-flex items-center gap-1.5">
                            <span>Unggah Bukti (PDF/JPG/PNG):</span>
                            <input type="file" accept="application/pdf,image/png,image/jpeg" disabled={pending}
                              onChange={(e) => { uploadOutputProof(out.id, e.target.files?.[0]); e.target.value = ""; }} />
                          </label>
                        )}
                      </div>
                      {canVerify && !readOnly && (
                        <div className="flex flex-wrap gap-2 border-t border-border pt-1.5">
                          <Button size="sm" variant="outline" disabled={pending} onClick={() => void run(async () => {
                            await api(`${base}/institutions/${tenant}/monev/outputs/${out.id}/verify`, json("POST", { status: "verified", note: "Luaran sesuai bukti" }));
                            toast.success("Luaran diverifikasi.", workspaceToastOptions);
                          })}>Verifikasi Luaran</Button>
                          <Button size="sm" variant="destructive" disabled={pending} onClick={() => void run(async () => {
                            await api(`${base}/institutions/${tenant}/monev/outputs/${out.id}/verify`, json("POST", { status: "rejected", note: "Bukti luaran perlu dilengkapi" }));
                            toast.success("Verifikasi luaran ditolak.", workspaceToastOptions);
                          })}>Tolak Bukti</Button>
                        </div>
                      )}
                    </div>
                  ))}
                  {isOwner && !readOnly && selected.projectStatus !== "completed" && (
                    <div className="grid grid-cols-1 gap-2 border-t border-border pt-2 sm:grid-cols-3">
                      <Input id="out-kind" label="Jenis Luaran" value={outKind} onChange={(e) => setOutKind(e.target.value)} />
                      <Input id="out-title" label="Judul Artikel / Luaran" value={outTitle} onChange={(e) => setOutTitle(e.target.value)} />
                      <Input id="out-pub" label="Nama Jurnal / Penerbit" value={outPub} onChange={(e) => setOutPub(e.target.value)} />
                      <Input id="out-id" label="DOI / ISSN / No. HKI" value={outId} onChange={(e) => setOutId(e.target.value)} />
                      <Input id="out-yr" label="Tahun" type="number" value={outYear} onChange={(e) => setOutYear(e.target.value)} />
                      <div>
                        <label htmlFor="out-st" className="block text-xs mb-1">Status Capaian</label>
                        <select id="out-st" value={outStatus} onChange={(e) => setOutStatus(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs">
                          <option value="submitted">Submitted</option>
                          <option value="accepted">Accepted</option>
                          <option value="published">Published</option>
                          <option value="granted">Granted (HKI)</option>
                        </select>
                      </div>
                      <Input id="out-url" label="Tautan URL (opsional)" value={outUrl} onChange={(e) => setOutUrl(e.target.value)} />
                      <Button size="sm" className="self-end" disabled={pending} onClick={() => void run(async () => {
                        await api(`${base}/institutions/${tenant}/monev/proposals/${selected.proposalId}/outputs`, json("POST", {
                          kind: outKind, title: outTitle, publicationName: outPub, identifier: outId,
                          outputYear: Number(outYear), status: outStatus, url: outUrl,
                        }));
                        setOutTitle(""); setOutPub(""); setOutId(""); setOutUrl("");
                        toast.success("Capaian luaran disimpan.", workspaceToastOptions);
                      })}>Tambah Capaian Luaran</Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

