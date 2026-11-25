import { ArrowRight, BookOpenCheck, Building2, ClipboardList, FlaskConical, FolderKanban, GraduationCap, Layers3, UsersRound } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { getWorkspaceSession } from "./session";
import { PeriodTimelineWidget } from "./period-timeline";

export const metadata: Metadata = {
  title: { absolute: "Dashboard | SIM-P2M" },
  robots: { index: false, follow: false },
};

const metrics = [
  { title: "Fakultas aktif", kind: "faculties", tone: "blue", icon: Building2 },
  { title: "Program studi aktif", kind: "study-programs", tone: "violet", icon: GraduationCap },
  { title: "Skema aktif", kind: "schemes", tone: "amber", icon: Layers3 },
  { title: "Bidang riset aktif", kind: "research-fields", tone: "mint", icon: FlaskConical },
];

export default async function Dashboard() {
  const { user, institutions, request } = await getWorkspaceSession();
  if (!user) return null;
  const activeInstitution = institutions.find(item => item.id === user.institutionId && item.canMasterRead)
    ?? institutions.find(item => item.canMasterRead);
  const canManageAccess = user.role === "superadmin" || institutions.some(item => item.canRead);
  const canSeeAudit = user.role === "superadmin" || institutions.some(item => item.canAudit);
  const metricsSignal = AbortSignal.timeout(4000);

  async function countActive(kind: string) {
    if (!activeInstitution) return;
    let next = 0;
    let total = 0;
    do {
      const page = await request<{ items: { id: number }[]; next: number }>(
        `/api/v1/iam/institutions/${activeInstitution.id}/master-data/${kind}?status=active&after=${next}`,
        metricsSignal,
      );
      if (!page || (page.next && page.next <= next)) return;
      total += page.items.length;
      next = page.next;
    } while (next);
    return total;
  }

  const totals = activeInstitution ? await Promise.all(metrics.map(metric => countActive(metric.kind))) : [];
  const shortcuts = [
    ...(user.canMaster ? [{ title: "Siapkan master data", description: "Organisasi, SDM, skema, dan bidang riset.", href: "/simp2m/master-data", icon: FolderKanban }] : []),
    ...(user.canSelection || canSeeAudit ? [{ title: "Analitik kinerja & ekspor", description: "KPI penelitian, capaian luaran, dan ekspor Excel/CSV.", href: "/simp2m/analitik", icon: ClipboardList }] : []),
    ...(canManageAccess ? [{ title: "Kelola pengguna dan role", description: "Akun, keanggotaan institusi, dan izin akses.", href: "/simp2m/akses", icon: UsersRound }] : []),
    ...(canSeeAudit ? [{ title: "Tinjau riwayat perubahan", description: "Audit tindakan untuk institusi yang dipilih.", href: "/simp2m/akses?section=audit", icon: ClipboardList }] : []),
  ];

  return (
    <div className="space-y-4">
      <section className="workspace-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <GraduationCap size={19} aria-hidden="true" />{user.institution}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Dashboard SIM-P2M</h1>
          </div>
          {user.canMaster && <Link href="/simp2m/master-data" className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent">Buka Master Data <ArrowRight size={15} aria-hidden="true" /></Link>}
        </div>
      </section>
      {(user.institutionId || institutions[0]?.id) ? (
        <PeriodTimelineWidget institutionId={user.institutionId || institutions[0]?.id || 0} />
      ) : null}
      {activeInstitution && <section aria-labelledby="dashboard-metrics">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
          <h2 id="dashboard-metrics" className="text-sm font-semibold">Ringkasan master data</h2>
          <p className="text-sm text-muted-foreground">{activeInstitution.name} · Operasional</p>
        </div>
        <div className="grid gap-2 min-[375px]:grid-cols-2 xl:grid-cols-4">
          {metrics.map(({ title, kind, tone, icon: Icon }, index) => (
            <article key={kind} data-tone={tone} className="workspace-metric flex min-w-0 items-start gap-2 rounded-md border border-border p-2.5 sm:gap-3 sm:p-3">
              <span className="workspace-metric-icon grid size-8 shrink-0 place-items-center rounded-lg sm:size-10"><Icon size={18} aria-hidden="true" /></span>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{title}</p>
                {totals[index] === undefined
                  ? <p className="mt-1 text-sm text-muted-foreground">Data belum tersedia</p>
                  : <p className="mt-1 text-2xl leading-none font-semibold tabular-nums">{new Intl.NumberFormat("id-ID").format(totals[index])}</p>}
              </div>
            </article>
          ))}
        </div>
      </section>}
      {shortcuts.length > 0 && <section aria-labelledby="dashboard-shortcuts" className="rounded-md border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <BookOpenCheck size={17} aria-hidden="true" className="shrink-0 text-brand" />
          <h2 id="dashboard-shortcuts" className="text-sm font-semibold">Alur pengelolaan</h2>
        </div>
        <div className="grid gap-2 p-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {shortcuts.map(({ title, description, href, icon: Icon }) => (
            <Link key={href} href={href} className="flex min-w-0 items-start gap-2 rounded-md px-2 py-2 hover:bg-accent">
              <Icon size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
              <div className="min-w-0 flex-1"><h3 className="text-sm font-medium">{title}</h3><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div>
              <ArrowRight size={16} aria-hidden="true" className="mt-1 shrink-0 text-brand" />
            </Link>
          ))}
        </div>
      </section>}
    </div>
  );
}
