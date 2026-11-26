"use client";

import Link from "next/link";
import { CalendarDays, ChartNoAxesCombined, ClipboardList, FileText, NotebookPen } from "lucide-react";

const researchTabs = [
  { key: "usulan", label: "Usulan", icon: ClipboardList },
  { key: "catatan-harian", label: "Catatan Harian", icon: CalendarDays },
  { key: "laporan-kemajuan", label: "Laporan Kemajuan", icon: NotebookPen },
  { key: "laporan-akhir", label: "Laporan Akhir", icon: FileText },
  { key: "capaian-terkini", label: "Capaian Penelitian Terkini", icon: ChartNoAxesCombined },
] as const;

export function ResearchTabs({ active, community = false }: { active: string; community?: boolean }) {
  const route = community ? "/simp2m/pengabdian" : "/simp2m/penelitian";
  const tabs = community ? researchTabs.filter(tab => tab.key !== "laporan-kemajuan" && tab.key !== "capaian-terkini") : researchTabs;
  return <nav aria-label={community ? "Bagian Pengabdian" : "Bagian Penelitian"} className={`grid grid-cols-2 gap-1 rounded-lg border border-border bg-card p-1 ${community ? "sm:grid-cols-3" : "md:grid-cols-3 xl:grid-cols-5"}`}>
    {tabs.map(({ key, label, icon: Icon }) => <Link key={key}
      href={key === "usulan" ? route : `${route}?tab=${key}`}
      aria-current={key === active ? "page" : undefined}
      data-action-tone={!community && key === "usulan" ? "research-proposal" : undefined}
      onNavigate={event => {
        if (key !== active && document.querySelector(community ? "[data-community-editing]" : "[data-research-editing]") &&
          !window.confirm("Ada isian yang belum selesai. Pindah tab?")) event.preventDefault();
      }}
      className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground hover:bg-accent aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground sm:px-3">
      <Icon size={16} className="shrink-0" aria-hidden="true" /> {community && key === "usulan" ? "Usulan Proposal" : label}
    </Link>)}
  </nav>;
}
