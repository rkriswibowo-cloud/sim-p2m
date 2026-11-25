import { AccessPanel } from "./view";

export default async function AccessPage({ searchParams }: PageProps<"/simp2m/akses">) {
  const requested = (await searchParams).section;
  const section = requested === "institutions" || requested === "audit" ? requested : "access";
  return <section className="space-y-5"><AccessPanel key={section} section={section} /></section>;
}
