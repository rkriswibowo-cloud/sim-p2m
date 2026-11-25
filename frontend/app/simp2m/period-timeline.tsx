"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatGrantMonth, grantMonthBounds } from "./grant-schedule";

interface TimelinePeriod {
  id: number;
  code: string;
  name: string;
  proposalYear: number;
  opensAt: string;
  closesAt: string;
  reviewStart: string;
  reviewEnd: string;
  executionStart: string;
  progressReportDate: string;
  finalReportDate: string;
  state: "scheduled" | "open" | "closed";
}

type StageStatus = "done" | "active" | "upcoming" | "unscheduled";

interface TimelineStage {
  key: string;
  label: string;
  dateText: string;
  status: StageStatus;
}

const idDate = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Jakarta",
});

function formatRange(start?: string, end?: string): string {
  if (!start && !end) return "Belum dijadwalkan";
  if (start && end) {
    const s = new Date(start.includes("T") ? start : `${start}T00:00:00+07:00`);
    const e = new Date(end.includes("T") ? end : `${end}T23:59:59+07:00`);
    return `${idDate.format(s)} – ${idDate.format(e)}`;
  }
  const single = start || end || "";
  const d = new Date(single.includes("T") ? single : `${single}T00:00:00+07:00`);
  return idDate.format(d);
}

function parseDayStart(dateStr?: string): number | null {
  if (!dateStr) return null;
  return new Date(dateStr.includes("T") ? dateStr : `${dateStr}T00:00:00+07:00`).getTime();
}

function parseDayEnd(dateStr?: string): number | null {
  if (!dateStr) return null;
  return new Date(dateStr.includes("T") ? dateStr : `${dateStr}T23:59:59+07:00`).getTime();
}

function buildStages(period: TimelinePeriod, nowMs: number, community: boolean): TimelineStage[] {
  const propStart = parseDayStart(period.opensAt)!;
  const propEnd = parseDayEnd(period.closesAt)!;
  const reviewMonth = grantMonthBounds(period.reviewStart.slice(0, 7));
  const finalMonth = grantMonthBounds(period.finalReportDate.slice(0, 7));
  const revStart = parseDayStart(community ? reviewMonth.first : period.reviewStart);
  const revEnd = parseDayEnd(community ? reviewMonth.last : (period.reviewEnd || period.reviewStart));
  const execStart = parseDayStart(community ? grantMonthBounds(period.executionStart.slice(0, 7)).first : period.executionStart);
  const progStart = parseDayStart(period.progressReportDate);
  const progEnd = parseDayEnd(period.progressReportDate);
  const finalStart = parseDayStart(community ? finalMonth.first : period.finalReportDate);
  const finalEnd = parseDayEnd(community ? finalMonth.last : period.finalReportDate);

  const evalRange = (start: number | null, end: number | null): StageStatus => {
    if (start === null) return "unscheduled";
    const effectiveEnd = end ?? start;
    if (nowMs > effectiveEnd) return "done";
    if (nowMs >= start && nowMs <= effectiveEnd) return "active";
    return "upcoming";
  };

  const evalExecution = (): StageStatus => {
    if (execStart === null) return "unscheduled";
    const nextStage = community ? finalStart : progStart;
    if (nextStage !== null && nowMs >= nextStage && nowMs >= execStart) return "done";
    if (nowMs >= execStart) return "active";
    return "upcoming";
  };

  const stages: TimelineStage[] = [
    {
      key: "proposal",
      label: "Pengajuan Proposal",
      dateText: formatRange(period.opensAt, period.closesAt),
      status: evalRange(propStart, propEnd),
    },
    {
      key: "review",
      label: "Review",
      dateText: community ? formatGrantMonth(period.reviewStart) : formatRange(period.reviewStart, period.reviewEnd),
      status: evalRange(revStart, revEnd),
    },
    {
      key: "execution",
      label: "Pelaksanaan",
      dateText: community ? formatGrantMonth(period.executionStart) : formatRange(period.executionStart),
      status: evalExecution(),
    },
    {
      key: "progress",
      label: "Laporan Kemajuan 75%",
      dateText: formatRange(period.progressReportDate),
      status: evalRange(progStart, progEnd),
    },
    {
      key: "final",
      label: "Laporan Akhir",
      dateText: community ? formatGrantMonth(period.finalReportDate) : formatRange(period.finalReportDate),
      status: evalRange(finalStart, finalEnd),
    },
  ];
  return community ? stages.filter(stage => stage.key !== "progress") : stages;
}

const statusLabel: Record<StageStatus, string> = {
  done: "Selesai",
  active: "Sedang Berjalan",
  upcoming: "Akan Datang",
  unscheduled: "Belum Dijadwalkan",
};

export function PeriodTimelineWidget({ institutionId, program = "research" }: { institutionId: number; program?: "research" | "community" }) {
  const community = program === "community";
  const title = community ? "Timeline Pengabdian kepada Masyarakat" : "Timeline Penelitian";
  const [periods, setPeriods] = useState<TimelinePeriod[]>([]);
  const [selectedId, setSelectedId] = useState<number>(0);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!institutionId) return;
    let cancelled = false;
    fetch(`/api/v1/iam/institutions/${institutionId}/grants/timeline?program=${program}`, { cache: "no-store" })
      .then(res => (res.ok ? res.json() : { periods: [] }))
      .then((data: { periods?: TimelinePeriod[]; serverNow?: string }) => {
        if (cancelled) return;
        const list = Array.isArray(data.periods) ? data.periods : [];
        setPeriods(list);
        if (list.length > 0) {
          setSelectedId(prev => (list.some(p => p.id === prev) ? prev : list[0].id));
        }
        if (data.serverNow) {
          setNowMs(new Date(data.serverNow).getTime());
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [institutionId, program]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  if (!institutionId || loading || periods.length === 0) return null;

  const activePeriod = periods.find(p => p.id === selectedId) ?? periods[0];
  const stages = buildStages(activePeriod, nowMs, community);
  const completedCount = stages.filter(s => s.status === "done").length;
  const activeCount = stages.filter(s => s.status === "active").length;
  const progressPercent = Math.round(((completedCount + activeCount * 0.5) / stages.length) * 100);
  const currentStage = stages.find(s => s.status === "active") ?? stages.find(s => s.status === "upcoming");

  return (
    <Card className="workspace-panel rounded-md">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CalendarDays size={18} className="text-brand" aria-hidden="true" />
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {periods.length > 1 && (
              <select
                aria-label={`Pilih periode ${title}`}
                value={activePeriod.id}
                onChange={e => setSelectedId(Number(e.target.value))}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                {periods.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-[color:var(--brand)]">
              {currentStage ? `Tahap saat ini: ${currentStage.label}` : completedCount === stages.length ? "Seluruh tahapan selesai" : "Jadwal belum lengkap"} · {progressPercent}%
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {activePeriod.name} ({activePeriod.code})
        </p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-600 transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className={`grid gap-2 sm:grid-cols-2 ${community ? "lg:grid-cols-4" : "lg:grid-cols-5"}`}>
          {stages.map((stage, idx) => {
            const isDone = stage.status === "done";
            const isActive = stage.status === "active";
            return (
              <div
                key={stage.key}
                className={`flex flex-col justify-between rounded-md border p-3 transition ${
                  isActive
                    ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/40"
                    : isDone
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-border bg-card"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-muted-foreground">
                    <span>Tahap {idx + 1}</span>
                    {isDone ? (
                      <span className="inline-flex items-center gap-1 text-[color:var(--brand)]">
                        <CheckCircle2 size={13} aria-hidden="true" /> {statusLabel[stage.status]}
                      </span>
                    ) : isActive ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-[color:var(--brand)]">
                        <Clock size={13} aria-hidden="true" /> {statusLabel[stage.status]}
                      </span>
                    ) : (
                      <span>{statusLabel[stage.status]}</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm font-semibold leading-snug text-foreground">{stage.label}</p>
                </div>
                <p className="workspace-timeline-date mt-2 rounded bg-amber-500/15 px-2 py-1 text-center text-[11px] font-medium">
                  {stage.dateText}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

