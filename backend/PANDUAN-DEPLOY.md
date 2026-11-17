# Panduan Setup Backend (sekali saja, ±15 menit, semua gratis)

Ada dua bagian:
1. **Database akun** -> Supabase (login, daftar, panel admin, hak akses).
2. **Deep Search** -> Google Apps Script (butuh akses Google Drive), memverifikasi login lewat Supabase.

## 1. Database (Supabase)
1. Buat akun di https://supabase.com lalu **New project** (paket Free). Catat database password-nya.
2. Buka **SQL Editor > New query**, tempel seluruh isi `backend/database.sql`, klik **Run**.
   Aman dijalankan ulang. Ini membuat tabel, fungsi `guma_api`, akun `admin`, dan hak akses awal.
3. Buka **Project Settings > API**. Salin:
   - **Project URL** -> `SUPABASE_URL` di `js/config.js`
   - **anon public key** -> `SUPABASE_ANON_KEY` di `js/config.js`
   - Jangan pakai/menaruh `service_role` di mana pun di web.
4. Buka **Authentication > Sign In / Providers**: tidak perlu diubah (web tidak memakai Supabase Auth).
5. Login admin pertama: username `admin`, sandi `admin123` (web akan mengingatkan agar diganti).
   > Selama sandi ini belum diganti, siapa pun yang tahu bisa masuk sebagai admin. Ganti segera setelah deploy.

Batas paket Free: 500 MB database, 50.000 pengguna aktif/bulan. 500 akun dan 200 orang bersamaan masih sangat longgar.
Catatan: proyek Free yang tidak ada aktivitas ±7 hari akan di-pause; klik **Restore** di dashboard.

## 2. Deep Search (Apps Script)
1. Buka proyek Apps Script Gumateri yang sudah ada (berisi `java.js` / Kode.gs).
2. Tambah file baru `DeepSearch`, tempel isi `backend/DeepSearch.gs`.
   (File lama `Auth.gs` sudah dihapus dari repo: tidak dipakai lagi. Jangan tempel ke Apps Script.)
3. **Project Settings > Script properties**, tambahkan:
   - `SUPABASE_URL` = Project URL tadi
   - `SUPABASE_ANON_KEY` = anon public key tadi
4. **Deploy > New deployment > Web app**: Execute as **Me**, Who has access **Anyone**. Salin URL `/exec`.
   Setiap `DeepSearch.gs` / `Kode.gs` diubah, buat **New version** pada deployment.
5. Isi `APPS_SCRIPT_URL` di `js/config.js` dengan URL itu. Login diverifikasi di server, jadi URL ini tidak bisa dipakai tanpa akun sah.

## Mengatur
- Hak akses fitur & akun: Panel Admin di web.
- Tutup pendaftaran mandiri: ubah batas di `guma.f_register` (database.sql), atau hapus tab Daftar.
- Batas Deep Search: `DS_CFG` di `DeepSearch.gs` (jeda per pengguna, cache hasil).
