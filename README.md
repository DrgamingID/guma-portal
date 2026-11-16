# GUMA Portal

Portal digital civitas Matematika IPB (Gumatika): login 4 tingkatan (Admin, Member Guma, CiviMat, Mahasiswa) dan fitur **Gumateri** (katalog modul & arsip ujian).

Situs statis (HTML/CSS/JS), tanpa build step.

## Status
Pra-rilis / prototipe. Akun disimpan **lokal di browser masing-masing** (bukan database bersama), sehingga:
- Akun yang dibuat di satu perangkat tidak muncul di perangkat lain.
- Belum aman untuk data sungguhan. Jangan memakai kata sandi yang Anda pakai di tempat lain.

Akun awal (per browser): `admin` / `admin123` - akan diminta diganti.

## Struktur
- `index.html`, `css/style.css`, `js/*.js` - aplikasi
- `backend/Auth.gs` - backend akun Apps Script (opsional, belum dipakai)
