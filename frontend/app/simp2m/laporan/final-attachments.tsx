"use client";

import { useEffect, useState } from "react";
import { Download, Eye, Upload } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { workspaceToastOptions } from "../confirm-removal";

type Expense = { id: number; date: string; activity: string; category: string; amount: string; fileNumber: string; evidenceCount: number };
const currency = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" });

export function FinalAttachments({ endpoint, poster, disabled, onUpload }: {
  endpoint: string; poster: boolean; disabled: boolean; onUpload: (uploading: boolean) => void;
}) {
  const [expenses, setExpenses] = useState<Expense[]>();
  const [hasPoster, setHasPoster] = useState(poster);
  const [uploading, setUploading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [posterError, setPosterError] = useState("");
  const expenseURL = endpoint + "/final-lpj";
  const posterURL = endpoint + "/final-poster";

  useEffect(() => {
    const controller = new AbortController();
    void fetch(expenseURL, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error();
      const entries = await response.json() as Expense[];
      if (!controller.signal.aborted) setExpenses(entries.filter(entry => BigInt(entry.amount) > BigInt(0)));
    }).catch(() => { if (!controller.signal.aborted) setLoadFailed(true); });
    return () => controller.abort();
  }, [expenseURL]);

  async function upload(file: File) {
    if (disabled || uploading) return;
    setPosterError("");
    if (file.size > 2 * 1024 * 1024) {
      setPosterError("Ukuran poster maksimal 2 MB.");
      return;
    }
    setUploading(true);
    onUpload(true);
    try {
      const form = new FormData();
      form.set("image", file);
      const response = await fetch(posterURL, { method: "PUT", body: form });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(result?.message ?? "Poster gagal diunggah.");
      }
      setHasPoster(true);
      toast.success("Poster laporan akhir tersimpan.", workspaceToastOptions);
    } catch (err) {
      setPosterError((err as Error).message);
    } finally {
      setUploading(false);
      onUpload(false);
    }
  }

  return <div className="space-y-3">
    <section className="space-y-2 rounded-lg border border-border p-3" aria-labelledby="lpj-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="lpj-heading" className="font-semibold">L.1 Laporan Penggunaan Dana (LPJ)</h3>
        {expenses && <span className="text-sm font-semibold tabular-nums">Total realisasi {currency.format(expenses.reduce((sum, entry) => sum + BigInt(entry.amount), BigInt(0)))}</span>}
      </div>
      <p className="text-xs text-muted-foreground">Nominal dan bukti mengikuti Catatan Harian usulan ini. Perbarui transaksi pada tab Catatan Harian, lalu buka kembali laporan untuk melihat perubahannya.</p>
      {loadFailed && <p role="alert" className="text-sm text-destructive">Data LPJ gagal dimuat.</p>}
      {!expenses && !loadFailed && <p role="status" className="text-sm">Memuat data Catatan Harian…</p>}
      {expenses?.length === 0 && <p className="text-sm text-muted-foreground">Belum ada pengeluaran bernominal di Catatan Harian.</p>}
      {!!expenses?.length && <div className="overflow-x-auto">
        <table className="workspace-table w-full min-w-[40rem] text-left text-sm">
          <thead><tr>{["Tanggal", "Kegiatan / kebutuhan", "Kelompok biaya", "Nominal", "No. berkas / bukti"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{expenses.map(entry => <tr key={entry.id}>
            <td className="whitespace-nowrap">{date.format(new Date(entry.date))}</td>
            <td className="wrap-anywhere">{entry.activity}</td><td>{entry.category || "–"}</td>
            <td className="whitespace-nowrap tabular-nums">{currency.format(BigInt(entry.amount))}</td>
            <td><p>{entry.fileNumber || "–"}</p>
              {!entry.evidenceCount && <span className="text-xs text-muted-foreground">Bukti belum ada</span>}
              {Array.from({ length: entry.evidenceCount }, (_, index) => <a key={index} className="mr-2 inline-flex items-center gap-1 text-xs text-brand underline"
                href={`${expenseURL}/${entry.id}/evidence/${index + 1}`} download><Download size={13} aria-hidden="true" /> Bukti {index + 1}</a>)}
            </td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
    <section className="space-y-2 rounded-lg border border-border p-3" aria-labelledby="poster-heading">
      <h3 id="poster-heading" className="font-semibold">L.2 Poster Penelitian</h3>
      {hasPoster && <a className="text-sm text-brand underline" href={posterURL} target="_blank" rel="noreferrer"><Eye size={15} className="mr-1 inline shrink-0 align-text-bottom" aria-hidden="true" /> Lihat poster tersimpan</a>}
      <Input icon={<Upload size={15} aria-hidden="true" />} label={hasPoster ? "Ganti poster (JPG, maksimal 2 MB)" : "Unggah poster (JPG, maksimal 2 MB)"} type="file" accept="image/jpeg,.jpg,.jpeg"
        disabled={disabled || uploading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
      {uploading && <p role="status" className="text-sm">Mengunggah poster…</p>}
      {posterError && <p role="alert" className="text-sm text-destructive">{posterError}</p>}
    </section>
  </div>;
}
