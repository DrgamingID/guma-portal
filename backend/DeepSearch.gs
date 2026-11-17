/**
 * ============================================================================
 * GUMA PORTAL - JEMBATAN DEEP SEARCH (DeepSearch.gs)
 * Tambahkan file ini ke proyek Apps Script YANG SAMA dengan Kode.gs (java.js):
 * ia memakai searchFullText(), syncFolderWithAuth(), dan CONFIG dari file itu.
 *
 * Alur: web (hosting statis) -> POST ke Web App ini membawa token sesi ->
 * skrip memverifikasi token ke database Supabase -> baru menjalankan pencarian.
 * Jadi hanya pengguna yang sudah login dan berhak ke Gumateri yang bisa mencari.
 *
 * Pengaturan (Project Settings > Script properties):
 *   SUPABASE_URL       contoh: https://abcdxyz.supabase.co
 *   SUPABASE_ANON_KEY  kunci "anon public" (BUKAN service_role)
 * ============================================================================
 */

const DS_CFG = {
  VERIFY_CACHE_SECONDS: 60,   // hasil verifikasi token di-cache agar hemat panggilan ke Supabase
  MIN_GAP_SECONDS: 3,         // jeda minimum antar pencarian per pengguna
  RESULT_CACHE_SECONDS: 600   // kata kunci yang sama dipakai ulang 10 menit (hemat kuota Drive)
};

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return ds_json_({ success: false, error: 'Permintaan tidak valid.' }); }
  try { return ds_json_(ds_handle_(req || {})); }
  catch (err) {
    Logger.log(err && err.stack || err);
    return ds_json_({ success: false, error: 'Terjadi kesalahan server.' });
  }
}

function ds_json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function ds_handle_(req) {
  const action = String(req.action || ''), d = req.data || {};
  const me = ds_verify_(String(req.token || ''));
  if (!me) return { success: false, error: 'Sesi tidak valid atau sudah berakhir. Silakan masuk kembali.', code: 'UNAUTH' };
  if (!me.canGumateri) return { success: false, error: 'Anda tidak punya akses ke Gumateri.', code: 'FORBIDDEN' };

  if (action === 'deepSearch') {
    const cache = CacheService.getScriptCache();
    const gapKey = 'ds_gap:' + me.id;
    if (cache.get(gapKey)) return { success: false, error: 'Terlalu cepat. Tunggu beberapa detik lalu coba lagi.' };
    cache.put(gapKey, '1', DS_CFG.MIN_GAP_SECONDS);

    const kw = String(d.keyword || '').trim();
    const rkey = 'ds_res:' + ds_sha_(kw.toLowerCase());
    const hit = cache.get(rkey);
    if (hit) return JSON.parse(hit);

    const r = searchFullText(kw);                 // dari Kode.gs
    if (r && r.success) {
      try { cache.put(rkey, JSON.stringify(r), DS_CFG.RESULT_CACHE_SECONDS); } catch (err) { /* terlalu besar: abaikan */ }
    }
    return r;
  }

  if (action === 'sync') {
    if (me.role !== 'admin') return { success: false, error: 'Hanya admin yang boleh menyinkronkan.', code: 'FORBIDDEN' };
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return { success: false, error: 'Sinkronisasi lain sedang berjalan. Coba lagi nanti.' };
    try { return syncFolderWithAuth(String(d.pin || '')); }   // dari Kode.gs (tetap meminta PIN)
    finally { lock.releaseLock(); }
  }

  return { success: false, error: 'Aksi tidak dikenal.' };
}

/**
 * Verifikasi token sesi ke Supabase (aksi 'me' pada fungsi guma_api).
 * Mengembalikan {id, role, canGumateri} atau null bila token tidak sah.
 */
function ds_verify_(token) {
  if (!token || token.length < 32) return null;
  const cache = CacheService.getScriptCache();
  const ckey = 'ds_v:' + ds_sha_(token);
  const cached = cache.get(ckey);
  if (cached) return JSON.parse(cached);

  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
  const key = props.getProperty('SUPABASE_ANON_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY belum diisi di Script properties.');

  const res = UrlFetchApp.fetch(url + '/rest/v1/rpc/guma_api', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: JSON.stringify({ p_action: 'me', p_token: token, p_data: {} })
  });
  if (res.getResponseCode() !== 200) throw new Error('Supabase HTTP ' + res.getResponseCode());
  const body = JSON.parse(res.getContentText());
  if (!body.ok) return null;                      // token tidak sah: jangan di-cache

  const u = body.user, roles = (body.access && body.access.gumateri) || [];
  const me = {
    id: u.id,
    role: u.role,
    canGumateri: u.role === 'admin' || u.role === 'guma' || roles.indexOf(u.role) >= 0
  };
  cache.put(ckey, JSON.stringify(me), DS_CFG.VERIFY_CACHE_SECONDS);
  return me;
}

function ds_sha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
