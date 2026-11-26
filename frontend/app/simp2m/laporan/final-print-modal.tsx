"use client";

import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { sanitizeClientHtml } from "../penelitian/rich-editor";
import "../penelitian/proposal-print.css";

export type PrintableFinalReport = {
  proposalId: number;
  title: string;
  data: Record<string, string>;
  source: Record<string, string>;
  owner: string;
  ownerNuptk?: string;
  ownerStudyProgram?: string;
  ownerFaculty?: string;
  ownerPhone?: string;
  ownerEmail?: string;
  officials?: {
    kaprodi?: { name: string; nuptk: string };
    dekan?: { name: string; nuptk: string };
    ketuaLppm?: { name: string; nuptk: string };
  };
  scheme: string;
  year: number;
  proposalYear?: number;
  team: string[];
  teamDetails?: { id: number; name: string; code: string; nuptk: string; studyProgram: string; phone: string; email: string }[];
  methodDiagram: boolean;
  poster: boolean;
};

type Expense = { id: number; date: string; activity: string; category: string; amount: string; fileNumber: string; evidenceCount: number };

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" });
const romanIdx = ["I", "II", "III", "IV", "V"];

function renderReportBlock(raw?: string) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return <p className="text-slate-600">–</p>;
  if (/<[a-z][\s\S]*>/i.test(trimmed)) {
    const clean = sanitizeClientHtml(trimmed);
    if (!clean) return <p className="text-slate-600">–</p>;
    return (
      <div
        className="space-y-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    );
  }
  return <p className="whitespace-pre-line">{trimmed}</p>;
}

export function FinalReportPrintModal({
  report,
  institutionName,
  reportEndpoint,
  onClose,
}: {
  report: PrintableFinalReport;
  institutionName: string;
  reportEndpoint: string;
  onClose: () => void;
}) {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const lpjUrl = `${reportEndpoint}/final-lpj`;
  const posterUrl = `${reportEndpoint}/final-poster`;
  const methodDiagramUrl = `${reportEndpoint}/method-diagram`;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(lpjUrl, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const rows = (await res.json()) as Expense[];
        if (!controller.signal.aborted) {
          setExpenses(rows.filter((row) => BigInt(row.amount || "0") > BigInt(0)));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setExpenses([]);
      });
    return () => controller.abort();
  }, [lpjUrl]);

  const d = report.data ?? {};
  const s = report.source ?? {};
  const intro = d.introduction || s.introduction;
  const literature = d.literature || s.literature;
  const method = d.method || s.method;
  const references = d.references || s.references;
  const displayYear = report.proposalYear || report.year || new Date().getFullYear();
  const teamDetails = report.teamDetails ?? [];
  const authorLine = [report.owner, ...(teamDetails.length > 0 ? teamDetails.map((m) => m.name) : report.team ?? [])]
    .filter(Boolean)
    .join(", ");

  const totalExpense = (expenses ?? []).reduce((sum, entry) => sum + BigInt(entry.amount || "0"), BigInt(0));

  async function printNow() {
    await Promise.allSettled(
      Array.from(document.querySelectorAll<HTMLImageElement>(".proposal-print-document img"), (image) => image.decode())
    );
    window.print();
  }

  return createPortal(
    <div
      className="proposal-print-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Pratinjau Cetak Laporan Akhir Penelitian"
    >
      <div className="proposal-print-frame flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-300 bg-white text-black shadow-2xl">
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3 print:hidden">
          <div>
            <h3 className="text-sm font-semibold">Pratinjau Cetak / PDF Laporan Akhir Penelitian</h3>
            <p className="text-xs text-muted-foreground">
              Format Tahoma 11pt, spasi 1,15 · Gunakan Simpan sebagai PDF pada dialog cetak browser.
            </p>
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
          className="proposal-print-document progress-print-document overflow-y-auto p-4 sm:p-8"
          style={{ fontFamily: "Tahoma, Verdana, sans-serif", fontSize: "11pt", lineHeight: 1.15 }}
        >
          <div className="space-y-5">
            {/* Cover */}
            <div className="proposal-print-cover flex min-h-[230mm] flex-col justify-between border-b border-slate-300 px-2 py-4 text-center print:border-0 print:py-0">
              <div className="flex items-center justify-center gap-6 pt-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/logo-uam.png" alt="Universitas Anwar Medika" className="h-20 w-auto object-contain sm:h-24" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/logo-diktisaintek.png" alt="Diktisaintek Berdampak" className="h-20 w-auto object-contain sm:h-24" />
              </div>

              <div className="space-y-4 py-6">
                <p className="text-xl font-bold uppercase tracking-wide">LAPORAN AKHIR PENELITIAN</p>
                <h1 className="wrap-anywhere px-4 text-lg font-bold">{report.title || "[Judul Penelitian]"}</h1>
                <p className="text-sm font-bold">
                  {report.ownerNuptk ? `${report.ownerNuptk} ` : ""}
                  {report.owner}
                </p>
              </div>

              <div className="space-y-1 pb-4 text-sm font-bold">
                <p>{report.ownerStudyProgram || "[Program Studi]"}</p>
                <p>{report.ownerFaculty || "[Nama Fakultas]"}</p>
                <p>{institutionName || "Universitas Anwar Medika"}</p>
                <p>{displayYear}</p>
              </div>

              <div className="grid break-inside-avoid grid-cols-[44%_56%] overflow-hidden text-left">
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

            {/* Halaman Pengesahan */}
            <section className="proposal-print-page-start space-y-4">
              <div className="text-center font-bold uppercase leading-snug">
                <h2>HALAMAN PENGESAHAN</h2>
                <p>LAPORAN AKHIR PENELITIAN</p>
              </div>

              <table className="w-full border-collapse text-sm">
                <tbody>
                  <tr>
                    <td className="w-56 py-0.5 align-top">Judul Penelitian</td>
                    <td className="w-4 py-0.5 align-top">:</td>
                    <td className="py-0.5 font-semibold">{report.title || "–"}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="pt-2 font-semibold">
                      Ketua Peneliti
                    </td>
                  </tr>
                  <tr>
                    <td className="py-0.5 pl-3">Nama</td>
                    <td className="py-0.5">:</td>
                    <td className="py-0.5">{report.owner || "–"}</td>
                  </tr>
                  <tr>
                    <td className="py-0.5 pl-3">NUPTK</td>
                    <td className="py-0.5">:</td>
                    <td className="py-0.5">{report.ownerNuptk || "–"}</td>
                  </tr>
                  <tr>
                    <td className="py-0.5 pl-3">Program Studi</td>
                    <td className="py-0.5">:</td>
                    <td className="py-0.5">{report.ownerStudyProgram || "–"}</td>
                  </tr>
                  <tr>
                    <td className="py-0.5 pl-3">Nomor HP</td>
                    <td className="py-0.5">:</td>
                    <td className="py-0.5">{report.ownerPhone || "–"}</td>
                  </tr>
                  <tr>
                    <td className="py-0.5 pl-3">Email</td>
                    <td className="py-0.5">:</td>
                    <td className="py-0.5">{report.ownerEmail || "–"}</td>
                  </tr>

                  {teamDetails.length > 0 ? (
                    teamDetails.map((member, idx) => (
                      <Fragment key={member.id || idx}>
                        <tr>
                          <td colSpan={3} className="pt-2 font-semibold">
                            Anggota Peneliti {teamDetails.length > 1 ? romanIdx[idx] ?? idx + 1 : ""}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-0.5 pl-3">Nama</td>
                          <td className="py-0.5">:</td>
                          <td className="py-0.5">{member.name || "–"}</td>
                        </tr>
                        <tr>
                          <td className="py-0.5 pl-3">NUPTK</td>
                          <td className="py-0.5">:</td>
                          <td className="py-0.5">{member.nuptk || member.code || "–"}</td>
                        </tr>
                        <tr>
                          <td className="py-0.5 pl-3">Program Studi</td>
                          <td className="py-0.5">:</td>
                          <td className="py-0.5">{member.studyProgram || "–"}</td>
                        </tr>
                        <tr>
                          <td className="py-0.5 pl-3">Nomor HP</td>
                          <td className="py-0.5">:</td>
                          <td className="py-0.5">{member.phone || "–"}</td>
                        </tr>
                        <tr>
                          <td className="py-0.5 pl-3">Email</td>
                          <td className="py-0.5">:</td>
                          <td className="py-0.5">{member.email || "–"}</td>
                        </tr>
                      </Fragment>
                    ))
                  ) : (report.team ?? []).length > 0 ? (
                    (report.team ?? []).map((memberName, idx) => (
                      <Fragment key={idx}>
                        <tr>
                          <td colSpan={3} className="pt-2 font-semibold">
                            Anggota Peneliti {(report.team ?? []).length > 1 ? romanIdx[idx] ?? idx + 1 : ""}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-0.5 pl-3">Nama</td>
                          <td className="py-0.5">:</td>
                          <td className="py-0.5">{memberName}</td>
                        </tr>
                      </Fragment>
                    ))
                  ) : null}
                </tbody>
              </table>

              <div className="proposal-print-signatures pt-6 text-sm">
                <p className="text-right">
                  Sidoarjo, {new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-x-10 gap-y-8">
                  <div className="flex min-h-[9.5rem] flex-col justify-between">
                    <div>
                      <p>Menyetujui,</p>
                      <p>Ketua Program Studi</p>
                    </div>
                    <div>
                      <p className="font-semibold">{report.officials?.kaprodi?.name || ""}</p>
                      <p className="border-t border-dotted border-black pt-1">
                        NUPTK. {report.officials?.kaprodi?.nuptk || ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex min-h-[9.5rem] flex-col justify-between">
                    <div>
                      <p>&nbsp;</p>
                      <p>Ketua Peneliti</p>
                    </div>
                    <div>
                      <p className="font-semibold">{report.owner}</p>
                      <p className="border-t border-dotted border-black pt-1">NUPTK. {report.ownerNuptk || ""}</p>
                    </div>
                  </div>
                  <div className="flex min-h-[9.5rem] flex-col justify-between">
                    <div>
                      <p>Mengetahui,</p>
                      <p>
                        {report.ownerFaculty
                          ? report.ownerFaculty.toLowerCase().startsWith("fakultas")
                            ? `Dekan ${report.ownerFaculty}`
                            : `Dekan Fakultas ${report.ownerFaculty}`
                          : "Dekan Fakultas ......"}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold">{report.officials?.dekan?.name || ""}</p>
                      <p className="border-t border-dotted border-black pt-1">
                        NUPTK. {report.officials?.dekan?.nuptk || ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex min-h-[9.5rem] flex-col justify-between">
                    <div>
                      <p>Disahkan,</p>
                      <p>Kepala LPPM</p>
                    </div>
                    <div>
                      <p className="font-semibold">{report.officials?.ketuaLppm?.name || ""}</p>
                      <p className="border-t border-dotted border-black pt-1">
                        NUPTK. {report.officials?.ketuaLppm?.nuptk || ""}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Abstrak */}
            <section className="proposal-print-page-start space-y-4 text-sm">
              <div className="space-y-1 text-center">
                <h2 className="text-base font-bold uppercase">{report.title || "[JUDUL PENELITIAN]"}</h2>
                <p className="font-medium">{authorLine}</p>
              </div>
              <div className="space-y-2 pt-2">
                <h3 className="text-center font-bold uppercase">ABSTRAK</h3>
                <div style={{ fontSize: "10pt" }}>{renderReportBlock(d.abstract)}</div>
                <p className="pt-2" style={{ fontSize: "10pt" }}>
                  <strong>Kata kunci:</strong> {d.keywords || "–"}
                </p>
              </div>
            </section>

            {/* Isi Laporan Akhir (Boxed Template A–F) */}
            <div className="proposal-print-page-start space-y-3">
              <div className="flex items-center justify-between gap-4 pb-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/logo-uam.png" alt="Universitas Anwar Medika" className="h-16 w-auto object-contain" />
                <div className="text-right font-bold uppercase leading-tight">
                  <p className="text-base">LAPORAN AKHIR PENELITIAN</p>
                  <p className="text-base">{institutionName || "UNIVERSITAS ANWAR MEDIKA"}</p>
                  <p className="text-base">
                    TAHUN {displayYear}/{displayYear + 1}
                  </p>
                </div>
              </div>

              <div className="proposal-boxed-container border border-black text-xs">
                {/* A. PENDAHULUAN */}
                <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">
                  A. PENDAHULUAN
                </div>
                <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                  <p>
                    Pendahuluan dijelaskan tidak lebih dari 1.000 kata dengan font <em>Tahoma</em> ukuran 11 spasi 1,15
                    yang berisi uraian yang terdiri dari :
                  </p>
                  <ul className="list-disc pl-5">
                    <li>Latar belakang dan rumusan permasalahan yang diteliti</li>
                    <li>Pendekatan pemecahan masalah</li>
                    <li>
                      <em>State of the art</em> dan kebaruan
                    </li>
                  </ul>
                </div>
                <div className="border-b border-black bg-white px-2.5 py-2">{renderReportBlock(intro)}</div>

                {/* B. TINJAUAN PUSTAKA */}
                <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">
                  B. TINJAUAN PUSTAKA
                </div>
                <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                  Tinjauan Pustaka dijelaskan dengan font <em>Tahoma</em> ukuran 11 spasi 1,15 yang mengemukakan Sumber
                  pustaka/referensi primer yang relevan dan dengan mengutamakan hasil penelitian pada jurnal ilmiah
                  dan/atau paten yang terkini. Disarankan penggunaan sumber pustaka 10 tahun terakhir.
                </div>
                <div className="border-b border-black bg-white px-2.5 py-2">{renderReportBlock(literature)}</div>

                {/* C. METODE */}
                <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">C. METODE</div>
                <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                  <p>
                    Metode dijelaskan dengan font <em>Tahoma</em> ukuran 11 spasi 1,15 yang berisi metode atau cara untuk
                    mencapai tujuan yang telah ditetapkan. Pada bagian metode wajib dilengkapi dengan:
                  </p>
                  <ul className="list-disc pl-5">
                    <li>
                      Diagram alir penelitian yang menggambarkan apa yang sudah dilaksanakan dan yang akan dikerjakan
                      selama waktu yang diusulkan. Format diagram alir dapat berupa file JPG/PNG.
                    </li>
                    <li>
                      Metode penelitian harus memuat, sekurang-kurangnya proses, luaran, indikator capaian yang
                      ditargetkan, serta anggota tim/mitra yang bertanggung jawab pada setiap tahapan penelitian.
                    </li>
                  </ul>
                </div>
                <div className="border-b border-black bg-white px-2.5 py-2">
                  {renderReportBlock(method)}
                  {report.methodDiagram && (
                    <figure className="my-3 text-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="mx-auto max-h-[150mm] max-w-full object-contain"
                        src={methodDiagramUrl}
                        alt="Diagram alir metode penelitian"
                      />
                      <figcaption className="mt-1 text-xs">Diagram alir metode penelitian</figcaption>
                    </figure>
                  )}
                </div>

                {/* D. HASIL DAN PEMBAHASAN */}
                <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">
                  D. HASIL DAN PEMBAHASAN
                </div>
                <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                  Hasil dan Pembahasan dijelaskan dengan font <em>Tahoma</em> ukuran 11 spasi 1,15 yang berisi uraian
                  mengenai hasil yang telah dicapai selama pelaksanaan kegiatan/penelitian, disertai analisis dan
                  interpretasi terhadap data atau temuan yang diperoleh. Pembahasan harus menunjukkan keterkaitan antara
                  hasil yang dicapai dengan tujuan, target luaran, serta teori atau penelitian terdahulu yang relevan.
                </div>
                <div className="border-b border-black bg-white px-2.5 py-2">{renderReportBlock(d.results)}</div>

                {/* E. KESIMPULAN DAN SARAN */}
                <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">
                  E. KESIMPULAN DAN SARAN
                </div>
                <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                  Kesimpulan dan Saran dijelaskan dengan font <em>Tahoma</em> ukuran 11 spasi 1,15 yang berisi ringkasan
                  hasil utama yang diperoleh berdasarkan tujuan kegiatan/penelitian yang telah ditetapkan. Saran memuat
                  rekomendasi untuk pengembangan kegiatan/penelitian selanjutnya, implementasi hasil, maupun tindak
                  lanjut yang diperlukan guna meningkatkan manfaat dan keberlanjutan program.
                </div>
                <div className="border-b border-black bg-white px-2.5 py-2">{renderReportBlock(d.conclusion)}</div>

                {/* F. DAFTAR PUSTAKA */}
                <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">
                  F. DAFTAR PUSTAKA
                </div>
                <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                  Daftar pustaka disusun dan ditulis berdasarkan <strong><em>APA style</em></strong> sesuai dengan
                  urutan pengutipan. Hanya pustaka yang disitasi pada laporan akhir penelitian yang dicantumkan dalam
                  Daftar Pustaka.
                </div>
                <div className="bg-white px-2.5 py-2">{renderReportBlock(references)}</div>
              </div>
            </div>

            {/* Lampiran */}
            <div className="proposal-print-page-start space-y-4 text-xs">
              <div>
                <h2 className="text-sm font-bold uppercase">LAMPIRAN</h2>
                <p className="mt-1 text-sm font-bold">L.1 Laporan Penggunaan Dana</p>
              </div>

              <table className="w-full border-collapse border border-black text-xs">
                <thead>
                  <tr>
                    <th className="w-8 border border-black px-2 py-1 text-center">No</th>
                    <th className="border border-black px-2 py-1 text-left">Kebutuhan</th>
                    <th className="border border-black px-2 py-1 text-left">Justifikasi Anggaran</th>
                    <th className="w-16 border border-black px-2 py-1 text-center">Jumlah</th>
                    <th className="w-28 border border-black px-2 py-1 text-right">Harga</th>
                    <th className="w-28 border border-black px-2 py-1 text-right">Total Harga</th>
                  </tr>
                </thead>
                <tbody>
                  {!expenses || expenses.length === 0 ? (
                    <tr>
                      <td className="border border-black px-2 py-1 text-center">-</td>
                      <td className="border border-black px-2 py-1">–</td>
                      <td className="border border-black px-2 py-1">–</td>
                      <td className="border border-black px-2 py-1 text-center">–</td>
                      <td className="border border-black px-2 py-1 text-right">–</td>
                      <td className="border border-black px-2 py-1 text-right">Rp 0</td>
                    </tr>
                  ) : (
                    expenses.map((entry, idx) => (
                      <tr key={entry.id}>
                        <td className="border border-black px-2 py-1 text-center">{idx + 1}</td>
                        <td className="border border-black px-2 py-1">
                          {entry.activity || "–"}
                          <span className="block text-[10px] text-slate-600">
                            {dateFormat.format(new Date(entry.date))}
                          </span>
                        </td>
                        <td className="border border-black px-2 py-1">
                          {entry.category || "–"}
                          {entry.fileNumber && (
                            <span className="block text-[10px] text-slate-600">Berkas: {entry.fileNumber}</span>
                          )}
                        </td>
                        <td className="border border-black px-2 py-1 text-center">1</td>
                        <td className="border border-black px-2 py-1 text-right">
                          {money.format(BigInt(entry.amount || "0"))}
                        </td>
                        <td className="border border-black px-2 py-1 text-right">
                          {money.format(BigInt(entry.amount || "0"))}
                        </td>
                      </tr>
                    ))
                  )}
                  <tr>
                    <td colSpan={5} className="border border-black px-2 py-1 text-center font-bold">
                      TOTAL PENGGUNAAN DANA
                    </td>
                    <td className="border border-black px-2 py-1 text-right font-bold">{money.format(totalExpense)}</td>
                  </tr>
                </tbody>
              </table>

              {d.fundUse && (
                <div className="space-y-1">
                  <p className="font-semibold">Catatan Penggunaan Dana:</p>
                  {renderReportBlock(d.fundUse)}
                </div>
              )}

              <div className="space-y-2 pt-4 break-inside-avoid">
                <p className="text-sm font-bold">L.2 Poster Penelitian</p>
                <p className="text-xs">Dibuat dalam bentuk jpg untuk dilampirkan di laporan akhir penelitian.</p>
                {report.poster ? (
                  <figure className="my-2 text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="mx-auto max-h-[180mm] max-w-full border border-black object-contain"
                      src={posterUrl}
                      alt="Poster Penelitian"
                    />
                    <figcaption className="mt-1 text-xs">Poster Penelitian</figcaption>
                  </figure>
                ) : (
                  <p className="text-slate-600">– (Poster belum diunggah)</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
