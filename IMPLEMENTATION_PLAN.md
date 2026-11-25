# Rencana Implementasi SIM-P2M

Target pertama adalah rilis lokal **v0.1 Foundation** untuk Universitas Anwar Medika. Demo pertama berfokus pada Superadmin yang bisa masuk, melihat dashboard SIM-P2M, dan keluar. Setelah alur itu lulus, lanjutkan ke pengelolaan akses, lingkungan trial, dan master data dasar. [PRD](prd.md)

## Posisi saat ini

| Bagian | Status |
| --- | --- |
| Frontend | DropX sudah diimpor. Halaman awal SIM-P2M dan kredit DataDropX tersedia. Instalasi, lint, typecheck, dan build sudah lulus. |
| Backend | Go/Gin berjalan. `go test ./...` lulus dan `GET /api/v1/health` sudah mengembalikan `{"status":"ok"}` lewat HTTP. |
| Database | MariaDB 10.11.20 terpasang di instance lokal terpisah pada port 3316. Enam migrasi lulus pada database kosong dan dijalankan ulang tanpa perubahan skema. |

## Tahapan v0.1

### 1. Database pengembangan dan migrasi · M01

- [x] Siapkan instance MariaDB 10.11 untuk pengembangan. Gunakan database `simp2m_dev` dan akun khusus SIM-P2M. Simpan DSN secara lokal. Pisahkan akses migrasi dan akses runtime.
- [x] Tetapkan cara menjalankan migrasi berversi dan mencatat versi skema. Terapkan migrasi institusi, pengguna, membership, peran sistem, sesi, dan audit.
- [x] Catat konfigurasi lokal, urutan migrasi, dan perintah verifikasi di README. Berkas utama ada di `backend/migrations/`, `backend/internal/core/database/`, dan `.env.example`.

**Lulus saat** database baru bisa dimigrasikan dari nol, menjalankan migrasi ulang tidak mengulang perubahan, dan API bisa terhubung dengan akun khusus. Gunakan instance atau layanan yang terpisah dari database aplikasi XAMPP lain.

### 2. Bootstrap Superadmin dan autentikasi · M01

- [x] Buat perintah bootstrap yang membuat institusi awal UAM dan Superadmin secara transaksional. Ambil kata sandi dari input privat dan simpan sebagai hash Argon2id. Jalankan ulang bootstrap untuk memastikan akun tidak terduplikasi atau kata sandinya direset.
- [x] Implementasikan login, refresh sesi, logout, dan `/api/v1/me`. Terapkan rotasi refresh token, pencabutan sesi, pengaturan cookie sesuai lingkungan, proteksi CSRF, pembatasan login, dan audit autentikasi.
- [x] Adaptasi formulir DropX menjadi login SIM-P2M. Hubungkan UI ke API Go, tampilkan pesan saat kredensial salah, lindungi dashboard, dan tampilkan identitas pengguna dari `/me`. Pertahankan kredit DataDropX dan keluarkan navigasi demo dari alur utama.
- [x] Pemilik membuat akun Superadmin di `simp2m_dev` dan meninjau demo M01 sebelum M02.

Migrasi sesi diterapkan di `simp2m_dev`. Tes integrasi MariaDB dan uji browser lulus memakai akun sintetis pada skema uji terpisah. Lint, typecheck, dan build frontend juga lulus.

**Lulus saat** Superadmin bisa login, membuka dashboard, dan logout dalam satu demo browser. Kredensial salah, sesi kedaluwarsa, akses langsung tanpa sesi, serta penggunaan ulang token yang sudah dicabut ditolak. Pemilik proyek meninjau M01 sebelum M02.

### 3. Pengguna, RBAC, audit, dan trial · M02

- [x] Bangun pengelolaan institusi, akun, membership, role, dan assignment. Registry izin mencakup `iam.read`, `iam.manage`, dan `audit.read`. Backend memeriksa akses berdasarkan institusi dan UI menampilkan kontrol sesuai izin.
- [x] Lindungi Superadmin aktif terakhir secara transaksional. Simpan audit aksi penting dengan aktor asal, role efektif, institusi, mode, tindakan, dan waktu.
- [x] Tambahkan switcher untuk Trial Pengelola dan Trial Pembaca. Keduanya membaca dan menulis melalui database trial terpisah sesuai izin masing-masing serta menampilkan indikator mode pada UI.
- [x] Pemilik meminta untuk melanjutkan dari M02 ke M03.

Migrasi 000008–000010 diterapkan pada database operasional dan trial. Uji integrasi MariaDB lulus untuk akses lintas institusi, penolakan mutasi oleh Trial Pembaca, isolasi data trial, serta perlindungan Superadmin terakhir pada permintaan paralel. Uji browser dengan akun sintetis lulus untuk login, halaman pengelolaan, pembuatan institusi trial, audit, pergantian ke Trial Pembaca, dan kembali ke mode operasional.

**Lulus saat** aksi tanpa izin dan akses silang institusi ditolak, operasi paralel tetap menyisakan Superadmin aktif, serta data trial tidak muncul dalam data produksi. Pemilik proyek meninjau M02 sebelum M03.

### 4. Master data dasar · M03

- [x] Master data dasar tersedia untuk fakultas, prodi, unit, dosen, mahasiswa, reviewer, sumber dana, kelompok skema, skema, dan bidang riset.
- [x] Pencarian, filter, paginasi, status aktif, dan audit tersedia. Seed awal UAM diterapkan dengan lima skema dan lima bidang riset.

Migrasi 000011–000021 diterapkan pada database operasional dan trial. Uji migrasi pada database kosong dan eksekusi ulang lulus. Uji integrasi membuktikan penolakan relasi dan akses lintas institusi, penolakan penulisan tanpa izin, audit, paginasi, serta isolasi trial. Uji browser lulus untuk tambah fakultas dan prodi di trial, edit, pencarian data nonaktif, dan pergantian ke mode baca saja serta operasional.

**Lulus saat** Superadmin bisa mengelola master data dari UI, relasi antardata tervalidasi, dan akun tanpa izin ditolak oleh API.

### Review rilis v0.1

Jalankan `go test ./...`, lint, typecheck, build frontend, dan smoke test browser. Uji migrasi database baru, hak akses negatif, isolasi institusi, isolasi trial, dan guard Superadmin terakhir. Perbarui README, changelog, dan kontrak API dengan hasil aktual. Tunjukkan demo lokal untuk persetujuan pemilik sebelum memulai v0.2.

Status lokal · `go test ./...`, lint, typecheck, build frontend, dan uji browser lulus. Rilis v0.1 siap direview sebelum v0.2.

## Urutan setelah v0.1

| Versi | Hasil yang dapat didemokan |
| --- | --- |
| v0.2 | Admin mengatur periode dan versi skema hibah. Dosen melihat eligibilitas berdasarkan aturan resmi. |
| v0.3 | Dosen menyusun proposal, tim, RAB, jadwal, dan luaran, lalu menghasilkan DOCX/PDF dan surat mahasiswa sesuai template UAM. |
| v0.4 | Usulan melewati persetujuan, seleksi, review, revisi, dan penetapan sesuai SOP yang disetujui. |
| v0.5 | Usulan yang didanai menjadi proyek dengan kontrak dan pencairan sesuai aturan. |
| v0.6 | Proyek memiliki logbook, laporan kemajuan, monev, dan tindak lanjut. |
| v0.7 | Tim mengirim laporan akhir dan luaran untuk verifikasi dan penutupan proyek. |
| v0.8 | LPPM dan pimpinan melihat dashboard kinerja dan ekspor sesuai izin. |
| v0.9+ | Laksanakan UAT, pengujian keamanan dan pemulihan. Jadwalkan LPJ dan PkM setelah format serta kebutuhan resminya tersedia. |

### Status Hibah v0.2

Migrasi 000024–000025 diterapkan pada database operasional dan trial. Uji API dan browser lulus untuk pembuatan periode, koreksi jadwal sebelum terbit, penguncian jadwal setelah terbit, riwayat versi skema, pembatasan akses, dan kelayakan awal. Pemeriksaan otomatis mencakup status dosen aktif berdasarkan email yang unik dalam institusi. Syarat lain dapat dicatat untuk verifikasi LPPM. Penetapan pagu, kuota, dan syarat pengusul dilakukan oleh pengelola pada periode masing-masing.

### Status Usulan Penelitian M05

Migrasi 000026–000028 diterapkan pada database operasional dan trial. Wizard usulan memuat skema, identitas, tim, narasi, gambar, target luaran, RAB, jadwal, dan pratinjau browser. Uji integrasi memeriksa akses pemilik, konflik revisi, pergantian versi skema, verifikasi manual, dan penguncian usulan setelah dikirim. Uji browser mencakup pembuatan draf, simpan otomatis, unggah gambar privat, pengiriman, dan tampilan baca saja.

Narasi saat ini berupa teks. Editor berformat, persetujuan tim lewat akun masing-masing, serta pembuatan DOCX/PDF dan surat mahasiswa masih perlu dituntaskan sebelum v0.3 direview sebagai rilis Proposal lengkap.
