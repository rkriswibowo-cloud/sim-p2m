"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmRemoval, workspaceToastOptions } from "../confirm-removal";
import { ProposalFields, steps } from "./proposal-fields";
import type { Choice, MemberConsent, ProposalData } from "./proposal-fields";
import { PrintPreviewModal } from "./print-views";

type Mode = "production" | "trial-admin" | "trial-reader";
type Institution = Choice & { active:boolean; canResearch:boolean };
type Grant = { id:number; periodId:number; schemeId:number; scheme:string; source:string; version:number; budget:string; duration:number; activeLecturer:boolean; manual:string };
type Options = { periods:Choice[]; versions:Grant[]; fields:Choice[]; lecturers:Choice[]; students:Choice[]; budgetCategories:Choice[]; canVerify:boolean };
type ApprovalEntry = { id:number; fromStatus:string; toStatus:string; actorName:string; roleName:string; note:string; revision:number; createdAt:string };
type PublicReview = { id:number; totalScore:number; recommendation:string; publicComment:string; submittedAt:string };
type Proposal = {
  id:number; grantVersionId:number; fieldId:number|null; title:string; status:"draft"|"submitted";
  revision:number; budget:string; scheme:string; period:string; owner:string; updatedAt:string; data:ProposalData;
  roadmapImage:boolean; methodImage:boolean; studentLetterFile?:boolean;
  periodId:number; schemeId:number; grantVersion:number; requiresVerification:boolean;
  verification:"none"|"requested"|"verified";
  workflowStatus?:string; fundingDecision?:string; approvedBudget?:string; decisionNote?:string;
  consents?:MemberConsent[]; approvals?:ApprovalEntry[]; publicReviews?:PublicReview[];
};
type InvitationItem={
  proposalId:number; title:string; scheme:string; period:string; owner:string; proposalStatus:string;
  expertise:string; hours:number; task:string; status:"pending"|"approved"|"rejected"; note:string;
};
type VerificationRequest={id:number;revision:number;title:string;owner:string;email:string;scheme:string;requirement:string;activeLecturer:boolean;own:boolean};
type DraftInput = { title:string; fieldId:number|null; data:ProposalData };
const emptyOptions: Options={periods:[],versions:[],fields:[],lecturers:[],students:[],budgetCategories:[],canVerify:false};
const money=new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0});

export async function api<T>(path:string, init?:RequestInit):Promise<T>{
  const response=await fetch(path,init);
  if(response.status===401){window.location.replace("/login?renew=1");throw new Error("Sesi berakhir.");}
  if(response.status===403)throw new Error("Akun belum memiliki izin untuk tindakan ini.");
  if(response.status===404)throw new Error("Usulan atau skema tidak ditemukan.");
  if(!response.ok){
    const result=await response.json().catch(()=>null) as {message?:string}|null;
    throw new Error(result?.message ?? "Periksa isian atau coba kembali setelah layanan tersedia.");
  }
  return response.json() as Promise<T>;
}

export function json(method:string,payload:unknown):RequestInit{
  return {method,headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)};
}

export function ResearchPanel(){
  const [mode,setMode]=useState<Mode>("production");
  const [system,setSystem]=useState(false);
  const [institutions,setInstitutions]=useState<Institution[]>([]);
  const [tenant,setTenant]=useState(0);
  const [items,setItems]=useState<Proposal[]>();
  const [options,setOptions]=useState<Options>(emptyOptions);
  const [grant,setGrant]=useState(0);
  const [proposal,setProposal]=useState<Proposal>();
  const [draft,setDraft]=useState<DraftInput>({title:"",fieldId:null,data:{}});
  const [step,setStep]=useState(0);
  const [revision,setRevision]=useState(0);
  const [changed,setChanged]=useState(0);
  const [saved,setSaved]=useState(0);
  const [pending,setPending]=useState(false);
  const [autoFailed,setAutoFailed]=useState(false);
  const [confirmed,setConfirmed]=useState(false);
  const [error,setError]=useState("");
  const [requests,setRequests]=useState<VerificationRequest[]>([]);
  const [invitations,setInvitations]=useState<InvitationItem[]>([]);
  const [printMode,setPrintMode]=useState<"proposal"|"student-letter"|null>(null);
  const busy=useRef(false);
  const dirty=changed!==saved;
  const base=mode==="production"?"/api/v1/iam":`/api/v1/trial/${mode}/iam`;
  const endpoint=`${base}/institutions/${tenant}/research`;
  const selectedGrant=options.versions.find(item=>item.id===grant);
  const currentGrant=options.versions.find(item=>item.periodId===proposal?.periodId&&item.schemeId===proposal?.schemeId);
  const isRevision=proposal?.status==="submitted"&&(proposal.workflowStatus==="admin_revision"||proposal.workflowStatus==="review_revision");
  const writable=mode!=="trial-reader"&&(proposal?.status==="draft"||isRevision);
  const scopeLocked=pending||dirty;

  useEffect(()=>{
    const controller=new AbortController();
    void api<{items:Institution[];system:boolean}>(base+"/institutions",{signal:controller.signal}).then(data=>{
      if(controller.signal.aborted)return;
      const allowed=data.items.filter(item=>item.active&&item.canResearch);
      setInstitutions(allowed);
      setTenant(allowed[0]?.id ?? 0);
      if(mode==="production")setSystem(data.system);
    }).catch((err:Error)=>{if(!controller.signal.aborted)setError(err.message);});
    return ()=>controller.abort();
  },[base,mode]);

  useEffect(()=>{
    if(!tenant)return;
    const controller=new AbortController();
    void Promise.all([
      api<Proposal[]>(endpoint,{signal:controller.signal}),
      api<Options>(endpoint+"/options",{signal:controller.signal}),
      api<InvitationItem[]>(endpoint+"/invitations",{signal:controller.signal}).catch(()=>[] as InvitationItem[])
    ])
      .then(async ([list,choices,invites])=>{
        if(controller.signal.aborted)return;
        setItems(list);
        setOptions(choices);
        setInvitations(invites);
        setGrant(previous=>choices.versions.some(item=>item.id===previous)?previous:0);
        if(choices.canVerify){
          const queue=await api<VerificationRequest[]>(endpoint+"/verification",{signal:controller.signal});
          if(!controller.signal.aborted)setRequests(queue);
        }
      }).catch((err:Error)=>{if(!controller.signal.aborted)setError(err.message);});
    return ()=>controller.abort();
  },[endpoint,tenant,revision]);

  useEffect(()=>{
    if(!dirty)return;
    const warn=(event:BeforeUnloadEvent)=>event.preventDefault();
    window.addEventListener("beforeunload",warn);
    return ()=>window.removeEventListener("beforeunload",warn);
  },[dirty]);

  function edit(values:Partial<DraftInput>){
    setDraft(previous=>({...previous,...values}));
    setChanged(previous=>previous+1);
    setAutoFailed(false);
  }

  function show(item:Proposal){
    setProposal(item);
    setDraft({title:item.title,fieldId:item.fieldId,data:item.data ?? {}});
    setStep(0);
    setChanged(0);
    setSaved(0);
    setAutoFailed(false);
    setConfirmed(false);
  }

  function clear(){
    setItems(undefined);setOptions(emptyOptions);setProposal(undefined);setGrant(0);setError("");
    setRequests([]);
    setChanged(0);setSaved(0);setAutoFailed(false);
  }

  const save=useCallback(async(manual:boolean)=>{
    if(!proposal||!writable||busy.current||!dirty)return;
    busy.current=true;setPending(true);setError("");
    try{
      const requestBody={...draft,revision:proposal.revision};
      await api(`${endpoint}/${proposal.id}`,json("PUT",requestBody));
      const refreshed=await api<Proposal>(`${endpoint}/${proposal.id}`);
      if(refreshed.revision!==proposal.revision+1 || (!isRevision && refreshed.status!=="draft")){
        throw new Error("Versi draf berubah di sesi lain. Muat ulang draf sebelum melanjutkan.");
      }
      setProposal(refreshed);
      setSaved(changed);
      setRevision(previous=>previous+1);
      setAutoFailed(false);
      if(manual)toast.success("Draf disimpan.",workspaceToastOptions);
    }catch(err){
      const message=err instanceof Error?err.message:"Draf gagal disimpan.";
      setError(message);setAutoFailed(true);
      if(manual)toast.error(message,workspaceToastOptions);
    }finally{busy.current=false;setPending(false);}
  },[changed,dirty,draft,endpoint,isRevision,proposal,writable]);

  useEffect(()=>{
    if(!dirty||!writable||pending||autoFailed)return;
    const timer=setTimeout(()=>void save(false),850);
    return ()=>clearTimeout(timer);
  },[autoFailed,dirty,pending,save,writable]);

  async function run(work:()=>Promise<void>){
    if(busy.current)return;
    busy.current=true;setPending(true);setError("");
    try{await work();}
    catch(err){
      const message=err instanceof Error?err.message:"Tindakan gagal.";
      setError(message);toast.error(message,workspaceToastOptions);
    }finally{busy.current=false;setPending(false);}
  }

  function chooseMode(value:Mode){
    if(scopeLocked||value===mode)return;
    void run(async()=>{
      if(value!=="production")await api(`/api/v1/trial/${value}/iam/enter`,{method:"POST"});
      clear();setTenant(0);setInstitutions([]);setMode(value);
    });
  }

  function upload(kind:"roadmap"|"method"|"student_letter",file:File|undefined){
    if(!file||!proposal||dirty)return;
    void run(async()=>{
      const body=new FormData();
      body.set("image",file);body.set("revision",String(proposal.revision));
      await api(`${endpoint}/${proposal.id}/images/${kind}`,{method:"PUT",body});
      const refreshed=await api<Proposal>(`${endpoint}/${proposal.id}`);
      setProposal(refreshed);
      toast.success(kind==="student_letter"?"Surat keterlibatan mahasiswa tersimpan.":"Gambar tersimpan.",workspaceToastOptions);
    });
  }

  return (
    <section className="space-y-4" data-research-editing={scopeLocked ? "" : undefined}>
      <header className="workspace-heading">
        <h2 className="text-lg font-semibold tracking-tight">Usulan penelitian</h2>
        {mode!=="production"&&<p className="mt-1 text-sm text-brand">Mode trial · database terpisah</p>}
      </header>
      <div className="workspace-toolbar grid gap-2 sm:grid-cols-2">
        {system&&<div className="min-w-0"><label htmlFor="research-mode" className="mb-1 block">Lingkungan dan peran</label>
          <select id="research-mode" value={mode} disabled={scopeLocked} className="w-full" onChange={event=>chooseMode(event.target.value as Mode)}>
            <option value="production">Operasional</option><option value="trial-admin">Trial · Pengelola</option><option value="trial-reader">Trial · Pembaca</option>
          </select>
        </div>}
        <div className="min-w-0"><label htmlFor="research-tenant" className="mb-1 block">Institusi</label>
          <select id="research-tenant" className="w-full" value={tenant} disabled={scopeLocked} onChange={event=>{clear();setTenant(Number(event.target.value));}}>
            {!institutions.length&&<option value={0}>Belum ada institusi yang dapat diakses</option>}
            {institutions.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
      </div>
      {error&&<p role="alert" className="rounded-md border border-destructive/30 p-2 text-sm text-destructive">{error}</p>}

      {!proposal&&tenant>0&&mode!=="trial-reader"&&<Card className="workspace-panel rounded-md">
        <CardHeader><CardTitle>Buat usulan dari hibah terbuka</CardTitle></CardHeader>
        <CardContent className="workspace-fields space-y-2">
          <label htmlFor="research-grant" className="block">Periode dan skema</label>
          <select id="research-grant" className="w-full" value={grant} disabled={pending} onChange={event=>setGrant(Number(event.target.value))}>
            <option value={0}>{options.versions.length?"Pilih skema":"Belum ada skema terbuka"}</option>
            {options.versions.map(item=><option key={item.id} value={item.id}>{options.periods.find(period=>period.id===item.periodId)?.name} · {item.scheme} · versi {item.version}</option>)}
          </select>
          {selectedGrant&&<div className="space-y-1 text-xs text-muted-foreground">
            <p>{selectedGrant.source} · Pagu {money.format(BigInt(selectedGrant.budget))} · {selectedGrant.duration} bulan</p>
            {selectedGrant.activeLecturer&&<p>Pengusul wajib dosen aktif.</p>}
            {selectedGrant.manual&&<p className="break-words">Syarat verifikasi LPPM · {selectedGrant.manual}</p>}
          </div>}
          <Button size="sm" disabled={!grant||pending} onClick={()=>void run(async()=>{
            const response=await api<{id:number}>(endpoint,json("POST",{grantVersionId:grant}));
            show(await api<Proposal>(`${endpoint}/${response.id}`));
            setRevision(previous=>previous+1);
          })}>Buat draf</Button>
        </CardContent>
      </Card>}

      {proposal&&<Card className="workspace-panel min-w-0 rounded-md">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{draft.title||"Draf usulan"} · {proposal.scheme}</CardTitle>
            <Button size="sm" variant="outline" disabled={scopeLocked} onClick={()=>{setProposal(undefined);setError("");}}>Kembali ke daftar</Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{proposal.period} · Skema versi {proposal.grantVersion} · Ketua {proposal.owner} · {proposal.status==="submitted"?`Nomor usulan ${proposal.id}`:"Draf"}</p>
        </CardHeader>
        <CardContent className="workspace-fields space-y-3">
          {writable&&currentGrant&&currentGrant.id!==proposal.grantVersionId&&<div className="rounded-md border border-border p-2 text-sm">
            <p>Versi skema {currentGrant.version} tersedia. Tinjau aturan terbaru sebelum mengirim draf.</p>
            <Button size="sm" variant="outline" className="mt-2" disabled={scopeLocked} onClick={()=>void run(async()=>{
              await api(`${endpoint}/${proposal.id}/grant`,json("POST",{revision:proposal.revision}));
              setProposal(await api<Proposal>(`${endpoint}/${proposal.id}`));
              toast.success("Draf memakai versi skema terbaru.",workspaceToastOptions);
            })}>Gunakan versi skema terbaru</Button>
          </div>}
          <nav aria-label="Bagian usulan" className="flex flex-wrap gap-1.5">
            {steps.map((label,index)=><Button key={label} size="sm" type="button" variant={step===index?"default":"outline"}
              aria-current={step===index?"step":undefined} onClick={()=>setStep(index)}>{label}</Button>)}
          </nav>
          <ProposalFields step={step} data={draft.data} options={options} title={draft.title} field={draft.fieldId} budget={proposal.budget}
            consents={proposal.consents} disabled={!writable} onTitle={title=>edit({title})} onField={fieldId=>edit({fieldId})} onData={data=>edit({data})} />
          {step===1&&(draft.data.students?.length ?? 0)>0&&<div className="space-y-2 rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">Surat Keterlibatan Mahasiswa (Wajib)</p>
                <p className="text-xs text-muted-foreground">Penelitian yang melibatkan mahasiswa wajib menyertakan surat pernyataan bertanda tangan (PDF/JPG/PNG, maks. 5 MB).</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={`${endpoint}/${proposal.id}/export/student-letter-docx`} className="inline-flex items-center rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent">
                  Unduh Template (.docx)
                </a>
                <Button size="sm" type="button" variant="outline" onClick={()=>setPrintMode("student-letter")}>
                  Pratinjau / Cetak Surat
                </Button>
              </div>
            </div>
            {proposal.studentLetterFile && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                Berkas terunggah · <a target="_blank" rel="noopener" className="underline" href={`${endpoint}/${proposal.id}/images/student_letter`}>Lihat Surat Keterlibatan Mahasiswa</a>
              </p>
            )}
            {writable&&<label className="block text-xs">Unggah Surat Keterlibatan Mahasiswa
              <input className="mt-1 block max-w-full" type="file" accept="application/pdf,image/png,image/jpeg" disabled={scopeLocked} onChange={event=>{upload("student_letter",event.target.files?.[0]);event.target.value="";}} />
            </label>}
            {dirty&&<p className="text-xs text-muted-foreground">Tunggu draf tersimpan sebelum mengunggah surat.</p>}
          </div>}
          {(step===2||step===3)&&(()=>{
            const kind=step===2?"roadmap":"method";
            const hasImage=step===2?proposal.roadmapImage:proposal.methodImage;
            const label=step===2?"Gambar roadmap":"Diagram metode";
            return <div className="space-y-2 rounded-md border border-border p-2">
              {hasImage&&<a target="_blank" rel="noopener" className="text-sm text-brand underline" href={`${endpoint}/${proposal.id}/images/${kind}`}>Lihat {label.toLowerCase()}</a>}
              {writable&&<label className="block">{label} (JPG/PNG, maks. 2 MB)
                <input className="mt-1 block max-w-full" type="file" accept="image/png,image/jpeg" disabled={scopeLocked} onChange={event=>{upload(kind,event.target.files?.[0]);event.target.value="";}} />
              </label>}
              {dirty&&<p className="text-xs text-muted-foreground">Tunggu draf tersimpan sebelum mengunggah gambar.</p>}
            </div>;
          })()}
          {step===6&&<div className="space-y-2 rounded-md border border-border p-3 text-sm">
            <dl className="grid gap-1 sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Judul</dt><dd>{draft.title||"Belum diisi"}</dd></div>
              <div><dt className="text-muted-foreground">Total RAB tersimpan</dt><dd>{money.format(BigInt(proposal.budget))}</dd></div>
              <div><dt className="text-muted-foreground">Tim dan luaran</dt><dd>{draft.data.team?.length ?? 0} dosen · {draft.data.students?.length ?? 0} mahasiswa · {draft.data.outputs?.length ?? 0} luaran</dd></div>
              <div><dt className="text-muted-foreground">Jadwal</dt><dd>{draft.data.starts||"—"} sampai {draft.data.ends||"—"}</dd></div>
            </dl>
            <details className="rounded border border-border p-2">
              <summary className="cursor-pointer font-medium">Tampilkan isi usulan</summary>
              <div className="mt-2 space-y-3">
                {steps.slice(0,-1).map((label,index)=><section key={label} className="space-y-2 border-t border-border pt-2">
                  <h3 className="font-semibold">{label}</h3>
                  <ProposalFields step={index} data={draft.data} options={options} title={draft.title} field={draft.fieldId} budget={proposal.budget}
                    consents={proposal.consents} disabled onTitle={()=>{}} onField={()=>{}} onData={()=>{}} />
                </section>)}
              </div>
            </details>
            {!!proposal.consents?.length&&<div className="rounded border border-border p-2 space-y-1">
              <p className="font-medium text-xs">Persetujuan anggota tim dosen:</p>
              <ul className="space-y-1 text-xs">
                {proposal.consents.map(c=><li key={c.lecturerId} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{c.name} ({c.code})</span>
                  <span className={c.status==="approved"?"text-emerald-600 dark:text-emerald-400 font-medium":c.status==="rejected"?"text-destructive font-medium":"text-amber-600 dark:text-amber-400 font-medium"}>
                    {c.status==="approved"?"Disetujui":c.status==="rejected"?`Ditolak${c.note?` (${c.note})`:""}`:"Menunggu persetujuan"}
                  </span>
                </li>)}
              </ul>
            </div>}
            <div className="flex flex-wrap gap-2 border-t border-border pt-2">
              <a href={`${endpoint}/${proposal.id}/export/proposal-docx`} className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent">
                Unduh Proposal (.docx)
              </a>
              <Button size="sm" type="button" variant="outline" onClick={()=>setPrintMode("proposal")}>
                Pratinjau / PDF Proposal
              </Button>
              <a href={`${endpoint}/${proposal.id}/export/student-letter-docx`} className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent">
                Unduh Surat Mahasiswa (.docx)
              </a>
              <Button size="sm" type="button" variant="outline" onClick={()=>setPrintMode("student-letter")}>
                Pratinjau / PDF Surat Mahasiswa
              </Button>
            </div>
            {proposal.status==="submitted"&&<div className="rounded border border-border p-2 space-y-1 text-xs">
              <p><strong>Status Seleksi:</strong> {proposal.workflowStatus ?? "submitted"} · <strong>Keputusan Pendanaan:</strong> {proposal.fundingDecision==="funded"?"Didanai":proposal.fundingDecision==="not_funded"?"Tidak Didanai":"Menunggu Keputusan"}</p>
              {proposal.approvedBudget&&<p><strong>Anggaran Disetujui:</strong> {money.format(BigInt(proposal.approvedBudget))}</p>}
              {proposal.decisionNote&&<p><strong>Catatan Keputusan:</strong> {proposal.decisionNote}</p>}
              {!!proposal.publicReviews?.length&&<div className="mt-1 border-t border-border pt-1 space-y-1">
                <p className="font-semibold">Umpan Balik Reviewer:</p>
                {proposal.publicReviews.map((r,idx)=><div key={r.id} className="rounded bg-muted/40 p-1.5">
                  <span className="font-medium">Reviewer {idx+1} · Skor {r.totalScore.toFixed(2)} ({r.recommendation})</span>
                  <p>{r.publicComment}</p>
                </div>)}
              </div>}
              {!!proposal.approvals?.length&&<details className="pt-1">
                <summary className="cursor-pointer font-medium">Riwayat status ({proposal.approvals.length})</summary>
                <ul className="mt-1 space-y-0.5">
                  {proposal.approvals.map(a=><li key={a.id}>{a.fromStatus} → {a.toStatus} ({a.actorName}){a.note?` — ${a.note}`:""}</li>)}
                </ul>
              </details>}
            </div>}
            {writable&&<>
              {proposal.requiresVerification&&proposal.status==="draft"&&<div className="rounded border border-border p-2">
                <p>{proposal.verification==="verified"?"Syarat manual telah diverifikasi.":proposal.verification==="requested"?"Menunggu verifikasi syarat dari LPPM.":"Jika syarat tidak dapat diperiksa otomatis, ajukan verifikasi LPPM."}</p>
                {proposal.verification==="none"&&<Button size="sm" variant="outline" className="mt-2" disabled={scopeLocked} onClick={()=>void run(async()=>{
                  await api(`${endpoint}/${proposal.id}/verification`,json("POST",{revision:proposal.revision}));
                  setProposal(await api<Proposal>(`${endpoint}/${proposal.id}`));
                  setRevision(previous=>previous+1);
                  toast.success("Permintaan verifikasi dikirim.",workspaceToastOptions);
                })}>Ajukan verifikasi syarat</Button>}
              </div>}
              <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={pending} onChange={event=>setConfirmed(event.target.checked)} /> Saya sudah memeriksa isi usulan dan menyatakan data yang diajukan benar.</label>
              {isRevision ? (
                <Button size="sm" disabled={scopeLocked||!confirmed} onClick={()=>void run(async()=>{
                  await api(`${endpoint}/${proposal.id}/resubmit`,json("POST",{revision:proposal.revision,confirmed:true}));
                  const refreshed=await api<Proposal>(`${endpoint}/${proposal.id}`);
                  setProposal(refreshed);setRevision(previous=>previous+1);
                  toast.success("Revisi usulan berhasil dikirim ulang.",workspaceToastOptions);
                })}>Kirim ulang revisi</Button>
              ) : (
                <Button size="sm" disabled={scopeLocked||!confirmed} onClick={()=>void run(async()=>{
                  await api(`${endpoint}/${proposal.id}/submit`,json("POST",{revision:proposal.revision,confirmed:true}));
                  const refreshed=await api<Proposal>(`${endpoint}/${proposal.id}`);
                  setProposal(refreshed);setRevision(previous=>previous+1);
                  toast.success("Usulan berhasil dikirim.",workspaceToastOptions);
                })}>Kirim usulan</Button>
              )}
            </>}
          </div>}
          {writable&&<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
            <p role="status" className="text-xs text-muted-foreground">{pending?"Memproses…":dirty?"Perubahan belum tersimpan":"Draf tersimpan otomatis"}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!dirty||pending} onClick={()=>void save(true)}>Simpan draf</Button>
              {autoFailed&&<Button size="sm" variant="outline" disabled={pending} onClick={()=>void run(async()=>{
                if(!await confirmRemoval("Buang perubahan lokal?","Draf akan dimuat ulang dari database."))return;
                show(await api<Proposal>(`${endpoint}/${proposal.id}`));
              })}>Muat ulang draf</Button>}
              <Button size="sm" variant="ghost" className="text-destructive" disabled={scopeLocked} onClick={()=>void run(async()=>{
                if(!await confirmRemoval("Hapus draf?","Draf akan dikeluarkan dari daftar usulan."))return;
                await api(`${endpoint}/${proposal.id}`,json("DELETE",{revision:proposal.revision}));
                setProposal(undefined);setRevision(previous=>previous+1);
                toast.success("Draf dihapus.",workspaceToastOptions);
              })}>Hapus draf</Button>
            </div>
          </div>}
        </CardContent>
      </Card>}
      {options.canVerify&&<Card className="workspace-panel rounded-md">
        <CardHeader><CardTitle>Verifikasi syarat LPPM</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!requests.length&&<p className="text-sm text-muted-foreground">Belum ada permintaan verifikasi.</p>}
          {requests.map(item=><article key={item.id} className="space-y-1 border-b border-border pb-2 text-sm">
            <h3 className="font-semibold">{item.title||"Draf tanpa judul"}</h3>
            <p className="break-words text-xs text-muted-foreground">{item.owner} · {item.email} · {item.scheme}</p>
            {item.activeLecturer&&<p>Periksa status dosen aktif.</p>}
            {item.requirement&&<p className="whitespace-pre-wrap break-words">{item.requirement}</p>}
            {item.own&&mode==="production"?<p className="text-xs text-muted-foreground">Verifikasi dilakukan oleh pengelola lain.</p>
              : <Button size="sm" variant="outline" disabled={pending||dirty} onClick={()=>void run(async()=>{
                await api(`${endpoint}/verification/${item.id}`,json("POST",{revision:item.revision}));
                if(proposal?.id===item.id)setProposal(await api<Proposal>(`${endpoint}/${item.id}`));
                setRevision(previous=>previous+1);
                toast.success("Syarat usulan diverifikasi.",workspaceToastOptions);
              })}>Konfirmasi syarat sudah diperiksa</Button>}
          </article>)}
        </CardContent>
      </Card>}

      {!!invitations.length&&<Card className="workspace-panel rounded-md">
        <CardHeader><CardTitle>Undangan anggota tim penelitian</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {invitations.map(inv=><article key={inv.proposalId} className="space-y-2 border-b border-border pb-2 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold">{inv.title||"Draf tanpa judul"}</h3>
                <p className="text-xs text-muted-foreground">{inv.scheme} · {inv.period} · Ketua {inv.owner}</p>
                <p className="text-xs text-muted-foreground">Keahlian: {inv.expertise||"-"} · {inv.hours||0} jam/minggu · Tugas: {inv.task||"-"}</p>
              </div>
              <span className={`text-xs font-medium ${inv.status==="approved"?"text-emerald-600 dark:text-emerald-400":inv.status==="rejected"?"text-destructive":"text-amber-600 dark:text-amber-400"}`}>
                {inv.status==="approved"?"Disetujui":inv.status==="rejected"?"Ditolak":"Menunggu persetujuan"}
              </span>
            </div>
            {mode!=="trial-reader"&&inv.proposalStatus==="draft"&&<div className="flex flex-wrap gap-2">
              {inv.status!=="approved"&&<Button size="sm" variant="outline" disabled={pending} onClick={()=>void run(async()=>{
                await api(`${endpoint}/${inv.proposalId}/consent`,json("POST",{status:"approved",note:""}));
                setRevision(previous=>previous+1);
                toast.success("Keanggotaan tim disetujui.",workspaceToastOptions);
              })}>Setuju menjadi anggota</Button>}
              {inv.status!=="rejected"&&<Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={()=>void run(async()=>{
                const note=window.prompt("Alasan penolakan (opsional):") ?? "";
                await api(`${endpoint}/${inv.proposalId}/consent`,json("POST",{status:"rejected",note}));
                setRevision(previous=>previous+1);
                toast.success("Undangan keanggotaan ditolak.",workspaceToastOptions);
              })}>Tolak</Button>}
            </div>}
          </article>)}
        </CardContent>
      </Card>}

      <Card className="workspace-panel rounded-md">
        <CardHeader><CardTitle>Usulan saya</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {items?.length===0&&<p className="text-sm text-muted-foreground">Belum ada usulan penelitian.</p>}
          {items?.map(item=><div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
            <div className="min-w-0"><p className="break-words text-sm font-medium">{item.title||"Draf tanpa judul"}</p>
              <p className="text-xs text-muted-foreground">{item.scheme} · {item.period} · {item.status==="submitted"?`Dikirim #${item.id}`:"Draf"}</p>
            </div>
            <Button size="sm" variant="outline" disabled={scopeLocked} onClick={()=>void run(async()=>show(await api<Proposal>(`${endpoint}/${item.id}`)))}>Buka</Button>
          </div>)}
        </CardContent>
      </Card>
      {printMode&&proposal&&<PrintPreviewModal
        mode={printMode}
        proposal={{...proposal,title:draft.title,fieldId:draft.fieldId,data:draft.data}}
        institutionName={institutions.find(i=>i.id===tenant)?.name ?? "Universitas Anwar Medika"}
        options={options}
        onClose={()=>setPrintMode(null)}
      />}
    </section>
  );
}
