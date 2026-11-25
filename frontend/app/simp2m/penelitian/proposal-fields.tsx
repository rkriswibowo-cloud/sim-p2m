"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "./rich-editor";

export const steps = ["Skema dan identitas", "Tim", "Roadmap dan ringkasan", "Pendahuluan dan metode", "Luaran dan referensi", "RAB dan jadwal", "Tinjau usulan"] as const;
export type Choice = { id: number; name: string };
export type MemberConsent = { lecturerId: number; name: string; code: string; status: "pending" | "approved" | "rejected"; note: string };
type TextKey = "object" | "location" | "starts" | "ends" | "partner" | "contribution" | "findings" | "journal" | "roadmap" | "summary" | "sdgKeywords" | "introduction" | "literature" | "method" | "expected" | "references";
type ListKey = "team" | "students" | "outputs" | "costs" | "schedule";
type Row = Record<string, string | number>;
export type ProposalData = Partial<Record<TextKey, string> & Record<ListKey, Row[]> & { keywords: string[] }>;
type Column = { key: string; name: string; type?: "number" | "lecturers" | "students" | "budgetCategory" | "outputKind" | "outputStatus" | "outputYear" };
type OptionLists = { fields: Choice[]; lecturers: Choice[]; students: Choice[]; budgetCategories: Choice[]; targetYears?: Choice[] };

const outputKindOptions = [
  "Publikasi Artikel Jurnal Nasional Terakreditasi",
  "Publikasi Artikel Jurnal Nasional",
  "Publikasi Artikel Jurnal Internasional Bereputasi",
  "Publikasi Artikel Jurnal Internasional",
  "Prosiding Seminar Nasional/Internasional",
  "HKI / Hak Cipta / Paten",
  "Buku Ajar / Monograf",
  "Produk / Prototipe",
];

const outputStatusOptions = ["Submit", "Review", "Accepted", "Terbit"];

const rowDefinitions: Record<ListKey, { title: string; columns: Column[] }> = {
  team: { title: "Anggota dosen", columns: [{key:"id",name:"Dosen",type:"lecturers"},{key:"expertise",name:"Keahlian"},{key:"hours",name:"Jam per minggu",type:"number"},{key:"task",name:"Tugas"}] },
  students: { title: "Mahasiswa", columns: [{key:"id",name:"Mahasiswa",type:"students"},{key:"activity",name:"Bentuk keterlibatan"},{key:"thesis",name:"Judul tugas akhir (opsional)"}] },
  outputs: { title: "Target luaran", columns: [{key:"kind",name:"Jenis luaran",type:"outputKind"},{key:"status",name:"Status target",type:"outputStatus"},{key:"year",name:"Tahun target",type:"outputYear"}] },
  costs: { title: "Rincian anggaran", columns: [{key:"categoryId",name:"Kategori",type:"budgetCategory"},{key:"item",name:"Item"},{key:"reason",name:"Justifikasi"},{key:"quantity",name:"Kuantitas"},{key:"unit",name:"Satuan"},{key:"price",name:"Harga satuan (Rp)"}] },
  schedule: { title: "Jadwal kegiatan", columns: [{key:"name",name:"Tahapan"},{key:"output",name:"Luaran tahapan"},{key:"indicator",name:"Indikator"},{key:"person",name:"Penanggung jawab"},{key:"from",name:"Mulai bulan ke-",type:"number"},{key:"to",name:"Selesai bulan ke-",type:"number"}] },
};
const formatMoney = new Intl.NumberFormat("id-ID", {style:"currency",currency:"IDR", maximumFractionDigits:0});

export function ProposalFields({ step, data, options, title, field, budget, consents, disabled, onTitle, onField, onData }: {
  step:number; data:ProposalData; options:OptionLists; title:string; field:number|null; budget:string; consents?:MemberConsent[];
  disabled:boolean; onTitle:(value:string)=>void; onField:(value:number|null)=>void; onData:(value:ProposalData)=>void;
}) {
  function text(key:TextKey, label:string, type="text") {
    return <Input key={key} label={label} id={key} type={type} value={data[key] ?? ""} disabled={disabled}
      onChange={event => onData({...data,[key]:event.target.value})} />;
  }
  function narrative(key:TextKey,label:string,limit?:number) {
    return <RichTextEditor key={key} id={key} label={label} value={data[key] ?? ""} disabled={disabled} limit={limit}
      onChange={next => onData({...data,[key]:next})} />;
  }
  const singleRowGrid: Partial<Record<ListKey, string>> = {
    team: "lg:grid-cols-[minmax(180px,1.5fr)_minmax(130px,1fr)_105px_minmax(150px,1.2fr)_auto_auto]",
    students: "lg:grid-cols-[minmax(180px,1.4fr)_minmax(170px,1.2fr)_minmax(180px,1.4fr)_auto]",
    costs: "lg:grid-cols-[minmax(140px,1.1fr)_minmax(130px,1.1fr)_minmax(130px,1.1fr)_85px_90px_130px_auto]",
    schedule: "lg:grid-cols-[minmax(130px,1.1fr)_minmax(130px,1.1fr)_minmax(120px,1fr)_minmax(120px,1fr)_90px_90px_auto]",
  };
  function records(key:ListKey) {
    const definition=rowDefinitions[key], items=data[key] ?? [];
    const rowClass = singleRowGrid[key]
      ? `grid grid-cols-1 items-end gap-2 border-b border-border pb-2 sm:grid-cols-2 ${singleRowGrid[key]}`
      : "grid grid-cols-1 items-end gap-2 border-b border-border pb-2 sm:grid-cols-2 xl:grid-cols-3";
    return <fieldset key={key} className="min-w-0 space-y-2 rounded-md border border-border p-2">
      <legend className="px-1 text-xs font-semibold">{definition.title}</legend>
      {key==="team" && <p className="text-xs text-muted-foreground">Minimal 1 anggota dosen dan maksimal 3 anggota dosen.</p>}
      {key==="outputs" && <p className="text-xs text-muted-foreground">Penelitian berbasis output: wajib menyertakan minimal 1 luaran publikasi artikel ilmiah.</p>}
      {!items.length && <p className="text-xs text-muted-foreground">Belum ada baris.</p>}
      {key==="costs" && !disabled && !options.budgetCategories.length &&
        <p className="text-xs text-muted-foreground">Belum ada kategori RAB aktif. Hubungi admin untuk menambahkan kategori.</p>}
      <div className={singleRowGrid[key] ? "space-y-2 overflow-x-auto pb-1" : "space-y-2"}>
      {items.map((item,index) => <div key={index} className={rowClass}>
        {definition.columns.map(column => {
          const id=`${key}-${index}-${column.key}`;
          const update=(value:string|number) => onData({...data,[key]:items.map((row,i) => i===index ? {...row,[column.key]:value}:row)});
          if(column.type==="budgetCategory") {
            if(disabled) return <Input key={column.key} id={id} label={column.name} value={item.category ?? ""} readOnly />;
            const choices=options.budgetCategories;
            const selected=choices.find(option=>option.id===item.categoryId)
              ?? (!item.categoryId && choices.find(option=>option.name===item.category) || undefined);
            const previous=item.category ? "previous" : "";
            return <div key={column.key} className="min-w-0">
              <label htmlFor={id} className="mb-1 block">{column.name}</label>
              <select id={id} className="w-full" value={selected?.id ?? previous} onChange={event=>{
                const choice=choices.find(option=>option.id===Number(event.target.value));
                onData({...data,[key]:items.map((row,i)=>i===index ? {...row,categoryId:choice?.id ?? 0,category:choice?.name ?? ""}:row)});
              }}>
                <option value="">Pilih kategori</option>
                {choices.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}
                {!selected && previous && <option value={previous} disabled>{item.category} (pilih ulang)</option>}
              </select>
            </div>;
          }
          if(column.type==="outputKind") {
            const currentKind = String(item[column.key] || "");
            return <div key={column.key} className="min-w-0">
              <label htmlFor={id} className="mb-1 block">{column.name}</label>
              <select id={id} className="w-full" disabled={disabled} value={currentKind} onChange={event=>update(event.target.value)}>
                <option value="">Pilih jenis luaran</option>
                {outputKindOptions.map(opt=><option key={opt} value={opt}>{opt}</option>)}
                {!!currentKind && !outputKindOptions.includes(currentKind) && <option value={currentKind}>{currentKind}</option>}
              </select>
            </div>;
          }
          if(column.type==="outputStatus") {
            const currentStatus = String(item[column.key] || "");
            return <div key={column.key} className="min-w-0">
              <label htmlFor={id} className="mb-1 block">{column.name}</label>
              <select id={id} className="w-full" disabled={disabled} value={currentStatus} onChange={event=>update(event.target.value)}>
                <option value="">Pilih status target</option>
                {outputStatusOptions.map(opt=><option key={opt} value={opt}>{opt}</option>)}
                {!!currentStatus && !outputStatusOptions.includes(currentStatus) && <option value={currentStatus}>{currentStatus}</option>}
              </select>
            </div>;
          }
          if(column.type==="outputYear") {
            const currentYear = item[column.key] ? String(item[column.key]) : "";
            const years = (options.targetYears ?? []).map(y => y.name.trim()).filter(y => /^\d+$/.test(y));
            return <div key={column.key} className="min-w-0">
              <label htmlFor={id} className="mb-1 block">{column.name}</label>
              <select id={id} className="w-full" disabled={disabled} value={currentYear} onChange={event=>update(Number(event.target.value))}>
                <option value="">Pilih tahun target</option>
                {years.map(yr=><option key={yr} value={yr}>{yr}</option>)}
                {!!currentYear && !years.includes(currentYear) && <option value={currentYear}>{currentYear}</option>}
              </select>
            </div>;
          }
          if(column.type==="lecturers"||column.type==="students") return <div key={column.key} className="min-w-0">
            <label htmlFor={id} className="mb-1 block">{column.name}</label>
            <select id={id} className="w-full" disabled={disabled} value={item[column.key] || ""} onChange={event=>update(Number(event.target.value))}>
              <option value="">Pilih {column.name.toLowerCase()}</option>
              {options[column.type].map(option=><option key={option.id} value={option.id}>{option.name}</option>)}
              {!!item[column.key] && !options[column.type].some(option=>option.id===item[column.key]) && <option value={item[column.key]}>Data tidak aktif</option>}
            </select>
          </div>;
          return <Input key={column.key} id={id} label={column.name} type={column.type ?? "text"} min={column.type==="number" ? 1 : undefined}
            value={item[column.key] || ""} disabled={disabled} onChange={event=>update(column.type==="number" ? Number(event.target.value) : event.target.value)} />;
        })}
        {!disabled && <Button type="button" variant="ghost" size="sm" className="shrink-0 justify-self-start text-destructive"
          aria-label={`Hapus baris ${definition.title} ${index+1}`} onClick={()=>onData({...data,[key]:items.filter((_,i)=>i!==index)})}>{singleRowGrid[key] ? "Hapus" : "Hapus baris"}</Button>}
        {key==="team" && Number(item.id) > 0 && (() => {
          const c = consents?.find(row => row.lecturerId === Number(item.id));
          if (!c) return <span className="whitespace-nowrap pb-2 text-xs text-muted-foreground">Menunggu simpan</span>;
          const label = c.status === "approved" ? "Disetujui" : c.status === "rejected" ? `Ditolak${c.note ? `: ${c.note}` : ""}` : "Menunggu persetujuan";
          const cls = c.status === "approved" ? "text-emerald-600 dark:text-emerald-400" : c.status === "rejected" ? "text-destructive" : "text-amber-600 dark:text-amber-400";
          return <span className={`whitespace-nowrap pb-2 text-xs font-medium ${cls}`}>{label}</span>;
        })()}
      </div>)}
      </div>
      {!disabled && !(key==="team" && items.length>=3) && <Button type="button" variant="outline" size="sm" onClick={()=>onData({...data,[key]:[...items,{}]})}>Tambah {definition.title.toLowerCase()}</Button>}
    </fieldset>;
  }

  if(step===0) return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <Input id="proposal-title" label="Judul penelitian" value={title} maxLength={300} disabled={disabled} onChange={event=>onTitle(event.target.value)} />
    <div className="min-w-0"><label htmlFor="proposal-field" className="mb-1 block">Bidang riset</label>
      <select id="proposal-field" className="w-full" disabled={disabled} value={field ?? ""} onChange={event=>onField(Number(event.target.value)||null)}>
        <option value="">Pilih bidang riset</option>{options.fields.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        {field&&!options.fields.some(item=>item.id===field)&&<option value={field}>Bidang riset nonaktif</option>}
      </select>
    </div>
    {text("object","Objek penelitian")}{text("location","Lokasi penelitian")}
    {text("starts","Tanggal mulai","date")}{text("ends","Tanggal selesai","date")}
    {text("partner","Instansi mitra (opsional)")}{text("contribution","Kontribusi mitra (opsional)")}
    {text("findings","Temuan yang ditargetkan")}{text("journal","Jurnal sasaran (opsional)")}
  </div>;
  if(step===1) return <div className="space-y-3">{records("team")}{records("students")}</div>;
  if(step===2) return <div className="space-y-3">{narrative("roadmap","Roadmap penelitian")}{narrative("summary","Ringkasan")}
    <Input id="keywords" label="Lima kata kunci, pisahkan dengan koma" defaultValue={data.keywords?.join(", ")} disabled={disabled}
      onChange={event=>onData({...data,keywords:event.target.value.split(",").map(word=>word.trim())})} />
    {text("sdgKeywords","Kata kunci SDGs (jika relevan)")}
  </div>;
  if(step===3) return <div className="space-y-3">{narrative("introduction","Pendahuluan",1000)}{narrative("literature","Tinjauan pustaka")}{narrative("method","Metode penelitian")}</div>;
  if(step===4) return <div className="space-y-3">{narrative("expected","Hasil yang diharapkan")}{records("outputs")}{narrative("references","Daftar pustaka")}</div>;
  if(step===5) return <div className="space-y-3">{records("costs")}
    <p className="text-sm">Total RAB tersimpan <strong>{formatMoney.format(BigInt(budget))}</strong></p>{records("schedule")}</div>;
  return <p className="text-sm text-muted-foreground">Periksa identitas, tim, narasi, luaran, RAB, dan jadwal sebelum mengirim usulan.</p>;
}
