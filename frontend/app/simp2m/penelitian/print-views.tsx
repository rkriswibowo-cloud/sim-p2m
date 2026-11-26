"use client";

import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";
import { Fragment } from "react";
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
  ownerNuptk?: string;
  ownerStudyProgram?: string;
  ownerFaculty?: string;
  ownerPhone?: string;
  ownerEmail?: string;
  proposalYear?: number;
  teamDetails?: { id: number; name: string; code: string; nuptk: string; studyProgram: string; phone: string; email: string }[];
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
  const outputs = d.outputs ?? [];
  const romanIdx = ["I", "II", "III", "IV", "V"];
  const lookupLecturer = (id: unknown) => options.lecturers.find((l) => l.id === Number(id))?.name ?? `Dosen #${id}`;
  const lookupLecturerDetail = (id: unknown) => proposal.teamDetails?.find((l) => l.id === Number(id));
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
              <div className="proposal-print-cover flex min-h-[240mm] flex-col justify-between border-b border-slate-300 px-2 py-4 text-center print:border-0 print:py-0">
                <div className="flex items-center justify-center gap-6 pt-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/images/logo-uam.png" alt="Universitas Anwar Medika" className="h-20 w-auto object-contain sm:h-24" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/images/logo-diktisaintek.png" alt="Diktisaintek Berdampak" className="h-20 w-auto object-contain sm:h-24" />
                </div>

                <div className="space-y-4 py-8">
                  <p className="text-xl font-bold uppercase tracking-wide">PROPOSAL PENELITIAN</p>
                  <h1 className="wrap-anywhere px-4 text-lg font-bold">{proposal.title || "[Judul Penelitian]"}</h1>
                  <p className="text-sm font-bold">
                    {proposal.ownerNuptk ? `${proposal.ownerNuptk} ` : ""}{proposal.owner}
                  </p>
                </div>

                <div className="space-y-1 pb-6 text-sm font-bold">
                  <p>{proposal.ownerStudyProgram || "[Program Studi]"}</p>
                  <p>{proposal.ownerFaculty || "[Nama Fakultas]"}</p>
                  <p>{institutionName || "Universitas Anwar Medika"}</p>
                  <p>{proposal.proposalYear || new Date().getFullYear()}</p>
                </div>

                <div className="grid grid-cols-[44%_56%] overflow-hidden text-left">
                  <div className="flex items-center bg-[#008000] px-5 py-4 text-white">
                    <span className="font-serif text-xl font-bold tracking-tight sm:text-2xl">www.uam.ac.id</span>
                  </div>
                  <div className="bg-[#f5ee24] px-4 py-3 text-center text-[11px] leading-snug text-black">
                    <p className="font-semibold uppercase">UNIVERSITAS ANWAR MEDIKA</p>
                    <p>Jalan Raya By Pass Krian KM. 33 Balongbendo Sidoarjo 61263</p>
                    <p>Telp. (031) 99892096 - 082233362014</p>
                    <p>Email univ.anwarmedika@uam.ac.id</p>
                  </div>
                </div>
              </div>

              <section className="proposal-print-page-start space-y-4">
                <div className="text-center font-bold uppercase leading-snug">
                  <h2>HALAMAN PENGESAHAN</h2>
                  <p>PROPOSAL PENELITIAN</p>
                </div>

                <table className="w-full border-collapse text-sm">
                  <tbody>
                    <tr>
                      <td className="w-56 py-0.5 align-top">Judul Penelitian</td>
                      <td className="w-4 py-0.5 align-top">:</td>
                      <td className="py-0.5 font-semibold">{proposal.title || "–"}</td>
                    </tr>
                    <tr>
                      <td className="py-0.5 align-top">Bidang Riset</td>
                      <td className="py-0.5 align-top">:</td>
                      <td className="py-0.5">{fieldName}</td>
                    </tr>
                    <tr>
                      <td className="py-0.5 align-top">Skema Riset</td>
                      <td className="py-0.5 align-top">:</td>
                      <td className="py-0.5">{proposal.scheme}</td>
                    </tr>
                    <tr>
                      <td className="py-0.5 align-top">Dana yang diajukan</td>
                      <td className="py-0.5 align-top">:</td>
                      <td className="py-0.5">{money.format(BigInt(proposal.budget || "0"))}</td>
                    </tr>

                    <tr><td colSpan={3} className="pt-2 font-semibold">Ketua Peneliti</td></tr>
                    <tr><td className="py-0.5 pl-3">Nama</td><td className="py-0.5">:</td><td className="py-0.5">{proposal.owner}</td></tr>
                    <tr><td className="py-0.5 pl-3">NIDN/NUPTK</td><td className="py-0.5">:</td><td className="py-0.5">{proposal.ownerNuptk || "–"}</td></tr>
                    <tr><td className="py-0.5 pl-3">Program Studi</td><td className="py-0.5">:</td><td className="py-0.5">{proposal.ownerStudyProgram || "–"}</td></tr>
                    <tr><td className="py-0.5 pl-3">Nomor HP</td><td className="py-0.5">:</td><td className="py-0.5">{proposal.ownerPhone || "–"}</td></tr>
                    <tr><td className="py-0.5 pl-3">Email</td><td className="py-0.5">:</td><td className="py-0.5">{proposal.ownerEmail || "–"}</td></tr>

                    {team.map((member, idx) => {
                      const det = lookupLecturerDetail(member.id);
                      const label = romanIdx[idx] ?? String(idx + 1);
                      return (
                        <Fragment key={idx}>
                          <tr><td colSpan={3} className="pt-2 font-semibold">Anggota Peneliti {label}</td></tr>
                          <tr><td className="py-0.5 pl-3">Nama</td><td className="py-0.5">:</td><td className="py-0.5">{det?.name ?? lookupLecturer(member.id)}</td></tr>
                          <tr><td className="py-0.5 pl-3">NIDN/NUPTK</td><td className="py-0.5">:</td><td className="py-0.5">{det?.nuptk || det?.code || "–"}</td></tr>
                          <tr><td className="py-0.5 pl-3">Program Studi</td><td className="py-0.5">:</td><td className="py-0.5">{det?.studyProgram || "–"}</td></tr>
                          <tr><td className="py-0.5 pl-3">Nomor HP</td><td className="py-0.5">:</td><td className="py-0.5">{det?.phone || "–"}</td></tr>
                          <tr><td className="py-0.5 pl-3">Email</td><td className="py-0.5">:</td><td className="py-0.5">{det?.email || "–"}</td></tr>
                        </Fragment>
                      );
                    })}

                    <tr>
                      <td className="pt-2 py-0.5 align-top">Jumlah Mahasiswa yang dilibatkan</td>
                      <td className="pt-2 py-0.5 align-top">:</td>
                      <td className="pt-2 py-0.5">{students.length} Orang</td>
                    </tr>
                    <tr>
                      <td className="py-0.5 align-top">Luaran yang dijanjikan</td>
                      <td className="py-0.5 align-top">:</td>
                      <td className="py-0.5">
                        {outputs.length === 0 ? "–" : (
                          <ul className="list-disc pl-4 space-y-0.5">
                            {outputs.map((o, i) => (
                              <li key={i}>{String(o.kind || "-")} ({String(o.status || "-")}, {String(o.year || "-")})</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="proposal-print-signatures pt-6 text-sm">
                  <p className="text-right">
                    Sidoarjo, {new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-x-10 gap-y-8">
                    <div>
                      <p>Menyetujui,</p>
                      <p>Ketua Program Studi</p>
                      <div className="h-16" />
                      <p className="border-t border-dotted border-black pt-1">NUPTK.</p>
                    </div>
                    <div>
                      <p>&nbsp;</p>
                      <p>Ketua Peneliti</p>
                      <div className="h-16" />
                      <p className="font-semibold">{proposal.owner}</p>
                      <p className="border-t border-dotted border-black pt-1">NUPTK. {proposal.ownerNuptk || ""}</p>
                    </div>
                    <div>
                      <p>Mengetahui,</p>
                      <p>Dekan Fakultas {proposal.ownerFaculty || "......"}</p>
                      <div className="h-16" />
                      <p className="border-t border-dotted border-black pt-1">NUPTK.</p>
                    </div>
                    <div>
                      <p>Disahkan,</p>
                      <p>Plt. Kepala LPPM</p>
                      <div className="h-16" />
                      <p className="border-t border-dotted border-black pt-1">NUPTK.</p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="proposal-print-page-start space-y-3 text-sm">
                <h2 className="text-center text-base font-bold uppercase">IDENTITAS DAN URAIAN UMUM</h2>

                <div>
                  <p className="font-semibold">1. Judul Penelitian</p>
                  <p className="pl-4 pt-0.5">{proposal.title || "–"}</p>
                </div>

                <div>
                  <p className="font-semibold">2. Tim Peneliti</p>
                  <table className="mt-1.5 w-full border-collapse border border-black text-xs">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="w-8 border border-black px-2 py-1 text-center">No</th>
                        <th className="border border-black px-2 py-1 text-left">Nama</th>
                        <th className="border border-black px-2 py-1 text-left">NUPTK</th>
                        <th className="border border-black px-2 py-1 text-left">Program Studi</th>
                        <th className="border border-black px-2 py-1 text-left">Bidang Keahlian</th>
                        <th className="w-28 border border-black px-2 py-1 text-center">Alokasi waktu (Jam/minggu)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="border border-black px-2 py-1 text-center">1</td>
                        <td className="border border-black px-2 py-1">{proposal.owner} (Ketua Peneliti)</td>
                        <td className="border border-black px-2 py-1">{proposal.ownerNuptk || "–"}</td>
                        <td className="border border-black px-2 py-1">{proposal.ownerStudyProgram || "–"}</td>
                        <td className="border border-black px-2 py-1">{fieldName}</td>
                        <td className="border border-black px-2 py-1 text-center">–</td>
                      </tr>
                      {team.map((m, idx) => {
                        const det = lookupLecturerDetail(m.id);
                        return (
                          <tr key={idx}>
                            <td className="border border-black px-2 py-1 text-center">{idx + 2}</td>
                            <td className="border border-black px-2 py-1">{det?.name ?? lookupLecturer(m.id)}</td>
                            <td className="border border-black px-2 py-1">{det?.nuptk || det?.code || "–"}</td>
                            <td className="border border-black px-2 py-1">{det?.studyProgram || "–"}</td>
                            <td className="border border-black px-2 py-1">{String(m.expertise || "–")}</td>
                            <td className="border border-black px-2 py-1 text-center">{m.hours ? String(m.hours) : "–"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div>
                  <p className="font-semibold">3. Objek Penelitian (jenis material yang diteliti dan segi penelitian)</p>
                  <p className="pl-4 pt-0.5">{d.object || "–"}</p>
                </div>

                <div>
                  <p className="font-semibold">4. Masa Pelaksanaan</p>
                  <div className="pl-4 pt-0.5 space-y-0.5">
                    <p><span className="inline-block w-20">Mulai</span>: {d.starts || "–"}</p>
                    <p><span className="inline-block w-20">Berakhir</span>: {d.ends || "–"}</p>
                  </div>
                </div>

                <div>
                  <p className="font-semibold">5. Usulan Biaya :</p>
                  <p className="pl-4 pt-0.5">{money.format(BigInt(proposal.budget || "0"))}</p>
                </div>

                <div>
                  <p className="font-semibold">6. Lokasi Penelitian :</p>
                  <p className="pl-4 pt-0.5">{d.location || "–"}</p>
                </div>

                <div>
                  <p className="font-semibold">7. Instansi lain yang terlibat (jika ada, sebutkan dan uraikan kontribusinya)</p>
                  <p className="pl-4 pt-0.5">{d.partner ? (d.contribution ? `${d.partner} (${d.contribution})` : d.partner) : "–"}</p>
                </div>

                <div>
                  <p className="font-semibold">8. Temuan yang ditargetkan</p>
                  <p className="pl-4 pt-0.5">{d.findings || "–"}</p>
                </div>

                <div>
                  <p className="font-semibold">9. Jurnal Ilmiah yang menjadi sasaran publikasi</p>
                  <p className="pl-4 pt-0.5">{d.journal || "–"}</p>
                </div>
              </section>

              {/* Inti Proposal (Boxed Template A–J) */}
              <div className="proposal-print-page-start space-y-3">
                <div className="flex items-center justify-between gap-4 pb-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/images/logo-uam.png" alt="Universitas Anwar Medika" className="h-16 w-auto object-contain" />
                  <div className="text-right font-bold uppercase leading-tight">
                    <p className="text-base">PROPOSAL PENELITIAN</p>
                    <p className="text-base">{institutionName || "UNIVERSITAS ANWAR MEDIKA"}</p>
                    <p className="text-base">TAHUN {proposal.proposalYear ? `${proposal.proposalYear}/${proposal.proposalYear + 1}` : new Date().getFullYear()}</p>
                  </div>
                </div>

                <div className="border-[1.5px] border-black text-xs">
                  {/* A. PETA JALAN */}
                  <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">
                    A. PETA JALAN PENELITIAN (<em>ROAD MAP</em>)
                  </div>
                  <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                    Tuliskan peta jalan penelitian dari tahapan yang telah dicapai, tahapan yang akan dilakukan selama jangka waktu penelitian, dan tahapan yang direncanakan. Bagan dan <em>road map</em> dibuat dalam bentuk JPG/PNG yang kemudian disisipkan dalam isian ini.
                  </div>
                  <div className="border-b border-black bg-white px-2.5 py-2">
                    {renderHtmlBlock(d.roadmap)}
                    {proposal.roadmapImage && <DocumentDiagram src={`${imageEndpoint}/roadmap`} label="Diagram peta jalan penelitian" />}
                  </div>

                  {/* B. RINGKASAN */}
                  <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">
                    B. RINGKASAN
                  </div>
                  <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                    Ringkasan dijelaskan tidak lebih dari 1 halaman dengan font <em>Tahoma</em> ukuran 11 spasi 1,15 yang berisi uraian latar belakang penelitian, tujuan dan tahapan metode penelitian, luaran yang ditargetkan.
                  </div>
                  <div className="border-b border-black bg-white px-2.5 py-2">
                    {renderHtmlBlock(d.summary)}
                  </div>

                  {/* C. KATA KUNCI */}
                  <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">
                    C. KATA KUNCI
                  </div>
                  <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                    Cantumkan pula lima kata kunci (<em>key words</em>) yang paling dominan dan ditambah kata kunci yang berkaitan dengan SDGs (Sustainable Development Goals).
                  </div>
                  <div className="border-b border-black bg-white px-2.5 py-2 space-y-1">
                    <p>{(d.keywords ?? []).filter(Boolean).join(", ") || "–"}</p>
                    {d.sdgKeywords && <p><strong>Kata kunci SDGs:</strong> {d.sdgKeywords}</p>}
                  </div>

                  {/* D. PENDAHULUAN */}
                  <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">
                    D. PENDAHULUAN
                  </div>
                  <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                    <p>Pendahuluan dijelaskan tidak lebih dari 1.000 kata dengan font <em>Tahoma</em> ukuran 11 spasi 1,15 yang berisi uraian yang terdiri dari :</p>
                    <ul className="list-disc pl-5">
                      <li>Latar belakang dan rumusan permasalahan yang akan diteliti</li>
                      <li>Pendekatan pemecahan masalah</li>
                      <li><em>State of the art</em> dan kebaruan</li>
                    </ul>
                  </div>
                  <div className="border-b border-black bg-white px-2.5 py-2">
                    {renderHtmlBlock(d.introduction)}
                  </div>

                  {/* E. TINJAUAN PUSTAKA */}
                  <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">
                    E. TINJAUAN PUSTAKA
                  </div>
                  <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                    Tinjauan Pustaka dijelaskan dengan font <em>Tahoma</em> ukuran 11 spasi 1,15 yang mengemukakan Sumber pustaka/referensi primer yang relevan dan dengan mengutamakan hasil penelitian pada jurnal ilmiah dan/atau paten yang terkini. Disarankan penggunaan sumber pustaka 10 tahun terakhir.
                  </div>
                  <div className="border-b border-black bg-white px-2.5 py-2">
                    {renderHtmlBlock(d.literature)}
                  </div>

                  {/* F. METODE */}
                  <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">
                    F. METODE
                  </div>
                  <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                    <p>Metode dijelaskan dengan font <em>Tahoma</em> ukuran 11 spasi 1,15 yang berisi metode atau cara untuk mencapai tujuan yang telah ditetapkan. Pada bagian metode wajib dilengkapi dengan:</p>
                    <ul className="list-disc pl-5">
                      <li>Diagram alir penelitian yang menggambarkan apa yang sudah dilaksanakan dan yang akan dikerjakan selama waktu yang diusulkan. Format diagram alir dapat berupa file JPG/PNG.</li>
                      <li>Metode penelitian harus memuat, sekurang-kurangnya proses, luaran, indikator capaian yang ditargetkan, serta anggota tim/mitra yang bertanggung jawab pada setiap tahapan penelitian.</li>
                    </ul>
                  </div>
                  <div className="border-b border-black bg-white px-2.5 py-2">
                    {renderHtmlBlock(d.method)}
                    {proposal.methodImage && <DocumentDiagram src={`${imageEndpoint}/method`} label="Diagram metode penelitian" />}
                  </div>

                  {/* G. HASIL YANG DIHARAPKAN */}
                  <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">
                    G. HASIL YANG DIHARAPKAN
                  </div>
                  <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                    Jelaskan hasil yang diharapkan atau luaran yang dijanjikan dari penelitian
                  </div>
                  <div className="border-b border-black bg-white px-2.5 py-2 space-y-2">
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
                  </div>

                  {/* H. ANGGARAN BIAYA */}
                  <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">
                    H. ANGGARAN BIAYA
                  </div>
                  <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                    Justifikasi anggaran biaya ditulis dengan terperinci dan jelas. Pada anggaran biaya tidak diperkenankan adanya honor pelaksana kegiatan.
                  </div>
                  <div className="border-b border-black bg-white px-2.5 py-2 space-y-2">
                    <p><strong>Tabel.</strong> Rencana Anggaran Biaya Penelitian</p>
                    <table className="w-full border-collapse border border-black text-xs">
                      <thead>
                        <tr>
                          <th className="w-10 border border-black px-2 py-1 text-center">No</th>
                          <th className="border border-black px-2 py-1 text-left">Jenis Pengeluaran</th>
                          <th className="w-44 border border-black px-2 py-1 text-center">Biaya yang diusulkan (Rp)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(d.costs ?? []).length === 0 ? (
                          <tr><td colSpan={3} className="border border-black px-2 py-1 text-center">–</td></tr>
                        ) : (d.costs ?? []).map((c, i) => {
                          const amount = costAmounts(c.quantity ?? "", c.price ?? "");
                          return (
                            <tr key={i}>
                              <td className="border border-black px-2 py-1 text-center">{i + 1}</td>
                              <td className="border border-black px-2 py-1">
                                <strong>{String(c.category || "–")}</strong>: {String(c.item || "–")} ({String(c.quantity || "0")} {String(c.unit || "")})
                                {c.reason && <span className="block text-[11px]">{String(c.reason)}</span>}
                              </td>
                              <td className="border border-black px-2 py-1 text-right">{amount.subtotal}</td>
                            </tr>
                          );
                        })}
                        <tr>
                          <td colSpan={2} className="border border-black px-2 py-1 text-right font-bold">TOTAL</td>
                          <td className="border border-black px-2 py-1 text-right font-bold">{money.format(BigInt(proposal.budget || "0"))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* I. JADWAL PELAKSANAAN */}
                  <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold">
                    I. Jadwal Pelaksanaan
                  </div>
                  <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                    Jadwal kegiatan selama waktu durasi penelitian dituliskan dengan jelas sesuai pekerjaan, jadwal kegiatan jelas kaitannya dengan tahapan pekerjaan di metodologi
                  </div>
                  <div className="border-b border-black bg-white px-2.5 py-2 space-y-2">
                    <p className="text-center font-bold uppercase">RENCANA JADWAL PELAKSANAAN KEGIATAN</p>
                    {(() => {
                      const maxMonth = Math.max(8, ...(d.schedule ?? []).map(s => Number(s.to) || 0));
                      const months = Array.from({ length: maxMonth }, (_, i) => i + 1);
                      return (
                        <table className="w-full border-collapse border border-black text-xs">
                          <thead>
                            <tr>
                              <th rowSpan={2} className="w-8 border border-black px-1.5 py-1 text-center">No</th>
                              <th rowSpan={2} className="border border-black px-2 py-1 text-center">Nama Kegiatan</th>
                              <th colSpan={months.length} className="border border-black px-2 py-1 text-center">Bulan</th>
                            </tr>
                            <tr>
                              {months.map(m => (
                                <th key={m} className="w-6 border border-black px-1 py-0.5 text-center">{m}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {!d.schedule?.length ? (
                              <tr><td colSpan={2 + months.length} className="border border-black px-2 py-1 text-center">–</td></tr>
                            ) : d.schedule.map((row, idx) => {
                              const from = Number(row.from) || 0;
                              const to = Number(row.to) || 0;
                              return (
                                <tr key={idx}>
                                  <td className="border border-black px-1.5 py-1 text-center">{idx + 1}</td>
                                  <td className="border border-black px-2 py-1">{row.name || "–"}</td>
                                  {months.map(m => {
                                    const active = from > 0 && to >= from && m >= from && m <= to;
                                    return (
                                      <td key={m} className={`border border-black px-1 py-1 text-center ${active ? "bg-slate-700 text-white font-bold" : ""}`}>
                                        {active ? "✓" : ""}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      );
                    })()}
                  </div>

                  {/* J. DAFTAR PUSTAKA */}
                  <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold">
                    J. Daftar Pustaka
                  </div>
                  <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                    Daftar pustaka disusun dan ditulis berdasarkan <strong><em>APA style</em></strong> sesuai dengan urutan pengutipan. Hanya pustaka yang disitasi pada usulan penelitian yang dicantumkan dalam Daftar Pustaka.
                  </div>
                  <div className="bg-white px-2.5 py-2">
                    {renderHtmlBlock(d.references)}
                  </div>
                </div>
              </div>
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

