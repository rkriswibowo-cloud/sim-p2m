"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { workspaceToastOptions } from "../confirm-removal";
import { api, json } from "../penelitian/view";

type Mode = "production" | "trial-admin" | "trial-reader";
type Institution = { id: number; name: string; active: boolean; canResearch: boolean; canVerify?: boolean; canDecide?: boolean };
type ReadyProposal = { proposalId: number; title: string; owner: string; scheme: string; period: string; approvedBudget: string };
type Amendment = { id: number; number: string; date: string; previousBudget: string; newBudget: string; reason: string };
type Disbursement = { id: number; projectId: number; termName: string; amount: string; status: "planned" | "transferred"; transferDate: string; referenceNo: string; hasProof: boolean; note: string };
type Project = {
  id: number; proposalId: number; title: string; owner: string; scheme: string; period: string;
  contractNumber: string; contractDate: string; approvedBudget: string; totalDisbursed: string; status: string;
  amendments: Amendment[]; disbursements: Disbursement[];
};
type ExternalFunding = {
  id: number; ownerId: number; owner: string; title: string; funderName: string; schemeName: string;
  fiscalYear: number; proposedBudget: string; approvedBudget?: string; externalContractNo: string;
  status: string; verificationNote: string; hasProof: boolean;
};

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export function FundingPanel() {
  const [mode, setMode] = useState<Mode>("production");
  const [system, setSystem] = useState(false);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [tenant, setTenant] = useState(0);
  const [tab, setTab] = useState<"contracts" | "external">("contracts");
  const [projects, setProjects] = useState<Project[]>([]);
  const [ready, setReady] = useState<ReadyProposal[]>([]);
  const [canDecide, setCanDecide] = useState(false);
  const [canVerify, setCanVerify] = useState(false);
  const [externals, setExternals] = useState<ExternalFunding[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  // Convert contract inputs
  const [contractNo, setContractNo] = useState("");
  const [contractDate, setContractDate] = useState(new Date().toISOString().slice(0, 10));

  // Amendment inputs
  const [amendNo, setAmendNo] = useState("");
  const [amendDate, setAmendDate] = useState(new Date().toISOString().slice(0, 10));
  const [amendBudget, setAmendBudget] = useState("");
  const [amendReason, setAmendReason] = useState("");

  // Disbursement inputs
  const [termName, setTermName] = useState("");
  const [termAmount, setTermAmount] = useState("");
  const [termNote, setTermNote] = useState("");
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [transferRef, setTransferRef] = useState("");

  // External funding form
  const [extTitle, setExtTitle] = useState("");
  const [extFunder, setExtFunder] = useState("");
  const [extScheme, setExtScheme] = useState("");
  const [extYear, setExtYear] = useState(String(new Date().getFullYear()));
  const [extProposed, setExtProposed] = useState("");
  const [extApproved, setExtApproved] = useState("");
  const [extContract, setExtContract] = useState("");

  const base = mode === "production" ? "/api/v1/iam" : `/api/v1/trial/${mode}/iam`;
  const readOnly = mode === "trial-reader";

  useEffect(() => {
    const controller = new AbortController();
    void api<{ items: Institution[]; system: boolean }>(base + "/institutions", { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        const allowed = res.items.filter((i) => i.active && (res.system || i.canResearch || i.canVerify || i.canDecide));
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
    void Promise.all([
      api<{ projects: Project[]; readyProposals: ReadyProposal[]; canDecide: boolean; canVerify: boolean }>(
        `${base}/institutions/${tenant}/projects`,
        { signal: controller.signal }
      ),
      api<{ items: ExternalFunding[]; canVerify: boolean }>(
        `${base}/institutions/${tenant}/external-fundings`,
        { signal: controller.signal }
      ).catch(() => ({ items: [] as ExternalFunding[], canVerify: false })),
    ])
      .then(([projRes, extRes]) => {
        if (controller.signal.aborted) return;
        setProjects(projRes.projects);
        setReady(projRes.readyProposals);
        setCanDecide(projRes.canDecide);
        setCanVerify(projRes.canVerify || extRes.canVerify);
        setExternals(extRes.items);
        setSelected((prev) => (prev ? projRes.projects.find((p) => p.id === prev.id) ?? null : null));
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

  function uploadExternalProof(extId: number, file?: File) {
    if (!file) return;
    const form = new FormData();
    form.set("proof", file);
    void run(async () => {
      await api(`${base}/institutions/${tenant}/external-fundings/${extId}/proof`, { method: "PUT", body: form });
      toast.success("Bukti pendanaan eksternal diunggah.", workspaceToastOptions);
    });
  }

  function transferDisbursement(disbId: number, file?: File) {
    if (!transferDate || !transferRef.trim()) {
      toast.error("Isi tanggal transfer dan nomor referensi terlebih dahulu.", workspaceToastOptions);
      return;
    }
    const form = new FormData();
    form.set("transferDate", transferDate);
    form.set("referenceNo", transferRef.trim());
    if (file) form.set("proof", file);
    void run(async () => {
      await api(`${base}/institutions/${tenant}/disbursements/${disbId}/transfer`, { method: "POST", body: form });
      setTransferRef("");
      toast.success("Pencairan dana dicatat.", workspaceToastOptions);
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Kontrak, Pencairan &amp; Pendanaan Eksternal</h1>
          <p className="text-xs text-muted-foreground">Konversi proposal didanai menjadi kontrak proyek, pencairan termin dana, dan registrasi hibah eksternal.</p>
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

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={tab === "contracts" ? "default" : "outline"} onClick={() => setTab("contracts")}>
          Kontrak &amp; Pencairan Internal ({projects.length})
        </Button>
        <Button size="sm" variant={tab === "external" ? "default" : "outline"} onClick={() => setTab("external")}>
          Pendanaan Eksternal ({externals.length})
        </Button>
      </div>

      {tab === "contracts" && (
        <div className="space-y-4">
          {canDecide && !readOnly && ready.length > 0 && (
            <Card className="workspace-panel rounded-md">
              <CardHeader><CardTitle>Usulan Didanai Siap Dibuat Kontrak ({ready.length})</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input id="new-contract-no" label="Nomor Kontrak / Surat Tugas" placeholder="001/LPPM-UAM/KONTRAK/2026" value={contractNo} onChange={(e) => setContractNo(e.target.value)} />
                  <Input id="new-contract-date" label="Tanggal Kontrak" type="date" value={contractDate} onChange={(e) => setContractDate(e.target.value)} />
                </div>
                {ready.map((r) => (
                  <div key={r.proposalId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                    <div>
                      <p className="font-semibold">#{r.proposalId} · {r.title}</p>
                      <p className="text-xs text-muted-foreground">{r.owner} · {r.scheme} · Disetujui {money.format(BigInt(r.approvedBudget))}</p>
                    </div>
                    <Button size="sm" disabled={pending} onClick={() => void run(async () => {
                      await api(`${base}/institutions/${tenant}/projects/convert/${r.proposalId}`, json("POST", { contractNumber: contractNo, contractDate }));
                      setContractNo("");
                      toast.success("Kontrak proyek berhasil dibuat.", workspaceToastOptions);
                    })}>Terbitkan Kontrak</Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <Card className="workspace-panel rounded-md lg:col-span-5">
              <CardHeader><CardTitle>Daftar Proyek &amp; Kontrak</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {!projects.length && <p className="text-sm text-muted-foreground">Belum ada proyek berkontrak.</p>}
                {projects.map((p) => (
                  <button key={p.id} type="button" onClick={() => { setSelected(p); setAmendBudget(p.approvedBudget); }}
                    className={`w-full rounded-md border p-3 text-left text-sm transition ${selected?.id === p.id ? "border-brand bg-accent/40" : "border-border hover:bg-muted/40"}`}>
                    <p className="font-semibold">{p.contractNumber}</p>
                    <p className="line-clamp-1 text-xs">{p.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{p.owner} · {p.scheme}</p>
                    <p className="mt-1 text-xs">Kontrak: <strong>{money.format(BigInt(p.approvedBudget))}</strong> · Cair: <strong>{money.format(BigInt(p.totalDisbursed))}</strong></p>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card className="workspace-panel rounded-md lg:col-span-7">
              <CardHeader><CardTitle>{selected ? `Kontrak ${selected.contractNumber}` : "Detail Kontrak & Termin"}</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm">
                {!selected ? (
                  <p className="text-muted-foreground">Pilih salah satu kontrak di sebelah kiri untuk melihat detail, mengunduh surat kontrak, mengelola pencairan, atau mencatat amandemen.</p>
                ) : (
                  <>
                    <div className="rounded-md border border-border p-3 space-y-1 text-xs">
                      <p className="text-sm font-semibold">{selected.title}</p>
                      <p className="text-muted-foreground">Ketua: {selected.owner} · Tanggal Kontrak: {selected.contractDate}</p>
                      <p>Nilai Kontrak: <strong>{money.format(BigInt(selected.approvedBudget))}</strong> · Total Dicairkan: <strong>{money.format(BigInt(selected.totalDisbursed))}</strong></p>
                      <div className="pt-2">
                        <a href={`${base}/institutions/${tenant}/projects/${selected.id}/contract-docx`}
                          className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent">
                          Unduh Surat Kontrak (.docx)
                        </a>
                      </div>
                    </div>

                    {/* Termin Pencairan */}
                    <div className="rounded-md border border-border p-3 space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Termin &amp; Pencairan Dana</h4>
                      {!selected.disbursements.length && <p className="text-xs text-muted-foreground">Belum ada termin pencairan.</p>}
                      {selected.disbursements.map((d) => (
                        <div key={d.id} className="rounded border border-border p-2 text-xs space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold">{d.termName} — {money.format(BigInt(d.amount))}</span>
                            <span className={d.status === "transferred" ? "font-semibold text-emerald-600" : "text-amber-600 font-medium"}>
                              {d.status === "transferred" ? `Ditransfer (${d.transferDate})` : "Direncanakan"}
                            </span>
                          </div>
                          {d.referenceNo && <p className="text-muted-foreground">No. Referensi / SP2D: {d.referenceNo}</p>}
                          {d.hasProof && (
                            <a target="_blank" rel="noopener" href={`${base}/institutions/${tenant}/disbursements/${d.id}/proof`} className="text-brand underline">
                              Lihat Bukti Transfer
                            </a>
                          )}
                          {canDecide && !readOnly && d.status !== "transferred" && (
                            <div className="grid grid-cols-1 gap-2 border-t border-border pt-2 sm:grid-cols-3 items-end">
                              <Input id={`tr-date-${d.id}`} label="Tanggal Transfer" type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
                              <Input id={`tr-ref-${d.id}`} label="No. Referensi" placeholder="SP2D/TRF-001" value={transferRef} onChange={(e) => setTransferRef(e.target.value)} />
                              <label className="block text-xs">
                                <span className="mb-1 block">Bukti &amp; Tandai Cair (PDF/JPG/PNG)</span>
                                <input type="file" accept="application/pdf,image/png,image/jpeg" disabled={pending}
                                  onChange={(e) => { transferDisbursement(d.id, e.target.files?.[0]); e.target.value = ""; }} />
                              </label>
                            </div>
                          )}
                        </div>
                      ))}

                      {canDecide && !readOnly && (
                        <div className="grid grid-cols-1 gap-2 border-t border-border pt-2 sm:grid-cols-3 items-end">
                          <Input id="disb-term" label="Nama Termin" placeholder="Termin 1 (70%)" value={termName} onChange={(e) => setTermName(e.target.value)} />
                          <Input id="disb-amt" label="Nominal (Rp)" type="number" value={termAmount} onChange={(e) => setTermAmount(e.target.value)} />
                          <div className="flex gap-2">
                            <Input id="disb-note" label="Catatan" value={termNote} onChange={(e) => setTermNote(e.target.value)} />
                            <Button size="sm" className="self-end" disabled={pending} onClick={() => void run(async () => {
                              await api(`${base}/institutions/${tenant}/projects/${selected.id}/disbursements`, json("POST", { termName, amount: termAmount, note: termNote }));
                              setTermName(""); setTermAmount(""); setTermNote("");
                              toast.success("Termin pencairan ditambahkan.", workspaceToastOptions);
                            })}>Tambah</Button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Amandemen Kontrak */}
                    <div className="rounded-md border border-border p-3 space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Riwayat Amandemen Kontrak</h4>
                      {!selected.amendments.length && <p className="text-xs text-muted-foreground">Belum ada amandemen kontrak.</p>}
                      {selected.amendments.map((am) => (
                        <div key={am.id} className="border-b border-border pb-1.5 text-xs">
                          <span className="font-semibold">{am.number}</span> ({am.date}) · {money.format(BigInt(am.previousBudget))} → {money.format(BigInt(am.newBudget))}
                          <p className="text-muted-foreground">{am.reason}</p>
                        </div>
                      ))}
                      {canDecide && !readOnly && (
                        <div className="grid grid-cols-1 gap-2 border-t border-border pt-2 sm:grid-cols-2">
                          <Input id="am-no" label="Nomor Adendum" value={amendNo} onChange={(e) => setAmendNo(e.target.value)} />
                          <Input id="am-date" label="Tanggal Adendum" type="date" value={amendDate} onChange={(e) => setAmendDate(e.target.value)} />
                          <Input id="am-bud" label="Nilai Anggaran Baru (Rp)" type="number" value={amendBudget} onChange={(e) => setAmendBudget(e.target.value)} />
                          <Input id="am-rsn" label="Alasan Amandemen" value={amendReason} onChange={(e) => setAmendReason(e.target.value)} />
                          <Button size="sm" className="sm:col-span-2 justify-self-start" disabled={pending} onClick={() => void run(async () => {
                            await api(`${base}/institutions/${tenant}/projects/${selected.id}/amendments`, json("POST", {
                              number: amendNo, date: amendDate, newBudget: amendBudget, reason: amendReason,
                            }));
                            setAmendNo(""); setAmendReason("");
                            toast.success("Amandemen kontrak disimpan.", workspaceToastOptions);
                          })}>Simpan Amandemen</Button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === "external" && (
        <div className="space-y-4">
          {!readOnly && (
            <Card className="workspace-panel rounded-md">
              <CardHeader><CardTitle>Registrasi Pendanaan Eksternal (BIMA / Mitra)</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Input id="ext-title" label="Judul Usulan / Hibah" value={extTitle} onChange={(e) => setExtTitle(e.target.value)} />
                  <Input id="ext-funder" label="Penyandang Dana (DRTPM/BRIN/Mitra)" value={extFunder} onChange={(e) => setExtFunder(e.target.value)} />
                  <Input id="ext-scheme" label="Nama Skema Eksternal" value={extScheme} onChange={(e) => setExtScheme(e.target.value)} />
                  <Input id="ext-year" label="Tahun Anggaran" type="number" value={extYear} onChange={(e) => setExtYear(e.target.value)} />
                  <Input id="ext-prop" label="Nominal Usulan (Rp)" type="number" value={extProposed} onChange={(e) => setExtProposed(e.target.value)} />
                  <Input id="ext-app" label="Nominal Disetujui (opsional)" type="number" value={extApproved} onChange={(e) => setExtApproved(e.target.value)} />
                  <Input id="ext-cnt" label="No. Kontrak Eksternal (opsional)" value={extContract} onChange={(e) => setExtContract(e.target.value)} />
                </div>
                <Button size="sm" disabled={pending} onClick={() => void run(async () => {
                  await api(`${base}/institutions/${tenant}/external-fundings`, json("POST", {
                    title: extTitle, funderName: extFunder, schemeName: extScheme,
                    fiscalYear: Number(extYear), proposedBudget: extProposed,
                    approvedBudget: extApproved, externalContractNo: extContract,
                  }));
                  setExtTitle(""); setExtFunder(""); setExtScheme(""); setExtProposed(""); setExtApproved(""); setExtContract("");
                  toast.success("Registrasi pendanaan eksternal disimpan.", workspaceToastOptions);
                })}>Daftarkan Pendanaan Eksternal</Button>
              </CardContent>
            </Card>
          )}

          <Card className="workspace-panel rounded-md">
            <CardHeader><CardTitle>Daftar Pendanaan Eksternal</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!externals.length && <p className="text-muted-foreground">Belum ada registrasi pendanaan eksternal.</p>}
              {externals.map((e) => (
                <div key={e.id} className="rounded-md border border-border p-3 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{e.title}</p>
                      <p className="text-xs text-muted-foreground">{e.owner} · {e.funderName} ({e.schemeName}) · Tahun {e.fiscalYear}</p>
                      <p className="text-xs">Usulan: {money.format(BigInt(e.proposedBudget))} {e.approvedBudget ? `· Disetujui: ${money.format(BigInt(e.approvedBudget))}` : ""} {e.externalContractNo ? `· Kontrak: ${e.externalContractNo}` : ""}</p>
                    </div>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium uppercase">{e.status}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {e.hasProof && <a target="_blank" rel="noopener" href={`${base}/institutions/${tenant}/external-fundings/${e.id}/proof`} className="text-brand underline">Lihat Bukti Pengajuan/SK</a>}
                    {!readOnly && (
                      <label className="inline-flex items-center gap-1.5">
                        <span>Unggah Bukti (PDF/JPG/PNG):</span>
                        <input type="file" accept="application/pdf,image/png,image/jpeg" disabled={pending}
                          onChange={(ev) => { uploadExternalProof(e.id, ev.target.files?.[0]); ev.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                  {canVerify && !readOnly && (
                    <div className="flex flex-wrap gap-2 border-t border-border pt-2">
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => void run(async () => {
                        await api(`${base}/institutions/${tenant}/external-fundings/${e.id}/verify`, json("POST", { status: "verified", note: "Terverifikasi LPPM" }));
                        toast.success("Registrasi diverifikasi.", workspaceToastOptions);
                      })}>Verifikasi</Button>
                      <Button size="sm" disabled={pending} onClick={() => void run(async () => {
                        await api(`${base}/institutions/${tenant}/external-fundings/${e.id}/verify`, json("POST", { status: "funded", note: "Tercatat Didanai Eksternal" }));
                        toast.success("Status ditetapkan Didanai Eksternal.", workspaceToastOptions);
                      })}>Tandai Didanai</Button>
                      <Button size="sm" variant="destructive" disabled={pending} onClick={() => void run(async () => {
                        await api(`${base}/institutions/${tenant}/external-fundings/${e.id}/verify`, json("POST", { status: "rejected", note: "Bukti belum valid" }));
                        toast.success("Registrasi ditolak.", workspaceToastOptions);
                      })}>Tolak</Button>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}

