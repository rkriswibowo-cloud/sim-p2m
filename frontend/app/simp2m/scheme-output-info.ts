export function getMinOutputInfo(schemeName: string): string | null {
  const name = schemeName.toLowerCase();
  if (name.includes("pemula")) {
    return "Jurnal nasional ber-ISSN & Seminar Nasional";
  }
  if (name.includes("pratama")) {
    return "Jurnal nasional terakreditasi terindeks SINTA 3 – 4, Seminar Nasional";
  }
  if (name.includes("utama")) {
    return "Jurnal nasional terakreditasi SINTA 2-3, Seminar Internasional";
  }
  if (name.includes("terapan")) {
    return "Jurnal terakreditasi minimal SINTA 2, Seminar Internasional";
  }
  return null;
}

