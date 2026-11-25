# SIM-P2M

Sistem Informasi Penelitian dan Pengabdian kepada Masyarakat untuk Universitas Anwar Medika. Spesifikasi produk ada di [PRD](prd.md).

Urutan pengerjaan dan kriteria lulus ada di [Rencana Implementasi](IMPLEMENTATION_PLAN.md).

## Fondasi v0.1

Mulai dengan M01. Halaman awal di `frontend/` menggunakan komponen DropX dan menampilkan status API Go. Lisensi dan kredit DataDropX mengikuti arsip asli. Halaman contoh DropX masih tersedia di sumber sebagai referensi pengembangan.

Backend dikembangkan di `backend/`. M01 mencakup koneksi MariaDB, migrasi berversi, bootstrap Superadmin, login, sesi, dan dashboard. M02 dan M03 mengikuti setelah demo M01 direview.

### Menjalankan API awal

```powershell
Set-Location 'C:\xampp\htdocs\sim-p2m\backend'
go test ./...
go run ./cmd/api
```

API lokal memakai `127.0.0.1:8080` secara default. Set `SIMP2M_HTTP_ADDR` untuk mengubah bind address. Endpoint `GET /api/v1/health` mengembalikan status proses. Masukkan konfigurasi sebagai environment variable di shell sesuai contoh `.env.example`.

### Menjalankan frontend

```powershell
Set-Location 'C:\xampp\htdocs\sim-p2m\frontend'
npm.cmd ci
npm.cmd run dev
```

Buka `http://localhost:3000`. Jika API memakai alamat lain, atur `SIMP2M_API_ORIGIN` di shell sebelum menjalankan frontend.

### Verifikasi awal

Build sumber DropX asli dan build halaman SIM-P2M lulus menggunakan Node.js 24.18.0 dan lockfile npm bawaan. Pengujian Go lulus pada Go 1.27.4. Uji HTTP langsung terhadap API lokal mengembalikan `{"status":"ok"}`.

### Lingkungan database

Target pengembangan adalah instance MariaDB 10.11 terpisah dari XAMPP, dengan database `simp2m_dev` dan port lokal `3316`. Gunakan `SIMP2M_MIGRATION_DSN` untuk akun migrasi dan `SIMP2M_DB_DSN` untuk akun runtime. Saat `SIMP2M_DB_DSN` diatur, API memverifikasi koneksi ketika startup.

Instalasi lokal MariaDB 10.11.20, direktori data, dan konfigurasi privat berada di `%LOCALAPPDATA%\SIM-P2M`. Bila database berhenti setelah restart Windows, jalankan perintah berikut di terminal database:

```powershell
$dbHome = Join-Path $env:LOCALAPPDATA 'SIM-P2M'
$data = Join-Path $dbHome 'data-10.11'
& (Join-Path $dbHome 'mariadb-10.11.20-winx64\bin\mariadbd.exe') --no-defaults "--datadir=$data" --bind-address=127.0.0.1 --port=3316 --default-time-zone=+00:00 --console
```

Dengan server database aktif, jalankan migrasi dari PowerShell:

```powershell
Set-Location 'C:\xampp\htdocs\sim-p2m\backend'
$config = Join-Path $env:LOCALAPPDATA 'SIM-P2M\dev.env'
$line = Get-Content -LiteralPath $config | Where-Object { $_ -like 'SIMP2M_MIGRATION_DSN=*' }
$env:SIMP2M_MIGRATION_DSN = ($line -split '=', 2)[1]
go run ./cmd/migrate
Remove-Item Env:SIMP2M_MIGRATION_DSN
```

Runner menjalankan satu pernyataan DDL per berkas `*.up.sql`, berdasarkan urutan nama, dan menyimpan statusnya di `schema_migrations`. Menjalankan ulang runner melewati migrasi yang sudah sukses. Jika statusnya `dirty`, periksa skema dan perbaiki migrasi secara terencana sebelum melanjutkan karena MariaDB dapat melakukan commit implisit untuk DDL.

Untuk menjalankan API dengan database, hentikan API lama dengan `Ctrl+C` jika masih memakai port `8080`, lalu jalankan:

```powershell
Set-Location 'C:\xampp\htdocs\sim-p2m'
.\scripts\start-api.ps1
```

Untuk login, gunakan skrip ini agar API membaca konfigurasi MariaDB lokal. Perintah `go run ./cmd/api` tanpa `SIMP2M_DB_DSN` hanya membuka endpoint status.

Akun runtime memiliki izin baca dan izin tulis terbatas pada tabel yang digunakan API. Izin audit bersifat tambah-saja. Jangan salin `dev.env` atau `admin.cnf` ke repositori.

### Membuat akun Superadmin pertama

Jalankan sekali saat database aktif dan migrasinya sudah diterapkan:

```powershell
Set-Location 'C:\xampp\htdocs\sim-p2m'
.\scripts\bootstrap-superadmin.ps1
```

Masukkan email, nama, dan kata sandi pilihan Anda melalui prompt PowerShell. Kata sandi disimpan sebagai hash Argon2id. Menjalankan ulang bootstrap dengan email yang sama mempertahankan akun dan kata sandi sebelumnya.

Jalankan API dengan konfigurasi database di atas, dan jalankan ulang frontend agar proxy API termuat. Buka [halaman masuk](http://localhost:3000/login). Dashboard terlindungi berada di `/simp2m`. Akses tanpa sesi mengarahkan ke halaman masuk.

Frontend meneruskan permintaan `/api/v1/*` ke Go sebagai satu origin. Origin yang diizinkan untuk autentikasi lokal adalah `http://localhost:3000`. Jika origin browser berbeda, sesuaikan `SIMP2M_WEB_ORIGIN` pada API. Untuk origin HTTPS, cookie sesi memakai atribut Secure. API menyediakan `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout` dan `GET /api/v1/me`.

Sesi akses berlaku 15 menit. Refresh token dirotasi hingga maksimal tujuh hari dari login dan keluarga sesi dicabut saat logout atau refresh token lama dipakai ulang. API membatasi percobaan login per proses dan mencatat login, refresh, logout, serta pemakaian ulang token di audit.

Uji Tahap 2 pada MariaDB 10.11.20 mencakup akses tanpa sesi, origin yang ditolak, kredensial salah, akses kedaluwarsa, rotasi dan pemakaian ulang refresh token, serta logout. Uji browser dengan akun sintetis juga lulus untuk login, dashboard, pembaruan sesi, dan logout.

### Pengguna, hak akses, dan trial

Masuk sebagai Superadmin dan pilih **Pengguna dan hak akses** di dashboard. Pilih institusi untuk mengelola akun, keanggotaan, role, dan audit. Role institusi dapat menggunakan `iam.read` untuk melihat pengaturan akses, `iam.manage` untuk menambah pengguna dan melihat pengaturan akses, serta `audit.read` untuk melihat audit institusi. Pengaturan role, perubahan akun global, dan perubahan hak Superadmin berada di bawah izin Superadmin.

Setiap baris pada **Pengguna & Role** mengatur izin satu akun di institusi terpilih. Ketika menambah pengguna, pilih satu atau beberapa paket izin (role). Centang akses mengikuti paket tersebut sampai diubah langsung untuk akun. Klik **Simpan izin** untuk memberlakukan centang, atau **Ikuti role lagi** untuk kembali memakai izin dari role. Akses Dashboard tersedia setelah login. Institusi dan akses penuh tetap merupakan wewenang Superadmin.

Migrasi matriks membutuhkan hak `CREATE VIEW` untuk akun migrasi. Akun runtime membutuhkan `SELECT` pada view izin efektif dan `SELECT, INSERT, DELETE` pada tabel `membership_permissions`. Hak ini sudah diberikan pada database lokal operasional dan trial.

Mode **Trial · Pengelola** dapat membuat dan mengubah data di `simp2m_dev_trial`. Mode **Trial · Pembaca** hanya dapat melihat data trial. Keduanya memakai sesi Superadmin yang sama dengan akses aktual yang diperiksa server. Audit trial mencatat peran efektif dan ID aktor asal. Basis data trial memakai runtime dan migrator terpisah. Saat menambah migrasi, jalankan runner satu kali dengan DSN migrasi operasional dan satu kali dengan `SIMP2M_TRIAL_MIGRATION_DSN` sebagai nilai `SIMP2M_MIGRATION_DSN`.

### Master Data

Pilih **Master Data** di dashboard. Daftar mencakup fakultas, prodi, unit, dosen, mahasiswa, reviewer, sumber dana, kelompok skema, skema, dan bidang riset. Pilih institusi dan jenis data untuk mencari, menyaring status, berpindah halaman, menambah, atau mengubah data. Gunakan status nonaktif untuk menyimpan histori. Perubahan muncul di audit institusi. Izin `masterdata.read` memberi akses baca dan `masterdata.manage` memberi akses tambah dan ubah.

Seed UAM memasukkan lima skema dan lima bidang riset dari template proposal, dengan kode lokal yang dapat diedit. Untuk database operasional baru, jalankan bootstrap UAM lebih dulu. Setelah migrasi, atur `SIMP2M_SEED_DSN` ke DSN migrasi operasional dan jalankan `go run ./cmd/seed-masterdata` dari folder `backend`. Runner seed mencatat eksekusi per institusi sehingga pengulangan mempertahankan perubahan manual. Data trial diisi melalui mode trial.

Endpoint `GET/POST /api/v1/iam/institutions/:institution/master-data/:kind` menampilkan dan menambah data. `PUT` pada path yang sama dengan akhiran `/:id` mengubah data. Daftar menerima `q`, `status` (`active` atau `inactive`), dan cursor `after`. Route trial menggunakan awalan `/api/v1/trial/:role/iam`.

Aksi **Hapus** menonaktifkan institusi, akun, keanggotaan, role, atau master data. Riwayat, relasi, dan audit tetap tersimpan. Untuk memulihkan data, gunakan **Sertakan data nonaktif** di pengaturan akses atau filter **Nonaktif** di Master Data, lalu aktifkan kembali lewat formulir. Penghapusan akun mencabut sesi aktif. Aksi ini memakai endpoint `DELETE` pada resource dan mengikuti izin serta perlindungan Superadmin.

### Hibah

Berikan **Lihat Hibah** kepada akun pengusul dan **Kelola Hibah** kepada pengelola LPPM lewat matriks akses. Dari **Hibah**, pengelola membuat periode dengan tahun usulan, pelaksanaan, anggaran, dan jadwal pendaftaran dalam WIB. Pilih skema dan sumber dana yang aktif di Master Data, lalu isi pagu, kuota kegiatan, durasi, serta persyaratan sebelum menerbitkan versi. Periode dapat dikoreksi sampai versi pertama terbit. Versi berikutnya menyimpan aturan baru sekaligus mempertahankan versi lama.

Pengusul melihat skema terbaru pada periode terbuka dan dapat memeriksa kelayakan awal. Syarat dosen aktif dicocokkan dengan email akun yang sama dan unik pada master Dosen institusi. Data yang tidak cocok atau tidak unik dan syarat manual memerlukan verifikasi LPPM. Kuota di sini adalah kuota kegiatan yang dikonfigurasi. Pemakaian kuota baru dapat dihitung ketika modul usulan tersedia.

API Hibah memakai awalan `/api/v1/iam/institutions/:institution/grants` untuk daftar, `/options` untuk pilihan aktif, `POST /periods` dan `PUT /periods/:id` untuk periode, `POST /periods/:id/versions` untuk penerbitan, serta `GET /versions/:id/eligibility` untuk kelayakan. Route trial memakai awalan IAM trial. Runtime perlu akses `SELECT, INSERT, UPDATE` pada periode dan `SELECT, INSERT` pada versi skema.

Hibah memiliki pengaturan periode terpisah untuk Penelitian dan Pengabdian kepada Masyarakat. Jalankan `seed-masterdata` untuk menyediakan skema PkM dan Sister School di UAM. Atur pagu setiap skema di periode dan tahun yang sesuai. Migrasi klasifikasi memerlukan izin `ALTER` pada `grant_periods` dan `schemes`.

### Usulan Penelitian

Berikan izin **Buat dan kirim Usulan Penelitian** untuk pengusul dan **Verifikasi syarat usulan** untuk petugas LPPM. Pengusul memilih skema yang sedang terbuka, membuat draf, dan mengisi wizard. Perubahan disimpan otomatis dengan pemeriksaan revisi. Jika skema berubah, pengusul dapat memilih **Gunakan versi skema terbaru** pada draf sebelum mengirim.

Server menghitung RAB dari kuantitas hingga tiga desimal dan harga rupiah bulat. Subtotal dibulatkan ke rupiah terdekat. Saat pengiriman, server memeriksa pagu, jadwal, syarat pengusul, dan kuota skema secara transaksional. Jika syarat perlu verifikasi manual, pengusul mengajukan verifikasi dan petugas LPPM mengonfirmasi pemeriksaan melalui antrean. Verifikasi berlaku untuk revisi yang diperiksa. Rekaman dosen nonaktif tetap menghasilkan penolakan.

Gambar roadmap dan metode diunggah sebagai JPG/PNG hingga 2 MB. Draf dan gambar hanya dapat diakses oleh pemilik akun pada institusi yang sama. Usulan yang sudah dikirim bersifat baca saja dan mempertahankan versi skema yang dipakai. Preview pada tahap ini berada di browser. Pembuatan DOCX/PDF dan surat mahasiswa masuk modul Document Engine.

Migrasi Penelitian membutuhkan `ALTER` pada `grant_scheme_versions` untuk akun migrasi serta `SELECT, INSERT, UPDATE` pada tabel `research_proposals` dan `research_proposal_images` untuk akun runtime.

Kategori pada tab RAB dan jadwal diambil dari **Master Data → Kategori RAB**. Superadmin dan admin dengan izin Kelola Master Data dapat menambah, mengubah, dan menonaktifkan kategori. Usulan yang sudah dikirim menyimpan nama kategori saat pengiriman. Jalankan `seed-masterdata` untuk mengisi empat kategori awal UAM. Akun runtime memerlukan akses `SELECT, INSERT, UPDATE` pada tabel `budget_categories` di database utama dan trial.

Menu **Pengabdian kepada Masyarakat** menyediakan draf usulan milik pengusul. Izin draf PkM dapat diatur melalui matriks Pengguna & Role. Tahap berikutnya mengikuti konfirmasi template dan ketentuan resmi PkM. Akun runtime memerlukan akses `SELECT, INSERT, UPDATE` pada tabel `community_proposals` di database utama dan trial.

Menu **Dokumen** menyediakan empat template penelitian asli melalui unduhan berizin. Simpan file DOCX di root proyek saat API dijalankan dari `backend`, atau tetapkan `SIMP2M_DOCUMENT_DIR` ke lokasi privat file. Menu **Laporan** menyediakan draf kemajuan dan akhir bagi pemilik usulan penelitian yang sudah mengirim usulan, dengan narasi awal yang dapat disalin dari usulan. Pengguna lain memerlukan izin masing-masing dari matriks Pengguna & Role. Akun runtime memerlukan `SELECT, INSERT, UPDATE` pada tabel `research_reports` di database utama dan trial.

Menu **Penelitian** memiliki tab Usulan, Catatan Harian, Laporan Kemajuan, dan Laporan Akhir. Pemilik usulan yang sudah dikirim dapat mengelola catatan harian. Tab laporan memakai draf yang sama dengan menu Laporan dan memerlukan izin Laporan pada institusi tersebut. Akun runtime memerlukan `SELECT, INSERT, UPDATE` pada tabel `research_journal` di database utama dan trial.

Migrasi 53–58 membutuhkan `ALTER` pada `research_journal`, `grant_periods`, `schemes`, dan `community_proposals`. Akun runtime membutuhkan `SELECT, INSERT` pada `research_journal_evidence` dan `SELECT, INSERT, UPDATE` pada `progress_report_uploads` di kedua database. Simpan PDF Laporan Kemajuan untuk membuka pencairan di atas 75% dari nilai kontrak. Rekap LPJ di draf Laporan Akhir membaca transaksi dan bukti dari Catatan Harian.
