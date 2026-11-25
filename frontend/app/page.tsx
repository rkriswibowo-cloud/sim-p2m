import { BrandCredit } from "@/components/layout/footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GraduationCap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

const description = "Sistem Informasi Penelitian dan Pengabdian kepada Masyarakat";

export const metadata: Metadata = {
  title: { absolute: "SIM-P2M | Universitas Anwar Medika" },
  description,
  robots: { index: false, follow: false },
};

async function isApiAvailable() {
  const origin = process.env.SIMP2M_API_ORIGIN ?? "http://127.0.0.1:8080";
  try {
    const response = await fetch(new URL("/api/v1/health", origin), {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    return response.ok && (await response.json()).status === "ok";
  } catch {
    return false;
  }
}

export default async function Home() {
  const apiAvailable = await isApiAvailable();

  return (
    <div lang="id" className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-5 py-4 sm:px-8">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <GraduationCap aria-hidden="true" className="size-6" />
          </div>
          <p className="text-sm font-semibold">Universitas Anwar Medika</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8 sm:py-20">
        <h1 className="text-4xl font-semibold tracking-tight">SIM-P2M</h1>
        <p className="mt-3 text-lg text-muted-foreground">{description}</p>
        <Link href="/login" className="mt-5 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Masuk ke SIM-P2M
        </Link>

        <Card className="mt-8 max-w-md">
          <CardHeader>
            <CardTitle>Status layanan pengembangan</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {apiAvailable ? "API SIM-P2M tersedia." : "API SIM-P2M belum dapat dihubungi."}
            </p>
          </CardContent>
        </Card>
      </main>

      <footer className="border-t border-border bg-card">
        <BrandCredit className="mx-auto max-w-4xl px-5 py-4 sm:px-8" />
      </footer>
    </div>
  );
}
