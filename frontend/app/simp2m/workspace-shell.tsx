"use client";

import { BookOpen, BriefcaseBusiness, Building2, CalendarDays, ChevronDown, ChevronsLeft, ChevronsRight, ClipboardList, Database, FileText, FlaskConical, GraduationCap, Layers3, LayoutDashboard, Menu, Moon, Network, Search, Settings, ShieldCheck, Sun, UserRound, UsersRound, Wallet, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";
import { workspaceToastOptions } from "./confirm-removal";
import { LogoutButton } from "./logout-button";
import { useWorkspacePreferences } from "./workspace-preferences";

interface ShellProps {
  name?: string;
  institution?: string;
  system: boolean;
  canAccess: boolean;
  canAudit: boolean;
  canMaster: boolean;
  canGrant: boolean;
  canResearch: boolean;
  canCommunity: boolean;
  canDocuments: boolean;
  canReports: boolean;
  canSelection: boolean;
  date: string;
  footer: React.ReactNode;
  children: React.ReactNode;
}

type NavItem = { label: string; href: string; icon?: LucideIcon };
const masterGroups: { label: string; icon: LucideIcon; kinds: [string, string, LucideIcon][] }[] = [
  { label: "Organisasi", icon: Network, kinds: [["Fakultas", "faculties", Building2], ["Program studi", "study-programs", BookOpen], ["Unit", "units", BriefcaseBusiness]] },
  { label: "SDM", icon: UsersRound, kinds: [["Dosen", "lecturers", UserRound], ["Mahasiswa", "students", GraduationCap], ["Reviewer", "reviewers", ShieldCheck]] },
  { label: "Riset dan pendanaan", icon: FlaskConical, kinds: [["Sumber dana", "funding-sources", Wallet], ["Kelompok skema", "scheme-groups", Layers3], ["Skema", "schemes", ClipboardList], ["Bidang riset", "research-fields", FlaskConical], ["Kategori RAB", "budget-categories", Wallet], ["Tahun target luaran", "output-target-years", CalendarDays]] },
];

function Navigation({ system, canAccess, canAudit, canMaster, canGrant, canResearch, canCommunity, canDocuments, canReports, canSelection, compact, close }: Omit<ShellProps, "name" | "institution" | "date" | "footer" | "children"> & { compact?: boolean; close?: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const filter = query.trim().toLowerCase();
  const matches = (label: string) => !filter || label.toLowerCase().includes(filter);
  const dashboard = { label: "Dashboard", href: "/simp2m", icon: LayoutDashboard };
  const core: NavItem[] = [];
  const master: NavItem[] = [];
  const administration: NavItem[] = [];
  if (canGrant) core.push({ label: "Hibah", href: "/simp2m/hibah", icon: Wallet });
  core.push({ label: "Profil Dosen", href: "/simp2m/profil-dosen", icon: UserRound });
  if (canResearch) core.push({ label: "Penelitian", href: "/simp2m/penelitian", icon: FlaskConical });
  if (canSelection) core.push({ label: "Seleksi & Review", href: "/simp2m/seleksi", icon: ShieldCheck });
  if (canResearch || canSelection) core.push({ label: "Kontrak & Pendanaan", href: "/simp2m/pendanaan", icon: BriefcaseBusiness });
  if (canResearch || canSelection || canReports) core.push({ label: "Monitoring & Luaran", href: "/simp2m/monev", icon: CalendarDays });
  if (canSelection || canAudit || canGrant || system) core.push({ label: "Analitik & Ekspor", href: "/simp2m/analitik", icon: ClipboardList });
  if (canCommunity) core.push({ label: "Pengabdian kepada Masyarakat", href: "/simp2m/pengabdian", icon: UsersRound });
  if (canDocuments) core.push({ label: "Dokumen", href: "/simp2m/dokumen", icon: FileText });
  if (canReports) core.push({ label: "Laporan", href: "/simp2m/laporan", icon: ClipboardList });
  if (canMaster) master.push({ label: "Daftar master data", href: "/simp2m/master-data", icon: Database });
  if (system) administration.push({ label: "Institusi", href: "/simp2m/akses?section=institutions", icon: Building2 });
  if (canAccess) administration.push({ label: "Pengguna & Role", href: "/simp2m/akses", icon: UsersRound });
  if (canAudit) administration.push({ label: "Audit", href: "/simp2m/akses?section=audit", icon: ClipboardList });
  administration.push({ label: "Pengaturan", href: "/simp2m/pengaturan", icon: Settings });
  const coreLinks = core.filter(item => matches(item.label));
  const masterLinks = master.filter(item => matches(item.label));
  const adminLinks = administration.filter(item => matches(item.label));
  const visibleMasterGroups = canMaster ? masterGroups.map(group => ({
    ...group, kinds: group.kinds.filter(([label]) => matches(label) || matches(group.label) || matches("Master Data")),
  })).filter(group => group.kinds.length) : [];

  function renderLink(item: NavItem) {
    const [url, search] = item.href.split("?");
    const active = pathname === url && (search ? params.toString() === search : !params.has("section") && !params.has("kind"));
    const Icon = item.icon;
    return (
      <Link key={item.href} href={item.href} onClick={close} title={compact ? item.label : undefined} aria-label={compact ? item.label : undefined} aria-current={active ? "page" : undefined} className="workspace-nav-link">
        {Icon && <Icon size={17} aria-hidden="true" />}
        {!compact && <span>{item.label}</span>}
      </Link>
    );
  }

  return (
    <nav aria-label="Navigasi SIM-P2M" className="workspace-nav">
      {!compact && <label className="workspace-search">
        <Search size={16} aria-hidden="true" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari menu" aria-label="Cari menu" />
      </label>}
      {matches(dashboard.label) && renderLink(dashboard)}
      <div role="group" aria-label="Modul inti" className="workspace-nav-section" hidden={!coreLinks.length}>
        {!compact && <p className="workspace-nav-caption">Modul inti</p>}
        {coreLinks.map(renderLink)}
      </div>
      <div role="group" aria-label="Master Data" className="workspace-nav-section" hidden={!masterLinks.length && !visibleMasterGroups.length}>
        {!compact && <p className="workspace-nav-caption">Master Data</p>}
        {masterLinks.map(renderLink)}
      {!compact && visibleMasterGroups.map(group => {
        const active = pathname === "/simp2m/master-data" && group.kinds.some(([, kind]) => params.get("kind") === kind);
        const Icon = group.icon;
        return <details key={group.label + (active ? "-active" : "")} open={filter || active ? true : undefined} className="workspace-nav-group">
          <summary><span className="flex items-center gap-2"><Icon size={15} aria-hidden="true" />{group.label}</span><ChevronDown size={14} aria-hidden="true" /></summary>
          {group.kinds.map(([label, kind, icon]) => renderLink({ label, href: `/simp2m/master-data?kind=${kind}`, icon }))}
        </details>;
      })}
      </div>
      <div role="group" aria-label="Administrasi" className="workspace-nav-section" hidden={!adminLinks.length}>
        {!compact && <p className="workspace-nav-caption">Administrasi</p>}
        {adminLinks.map(renderLink)}
      </div>
      {!compact && filter && !matches(dashboard.label) && !coreLinks.length && !masterLinks.length && !visibleMasterGroups.length && !adminLinks.length &&
        <p className="px-2 text-sm text-muted-foreground">Menu tidak ditemukan.</p>}
    </nav>
  );
}

export function WorkspaceShell(props: ShellProps) {
  const { theme, appearance, collapsed, save } = useWorkspacePreferences();
  const [isMobileOpen, setMobileOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const initials = props.name?.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 960px)");
    function closeOnDesktop() { if (desktop.matches) drawer.current?.close(); }
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  function closeDrawer() { drawer.current?.close(); }
  function openDrawer() { drawer.current?.showModal(); setMobileOpen(true); }

  return (
    <div lang="id" className="workspace-shell" data-mode={appearance} data-collapsed={collapsed}>
      <a className="workspace-skip" href="#workspace-main">Lewati ke konten</a>
      <header className="workspace-topbar">
        <button ref={mobileTrigger} type="button" className="workspace-icon workspace-mobile-toggle" aria-label="Buka navigasi" aria-controls="workspace-drawer" aria-expanded={isMobileOpen} onClick={openDrawer}><Menu size={20} /></button>
        <Link href="/simp2m" className="workspace-brand">
          <span className="workspace-logo"><GraduationCap size={22} aria-hidden="true" /></span>
          <span className="min-w-0"><strong>SIM-P2M</strong><small className="truncate" title={props.institution}>{props.institution}</small></span>
        </Link>
        <span className="workspace-date"><CalendarDays size={15} aria-hidden="true" />{props.date}</span>
        <div className="workspace-topbar-actions">
          <button type="button" className="workspace-icon" title={appearance === "dark" ? "Tema terang" : "Tema gelap"} aria-label={appearance === "dark" ? "Aktifkan tema terang" : "Aktifkan tema gelap"} onClick={() => save(appearance === "dark" ? "light" : "dark", collapsed)}>{appearance === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
          {props.name && <details className="workspace-account">
            <summary aria-label={`Menu akun ${props.name}`}><span className="workspace-avatar">{initials}</span><span className="workspace-account-name"><strong>{props.name}</strong><small>{props.system ? "Superadmin" : "Anggota"}</small></span><ChevronDown size={14} aria-hidden="true" /></summary>
            <div className="workspace-account-popover">
              <p className="mb-3 text-sm text-muted-foreground">{props.institution}</p>
              <Link href="/simp2m/pengaturan" className="workspace-nav-link mb-2"><Settings size={16} aria-hidden="true" /> Pengaturan</Link>
              <LogoutButton />
            </div>
          </details>}
        </div>
      </header>
      <div className="workspace-frame">
        <aside className="workspace-sidebar" aria-label="Sidebar">
          <Navigation {...props} compact={collapsed} />
          <button type="button" className="workspace-collapse" aria-label={collapsed ? "Bentangkan sidebar" : "Ciutkan sidebar"} aria-expanded={!collapsed} onClick={() => save(theme, !collapsed)}>
            {collapsed ? <ChevronsRight size={19} /> : <><ChevronsLeft size={19} />Ciutkan sidebar</>}
          </button>
        </aside>
        <div className="workspace-body">
          <main id="workspace-main" className="workspace-content" tabIndex={-1}>{props.children}</main>
          <footer className="workspace-footer">{props.footer}</footer>
        </div>
      </div>
      <dialog ref={drawer} id="workspace-drawer" aria-label="Menu SIM-P2M" className="workspace-drawer" onClose={() => { setMobileOpen(false); mobileTrigger.current?.focus(); }} onClick={event => { if (event.target === event.currentTarget) closeDrawer(); }}>
        <div className="workspace-drawer-content">
          <div className="workspace-drawer-title"><strong>Menu SIM-P2M</strong><button type="button" className="workspace-icon" aria-label="Tutup navigasi" onClick={closeDrawer}><X size={20} /></button></div>
          <Navigation {...props} close={closeDrawer} />
        </div>
      </dialog>
      <Toaster id={workspaceToastOptions.toasterId} theme={appearance} position="top-right" richColors closeButton containerAriaLabel="Notifikasi SIM-P2M" />
    </div>
  );
}
