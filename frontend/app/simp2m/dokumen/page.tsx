import { Download, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getWorkspaceSession } from "../session";

export const metadata = { title: "Dokumen SIM-P2M" };

export default async function DocumentsPage() {
  const { user, institutions, request } = await getWorkspaceSession();
  const institution = institutions.find(item => item.active && item.canDocuments);
  if (!user?.canDocuments || !institution) return <p role="alert">Akun ini belum punya akses Dokumen untuk institusi aktif.</p>;

  const endpoint = `/api/v1/iam/institutions/${institution.id}/documents`;
  const documents = await request<{ id: string; name: string }[]>(endpoint);
  return <section className="space-y-4">
    <h1 className="text-2xl font-semibold tracking-tight">Dokumen</h1>
    <Card>
      <CardHeader><CardTitle>Template penelitian</CardTitle></CardHeader>
      <CardContent>
        {!documents && <p role="alert">Daftar template gagal dimuat.</p>}
        {documents?.length === 0 && <p className="text-muted-foreground">Belum ada template yang tersedia.</p>}
        {!!documents?.length && <ul className="divide-y divide-border">
          {documents.map(document => <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span className="flex min-w-0 items-center gap-2"><FileText size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" /> <span className="wrap-anywhere">{document.name}</span></span>
            <a className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" href={`${endpoint}/${document.id}`} aria-label={`Unduh ${document.name}`}>
              <Download size={16} aria-hidden="true" /> Unduh
            </a>
          </li>)}
        </ul>}
      </CardContent>
    </Card>
  </section>;
}
