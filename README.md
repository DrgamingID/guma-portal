# GUMA Portal

Portal digital civitas Matematika IPB (Gumatika): login 4 tingkatan (Admin, Member Guma, CiviMat, Mahasiswa) dengan fitur **Gumateri** (katalog modul & arsip ujian, Deep Search isi PDF), **Forum Diskusi** (ruang General untuk semua tingkatan), dan **Peminjaman** (status ruangan/alat yang sedang dipakai Birdept atau perorangan).

Situs statis (HTML/CSS/JS), tanpa build step.

## Mode
- **Database bersama (disarankan):** isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di `js/config.js`. Akun tersimpan di Supabase.
- **Lokal/demo:** biarkan kosong. Akun hanya di browser masing-masing, tidak aman. Akun awal `admin` / `admin123`.

Panduan setup lengkap: `backend/PANDUAN-DEPLOY.md`.

## Struktur
- `index.html`, `css/style.css`, `js/*.js` - aplikasi
- `backend/database.sql` - skema & fungsi database (Supabase/PostgreSQL)
- `backend/DeepSearch.gs` - jembatan Apps Script untuk Deep Search dan Sinkronisasi Drive

## Menjalankan prototipe di GitHub Pages
1. Push ke GitHub, lalu **Settings > Pages > Build and deployment > Source: Deploy from a branch > `main` / `(root)`**.
2. Buka `https://<username>.github.io/guma-portal/`.
3. Biarkan `js/config.js` kosong: mode prototipe. Login `admin` / `admin123`, atau daftar akun baru. Akun hanya tersimpan di browser masing-masing.
4. Katalog Gumateri tetap dibaca dari Google Sheets (pastikan sheet "Siapa saja yang memiliki link"). Deep Search isi PDF dan Sinkronisasi Drive baru aktif setelah backend disetup (lihat `backend/PANDUAN-DEPLOY.md`); di prototipe, pencarian memakai judul/mata kuliah/semester.
