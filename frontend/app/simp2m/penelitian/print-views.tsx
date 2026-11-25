"use client";

import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { Choice, ProposalData } from "./proposal-fields";
import { sanitizeClientHtml } from "./rich-editor";
import "./proposal-print.css";

type ConsentItem = {
  lecturerId: number;
  name: string;
  code: string;
  status: "pending" | "approved" | "rejected";
  note: string;
};

type PrintableProposal = {
  id: number;
  title: string;
  scheme: string;
  period: string;
  owner: string;
  budget: string;
  fieldId: number | null;
  status: string;
  data: ProposalData;
  roadmapImage?: boolean;
  methodImage?: boolean;
  consents?: ConsentItem[];
};

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

function costAmounts(quantity: string | number, price: string | number) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(quantity));
  if (!match || !/^\d+$/.test(String(price))) return { unit: "–", subtotal: "–" };
  const fraction = match[2] ?? "";
  const denominator = BigInt("1" + "0".repeat(fraction.length));
  const unit = BigInt(price);
  const subtotal = (BigInt(match[1] + fraction) * unit + denominator / BigInt(2)) / denominator;
  return { unit: money.format(unit), subtotal: money.format(subtotal) };
}

export function PrintPreviewModal({
  mode,
  proposal,
  institutionName,
  options,
  imageEndpoint,
  onClose,
}: {
  mode: "proposal" | "student-letter";
  proposal: PrintableProposal;
  institutionName: string;
  options: { fields: Choice[]; lecturers: Choice[]; students: Choice[] };
  imageEndpoint: string;
  onClose: () => void;
}) {
  const fieldName = options.fields.find((f) => f.id === proposal.fieldId)?.name ?? "-";
  const d = proposal.data;
  const students = d.students ?? [];
  const team = d.team ?? [];
  const lookupLecturer = (id: unknown) => options.lecturers.find((l) => l.id === Number(id))?.name ?? `Dosen #${id}`;
  const lookupStudent = (id: unknown) => options.students.find((s) => s.id === Number(id))?.name ?? `Mahasiswa #${id}`;

  function renderHtmlBlock(raw?: string) {
    const clean = sanitizeClientHtml(raw ?? "");
    if (!clean) return <p className="text-slate-600">–</p>;
    return <div className="space-y-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: clean }} />;
  }

  async function printNow() {
    await Promise.allSettled(Array.from(document.querySelectorAll<HTMLImageElement>(".proposal-print-document img"), image => image.decode()));
    window.print();
  }

  return createPortal(
    <div className="proposal-print-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Pratinjau Cetak">
      <div className="proposal-print-frame flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-300 bg-white text-black shadow-2xl">
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3 print:hidden">
          <div>
            <h3 className="text-sm font-semibold">
              {mode === "proposal" ? "Pratinjau Cetak / PDF Proposal Penelitian" : "Pratinjau Cetak / PDF Surat Keterlibatan Mahasiswa"}
            </h3>
            <p className="text-xs text-muted-foreground">Format Tahoma 11pt, spasi 1,15 · Gunakan Simpan sebagai PDF pada dialog cetak browser.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" type="button" onClick={printNow}>
              <Printer size={15} className="mr-1.5" aria-hidden="true" />
              Cetak / Simpan PDF
            </Button>
            <Button size="sm" type="button" variant="outline" onClick={onClose} aria-label="Tutup pratinjau">
              <X size={15} aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div
          className="proposal-print-document overflow-y-auto p-4 sm:p-8"
          style={{ fontFamily: "Tahoma, Verdana, sans-serif", fontSize: "11pt", lineHeight: 1.15 }}
        >
          {mode === "student-letter" ? (
            <div className="space-y-4">
              <div className="border-b-2 border-black pb-2 text-center">
                <h1 className="text-base font-bold uppercase">SURAT PERNYATAAN KETERLIBATAN MAHASISWA</h1>
                <p className="text-sm font-bold uppercase">DALAM PENELITIAN DOSEN</p>
              </div>
              <p>Yang bertanda tangan di bawah ini:</p>
              <table className="w-full border-collapse text-sm">
                <tbody>
                  <tr><td className="w-48 py-1">Nama Ketua Peneliti</td><td className="w-4">:</td><td className="font-semibold">{proposal.owner}</td></tr>
                  <tr><td className="py-1">Institusi</td><td>:</td><td>{institutionName}</td></tr>
                  <tr><td className="py-1">Judul Penelitian</td><td>:</td><td>{proposal.title || "-"}</td></tr>
                  <tr><td className="py-1">Skema / Periode</td><td>:</td><td>{proposal.scheme} · {proposal.period}</td></tr>
                </tbody>
              </table>
              <p>Menyatakan bahwa mahasiswa berikut dilibatkan dalam pelaksanaan penelitian:</p>
              <table className="w-full border-collapse border border-black text-xs">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-black px-2 py-1.5 text-center w-10">No</th>
                    <th className="border border-black px-2 py-1.5 text-left">Nama &amp; NIM Mahasiswa</th>
                    <th className="border border-black px-2 py-1.5 text-left">Bentuk Keterlibatan</th>
                  </tr>
                </thead>
                <tbody>
                  {students.length === 0 ? (
                    <tr><td colSpan={3} className="border border-black px-2 py-2 text-center">Belum ada mahasiswa ditambahkan.</td></tr>
                  ) : students.map((st, idx) => (
                    <tr key={idx}>
                      <td className="border border-black px-2 py-1.5 text-center">{idx + 1}</td>
                      <td className="border border-black px-2 py-1.5">{lookupStudent(st.id)}</td>
                      <td className="border border-black px-2 py-1.5">{String(st.activity || "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="pt-2 font-semibold">Rencana Tugas Akhir dan Tanda Tangan Mahasiswa:</p>
              <table className="w-full border-collapse border border-black text-xs">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-black px-2 py-1.5 text-center w-10">No</th>
                    <th className="border border-black px-2 py-1.5 text-left">Nama &amp; NIM</th>
                    <th className="border border-black px-2 py-1.5 text-left">Judul Tugas Akhir</th>
                    <th className="border border-black px-2 py-1.5 text-center w-32">Tanda Tangan</th>
                  </tr>
                </thead>
                <tbody>
                  {students.length === 0 ? (
                    <tr><td colSpan={4} className="border border-black px-2 py-2 text-center">-</td></tr>
                  ) : students.map((st, idx) => (
                    <tr key={idx}>
                      <td className="border border-black px-2 py-2 text-center">{idx + 1}</td>
                      <td className="border border-black px-2 py-2">{lookupStudent(st.id)}</td>
                      <td className="border border-black px-2 py-2">{String(st.thesis || "-")}</td>
                      <td className="border border-black px-2 py-4 text-center"></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="grid grid-cols-2 gap-8 pt-8 text-center text-xs">
                <div>
                  <p>Mengetahui,</p>
                  <p className="font-semibold">Pejabat LPPM {institutionName}</p>
                  <div className="h-16" />
                  <p>(........................................)</p>
                </div>
                <div>
                  <p>{institutionName}, {new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</p>
                  <p className="font-semibold">Ketua Peneliti,</p>
                  <div className="h-16" />
                  <p className="font-semibold underline">{proposal.owner}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Cover */}
              <div className="proposal-print-cover space-y-4 border-b border-slate-300 px-2 py-10 text-center print:border-0 print:pb-0">
                <p className="text-xl font-bold uppercase">Proposal Penelitian</p>
                <p className="text-sm font-bold uppercase">{proposal.scheme}</p>
                <h1 className="wrap-anywhere py-6 text-xl font-bold">{proposal.title || "Draf Tanpa Judul"}</h1>
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">Ketua: {proposal.owner}</p>
                  {team.map((m, idx) => (
                    <p key={idx}>Anggota {idx + 1}: {lookupLecturer(m.id)}</p>
                  ))}
                </div>
                <div className="pt-8"><p className="text-sm font-bold uppercase">{institutionName}</p><p className="mt-1 text-sm">{proposal.period}</p></div>
              </div>

              <section className="proposal-print-page-start space-y-3">
                <h2 className="border-b border-slate-300 pb-2 text-center text-base font-bold uppercase">Halaman Pengesahan</h2>
                <dl className="space-y-1 text-sm">
                  <dt className="font-semibold">Judul Penelitian</dt><dd>{proposal.title || "–"}</dd>
                  <dt className="font-semibold">Ketua Peneliti</dt><dd>{proposal.owner}</dd>
                  {!!team.length && <><dt className="font-semibold">Anggota Peneliti</dt>
                    {team.map((member, index) => <dd key={index}>{lookupLecturer(member.id)}</dd>)}</>}
                </dl>
                <div className="proposal-print-signatures grid grid-cols-2 gap-8 pt-8 text-center text-sm">
                  <div><p>Mengetahui,</p><p className="font-semibold">Kepala LPPM</p><div className="h-16" /><p>(........................................)</p></div>
                  <div><p>Ketua Peneliti,</p><div className="h-[4.9rem]" /><p className="font-semibold">{proposal.owner}</p></div>
                </div>
              </section>

              <section className="proposal-print-page-start space-y-2">
                <h2 className="text-base font-bold uppercase">Identitas dan Uraian Umum</h2>
                <table className="w-full border-collapse border border-black text-xs">
                  <tbody>
                    <tr><td className="border border-black px-2 py-1 font-semibold w-44">Bidang Riset</td><td className="border border-black px-2 py-1">{fieldName}</td></tr>
                    <tr><td className="border border-black px-2 py-1 font-semibold">Objek &amp; Lokasi</td><td className="border border-black px-2 py-1">{d.object || "-"} / {d.location || "-"}</td></tr>
                    <tr><td className="border border-black px-2 py-1 font-semibold">Jadwal Pelaksanaan</td><td className="border border-black px-2 py-1">{d.starts || "-"} s.d. {d.ends || "-"}</td></tr>
                    <tr><td className="border border-black px-2 py-1 font-semibold">Total Usulan RAB</td><td className="border border-black px-2 py-1 font-semibold">{money.format(BigInt(proposal.budget || "0"))}</td></tr>
                  </tbody>
                </table>
              </section>

              <section className="space-y-1">
                <h2 className="text-sm font-bold uppercase">A. Peta Jalan Penelitian</h2>
                {renderHtmlBlock(d.roadmap)}
                {proposal.roadmapImage && <DocumentDiagram src={`${imageEndpoint}/roadmap`} label="Diagram peta jalan penelitian" />}
              </section>
              <section className="space-y-1">
                <h2 className="text-sm font-bold uppercase">B. Ringkasan</h2>
                {renderHtmlBlock(d.summary)}
              </section>
              <section className="space-y-1">
                <h2 className="text-sm font-bold uppercase">C. Kata Kunci</h2>
                <p>{(d.keywords ?? []).filter(Boolean).join(", ") || "–"}</p>
                {d.sdgKeywords && <p><strong>Kata kunci SDGs:</strong> {d.sdgKeywords}</p>}
              </section>

              <section className="space-y-1">
                <h2 className="text-sm font-bold uppercase">D. Pendahuluan</h2>
                {renderHtmlBlock(d.introduction)}
              </section>

              <section className="space-y-1">
                <h2 className="text-sm font-bold uppercase">E. Tinjauan Pustaka</h2>
                {renderHtmlBlock(d.literature)}
              </section>

              <section className="space-y-1">
                <h2 className="text-sm font-bold uppercase">F. Metode</h2>
                {renderHtmlBlock(d.method)}
                {proposal.methodImage && <DocumentDiagram src={`${imageEndpoint}/method`} label="Diagram metode penelitian" />}
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-bold uppercase">G. Hasil yang Diharapkan</h2>
                {renderHtmlBlock(d.expected)}
                {(d.outputs ?? []).length > 0 && (
                  <table className="w-full border-collapse border border-black text-xs">
                    <thead><tr className="bg-gray-100"><th className="border border-black px-2 py-1">No</th><th className="border border-black px-2 py-1 text-left">Jenis Luaran</th><th className="border border-black px-2 py-1 text-left">Status</th><th className="border border-black px-2 py-1">Tahun</th></tr></thead>
                    <tbody>
                      {(d.outputs ?? []).map((o, i) => (
                        <tr key={i}><td className="border border-black px-2 py-1 text-center">{i + 1}</td><td className="border border-black px-2 py-1">{String(o.kind || "-")}</td><td className="border border-black px-2 py-1">{String(o.status || "-")}</td><td className="border border-black px-2 py-1 text-center">{String(o.year || "-")}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-bold uppercase">H. Anggaran Biaya</h2>
                {(d.costs ?? []).length > 0 && (
                  <table className="w-full border-collapse border border-black text-xs">
                    <thead><tr className="bg-gray-100"><th className="border border-black px-2 py-1 text-left">Kategori</th><th className="border border-black px-2 py-1 text-left">Item dan Justifikasi</th><th className="border border-black px-2 py-1">Volume</th><th className="border border-black px-2 py-1 text-right">Harga Satuan</th><th className="border border-black px-2 py-1 text-right">Subtotal</th></tr></thead>
                    <tbody>
                      {(d.costs ?? []).map((c, i) => {
                        const amount = costAmounts(c.quantity ?? "", c.price ?? "");
                        return <tr key={i}><td className="border border-black px-2 py-1">{String(c.category || "–")}</td><td className="border border-black px-2 py-1">{String(c.item || "–")}{c.reason && <p className="mt-1">{String(c.reason)}</p>}</td><td className="border border-black px-2 py-1 text-center">{String(c.quantity || "0")} {String(c.unit || "")}</td><td className="border border-black px-2 py-1 text-right">{amount.unit}</td><td className="border border-black px-2 py-1 text-right">{amount.subtotal}</td></tr>;
                      })}
                    </tbody>
                  </table>
                )}
                <p className="text-right font-semibold">Total RAB {money.format(BigInt(proposal.budget || "0"))}</p>
              </section>

              <section className="space-y-1">
                <h2 className="text-sm font-bold uppercase">I. Jadwal Pelaksanaan</h2>
                {!!d.schedule?.length && <table className="w-full border-collapse border border-black text-xs">
                  <thead><tr>{["Kegiatan", "Luaran", "Penanggung jawab", "Bulan"].map(label => <th className="border border-black px-2 py-1 text-left" key={label}>{label}</th>)}</tr></thead>
                  <tbody>{d.schedule.map((row, index) => <tr key={index}>
                    {[row.name, row.output, row.person, `${row.from || "–"}–${row.to || "–"}`].map((value, column) => <td className="border border-black px-2 py-1" key={column}>{value || "–"}</td>)}
                  </tr>)}</tbody>
                </table>}
              </section>
              <section className="space-y-1">
                <h2 className="text-sm font-bold uppercase">J. Daftar Pustaka</h2>
                {renderHtmlBlock(d.references)}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>, document.body
  );
}

function DocumentDiagram({ src, label }: { src: string; label: string }) {
  return <figure className="my-3 text-center">
    {/* The authenticated image must load before printing, at its original resolution. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className="mx-auto max-h-[150mm] max-w-full object-contain" src={src} alt={label} />
    <figcaption className="mt-1 text-xs">{label}</figcaption>
  </figure>;
}

