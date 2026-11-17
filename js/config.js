/* Konfigurasi portal (lihat backend/PANDUAN-DEPLOY.md).
   SUPABASE_URL + SUPABASE_ANON_KEY : database akun bersama (Supabase). Kunci "anon" memang
                                      publik; jangan pernah menaruh kunci "service_role" di sini.
                                      Kosongkan salah satunya -> mode lokal/demo (akun hanya di browser).
   APPS_SCRIPT_URL                  : URL Web App Apps Script (berakhiran /exec) untuk Deep Search
                                      dan Sinkronisasi Drive. Kosong -> Deep Search tidak tersedia. */
window.GUMA_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  APPS_SCRIPT_URL: ''
};
