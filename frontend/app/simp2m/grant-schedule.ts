const monthFormat = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });

export function formatGrantMonth(value?: string) {
  return value ? monthFormat.format(new Date(`${value.slice(0, 7)}-01T00:00:00Z`)) : "Belum dijadwalkan";
}

export function grantMonthBounds(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { first: "", last: "" };
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${last}` };
}
