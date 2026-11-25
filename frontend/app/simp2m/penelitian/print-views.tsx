"use client";

import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";
import type { Choice, ProposalData } from "./proposal-fields";
import { sanitizeClientHtml } from "./rich-editor";

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
  consents?: ConsentItem[];
};

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export function PrintPreviewModal({
  mode,
  proposal,
  institutionName,
  options,
  onClose,
}: {
  mode: "proposal" | "student-letter";
  proposal: PrintableProposal;
  institutionName: string;
  options: { fields: Choice[]; lecturers: Choice[]; students: Choice[] };
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
    if (!clean) return <p className="text-muted-foreground">-</p>;
    return <div className="space-y-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: clean }} />;
  }

  function printNow() {
    window.print();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print:static print:bg-white print:p-0" role="dialog" aria-modal="true" aria-label="Pratinjau Cetak">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-white text-black shadow-2xl print:max-h-none print:max-w-none print:border-0 print:shadow-none">
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
          className="overflow-y-auto p-8 print:overflow-visible print:p-0"
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
              <div className="border-b-2 border-black pb-6 text-center space-y-3">
                <p className="text-base font-bold uppercase">USULAN PENELITIAN</p>
                <p className="text-sm font-bold uppercase">{proposal.scheme}</p>
                <h1 className="py-4 text-lg font-bold">{proposal.title || "Draf Tanpa Judul"}</h1>
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">Ketua: {proposal.owner}</p>
                  {team.map((m, idx) => (
                    <p key={idx}>Anggota {idx + 1}: {lookupLecturer(m.id)}</p>
                  ))}
                </div>
                <p className="pt-4 text-sm font-bold uppercase">{institutionName}</p>
                <p className="text-xs">{proposal.period}</p>
              </div>

              {/* Identitas */}
              <section className="space-y-2">
                <h2 className="text-sm font-bold uppercase">Identitas Penelitian</h2>
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
                <h2 className="text-sm font-bold uppercase">Ringkasan</h2>
                {renderHtmlBlock(d.summary)}
                <p className="text-xs"><strong>Kata Kunci:</strong> {(d.keywords ?? []).filter(Boolean).join(", ") || "-"}</p>
              </section>

              <section className="space-y-1">
                <h2 className="text-sm font-bold uppercase">A. Pendahuluan</h2>
                {renderHtmlBlock(d.introduction)}
              </section>

              <section className="space-y-1">
                <h2 className="text-sm font-bold uppercase">B. Tinjauan Pustaka</h2>
                {renderHtmlBlock(d.literature)}
              </section>

              <section className="space-y-1">
                <h2 className="text-sm font-bold uppercase">C. Roadmap &amp; Metode Penelitian</h2>
                {renderHtmlBlock(d.roadmap)}
                {renderHtmlBlock(d.method)}
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-bold uppercase">D. Hasil yang Diharapkan &amp; Target Luaran</h2>
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
                <h2 className="text-sm font-bold uppercase">E. Rencana Anggaran Biaya (RAB)</h2>
                {(d.costs ?? []).length > 0 && (
                  <table className="w-full border-collapse border border-black text-xs">
                    <thead><tr className="bg-gray-100"><th className="border border-black px-2 py-1 text-left">Kategori</th><th className="border border-black px-2 py-1 text-left">Item</th><th className="border border-black px-2 py-1">Volume</th><th className="border border-black px-2 py-1 text-right">Harga Satuan</th></tr></thead>
                    <tbody>
                      {(d.costs ?? []).map((c, i) => (
                        <tr key={i}><td className="border border-black px-2 py-1">{String(c.category || "-")}</td><td className="border border-black px-2 py-1">{String(c.item || "-")}</td><td className="border border-black px-2 py-1 text-center">{String(c.quantity || "0")} {String(c.unit || "")}</td><td className="border border-black px-2 py-1 text-right">Rp {Number(c.price || 0).toLocaleString("id-ID")}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="space-y-1">
                <h2 className="text-sm font-bold uppercase">F. Daftar Pustaka</h2>
                {renderHtmlBlock(d.references)}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

