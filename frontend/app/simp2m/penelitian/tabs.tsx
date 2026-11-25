"use client";

import Link from "next/link";
import { CalendarDays, ClipboardList, FileText, NotebookPen } from "lucide-react";

const researchTabs = [
  { key: "usulan", label: "Usulan", icon: ClipboardList },
  { key: "catatan-harian", label: "Catatan Harian", icon: CalendarDays },
  { key: "laporan-kemajuan", label: "Laporan Kemajuan", icon: NotebookPen },
  { key: "laporan-akhir", label: "Laporan Akhir", icon: FileText },
] as const;

export function ResearchTabs({ active }: { active: string }) {
  return <nav aria-label="Bagian Penelitian" className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-card p-1 lg:grid-cols-4">
    {researchTabs.map(({ key, label, icon: Icon }) => <Link key={key}
      href={key === "usulan" ? "/simp2m/penelitian" : `/simp2m/penelitian?tab=${key}`}
      aria-current={key === active ? "page" : undefined}
      onNavigate={event => {
        if (key !== active && document.querySelector("[data-research-editing]") &&
          !window.confirm("Ada isian yang belum selesai. Pindah tab?")) event.preventDefault();
      }}
      className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground hover:bg-accent aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground sm:px-3">
      <Icon size={16} className="shrink-0" aria-hidden="true" /> {label}
    </Link>)}
  </nav>;
}
