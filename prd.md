# PRD — SIM-P2M

**Product Requirements Document | v0.1 (planning baseline)**  
**Tanggal:** 24 November 2026  
**Produk:** Sistem Informasi Penelitian dan Pengabdian kepada Masyarakat  
**Implementasi awal:** Universitas Anwar Medika (UAM)  
**Status:** Rancangan; belum ada implementasi yang dinyatakan lulus pengujian.

## 1. Instruksi utama untuk coding agent (VS Code)

Dokumen ini merupakan acuan produk, bukan perintah untuk mengimplementasikan seluruh fitur sekaligus. Baca PRD, struktur repository, AGENTS.md bawaan template, dan sumber dokumen sebelum mengubah kode. Jika belum ada repository, mulai dari fondasi v0.1 saja. Setiap versi harus dapat dijalankan dan diuji sebelum melanjutkan modul berikutnya atas persetujuan pemilik produk.

- **WAJIB:** Go sebagai backend utama; React sebagai frontend; MySQL/MariaDB sebagai database; shadcn/ui dengan visual DropX; arsitektur modular monolith; Superadmin permanen; master data dinamis; Proposal & Report Builder; logbook dalam sistem.
- **Rekomendasi teknis:** pertahankan Next.js dari DropX (menggantikan usulan Vite awal), Gin, GORM, Tiptap, Docker Compose, Nginx. Verifikasi kompatibilitas versi terlebih dahulu dan dokumentasikan keputusan. Jangan mengganti stack tanpa persetujuan.
- **JANGAN:** menginstal PostgreSQL, merombak aplikasi lain di server, hardcode kebijakan hibah, menggunakan data demo sebagai data produksi, membuat fitur LPJ final sebelum format diterima, atau menjalankan migrasi destruktif tanpa persetujuan.
- Implementasikan satu modul per iterasi. Tulis rencana singkat, daftar file terdampak, migrasi, tes, cara menjalankan, dan catatan perubahan. Laporkan kegagalan secara jujur; jangan mengklaim build/test lulus jika belum dijalankan.
- Pertahankan kompatibilitas modul lama; gunakan migrasi database berversi; jangan menyimpan secret dalam Git. Jangan menyalin data pribadi atau kredensial ke fixture.
- Keputusan yang berlabel **usulan** boleh menjadi rancangan teknis, bukan kebijakan resmi. Yang berlabel **tertunda** tidak boleh diasumsikan final.

## 2. Visi, tujuan, dan ruang lingkup

Platform manajemen siklus penelitian dan PkM terinspirasi BIMA Kemendiktisaintek, dengan desain modern dan aturan yang dapat dikonfigurasi oleh institusi. Pengguna mengisi data terstruktur sekali dan memanfaatkannya untuk proposal, surat, pelaksanaan, laporan, serta analitik.

Tujuan: mengurangi input berulang; meningkatkan keterlacakan persetujuan dan review; memudahkan pengelolaan skema, pendanaan dan luaran; menyediakan bukti kinerja untuk LPPM, pimpinan dan SPMI. Implementasi awal satu institusi, tetapi siap multi-institusi. Pendanaan internal dan eksternal; penelitian mandiri dapat dicatat sebagai opsi lanjutan. Prioritas produk adalah siklus lengkap yang dikembangkan bertahap, dimulai dari penelitian. PkM dikembangkan setelah kebutuhan dan template khusus tersedia.

Di luar fase awal: SaaS multi-institusi publik, integrasi langsung BIMA/SINTA, AI penilaian, portal publik, dan LPJ final. Jangan melakukan scraping atau menganggap API eksternal tersedia tanpa verifikasi dan izin.

## 3. Referensi sumber

| Sumber | Penggunaan |
|---|---|
| `dropx-admin-v1.0.0.zip` | Source frontend; manifest versi 1.0.1 |
| https://preview.themewagon.com/dropx-admin/dashboard/ | Referensi visual |
| `image(20261124-131409).png` | Navigasi penelitian BIMA |
| `image(20261124-131556).png`, `image(20261124-131614).png` | Referensi rangkuman usulan BIMA |
| `Template Proposal Penelitian.docx` | Struktur proposal UAM |
| `Surat Pernyataan - Keterlibatan Mahasiswa dalam Penelitian Dosen.docx` | Surat keterlibatan mahasiswa |
| `Template Laporan Kemajuan Penelitian.docx` | Struktur laporan kemajuan |
| `Template Laporan Akhir Penelitian.docx` | Struktur laporan akhir |
| Format LPJ, nota, template PkM | Belum tersedia |

Simpan sumber asli tanpa mengubahnya dalam folder referensi lokal yang aksesnya terkontrol. Jangan menganggap file tersedia di VS Code sampai pemilik menyalinnya. Dokumen resmi mengungguli contoh simulasi di PRD. Inkonsistensi sumber wajib dilaporkan sebelum dinormalisasi.

## 4. Tech stack dan arsitektur

| Layer | Rancangan |
|---|---|
| Frontend | React 19 + TypeScript strict; Next.js 16 App Router (rekomendasi berdasarkan source DropX) |
| UI | Tailwind CSS v4, shadcn/ui, token visual DropX, Lucide, Recharts, Sonner |
| Editor | Tiptap; simpan JSON terstruktur, sanitasi saat render |
| Backend | Go + Gin REST API, GORM |
| Database | MySQL/MariaDB, kompatibilitas MariaDB 10.11 sebagai target awal; verifikasi instance aktual |
| Storage | Private local volume dahulu, abstraction untuk S3-compatible kemudian |
| Document engine | Modul Go untuk pemetaan data ke DOCX dan konversi PDF melalui worker/tool terisolasi yang diuji; library belum diputuskan |
| Deployment | Debian, Docker Compose, Nginx reverse proxy; HTTPS produksi |
| Queue/cache | Tidak wajib pada v0.1; Redis/Asynq opsional jika kebutuhan terukur |

Frontend tidak mengakses database langsung. Business logic dan otorisasi berada di Go. Next.js hanya presentation layer dan mekanisme rendering/proxy bila diperlukan. Gunakan satu origin untuk UI/API bila memungkinkan. Modul berinteraksi melalui service interface yang jelas, bukan mengakses tabel internal modul lain secara sembarangan. Hindari microservices sebelum ada kebutuhan nyata.

### 4.1 Source DropX yang diperiksa

Manifest menyebut Next.js 16.4.5, React 19.2.8, Tailwind v4, Redux Toolkit, Recharts, next-themes, Lucide React dan Sonner; engines Node >=20. Versi tersebut adalah deklarasi arsip, bukan bukti instalasi berhasil. Verifikasi lockfile, runtime dan dependency resolution; gunakan package manager sesuai lockfile. Source belum diuji build. Baca `AGENTS.md` bawaan: `app/(admin)/`, `app/(auth)/`, `config/navigation.ts`, `config/site.ts`, `components/ui/`, `components/layout/`, `app/globals.css`, `lib/chart-theme.ts`, `data/`. Gunakan token tema, pola PageHeader, aksesibilitas dan konvensi App Router. Jangan membuat dua set komponen yang berkonflik saat memasukkan shadcn/ui. Ganti data mock dengan API secara bertahap dan hilangkan menu demo yang tidak relevan.

**Lisensi:** pertahankan LICENSE dan copyright asli. UI wajib menampilkan kredit yang terbaca dan dapat diklik `Designed & developed by DataDropX` menuju https://datadropx.net (misalnya footer). Jangan menjual ulang template asli atau modifikasi ringan sebagai template berbayar. Produk aplikasi komersial diperbolehkan sesuai syarat lisensi.

### 4.2 Struktur repository usulan

```text
simp2m/
├── PRD.md
├── README.md
├── .env.example
├── backend/
│   ├── cmd/api/
│   ├── internal/core/          # config, DB, HTTP, auth context
│   ├── internal/modules/       # auth, institutions, users, roles, masterdata,
│   │                           # grants, proposals, reviews, documents,
│   │                           # projects, logbook, reports, outputs, finance
│   ├── internal/shared/
│   └── migrations/
├── frontend/                   # adaptasi source DropX, pertahankan App Router
│   ├── app/(admin)/
│   ├── app/(auth)/
│   ├── components/ui/
│   ├── components/layout/
│   ├── config/
│   ├── modules/
│   └── lib/
├── references/                 # dokumen asli, jangan commit jika sensitif
├── docs/                       # ADR, API contract, ERD, changelog
└── docker-compose.yml
```

Struktur ini usulan; adaptasikan dengan repository aktual. File upload berada di volume privat, bukan direktori publik frontend.

## 5. Pengguna, RBAC, Superuser, dan Trial Mode

Superadmin adalah system role permanen dan wajib ada. Minimal satu akun Superadmin aktif harus selalu tersedia. Bootstrap melalui command/secret environment; tidak boleh ada password default publik. Superadmin dapat mengelola institusi, role, permission, pengguna, seluruh modul, dan audit. Jangan menghapus atau menonaktifkan Superadmin aktif terakhir, termasuk melalui operasi paralel.

| Role | Fungsi utama |
|---|---|
| Superadmin | Akses platform dan pengujian seluruh fungsi |
| Admin LPPM | Master data, periode, seleksi administrasi, penugasan, operasional |
| Dosen | Proposal, persetujuan anggota, logbook, laporan, luaran |
| Reviewer | Review proposal/monev/laporan sesuai penugasan |
| Kepala LPPM | Persetujuan dan penetapan sesuai workflow |
| Kaprodi / Dekan | Persetujuan dan monitoring lingkup unit bila diperlukan |
| Keuangan | Kontrak keuangan, pencairan, realisasi/LPJ |
| Pimpinan / SPMI | Analitik dan indikator mutu sesuai permission |
| Administrator institusi | Opsional untuk pengembangan multi-institusi |

Role selain Superadmin dapat dikonfigurasi. Satu akun dapat memiliki beberapa role dan lingkup institusi/unit. Gunakan permission granular seperti `masterdata.manage`, `proposal.create`, `proposal.submit`, `proposal.approve`, `review.assess`, `grant.award`, `document.generate`, `audit.read`. Registry permission berasal dari kemampuan yang benar-benar diimplementasikan; admin dapat menyusun role dari registry tersebut. Menu disaring sesuai role, tetapi backend wajib memeriksa permission dan ownership setiap request.

**Role Switcher:** Superadmin dapat berganti tampilan/role aktif tanpa login ulang dan melakukan pengujian sebagai Dosen, Admin LPPM, Reviewer, pemberi persetujuan, dan role lainnya. Dalam trial, ia bisa menjalankan satu siklus lengkap dengan satu akun. Rekomendasi: sandbox eksplisit, data terisolasi (database terpisah atau tenant trial yang benar-benar terisolasi), badge mode aktif, notifikasi eksternal dinonaktifkan, data trial tidak masuk statistik produksi. Pelonggaran konflik kepentingan hanya di sandbox. Audit menyimpan aktor asli, role efektif, mode, institusi, aksi, waktu dan objek. Produksi tetap menegakkan penugasan dan konflik kepentingan; akses luas Superadmin tidak berarti persetujuan palsu atau menyamar tanpa jejak.

## 6. Modul dan prioritas

| ID | Modul | Prioritas |
|---|---|---|
| M01 | Core, autentikasi, organisasi, branding | v0.1 |
| M02 | Users, RBAC, Role Switcher, audit, trial | v0.1 |
| M03 | Master Data | v0.1 dasar; diperluas v0.2 |
| M04 | Periode hibah, konfigurasi skema, eligibilitas | v0.2 |
| M05 | Proposal Builder, tim, RAB, jadwal, luaran | v0.3 |
| M06 | Document Engine dan surat mahasiswa | v0.3 |
| M07 | Approval, seleksi, review, penetapan | v0.4 |
| M08 | Kontrak, pencairan, registrasi eksternal | v0.5 |
| M09 | Proyek aktif dan catatan harian | v0.6 |
| M10 | Laporan kemajuan, monev, tindak lanjut | v0.6 |
| M11 | Laporan akhir, luaran, penutupan | v0.7 |
| M12 | LPJ dan bukti nota | Tertunda hingga template diterima |
| M13 | Dashboard kinerja, SPMI, laporan ekspor | v0.8 |
| M14 | PkM, integrasi, fitur lanjutan | Bertahap, kebutuhan khusus belum final |

## 7. Master Data dan manajemen hibah

Master data memiliki CRUD, kode/nama, status aktif, pencarian, filter, pagination, audit; import/export Excel merupakan usulan pengembangan. Data yang sudah dirujuk transaksi tidak boleh dihapus permanen. Jangan menyimpan seluruh master ke satu tabel generik tanpa relasi dan constraint yang diperlukan.

| Kelompok | Data |
|---|---|
| Organisasi | Institusi, fakultas, prodi, unit, pejabat dan masa jabatan |
| SDM | Dosen, mahasiswa, reviewer eksternal, jabatan fungsional, pendidikan, identitas NIDN/NUPTK/NIM |
| Hibah | Sumber dana, kelompok skema, skema penelitian/PkM, kategori Lab/Non-Lab |
| Klasifikasi | Bidang riset, bidang fokus, tema, topik, rumpun ilmu hierarkis, makro riset, bidang strategis, TKT, SDGs (opsional per skema) |
| Luaran | Kelompok, jenis, target status, bukti yang diperlukan |
| Anggaran | Kelompok dan komponen RAB, satuan, standar biaya, aturan biaya |
| Dokumen | Jenis, template, versi, status publikasi |

Master skema tidak dibuat ulang tiap tahun. Hubungkan periode dengan skema melalui entitas konfigurasi skema-periode berversi; sumber pendanaan merupakan atribut periode/konfigurasi, bukan batasan permanen pada definisi skema. Admin mengatur tahun usulan/pelaksanaan/anggaran, tanggal buka-tutup, pagu, kuota, durasi, syarat ketua/anggota, batas jumlah proposal, mahasiswa, luaran, RAB, template, rubrik, tahapan persetujuan dan jadwal. Versi aturan yang digunakan proposal harus dapat ditelusuri dan tidak berubah retroaktif.

Skema awal yang terdapat pada template UAM: Penelitian Dosen Pemula, Penelitian Dasar Pratama, Penelitian Dasar Utama, Penelitian Terapan, Penelitian Unggulan. Bidang riset awal (template halaman 2): Pengembangan Analisa Klinik; Pengembangan Sumber Daya Alam sebagai bahan baku obat; Pengembangan Healthcare untuk Penanganan Kesehatan; Pengembangan Ekonomi Kreatif; Pengembangan Digitalisasi Data Informasi dan Aplikasi. Jadikan seed editable per institusi, bukan enum permanen. Pagu dan kuota aktual belum ditentukan; jangan seed nominal simulasi sebagai kebijakan resmi.

Eligibility engine: tampilkan aturan, hasil lulus/gagal/belum dapat diverifikasi, dan alasan. Syarat dapat meliputi status dosen aktif, identitas, jabatan, kuota ketua/anggota, tanggungan luaran, mahasiswa, dan SINTA bila data tersedia. Periksa di backend pada pemilihan dan submit, dengan transaksi untuk kuota. Aturan yang tidak dapat diverifikasi memerlukan verifikasi manual sesuai konfigurasi, bukan otomatis lulus.

## 8. Proposal Builder — kebutuhan fungsional

Dosen mengisi proposal langsung di sistem melalui wizard bertahap, bukan hanya upload PDF. Autosave, progress, navigasi antarbagian, validasi per bagian dan submit, preview, riwayat versi. Simpan data terstruktur dan isi rich text; draft boleh belum lengkap, submit wajib lengkap. Gunakan optimistic locking atau mekanisme revisi untuk mencegah tab saling menimpa.

| Langkah | Field dan fungsi |
|---|---|
| 1. Skema | Periode, skema, sumber dana, eligibilitas |
| 2. Identitas | Judul, bidang riset, objek, lokasi, mulai/akhir, instansi lain dan kontribusi, temuan target, jurnal sasaran; klasifikasi BIMA opsional sesuai skema |
| 3. Tim | Ketua, anggota dosen, identitas, keahlian, jam/minggu, tugas, mahasiswa, bentuk keterlibatan, judul tugas akhir jika ada, persetujuan anggota |
| 4. Roadmap | Narasi dan upload JPG/PNG |
| 5. Ringkasan | Maksimal satu halaman pada output; lima kata kunci dominan ditambah kata kunci SDGs sesuai template |
| 6. Pendahuluan | Maksimal 1.000 kata; latar belakang, rumusan masalah, pendekatan, state of the art, kebaruan |
| 7. Tinjauan pustaka | Referensi primer relevan; 10 tahun terakhir disarankan, bukan hard block |
| 8. Metode | Proses, luaran, indikator, penanggung jawab per tahapan, diagram alir JPG/PNG |
| 9. Hasil diharapkan | Narasi dan target luaran terstruktur, jenis/status/tahun target |
| 10. RAB | Rincian item, justifikasi, kuantitas, satuan, harga, subtotal, kategori, total |
| 11. Jadwal | Tahapan terhubung metode dan durasi; tabel/Gantt per bulan; template contoh 8 bulan bukan batas global |
| 12. Daftar pustaka | Editor referensi dan format sesuai kebijakan yang dikonfirmasi |
| 13. Preview & submit | Rangkuman, dokumen, validasi, pernyataan, submit dan nomor usulan |

Cover, pengesahan, tabel identitas, ringkasan RAB dan lampiran justifikasi dihasilkan dari input yang sama. Format template proposal Tahoma 11 spasi 1,15. Hitung batas kata dari teks editor, bukan markup; batas halaman diperiksa di hasil render. Persetujuan anggota melalui akun masing-masing merupakan usulan; mahasiswa tidak otomatis membutuhkan akun. Perubahan tim setelah persetujuan memerlukan persetujuan ulang sesuai workflow.

### 8.1 RAB Builder

| Kelompok | Lab | Non-Lab |
|---|---:|---:|
| Bahan Habis Pakai | 50% | 30% |
| Penggandaan | 10% | 30% |
| Peralatan Penunjang | 30% | 20% |
| Lain-lain | 10% | 20% |
| Total | 100% | 100% |

Sumber: template proposal halaman 8 dan lampiran halaman 10–11; juga laporan kemajuan. Honor pelaksana tidak diperkenankan pada template tersebut. **Tertunda:** apakah persentase adalah alokasi tepat atau batas maksimum; admin harus dapat memilih mode aturan setelah konfirmasi. Jangan menebak mode sebagai kebijakan aktif. Validasi pagu dan standar biaya di backend, gunakan DECIMAL atau integer rupiah, bukan float untuk uang. Total dihitung server; simpan usulan, anggaran disetujui dan realisasi secara terpisah. Lampiran otomatis dari rincian yang sama.

### 8.2 Surat keterlibatan mahasiswa

Generate dari template satu halaman: identitas ketua (nama, NIK/NUPTK, prodi/fakultas), tabel nama/NIM/bentuk keterlibatan, judul/skema/sumber dana/tahun anggaran, tabel nama/NIM/judul tugas akhir/tanda tangan, tanggal, ketua peneliti dan pejabat LPPM. Jumlah baris mengikuti data aktual. Tidak mengarang judul TA atau menempelkan tanda tangan palsu. Nama pejabat dan tahun dinamis; bentuk pengesahan final tertunda.

## 9. Workflow, review dan pendanaan

Internal: periode dibuka → draft → persetujuan tim bila diwajibkan → submit → verifikasi administrasi/persetujuan institusi → review substansi → revisi bila perlu → keputusan pendanaan → proyek/kontrak → pencairan → logbook → laporan kemajuan/monev → laporan akhir/luaran → penutupan.

Eksternal: registrasi usulan → verifikasi/persetujuan internal → pengajuan ke penyandang dana di luar sistem → pencatatan hasil dengan bukti → registrasi kontrak dan monitoring. LPPM tidak menetapkan hasil seleksi pihak eksternal. Jangan mengklaim integrasi BIMA otomatis.

Simpan status proposal, persetujuan, keputusan pendanaan, proyek, dokumen dan laporan secara terpisah. Status proposal usulan: `draft`, `submitted`, `admin_revision`, `admin_verified`, `under_review`, `review_revision`, `review_completed`, `rejected_admin`, `withdrawn`. Keputusan: `pending`, `funded`, `not_funded`. Nama UI berbahasa Indonesia. Status final dan transisi mengikuti workflow berversi. Setiap transisi memvalidasi kondisi, permission, lingkup, deadline, alasan, versi data, dan menulis audit dalam transaksi. Tidak ada endpoint edit status arbitrer.

Reviewer: penugasan internal/eksternal, kesediaan, kompetensi, konflik kepentingan, deadline, rubrik berversi dengan indikator/bobot/skala, komentar per komponen dan rekomendasi. Bobot harus valid; skor dihitung backend berdasarkan formula yang dipublikasikan. Review independen; reviewer hanya melihat yang ditugaskan, komentar internal dipisahkan dari yang dapat dilihat pengusul. Keputusan pendanaan merupakan tindakan pejabat berwenang, bukan otomatis dari skor. Blind review opsional; pastikan dokumen juga tidak membocorkan identitas jika mode diaktifkan. Jumlah reviewer, ambang batas, urutan Kaprodi/Dekan/LPPM dan aturan revisi masih perlu konfirmasi.

Kontrak dan pencairan: konversi proposal didanai menjadi proyek secara idempoten, template kontrak/surat tugas, nomor, nilai disetujui, termin yang dapat dikonfigurasi, bukti transfer, amandemen dengan riwayat. Tidak ada persentase termin baku sampai ditetapkan.

## 10. Pelaksanaan dan Report Builder

### 10.1 Catatan harian

Hanya tercatat di sistem; tidak wajib generate dokumen logbook. Field usulan: tanggal, tahap dari jadwal, uraian, hasil, pelaksana, progres, kendala opsional, lampiran foto/file. Ketua/anggota berwenang dapat mencatat; LPPM dan reviewer yang ditugaskan dapat membaca. Riwayat perubahan, filter tanggal/tahap, dan keterkaitan dengan proyek. Jangan menganggap jumlah catatan sebagai persentase keberhasilan; progres berdasarkan indikator yang ditentukan.

### 10.2 Laporan kemajuan

Mengikuti `Template Laporan Kemajuan Penelitian.docx` (6 halaman): cover, pengesahan, A Pendahuluan (maks. 1.000 kata), B Metode dan diagram, C Kemajuan Penelitian (75%) dengan tabel tahapan/target hasil/hasil dicapai, D Rencana Tahapan yang Akan Dikerjakan, E Anggaran Biaya (25%), F Daftar Pustaka. Angka 75%/25% adalah label template; jangan menyimpulkan otomatis sebagai bobot penilaian atau syarat pencairan tanpa konfirmasi. RAB mengacu pada data yang disetujui, realisasi hanya jika diminta kebijakan. Dosen dapat menyalin bagian relevan dari snapshot proposal dan mengedit laporan tanpa mengubah proposal. Catatan harian membantu mengisi capaian, bukan menghasilkan klaim otomatis. Monev mendukung rubrik, komentar, revisi dan tindak lanjut.

### 10.3 Laporan akhir

Mengikuti `Template Laporan Akhir Penelitian.docx` (7 halaman): cover, pengesahan ketua/anggota, judul dan nama peneliti, abstrak (Tahoma 10; latar belakang, tujuan, metode, hasil, kesimpulan), 3–5 kata kunci; A Pendahuluan (maks. 1.000 kata), B Tinjauan Pustaka, C Metode/diagram, D Hasil dan Pembahasan, E Kesimpulan dan Saran, F Daftar Pustaka; lampiran L.1 Laporan Penggunaan Dana dan L.2 Poster Penelitian JPG. Narasi bagian utama Tahoma 11 spasi 1,15. Tabel penggunaan dana memuat kebutuhan, justifikasi, jumlah, harga, total harga. Realisasi harus berdasarkan input aktual, bukan salinan RAB yang diklaim sebagai pengeluaran.

### 10.4 LPJ dan luaran

LPJ nota/bukti transaksi: **format menyusul**. Sediakan extension point finance, jangan membuat format final atau aturan pajak/reimbursement sendiri. Luaran: target dan aktual, jenis, metadata, status, bukti, kontributor, tahun, verifikasi; publikasi, HKI, buku, produk/prototipe, dan luaran PkM. Penutupan kegiatan mengikuti persyaratan laporan dan luaran terverifikasi; luaran yang belum jatuh tempo dapat dipantau terpisah sesuai kebijakan.

## 11. Document Template Engine

Satu engine reusable untuk proposal, surat mahasiswa, laporan kemajuan, laporan akhir, dan kelak kontrak/LPJ. Admin mengelola DOCX template dan versi, mapping placeholder, tabel berulang, gambar, page break, logo, pejabat, format tanggal/uang dan tahun. Template bukan kode executable; validasi placeholder terhadap schema yang diizinkan. Simpan sumber template, versi, snapshot input, hasil DOCX/PDF, checksum dan metadata generate. Draft boleh digenerate ulang; versi submitted/approved bersifat immutable dan revisi menghasilkan versi baru. Preview PDF dan download dengan otorisasi. Uji visual terhadap template asli (header, footer, logo, tabel, font, pagination). Gunakan font berlisensi; jika Tahoma tidak tersedia, laporkan sebelum substitusi. Persetujuan digital workflow berbeda dari tanda tangan elektronik tersertifikasi; mekanisme TTE/scan belum ditetapkan.

Inkonsistensi sumber yang harus dikonfirmasi: NIDN vs NUPTK/NIK, tahun statis 2025/2026/2027, Plt. Kepala LPPM vs Kepala LPPM, teks daftar pustaka menyebut PkM pada template penelitian, APA style sekaligus urutan pengutipan, typo judul roadmap. Jangan diam-diam mengubah template asli.

## 12. UI/UX dan navigasi

Visual DropX dengan shadcn/ui: sidebar collapsible, header, breadcrumb, role switcher, theme light/dark/system, kartu statistik, tabel responsif, wizard, accordion rangkuman, loading/skeleton, empty/error states, konfirmasi tindakan destruktif, notifikasi, keyboard accessibility. Gunakan token tema dan branding dinamis institusi. Bahasa UI Indonesia; tanggal lokal Asia/Jakarta, rupiah IDR; simpan waktu server dalam UTC. Jangan membuat semua submenu menjadi halaman kosong berlabel selesai; fitur belum tersedia disembunyikan atau diberi status belum aktif.

Menu Superadmin: Dashboard, Institusi, Pengguna & Role, Master Data, Hibah, Penelitian, PkM (belum aktif), Dokumen, Laporan, Audit, Pengaturan. Dosen: Dashboard, Profil, Penelitian (Usulan, Bimbingan Teknis opsional, Perbaikan Usulan, Catatan Harian, Laporan Kemajuan, Laporan Akhir, Capaian Luaran), Pendanaan Eksternal, Dokumen. LPPM: Hibah, Verifikasi, Penugasan Reviewer, Penetapan, Monitoring, Luaran, Laporan. Reviewer: Penugasan, Review, Monev, Riwayat. Menu lain mengikuti permission. Bimbingan teknis belum dibahas detail; jangan mengimplementasikan workflow tanpa kebutuhan.

## 13. Model data konseptual (bukan DDL final)

| Domain | Entitas utama |
|---|---|
| Tenant & IAM | institutions, faculties, study_programs, units, users, memberships, roles, permissions, role_permissions, user_role_assignments, sessions |
| SDM | lecturer_profiles, student_profiles, reviewer_profiles, official_assignments |
| Master & hibah | funding_sources, scheme_groups, schemes, grant_periods, grant_scheme_versions, eligibility_rules, classifications, output_types, budget_categories, budget_rules |
| Usulan | proposals, proposal_versions, proposal_sections, proposal_members, member_consents, proposal_students, proposed_outputs, budget_items, milestones, attachments |
| Seleksi | workflow_versions, workflow_transitions, approval_records, reviewer_assignments, rubric_versions, rubric_items, reviews, review_scores, funding_decisions |
| Pelaksanaan | projects, contracts, disbursements, logbook_entries, progress_reports, final_reports, monitoring_reviews, corrective_actions, research_outputs |
| Dokumen | document_templates, template_versions, generated_documents, files |
| Platform | audit_events, notifications, institution_settings |

Gunakan foreign key, unique constraints, index berdasar pola akses, `created_at`, `updated_at`, actor, version jika relevan. Semua data tenant-owned membawa institution_id langsung atau melalui relasi yang tidak ambigu; gunakan composite constraint bila diperlukan untuk mencegah referensi silang tenant. User global dapat memiliki membership beberapa institusi. File key, cache, job dan ekspor selalu scoped. MariaDB tidak memiliki RLS setara PostgreSQL; enforcement wajib di service/repository dan diuji. Jangan mengandalkan filter UI. JSON untuk konfigurasi/isi editor, data yang dibutuhkan relasi dan analitik tetap terstruktur. ERD final dibuat per modul sebelum migrasi.

## 14. API dan non-functional requirements

REST `/api/v1`; contoh domain endpoint (usulan): `/auth/login`, `/auth/refresh`, `/auth/logout`, `/me`, `/me/active-role`, `/users`, `/roles`, `/permissions`, `/master-data/...`, `/grant-periods`, `/grant-schemes`, `/proposals`, `/proposals/{id}/submit`, `/proposals/{id}/approvals`, `/reviews`, `/projects/{id}/logbook`, `/documents/{id}/download`. Gunakan OpenAPI/kontrak terdokumentasi, pagination, filter, field-level errors, request ID, status HTTP yang tepat. Mutasi penting transactional dan idempoten bila relevan; jangan menerima institution_id/actor dari request tanpa validasi konteks server.

Keamanan: Argon2id atau alternatif kuat yang terdokumentasi; access/refresh token dengan rotasi dan pencabutan sesi, cookie HttpOnly/Secure/SameSite bila cookie-based, proteksi CSRF sesuai desain, rate limit login, HTTPS, validasi input, sanitasi rich text, SQL parameterized, CORS ketat, upload allowlist MIME/ukuran dan pemindaian sesuai kesiapan, unduhan privat. Audit append-only untuk aksi penting; jangan log password, token atau isi rahasia. Backup database dan file, verifikasi restore, retensi dan kebijakan privasi perlu ditetapkan. Tidak ada AI eksternal yang menerima proposal tanpa izin. Target performa/SLA dan kapasitas belum diukur; gunakan pagination, query indexes dan ukur beban sebelum menetapkan angka. Aksesibilitas: label form, fokus, keyboard, kontras, responsive tanpa overflow kecuali tabel yang perlu scroll.

## 15. Roadmap dan acceptance criteria

| Versi | Deliverable / kriteria kelulusan |
|---|---|
| 0.1 Foundation | DropX berjalan; login/logout; bootstrap Superadmin; CRUD users/roles/permissions/institusi; role switcher; sandbox atau test environment terisolasi; master data dasar; navigasi sesuai hak akses; DB persisten; audit; smoke test dan uji akses negatif |
| 0.2 Grants | Admin membuat master skema dan periode, versi aturan, jadwal dan pagu; dosen melihat hasil eligibilitas; perubahan periode baru tidak mengubah histori |
| 0.3 Proposal | Wizard lengkap, autosave, tim, RAB/jadwal/luaran, upload, validasi submit; DOCX/PDF proposal dan surat sesuai template; draft dapat dilanjutkan |
| 0.4 Review | Transisi sah, review berbobot, konflik kepentingan, revisi dan penetapan terdokumentasi; pengguna tak berwenang ditolak |
| 0.5 Funding | Konversi proyek tanpa duplikasi, kontrak/termin sesuai aturan, registrasi eksternal dengan bukti |
| 0.6 Monitoring | Logbook digital, laporan kemajuan, monev, revisi dan tindak lanjut; data proposal tidak tertimpa |
| 0.7 Final | Laporan akhir dan poster, lampiran dana, target/aktual luaran, verifikasi dan penutupan |
| 0.8 Analytics | Filter tahun, skema, unit, sumber dana; agregasi dari data valid; data trial dikecualikan; definisi indikator terdokumentasi |
| 0.9+ | UAT, security, restore test, LPJ jika template tersedia, PkM dan integrasi sesuai prioritas |
| 1.0 | Siklus penelitian lengkap yang disetujui pemilik; cakupan PkM dan LPJ dikonfirmasi sebelum klaim rilis siklus lengkap |

### Definition of Done setiap modul

1. Requirement dan perubahan scope terdokumentasi; migrasi berversi dan diuji pada DB development.
2. Backend unit/integration test, termasuk forbidden access, tenant isolation, dan transisi invalid yang relevan.
3. Frontend lint, typecheck, build dan smoke test; alur loading, empty, error dan responsive diuji.
4. API contract, cara menjalankan, konfigurasi, dan changelog diperbarui; tidak ada secret atau data asli di fixture.
5. Demo end-to-end oleh Superadmin dalam sandbox; pemilik menyetujui sebelum modul berikutnya.

## 16. Instruksi pengerjaan pertama — v0.1 saja

1. Inventaris repository, source DropX dan dokumen. Periksa `package.json`, lockfile, AGENTS.md, LICENSE, Node/Go/DB runtime. Catat blocker dependency, jangan upgrade mayor diam-diam.
2. Adaptasi DropX dengan branding SIM-P2M, menu minimal, tema, layout dan kredit lisensi. Jalankan build dasar sebelum perubahan besar.
3. Buat backend Go modular, config environment, health endpoint, koneksi MariaDB, migrasi awal dan `.env.example`.
4. Implementasi institusi/membership, bootstrap Superadmin permanen, auth/session, registry permission, role assignment dan audit. Uji last-superadmin guard dan tenant isolation.
5. Hubungkan login dan layout ke API nyata. Implementasi role switcher dan lingkungan trial terpisah; role yang belum mempunyai fitur tidak boleh menghasilkan aksi palsu.
6. Buat master data dasar organisasi, SDM, sumber dana, kelompok skema, skema dan bidang riset; master lainnya ditambah bersama modul terkait. Gunakan seed idempoten, tanpa nominal kebijakan rekaan.
7. Jalankan `go test ./...`, lint/typecheck/build frontend sesuai package manager, migrasi dan smoke test. Dokumentasikan hasil yang benar-benar terjadi. Berhenti setelah v0.1 siap direview.

Deployment awal disarankan lokal/dev Docker. Jika menggunakan MariaDB existing, buat database dan user khusus (nama usulan `simp2m_db`); jangan gunakan root aplikasi, jangan expose DB ke publik atau mengubah schema aplikasi lain. Host/port/kredensial dan kapasitas server harus diverifikasi oleh pemilik, tidak diasumsikan dari percakapan lama.

## 17. Keputusan tertunda / backlog brainstorming

- Pagu/kuota/eligibilitas resmi per skema, mode persentase RAB, batas biaya, termin pencairan.
- Urutan approval per skema, jumlah reviewer, formula/ambang rubrik, persetujuan tim, revisi, SOP banding atau penarikan.
- Mekanisme pengesahan/tanda tangan, nomenklatur identitas dan perbaikan inkonsistensi template.
- Format LPJ dan nota, template kontrak, template PkM serta kebutuhan khusus mitra/dampak.
- Integrasi SIAKAD/Simpeg/SINTA/BIMA: API dan izin belum dipastikan. AI assistant, portal publik, roadmap prodi, bimbingan teknis, dan indikator PPEPP dinamis adalah backlog.
- Finalisasi strategi document engine, format referensi, retensi, backup, kapasitas, SLA, domain/hosting, dan acceptance UAT.

## 18. Prompt awal untuk coding agent

> Baca PRD.md dan AGENTS.md pada repository. Pelajari source DropX dan file referensi yang tersedia. Gunakan Go + Gin + GORM, MySQL/MariaDB, React/Next.js + TypeScript, Tailwind dan shadcn/ui, modular monolith. Pertahankan lisensi DropX. Mulai hanya v0.1 Core Foundation sebagaimana bagian 16. Sebelum coding, buat rencana implementasi, daftar file dan migrasi, dan laporkan blocker. Jangan mengimplementasikan modul hibah/proposal/laporan/LPJ sekaligus. Gunakan data trial terisolasi, backend authorization dan audit. Setelah selesai, jalankan pengujian yang relevan, laporkan hasil aktual, perbarui README/changelog, lalu berhenti untuk review pemilik produk.

---
**Akhir PRD.** Perbarui versi dan changelog keputusan setiap kali brainstorming modul menghasilkan persetujuan baru. Dokumen ini tidak menggantikan kebijakan resmi institusi.

