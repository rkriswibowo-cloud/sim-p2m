"use client";

import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";
import { createPortal } from "react-dom";
import { sanitizeClientHtml } from "../penelitian/rich-editor";
import "../penelitian/proposal-print.css";

export type PrintableProgressReport = {
  proposalId: number;
  title: string;
  data: Record<string, string>;
  source: Record<string, string>;
  outputTargets?: { kind: string; status: string; year: number }[] | null;
  outputProgress?: { status: string; result: string; evidence: string; followUp: string }[] | null;
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
  budget?: string;
  costs?: { category?: string; item?: string; quantity?: string | number; price?: string | number }[] | null;
  methodDiagram: boolean;
};

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

const statusLabels: Record<string, string> = {
  not_started: "Belum dimulai",
  in_progress: "Dalam proses",
  achieved: "Tercapai",
};

function costSubtotal(quantity: string | number, price: string | number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(quantity ?? ""));
  if (!match || !/^\d+$/.test(String(price ?? ""))) return BigInt(0);
  const fraction = match[2] ?? "";
  const denominator = BigInt("1" + "0".repeat(fraction.length));
  const unit = BigInt(price);
  return (BigInt(match[1] + fraction) * unit + denominator / BigInt(2)) / denominator;
}

function rabGroupKey(category: unknown): "habis" | "ganda" | "penunjang" | "lain" {
  const c = String(category ?? "").toLowerCase();
  if (c.includes("habis") || c.includes("bahan")) return "habis";
  if (c.includes("ganda")) return "ganda";
  if (c.includes("penunjang") || c.includes("alat")) return "penunjang";
  return "lain";
}

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

export function ProgressReportPrintModal({
  report,
  institutionName,
  methodDiagramUrl,
  onClose,
}: {
  report: PrintableProgressReport;
  institutionName: string;
  methodDiagramUrl: string;
  onClose: () => void;
}) {
  const d = report.data ?? {};
  const s = report.source ?? {};
  const intro = d.introduction || s.introduction;
  const method = d.method || s.method;
  const references = d.references || s.references;
  const targets = report.outputTargets ?? [];
  const progress = report.outputProgress ?? [];
  const displayYear = report.proposalYear || report.year || new Date().getFullYear();

  const costs = report.costs ?? [];
  const totals = { habis: BigInt(0), ganda: BigInt(0), penunjang: BigInt(0), lain: BigInt(0) };
  for (const item of costs) {
    totals[rabGroupKey(item.category)] += costSubtotal(item.quantity ?? "", item.price ?? "");
  }
  const sumCosts = totals.habis + totals.ganda + totals.penunjang + totals.lain;
  const grandTotal = sumCosts > BigInt(0) ? sumCosts : BigInt(report.budget || "0");

  const rabRows = [
    { no: 1, label: "Bahan Habis Pakai (Lab = 50%/Non-Lab = 30%)", amount: totals.habis },
    { no: 2, label: "Penggandaan (Lab = 10%/Non-Lab 30%)", amount: totals.ganda },
    { no: 3, label: "Peralatan Penunjang (Lab = 30%/Non-Lab 20%)", amount: totals.penunjang },
    { no: 4, label: "Lain-lain (Lab = 10%/Non-Lab = 20%)", amount: totals.lain },
  ];

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
      aria-label="Pratinjau Cetak Laporan Kemajuan Penelitian"
    >
      <div className="proposal-print-frame flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-300 bg-white text-black shadow-2xl">
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3 print:hidden">
          <div>
            <h3 className="text-sm font-semibold">Pratinjau Cetak / PDF Laporan Kemajuan Penelitian</h3>
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
                <p className="text-xl font-bold uppercase tracking-wide">LAPORAN KEMAJUAN PENELITIAN</p>
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
                <p>LAPORAN KEMAJUAN PENELITIAN</p>
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
                    <td className="py-0.5 pl-3">NIDN/NUPTK</td>
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
                      <p>Plt. Kepala LPPM</p>
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

            {/* Isi Laporan Kemajuan (Boxed Template A–F) */}
            <div className="proposal-print-page-start space-y-3">
              <div className="flex items-center justify-between gap-4 pb-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/logo-uam.png" alt="Universitas Anwar Medika" className="h-16 w-auto object-contain" />
                <div className="text-right font-bold uppercase leading-tight">
                  <p className="text-base">LAPORAN KEMAJUAN PENELITIAN</p>
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
                    <li>Latar belakang dan rumusan permasalahan yang akan diteliti</li>
                    <li>Pendekatan pemecahan masalah</li>
                    <li>
                      <em>State of the art</em> dan kebaruan
                    </li>
                  </ul>
                </div>
                <div className="border-b border-black bg-white px-2.5 py-2">{renderReportBlock(intro)}</div>

                {/* B. METODE */}
                <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">B. METODE</div>
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

                {/* C. KEMAJUAN PENELITIAN (75%) */}
                <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">
                  C. KEMAJUAN PENELITIAN (75%)
                </div>
                <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                  Uraikan Capaian indikator tahapan Penelitian dan luaran
                </div>
                <div className="border-b border-black bg-white px-2.5 py-2 space-y-2">
                  {d.progress && renderReportBlock(d.progress)}
                  <table className="w-full border-collapse border border-black text-xs">
                    <thead>
                      <tr>
                        <th className="w-10 border border-black px-2 py-1 text-center">No</th>
                        <th className="border border-black px-2 py-1 text-left">Tahapan Penelitian</th>
                        <th className="border border-black px-2 py-1 text-left">Target Hasil</th>
                        <th className="border border-black px-2 py-1 text-left">Hasil yang dicapai</th>
                      </tr>
                    </thead>
                    <tbody>
                      {targets.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="border border-black px-2 py-1 text-center">
                            –
                          </td>
                        </tr>
                      ) : (
                        targets.map((target, idx) => {
                          const item = progress[idx];
                          const statusText = item?.status ? statusLabels[item.status] ?? item.status : "";
                          return (
                            <tr key={idx}>
                              <td className="border border-black px-2 py-1 text-center">{idx + 1}</td>
                              <td className="border border-black px-2 py-1">{String(target.kind || "–")}</td>
                              <td className="border border-black px-2 py-1">
                                {String(target.status || "–")} ({String(target.year || "–")})
                              </td>
                              <td className="border border-black px-2 py-1 space-y-0.5">
                                {statusText && <p className="font-semibold">Status: {statusText}</p>}
                                <p>{item?.result || "–"}</p>
                                {item?.evidence && (
                                  <p className="text-[10px] break-all">Bukti: {item.evidence}</p>
                                )}
                                {item?.followUp && (
                                  <p className="text-[10px]">Tindak lanjut: {item.followUp}</p>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* D. RENCANA TAHAPAN YANG AKAN DIKERJAKAN */}
                <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">
                  D. RENCANA TAHAPAN YANG AKAN DIKERJAKAN
                </div>
                <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                  Uraikan tahapan Penelitian yang belum dan akan dikerjakan
                </div>
                <div className="border-b border-black bg-white px-2.5 py-2">{renderReportBlock(d.nextPlan)}</div>

                {/* E. ANGGARAN BIAYA (25%) */}
                <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold uppercase">
                  E. ANGGARAN BIAYA (25%)
                </div>
                <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                  Justifikasi anggaran biaya ditulis dengan terperinci dan jelas. Pada anggaran biaya tidak
                  diperkenankan adanya honor pelaksana kegiatan.
                </div>
                <div className="border-b border-black bg-white px-2.5 py-2 space-y-2">
                  <p>
                    <strong>Tabel.</strong> Rencana Anggaran Biaya Penelitian
                  </p>
                  <table className="w-full border-collapse border border-black text-xs">
                    <thead>
                      <tr>
                        <th className="w-10 border border-black px-2 py-1 text-center">No</th>
                        <th className="border border-black px-2 py-1 text-left">Jenis Pengeluaran</th>
                        <th className="w-44 border border-black px-2 py-1 text-center">Biaya yang diusulkan (Rp)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rabRows.map((row) => (
                        <tr key={row.no}>
                          <td className="border border-black px-2 py-1 text-center">{row.no}</td>
                          <td className="border border-black px-2 py-1">{row.label}</td>
                          <td className="border border-black px-2 py-1 text-right">{money.format(row.amount)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td colSpan={2} className="border border-black px-2 py-1 text-center font-bold">
                          TOTAL
                        </td>
                        <td className="border border-black px-2 py-1 text-right font-bold">
                          {money.format(grandTotal)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {d.budgetNotes && (
                    <div className="pt-1">
                      <p className="font-semibold">Catatan Anggaran:</p>
                      {renderReportBlock(d.budgetNotes)}
                    </div>
                  )}
                </div>

                {/* F. DAFTAR PUSTAKA */}
                <div className="border-b border-black bg-[#8eaadb] px-2.5 py-1.5 font-bold">F. Daftar Pustaka</div>
                <div className="border-b border-black bg-[#bdd0e9] px-2.5 py-1.5">
                  Daftar pustaka disusun dan ditulis berdasarkan <strong><em>APA style</em></strong> sesuai dengan
                  urutan pengutipan. Hanya pustaka yang disitasi pada usulan penelitian yang dicantumkan dalam Daftar
                  Pustaka.
                </div>
                <div className="bg-white px-2.5 py-2">{renderReportBlock(references)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
