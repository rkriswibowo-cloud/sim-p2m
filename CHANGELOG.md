# Changelog

## v0.1 dalam pengembangan

- Mengimpor sumber DropX dari arsip yang disediakan beserta lisensi, instruksi, dan lockfile asli.
- Menginisialisasi repositori lokal dan menyiapkan API Go/Gin dengan endpoint `GET /api/v1/health`.
- Menambahkan konfigurasi koneksi MariaDB melalui GORM dan SQL awal untuk tabel institusi.
- Menambahkan halaman awal SIM-P2M dengan status API dan kredit DataDropX.
- Menambahkan perintah migrasi berversi serta skema awal pengguna, membership, peran sistem, sesi, dan audit.
- Menambahkan bootstrap Superadmin, autentikasi berbasis sesi, rotasi refresh token, serta halaman masuk dan dashboard SIM-P2M yang terhubung ke API.
- Menambahkan pengelolaan institusi, akun, membership dan role, pemeriksaan izin di backend, audit per institusi, serta switcher ke database trial.
- Menambahkan Master Data dasar organisasi, SDM, dan penelitian, termasuk validasi relasi institusi, pencarian, filter, paginasi, audit, dan seed awal UAM.
- Menambahkan hapus lunak dengan konfirmasi SweetAlert2, toast, dan ikon submenu Master Data.
- Menyederhanakan pengaturan hak akses menjadi matriks menu dengan paket izin dan pilihan per akun.
- Menambahkan Hibah v0.2 untuk periode, versi konfigurasi skema, sumber dana, dan pengecekan kelayakan awal.
- Menambahkan Usulan Penelitian M05 dengan wizard, simpan otomatis, gambar privat, verifikasi syarat, dan pengiriman dengan validasi pagu dan kuota.
- Mengaktifkan unduhan berizin untuk template penelitian serta draf laporan kemajuan dan akhir dari usulan yang telah dikirim.
- Menambahkan Pengaturan dengan preferensi tema dan sidebar yang tersimpan di browser, ringkasan akun, serta tautan administrasi untuk Superadmin.
