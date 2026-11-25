import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LoginForm } from "./view";

export const metadata: Metadata = {
  title: { absolute: "Masuk | SIM-P2M" },
  robots: { index: false, follow: false },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const query = await searchParams;
  const renew = query.renew === "1" && (await cookies()).has("simp2m_refresh");
  return <LoginForm renew={renew} />;
}
