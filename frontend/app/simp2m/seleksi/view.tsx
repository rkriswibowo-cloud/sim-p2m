"use client";

import { CircleCheck, CircleX, Eye, Pencil, Save, Trash2, UserCheck, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { workspaceToastOptions } from "../confirm-removal";
import { api, json } from "../penelitian/view";
import { stripHtml } from "../penelitian/rich-editor";

type Mode = "production" | "trial-admin" | "trial-reader";
type Institution = {
  id: number; name: string; active: boolean;
  canVerify?: boolean; canReview?: boolean; canDecide?: boolean;
};
type Choice = { id: number; name: string };
type ReviewRow = {
  id: number; assignmentId: number; reviewerName?: string;
  scoreRelevance: number; scoreMethod: number; scoreNovelty: number; scoreBudget: number;
  totalScore: number; recommendation: "approve" | "revise" | "reject";
  publicComment: string; internalComment?: string; submittedAt: string;
};
type AssignmentView = {
  id: number; proposalId: number; reviewerId: number; reviewerName: string; reviewerCode: string;
  blindReview: boolean; dueDate: string; status: "assigned" | "accepted" | "declined" | "completed";
  conflictNote: string; review?: ReviewRow;
};
type ApprovalEntry = {
  id: number; fromStatus: string; toStatus: string; actorName: string; roleName: string; note: string; revision: number; createdAt: string;
};
type WorkflowProposal = {
  id: number; title: string; owner: string; ownerEmail: string; scheme: string; period: string;
  revision: number; budget: string; maxBudget: string; workflowStatus: string; fundingDecision: string;
  approvedBudget?: string; decisionNote: string; submittedAt?: string;
  assignments: AssignmentView[]; approvals: ApprovalEntry[]; averageScore?: number;
};
type MyReviewItem = {
  assignmentId: number; proposalId: number; title: string; scheme: string; period: string;
  owner: string; budget: string; workflowStatus: string; blindReview: boolean; dueDate: string;
  status: "assigned" | "accepted" | "declined" | "completed"; conflictNote: string;
  data: { summary?: string; introduction?: string; method?: string; expected?: string };
  review?: ReviewRow;
};

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

const wfLabels: Record<string, string> = {
  draft: "Draf",
  submitted: "Dikirim",
  admin_revision: "Revisi Administrasi",
  admin_verified: "Lolos Administrasi",
  under_review: "Sedang Direview",
  review_revision: "Revisi Pasca-Review",
  review_completed: "Review Selesai",
  rejected_admin: "Ditolak Administrasi",
  withdrawn: "Ditarik",
};

const decLabels: Record<string, string> = {
  pending: "Menunggu Keputusan",
  funded: "Didanai",
  not_funded: "Tidak Didanai",
};

export function SelectionPanel() {
  const [mode, setMode] = useState<Mode>("production");
  const [system, setSystem] = useState(false);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [tenant, setTenant] = useState(0);
  const [tab, setTab] = useState<"workflow" | "reviews">("workflow");
  const [proposals, setProposals] = useState<WorkflowProposal[]>([]);
  const [reviewers, setReviewers] = useState<Choice[]>([]);
  const [canVerify, setCanVerify] = useState(false);
  const [canDecide, setCanDecide] = useState(false);
  const [myReviews, setMyReviews] = useState<MyReviewItem[]>([]);
  const [selected, setSelected] = useState<WorkflowProposal | null>(null);
  const [activeReview, setActiveReview] = useState<MyReviewItem | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  // Forms state
  const [transNote, setTransNote] = useState("");
  const [assignReviewerId, setAssignReviewerId] = useState(0);
  const [assignBlind, setAssignBlind] = useState(false);
  const [assignDue, setAssignDue] = useState("");
  const [decisionBudget, setDecisionBudget] = useState("");
  const [decisionNote, setDecisionNote] = useState("");

  // Review rubric form
  const [scoreRel, setScoreRel] = useState(80);
  const [scoreMet, setScoreMet] = useState(80);
  const [scoreNov, setScoreNov] = useState(80);
  const [scoreBud, setScoreBud] = useState(80);
  const [rec, setRec] = useState<"approve" | "revise" | "reject">("approve");
  const [pubComment, setPubComment] = useState("");
  const [intlComment, setIntlComment] = useState("");

  const base = mode === "production" ? "/api/v1/iam" : `/api/v1/trial/${mode}/iam`;
  const readOnly = mode === "trial-reader";

  useEffect(() => {
    const controller = new AbortController();
    void api<{ items: Institution[]; system: boolean }>(base + "/institutions", { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        const allowed = res.items.filter((i) => i.active && (res.system || i.canVerify || i.canReview || i.canDecide));
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
    const inst = institutions.find((i) => i.id === tenant);
    const allowWF = system || mode !== "production" || inst?.canVerify || inst?.canDecide;
    const allowRev = system || mode !== "production" || inst?.canReview;

    if (allowWF) {
      void api<{ proposals: WorkflowProposal[]; reviewers: Choice[]; canVerify: boolean; canDecide: boolean }>(
        `${base}/institutions/${tenant}/workflow/proposals`,
        { signal: controller.signal }
      )
        .then((res) => {
          if (controller.signal.aborted) return;
          setProposals(res.proposals);
          setReviewers(res.reviewers);
          setCanVerify(res.canVerify);
          setCanDecide(res.canDecide);
          setSelected((prev) => (prev ? res.proposals.find((p) => p.id === prev.id) ?? null : null));
        })
        .catch(() => {
          if (!controller.signal.aborted) setProposals([]);
        });
    } else if (allowRev) {
      Promise.resolve().then(() => {
        if (controller.signal.aborted) return;
        setProposals([]);
        setCanVerify(false);
        setCanDecide(false);
        setTab("reviews");
      });
    }

    if (allowRev) {
      void api<MyReviewItem[]>(`${base}/institutions/${tenant}/reviews`, { signal: controller.signal })
        .then((revs) => {
          if (controller.signal.aborted) return;
          setMyReviews(revs);
          setActiveReview((prev) => (prev ? revs.find((r) => r.assignmentId === prev.assignmentId) ?? null : null));
        })
        .catch(() => {
          if (!controller.signal.aborted) setMyReviews([]);
        });
    }

    return () => controller.abort();
  }, [base, institutions, mode, system, tenant, tick]);

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

  function openReviewForm(item: MyReviewItem) {
    setActiveReview(item);
    setScoreRel(item.review?.scoreRelevance ?? 80);
    setScoreMet(item.review?.scoreMethod ?? 80);
    setScoreNov(item.review?.scoreNovelty ?? 80);
    setScoreBud(item.review?.scoreBudget ?? 80);
    setRec(item.review?.recommendation ?? "approve");
    setPubComment(item.review?.publicComment ?? "");
    setIntlComment(item.review?.internalComment ?? "");
  }

  const totalPreviewScore = (scoreRel * 0.25 + scoreMet * 0.30 + scoreNov * 0.25 + scoreBud * 0.20).toFixed(2);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Seleksi, Review &amp; Penetapan Pendanaan</h1>
          <p className="text-xs text-muted-foreground">Verifikasi administrasi LPPM, penugasan reviewer, penilaian rubrik, dan keputusan pendanaan.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {system && (
            <select aria-label="Mode workspace" value={mode} onChange={(e) => { setMode(e.target.value as Mode); setSelected(null); setActiveReview(null); }}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs">
              <option value="production">Operasional</option>
              <option value="trial-admin">Trial · Pengelola</option>
              <option value="trial-reader">Trial · Pembaca</option>
            </select>
          )}
          <select aria-label="Pilih institusi" value={tenant} onChange={(e) => { setTenant(Number(e.target.value)); setSelected(null); setActiveReview(null); }}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs">
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
      </div>

      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {(canVerify || canDecide || system || mode !== "production") && (
          <Button size="sm" variant={tab === "workflow" ? "default" : "outline"} onClick={() => setTab("workflow")}>
            Antrean Seleksi &amp; Penetapan ({proposals.length})
          </Button>
        )}
        <Button size="sm" variant={tab === "reviews" ? "default" : "outline"} onClick={() => setTab("reviews")}>
          Penugasan Review Saya ({myReviews.length})
        </Button>
      </div>

      {tab === "workflow" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Card className="workspace-panel rounded-md lg:col-span-5">
            <CardHeader><CardTitle>Usulan Masuk</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!proposals.length && <p className="text-sm text-muted-foreground">Belum ada usulan yang dikirim.</p>}
              {proposals.map((p) => (
                <button key={p.id} type="button" onClick={() => { setSelected(p); setDecisionBudget(p.approvedBudget ?? p.budget); setDecisionNote(p.decisionNote); }}
                  className={`w-full rounded-md border p-3 text-left text-sm transition ${selected?.id === p.id ? "border-brand bg-accent/40" : "border-border hover:bg-muted/40"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold line-clamp-2"><Eye size={15} className="mr-1 inline shrink-0 align-text-bottom" aria-hidden="true" /> #{p.id} · {p.title || "Tanpa judul"}</p>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">{wfLabels[p.workflowStatus] ?? p.workflowStatus}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{p.owner} · {p.scheme}</p>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span>RAB: {money.format(BigInt(p.budget))}</span>
                    {p.averageScore !== undefined && p.averageScore !== null && (
                      <span className="font-semibold text-brand">Skor: {p.averageScore.toFixed(2)}</span>
                    )}
                    <span className={p.fundingDecision === "funded" ? "text-emerald-600 font-semibold" : p.fundingDecision === "not_funded" ? "text-destructive font-semibold" : "text-muted-foreground"}>
                      {decLabels[p.fundingDecision] ?? p.fundingDecision}
                    </span>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="workspace-panel rounded-md lg:col-span-7">
            <CardHeader><CardTitle>{selected ? `Detail Seleksi #${selected.id}` : "Pilih Usulan"}</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              {!selected ? (
                <p className="text-muted-foreground">Pilih salah satu usulan di sebelah kiri untuk verifikasi administrasi, penugasan reviewer, atau penetapan pendanaan.</p>
              ) : (
                <>
                  <div className="rounded-md border border-border p-3 space-y-1">
                    <h3 className="font-semibold text-base">{selected.title}</h3>
                    <p className="text-xs text-muted-foreground">Ketua: {selected.owner} ({selected.ownerEmail}) · {selected.scheme} · {selected.period}</p>
                    <p className="text-xs">Usulan RAB: <strong>{money.format(BigInt(selected.budget))}</strong> (Pagu skema: {money.format(BigInt(selected.maxBudget))})</p>
                    <p className="text-xs">Status Workflow: <strong>{wfLabels[selected.workflowStatus] ?? selected.workflowStatus}</strong> · Keputusan: <strong>{decLabels[selected.fundingDecision] ?? selected.fundingDecision}</strong></p>
                  </div>

                  {/* Transisi Administrasi & Review LPPM */}
                  {canVerify && !readOnly && (
                    <div className="rounded-md border border-border p-3 space-y-2">
                      <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Tindakan Verifikasi &amp; Seleksi LPPM</h4>
                      <Input id="wf-note" label="Catatan Transisi (wajib untuk revisi / penolakan)" value={transNote} onChange={(e) => setTransNote(e.target.value)} />
                      <div className="flex flex-wrap gap-2 pt-1">
                        {selected.workflowStatus === "submitted" && (
                          <Button data-action-tone="positive" size="sm" disabled={pending} onClick={() => void run(async () => {
                            await api(`${base}/institutions/${tenant}/workflow/proposals/${selected.id}/transition`, json("POST", { toStatus: "admin_verified", note: transNote, revision: selected.revision }));
                            setTransNote("");
                            toast.success("Usulan lolos verifikasi administrasi.", workspaceToastOptions);
                          })}><CircleCheck size={15} aria-hidden="true" /> Lolos Administrasi</Button>
                        )}
                        {(selected.workflowStatus === "submitted" || selected.workflowStatus === "admin_verified") && (
                          <>
                            <Button data-action-tone="edit" size="sm" variant="outline" disabled={pending} onClick={() => void run(async () => {
                              await api(`${base}/institutions/${tenant}/workflow/proposals/${selected.id}/transition`, json("POST", { toStatus: "admin_revision", note: transNote, revision: selected.revision }));
                              setTransNote("");
                              toast.success("Dikembalikan untuk revisi administrasi.", workspaceToastOptions);
                            })}><Pencil size={15} aria-hidden="true" /> Minta Revisi Admin</Button>
                            <Button data-action-tone="danger" size="sm" variant="destructive" disabled={pending} onClick={() => void run(async () => {
                              await api(`${base}/institutions/${tenant}/workflow/proposals/${selected.id}/transition`, json("POST", { toStatus: "rejected_admin", note: transNote, revision: selected.revision }));
                              setTransNote("");
                              toast.success("Usulan ditolak secara administratif.", workspaceToastOptions);
                            })}><CircleX size={15} aria-hidden="true" /> Tolak Administrasi</Button>
                          </>
                        )}
                        {selected.workflowStatus === "under_review" && (
                          <>
                            <Button data-action-tone="positive" size="sm" disabled={pending} onClick={() => void run(async () => {
                              await api(`${base}/institutions/${tenant}/workflow/proposals/${selected.id}/transition`, json("POST", { toStatus: "review_completed", note: transNote, revision: selected.revision }));
                              setTransNote("");
                              toast.success("Proses review diselesaikan.", workspaceToastOptions);
                            })}><CircleCheck size={15} aria-hidden="true" /> Selesaikan Review</Button>
                            <Button data-action-tone="edit" size="sm" variant="outline" disabled={pending} onClick={() => void run(async () => {
                              await api(`${base}/institutions/${tenant}/workflow/proposals/${selected.id}/transition`, json("POST", { toStatus: "review_revision", note: transNote, revision: selected.revision }));
                              setTransNote("");
                              toast.success("Dikembalikan untuk revisi substansi.", workspaceToastOptions);
                            })}><Pencil size={15} aria-hidden="true" /> Minta Revisi Substansi</Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Penugasan Reviewer */}
                  <div className="rounded-md border border-border p-3 space-y-2">
                    <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Penugasan &amp; Hasil Reviewer</h4>
                    {!selected.assignments.length && <p className="text-xs text-muted-foreground">Belum ada reviewer ditugaskan.</p>}
                    {selected.assignments.map((a) => (
                      <div key={a.id} className="rounded border border-border p-2 text-xs space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold">{a.reviewerName} ({a.reviewerCode}) {a.blindReview ? "· Blind Review" : ""}</span>
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-muted px-1.5 py-0.5">{a.status}</span>
                            {canVerify && !readOnly && a.status !== "completed" && (
                              <Button data-action-tone="danger" size="sm" variant="ghost" className="h-6 px-2 text-destructive" disabled={pending} onClick={() => void run(async () => {
                                await api(`${base}/institutions/${tenant}/workflow/assignments/${a.id}`, { method: "DELETE" });
                                toast.success("Penugasan reviewer dicabut.", workspaceToastOptions);
                              })}><Trash2 size={15} aria-hidden="true" /> Hapus</Button>
                            )}
                          </div>
                        </div>
                        {a.dueDate && <p className="text-muted-foreground">Batas waktu: {a.dueDate}</p>}
                        {a.conflictNote && <p className="text-destructive">Catatan konflik/penolakan: {a.conflictNote}</p>}
                        {a.review && (
                          <div className="mt-1 rounded bg-muted/40 p-2 space-y-1">
                            <p className="font-semibold">Skor Total: {a.review.totalScore.toFixed(2)} · Rekomendasi: {a.review.recommendation.toUpperCase()}</p>
                            <p>Komentar untuk pengusul: {a.review.publicComment}</p>
                            {a.review.internalComment && <p className="text-muted-foreground">Catatan internal LPPM: {a.review.internalComment}</p>}
                          </div>
                        )}
                      </div>
                    ))}
                    {canVerify && !readOnly && (selected.workflowStatus === "admin_verified" || selected.workflowStatus === "under_review") && (
                      <div className="grid grid-cols-1 gap-2 border-t border-border pt-2 sm:grid-cols-3 items-end">
                        <div>
                          <label htmlFor="assign-rev" className="block text-xs mb-1">Pilih Reviewer</label>
                          <select id="assign-rev" value={assignReviewerId} onChange={(e) => setAssignReviewerId(Number(e.target.value))}
                            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs">
                            <option value={0}>— Pilih Reviewer —</option>
                            {reviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </div>
                        <Input id="assign-due" label="Batas Review" type="date" value={assignDue} onChange={(e) => setAssignDue(e.target.value)} />
                        <div className="flex flex-col gap-1.5">
                          <label className="flex items-center gap-1.5 text-xs">
                            <input type="checkbox" checked={assignBlind} onChange={(e) => setAssignBlind(e.target.checked)} /> Blind Review
                          </label>
                          <Button data-action-tone="positive" size="sm" disabled={pending || assignReviewerId < 1} onClick={() => void run(async () => {
                            await api(`${base}/institutions/${tenant}/workflow/proposals/${selected.id}/reviewers`, json("POST", {
                              reviewerId: assignReviewerId, blindReview: assignBlind, dueDate: assignDue,
                            }));
                            setAssignReviewerId(0); setAssignDue("");
                            toast.success("Reviewer ditugaskan.", workspaceToastOptions);
                          })}><UserPlus size={15} aria-hidden="true" /> Tugaskan Reviewer</Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Penetapan Pendanaan */}
                  {canDecide && !readOnly && (selected.workflowStatus === "review_completed" || selected.workflowStatus === "admin_verified") && (
                    <div className="rounded-md border border-border p-3 space-y-2">
                      <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Penetapan Keputusan Pendanaan</h4>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <Input id="dec-budget" label="Anggaran Disetujui (Rp)" type="number" value={decisionBudget} onChange={(e) => setDecisionBudget(e.target.value)} />
                        <Input id="dec-note" label="Catatan Keputusan" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button data-action-tone="positive" size="sm" disabled={pending} onClick={() => void run(async () => {
                          await api(`${base}/institutions/${tenant}/workflow/proposals/${selected.id}/decision`, json("POST", {
                            decision: "funded", approvedBudget: decisionBudget, note: decisionNote,
                          }));
                          toast.success("Usulan ditetapkan DIDANAI.", workspaceToastOptions);
                        })}><CircleCheck size={15} aria-hidden="true" /> Tetapkan Didanai</Button>
                        <Button data-action-tone="danger" size="sm" variant="destructive" disabled={pending} onClick={() => void run(async () => {
                          await api(`${base}/institutions/${tenant}/workflow/proposals/${selected.id}/decision`, json("POST", {
                            decision: "not_funded", approvedBudget: "0", note: decisionNote,
                          }));
                          toast.success("Usulan ditetapkan TIDAK DIDANAI.", workspaceToastOptions);
                        })}><CircleX size={15} aria-hidden="true" /> Tetapkan Tidak Didanai</Button>
                      </div>
                    </div>
                  )}

                  {/* Riwayat Transisi */}
                  {!!selected.approvals.length && (
                    <div className="rounded-md border border-border p-3 space-y-1.5">
                      <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Riwayat Persetujuan &amp; Status</h4>
                      <ul className="space-y-1 text-xs">
                        {selected.approvals.map((app) => (
                          <li key={app.id} className="border-b border-border pb-1">
                            <span className="font-medium">{app.fromStatus} → {app.toStatus}</span> oleh {app.actorName} ({app.roleName}) · rev {app.revision}
                            {app.note && <p className="text-muted-foreground">{app.note}</p>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "reviews" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Card className="workspace-panel rounded-md lg:col-span-5">
            <CardHeader><CardTitle>Tugas Review Saya</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!myReviews.length && <p className="text-sm text-muted-foreground">Belum ada usulan yang ditugaskan untuk direview.</p>}
              {myReviews.map((item) => (
                <button key={item.assignmentId} type="button" onClick={() => openReviewForm(item)}
                  className={`w-full rounded-md border p-3 text-left text-sm transition ${activeReview?.assignmentId === item.assignmentId ? "border-brand bg-accent/40" : "border-border hover:bg-muted/40"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold"><Eye size={15} className="mr-1 inline shrink-0 align-text-bottom" aria-hidden="true" /> {item.title || "Tanpa judul"}</p>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px]">{item.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.owner} · {item.scheme}</p>
                  {item.dueDate && <p className="text-xs text-muted-foreground">Batas: {item.dueDate}</p>}
                  {item.review && <p className="mt-1 text-xs font-semibold text-brand">Skor tersimpan: {item.review.totalScore.toFixed(2)}</p>}
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="workspace-panel rounded-md lg:col-span-7">
            <CardHeader><CardTitle>{activeReview ? `Penilaian: ${activeReview.title}` : "Pilih Tugas Review"}</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              {!activeReview ? (
                <p className="text-muted-foreground">Pilih salah satu tugas review di sebelah kiri.</p>
              ) : (
                <>
                  <div className="rounded-md border border-border p-3 space-y-1 text-xs">
                    <p><strong>Pengusul:</strong> {activeReview.owner} {activeReview.blindReview ? "(Mode Blind Review Aktif)" : ""}</p>
                    <p><strong>Skema:</strong> {activeReview.scheme} · <strong>RAB:</strong> {money.format(BigInt(activeReview.budget))}</p>
                    <details className="pt-2">
                      <summary className="cursor-pointer font-semibold text-brand"><Eye size={15} className="mr-1 inline shrink-0 align-text-bottom" aria-hidden="true" /> Lihat Ringkasan &amp; Substansi Usulan</summary>
                      <div className="mt-2 space-y-2 border-t border-border pt-2">
                        <div><strong>Ringkasan:</strong> <p className="whitespace-pre-wrap text-muted-foreground">{stripHtml(activeReview.data.summary ?? "") || "-"}</p></div>
                        <div><strong>Pendahuluan:</strong> <p className="whitespace-pre-wrap text-muted-foreground">{stripHtml(activeReview.data.introduction ?? "") || "-"}</p></div>
                        <div><strong>Metode:</strong> <p className="whitespace-pre-wrap text-muted-foreground">{stripHtml(activeReview.data.method ?? "") || "-"}</p></div>
                        <div><strong>Hasil Diharapkan:</strong> <p className="whitespace-pre-wrap text-muted-foreground">{stripHtml(activeReview.data.expected ?? "") || "-"}</p></div>
                      </div>
                    </details>
                  </div>

                  {activeReview.status === "assigned" && !readOnly && (
                    <div className="rounded-md border border-border p-3 space-y-2">
                      <p className="text-xs font-medium">Konfirmasi kesediaan &amp; bebas konflik kepentingan sebelum menilai:</p>
                      <div className="flex flex-wrap gap-2">
                        <Button data-action-tone="positive" size="sm" disabled={pending} onClick={() => void run(async () => {
                          await api(`${base}/institutions/${tenant}/reviews/${activeReview.assignmentId}/conflict`, json("POST", { status: "accepted", note: "" }));
                          toast.success("Penugasan diterima.", workspaceToastOptions);
                        })}><UserCheck size={15} aria-hidden="true" /> Terima Penugasan Review</Button>
                        <Button data-action-tone="danger" size="sm" variant="destructive" disabled={pending} onClick={() => void run(async () => {
                          const reason = window.prompt("Alasan penolakan / konflik kepentingan:") ?? "";
                          if (!reason.trim()) return;
                          await api(`${base}/institutions/${tenant}/reviews/${activeReview.assignmentId}/conflict`, json("POST", { status: "declined", note: reason }));
                          toast.success("Penugasan ditolak.", workspaceToastOptions);
                        })}><CircleX size={15} aria-hidden="true" /> Tolak / Konflik Kepentingan</Button>
                      </div>
                    </div>
                  )}

                  {(activeReview.status === "accepted" || activeReview.status === "completed") && (
                    <div className="space-y-3 rounded-md border border-border p-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Rubrik Penilaian Substansi</h4>
                        <span className="text-sm font-bold text-brand">Estimasi Skor: {totalPreviewScore} / 100</span>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Input id="sc-rel" label="Relevansi & Perumusan Masalah (25%)" type="number" min={0} max={100} disabled={readOnly} value={scoreRel} onChange={(e) => setScoreRel(Number(e.target.value))} />
                        <Input id="sc-met" label="Ketepatan Metode Penelitian (30%)" type="number" min={0} max={100} disabled={readOnly} value={scoreMet} onChange={(e) => setScoreMet(Number(e.target.value))} />
                        <Input id="sc-nov" label="Kebaruan & Potensi Luaran (25%)" type="number" min={0} max={100} disabled={readOnly} value={scoreNov} onChange={(e) => setScoreNov(Number(e.target.value))} />
                        <Input id="sc-bud" label="Kewajaran RAB & Jadwal (20%)" type="number" min={0} max={100} disabled={readOnly} value={scoreBud} onChange={(e) => setScoreBud(Number(e.target.value))} />
                      </div>
                      <div>
                        <label htmlFor="rev-rec" className="block text-xs font-medium mb-1">Rekomendasi</label>
                        <select id="rev-rec" disabled={readOnly} value={rec} onChange={(e) => setRec(e.target.value as "approve" | "revise" | "reject")}
                          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
                          <option value="approve">Direkomendasikan Didanai (Approve)</option>
                          <option value="revise">Perlu Perbaikan / Revisi (Revise)</option>
                          <option value="reject">Tidak Direkomendasikan (Reject)</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="rev-pub" className="block text-xs font-medium mb-1">Komentar untuk Pengusul (terlihat peneliti)</label>
                        <textarea id="rev-pub" rows={3} disabled={readOnly} value={pubComment} onChange={(e) => setPubComment(e.target.value)}
                          className="w-full rounded-md border border-input bg-background p-2 text-sm" />
                      </div>
                      <div>
                        <label htmlFor="rev-intl" className="block text-xs font-medium mb-1">Catatan Rahasia untuk LPPM (opsional)</label>
                        <textarea id="rev-intl" rows={2} disabled={readOnly} value={intlComment} onChange={(e) => setIntlComment(e.target.value)}
                          className="w-full rounded-md border border-input bg-background p-2 text-sm" />
                      </div>
                      {!readOnly && (
                        <Button data-action-tone="positive" size="sm" disabled={pending} onClick={() => void run(async () => {
                          await api(`${base}/institutions/${tenant}/reviews/${activeReview.assignmentId}/submit`, json("POST", {
                            scoreRelevance: scoreRel,
                            scoreMethod: scoreMet,
                            scoreNovelty: scoreNov,
                            scoreBudget: scoreBud,
                            recommendation: rec,
                            publicComment: pubComment,
                            internalComment: intlComment,
                          }));
                          toast.success("Hasil review berhasil dikirim.", workspaceToastOptions);
                        })}><Save size={15} aria-hidden="true" /> Simpan &amp; Kirim Hasil Review</Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}

