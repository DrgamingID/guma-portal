# Deploy Backend Akun (Apps Script) - OPSIONAL, SAAT INI TIDAK DIPAKAI

> Status: ditunda. Selama `API_URL` di `js/config.js` kosong, web memakai mode lokal
> dan file `Auth.gs` tidak diperlukan. Simpan sebagai opsi cadangan.

1. Buka proyek Apps Script Gumateri yang sudah ada (yang berisi `java.js` / Kode.gs).
2. Tambah file baru bernama `Auth`, tempel isi `backend/Auth.gs`.
3. Pilih fungsi **`authSetup`** di editor lalu klik **Run** (sekali saja). Setujui izin yang diminta.
   - Ini membuat spreadsheet PRIVAT "GUMA Portal - Auth DB" dan akun `admin`.
   - Buka **Execution log**: catat sandi sementara admin, lalu hapus lognya.
   - Jangan bagikan spreadsheet database akun itu ke siapa pun.
4. **Deploy > New deployment > Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Salin URL berakhiran `/exec`.
   - Setiap kali `Auth.gs` / `Kode.gs` diubah, buat **New version** pada deployment agar berlaku.
5. Isi `API_URL` di `js/config.js` dengan URL tersebut. Selesai.
6. Login sebagai `admin`, ganti sandi, lalu buat akun lain lewat Panel Admin.

## Mengunci katalog Gumateri (opsional, disarankan)
Dalam mode backend, katalog diambil lewat server yang memeriksa hak akses.
Setelah berjalan, ubah spreadsheet katalog dari "Siapa saja yang memiliki link"
menjadi **Terbatas**. Script tetap bisa membacanya karena berjalan sebagai pemilik.
(Selama sheet masih publik, orang yang tahu ID-nya tetap bisa membacanya langsung.)

## Pengaturan
Di `Auth.gs` bagian `AUTH_CFG`: lama sesi, batas gagal login, dan `OPEN_REGISTRATION`
(`false` = hanya admin yang bisa membuat akun).
Jika menambah fitur baru di `FEATURES` (js/app.js), tambahkan juga ke `AUTH_FEATURE_DEFAULTS`.
