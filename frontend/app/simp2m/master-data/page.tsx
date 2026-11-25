import { MasterDataPanel } from "./view";

export default async function MasterDataPage({ searchParams }: PageProps<"/simp2m/master-data">) {
  const requested = (await searchParams).kind;
  const kind = typeof requested === "string" ? requested : undefined;
  return <section className="space-y-5"><MasterDataPanel key={kind ?? "all"} initialKind={kind} /></section>;
}
