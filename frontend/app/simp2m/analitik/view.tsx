"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "../penelitian/view";

type Mode = "production" | "trial-admin" | "trial-reader";
type Choice = { id: number; name: string };
type Institution = { id: number; name: string; active: boolean; canVerify?: boolean; canDecide?: boolean; canAudit?: boolean; canGrantRead?: boolean };
type AnalyticsResponse = {
  kpi: {
    totalProposals: number;
    fundedProposals: number;
    activeProjects: number;
    completedProjects: number;
    totalApprovedBudget: string;
    totalDisbursed: string;
    totalSpent: string;
    verifiedOutputs: number;
    externalFunded: number;
  };
  byScheme: { schemeId: number; schemeName: string; submittedCount: number; fundedCount: number; approvedBudget: string }[];
  byWorkflow: { status: string; count: number }[];
  byYear: { year: number; submittedCount: number; fundedCount: number; approvedBudget: string }[];
  filters: { years: number[]; schemes: Choice[]; fundingSources: Choice[] };
};

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("id-ID");

export function AnalyticsPanel() {
  const [mode, setMode] = useState<Mode>("production");
  const [system, setSystem] = useState(false);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [tenant, setTenant] = useState(0);
  const [year, setYear] = useState("");
  const [schemeId, setSchemeId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState("");

  const base = mode === "production" ? "/api/v1/iam" : `/api/v1/trial/${mode}/iam`;

  useEffect(() => {
    const controller = new AbortController();
    void api<{ items: Institution[]; system: boolean }>(base + "/institutions", { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        const allowed = res.items.filter((i) => i.active && (res.system || i.canVerify || i.canDecide || i.canAudit || i.canGrantRead));
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
    const qs = new URLSearchParams();
    if (year) qs.set("year", year);
    if (schemeId) qs.set("schemeId", schemeId);
    if (sourceId) qs.set("fundingSourceId", sourceId);
    void api<AnalyticsResponse>(`${base}/institutions/${tenant}/analytics?${qs.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) {
          setData(res);
          setError("");
        }
      })
      .catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [base, schemeId, sourceId, tenant, year]);

  const exportQuery = new URLSearchParams();
  if (year) exportQuery.set("year", year);
  if (schemeId) exportQuery.set("schemeId", schemeId);
  if (sourceId) exportQuery.set("fundingSourceId", sourceId);
  const qsString = exportQuery.toString();

  function exportHref(kind: "proposals" | "projects" | "outputs" | "external", format: "xls" | "csv") {
    return `${base}/institutions/${tenant}/analytics/export?kind=${kind}&format=${format}${qsString ? `&${qsString}` : ""}`;
  }

  const maxSchemeCount = Math.max(1, ...(data?.byScheme.map((s) => s.submittedCount) ?? [1]));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dashboard Kinerja, Analitik &amp; Ekspor</h1>
          <p className="text-xs text-muted-foreground">Agregasi kinerja penelitian dan pengabdian (data trial dikecualikan pada mode Operasional).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {system && (
            <select aria-label="Mode workspace" value={mode} onChange={(e) => setMode(e.target.value as Mode)}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs">
              <option value="production">Operasional (Valid)</option>
              <option value="trial-admin">Trial</option>
            </select>
          )}
          <select aria-label="Pilih institusi" value={tenant} onChange={(e) => setTenant(Number(e.target.value))}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs">
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
      </div>

      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {/* Filter Bar */}
      <Card className="workspace-panel rounded-md">
        <CardContent className="grid grid-cols-1 gap-3 pt-4 sm:grid-cols-3 text-xs">
          <div>
            <label htmlFor="an-year" className="block font-medium mb-1">Tahun Anggaran</label>
            <select id="an-year" value={year} onChange={(e) => setYear(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-1.5">
              <option value="">Semua Tahun</option>
              {data?.filters.years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="an-scheme" className="block font-medium mb-1">Skema</label>
            <select id="an-scheme" value={schemeId} onChange={(e) => setSchemeId(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-1.5">
              <option value="">Semua Skema</option>
              {data?.filters.schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="an-source" className="block font-medium mb-1">Sumber Dana</label>
            <select id="an-source" value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-1.5">
              <option value="">Semua Sumber Dana</option>
              {data?.filters.fundingSources.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      {data && (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="workspace-panel rounded-md"><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Usulan Masuk</p><p className="text-2xl font-bold tabular-nums">{num.format(data.kpi.totalProposals)}</p><p className="text-xs text-emerald-600">{num.format(data.kpi.fundedProposals)} didanai</p></CardContent></Card>
            <Card className="workspace-panel rounded-md"><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Proyek Berkontrak</p><p className="text-2xl font-bold tabular-nums">{num.format(data.kpi.activeProjects)} Aktif</p><p className="text-xs text-muted-foreground">{num.format(data.kpi.completedProjects)} selesai (ditutup)</p></CardContent></Card>
            <Card className="workspace-panel rounded-md"><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Anggaran Disetujui</p><p className="text-lg font-bold tabular-nums">{money.format(BigInt(data.kpi.totalApprovedBudget))}</p><p className="text-xs text-muted-foreground">Cair: {money.format(BigInt(data.kpi.totalDisbursed))}</p></CardContent></Card>
            <Card className="workspace-panel rounded-md"><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Luaran &amp; Eksternal</p><p className="text-2xl font-bold tabular-nums">{num.format(data.kpi.verifiedOutputs)} Luaran</p><p className="text-xs text-muted-foreground">Realisasi: {money.format(BigInt(data.kpi.totalSpent))} · {data.kpi.externalFunded} Hibah Eksternal</p></CardContent></Card>
          </div>

          {/* Distribusi Per Skema & Status */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="workspace-panel rounded-md">
              <CardHeader><CardTitle>Distribusi Usulan &amp; Pendanaan per Skema</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-xs">
                {!data.byScheme.length && <p className="text-muted-foreground">Belum ada data pada filter ini.</p>}
                {data.byScheme.map((s) => (
                  <div key={s.schemeId} className="space-y-1">
                    <div className="flex justify-between font-medium">
                      <span>{s.schemeName}</span>
                      <span>{s.submittedCount} usulan ({s.fundedCount} didanai) · {money.format(BigInt(s.approvedBudget))}</span>
                    </div>
                    <div className="h-2 w-full rounded bg-muted overflow-hidden">
                      <div className="h-full bg-brand" style={{ width: `${Math.round((s.submittedCount / maxSchemeCount) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="workspace-panel rounded-md">
              <CardHeader><CardTitle>Ringkasan Status Seleksi &amp; Per Tahun</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-xs">
                <div className="space-y-1.5">
                  <p className="font-semibold text-muted-foreground uppercase">Status Workflow</p>
                  {!data.byWorkflow.length && <p className="text-muted-foreground">Belum ada usulan dikirim.</p>}
                  <div className="flex flex-wrap gap-2">
                    {data.byWorkflow.map((w) => (
                      <span key={w.status} className="rounded border border-border bg-muted/40 px-2 py-1 font-medium">
                        {w.status}: <strong>{w.count}</strong>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5 border-t border-border pt-2">
                  <p className="font-semibold text-muted-foreground uppercase">Tren Tahunan</p>
                  {data.byYear.map((y) => (
                    <div key={y.year} className="flex justify-between border-b border-border pb-1">
                      <span className="font-medium">Tahun {y.year}</span>
                      <span>{y.submittedCount} usulan · {y.fundedCount} didanai · {money.format(BigInt(y.approvedBudget))}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Ekspor Data Excel / CSV */}
          <Card className="workspace-panel rounded-md">
            <CardHeader><CardTitle>Ekspor Laporan Kinerja &amp; SPMI</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
              {([
                ["proposals", "Rekap Usulan Penelitian"],
                ["projects", "Rekap Kontrak & Pencairan"],
                ["outputs", "Rekap Capaian Luaran"],
                ["external", "Rekap Pendanaan Eksternal"],
              ] as const).map(([kind, label]) => (
                <div key={kind} className="rounded-md border border-border p-3 space-y-2">
                  <p className="font-semibold text-sm">{label}</p>
                  <div className="flex gap-2">
                    <a href={exportHref(kind, "xls")} className="inline-flex items-center rounded border border-input bg-background px-2.5 py-1 font-medium hover:bg-accent">Excel (.xls)</a>
                    <a href={exportHref(kind, "csv")} className="inline-flex items-center rounded border border-input bg-background px-2.5 py-1 font-medium hover:bg-accent">CSV</a>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}

