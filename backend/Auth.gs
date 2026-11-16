/**
 * ============================================================================
 * GUMA PORTAL - BACKEND AKUN (Auth.gs)
 * Tambahkan file ini ke proyek Apps Script YANG SAMA dengan Kode.gs (java.js),
 * karena memakai getKatalogDataDirect_() dan CONFIG dari file tersebut.
 *
 * Database akun disimpan di spreadsheet PRIVAT terpisah (dibuat otomatis oleh
 * authSetup()). JANGAN pernah membagikan spreadsheet itu.
 * ============================================================================
 */

const AUTH_CFG = {
  SESSION_HOURS: 8,            // lama sesi biasa
  SESSION_HOURS_REMEMBER: 336, // lama sesi bila "ingat saya" (14 hari)
  HASH_ITERATIONS: 2000,       // iterasi SHA-256 (naikkan bila eksekusi masih cepat)
  MAX_FAILS: 5,                // gagal login berturut-turut sebelum dikunci
  LOCK_SECONDS: 300,           // lama kunci setelah terlalu banyak gagal
  OPEN_REGISTRATION: true,     // false = hanya admin yang bisa membuat akun
  MAX_REGISTER_PER_HOUR: 30    // batas pendaftaran global per jam
};

const AUTH_ROLES = ['admin', 'guma', 'civimat', 'mahasiswa'];
const AUTH_CONFIGURABLE = ['mahasiswa', 'civimat'];
// Harus sama dengan FEATURES di js/app.js
const AUTH_FEATURE_DEFAULTS = {
  gumateri: ['mahasiswa', 'civimat'],
  agenda: ['mahasiswa', 'civimat'],
  forum: ['civimat'],
  ruangguma: []
};

const USER_COLS = ['id', 'username', 'name', 'nim', 'role', 'salt', 'hash', 'active', 'mustChange', 'createdAt'];

/* ============================ SETUP (jalankan sekali) ============================ */
function authSetup() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('AUTH_DB_ID')) {
    Logger.log('Database akun sudah ada: ' + SpreadsheetApp.openById(props.getProperty('AUTH_DB_ID')).getUrl());
    return;
  }
  const ss = SpreadsheetApp.create('GUMA Portal - Auth DB (PRIVAT, jangan dibagikan)');
  const users = ss.getSheets()[0].setName('Users');
  users.getRange('A:J').setNumberFormat('@');
  users.getRange(1, 1, 1, USER_COLS.length).setValues([USER_COLS]).setFontWeight('bold');
  users.setFrozenRows(1);
  const sess = ss.insertSheet('Sessions');
  sess.getRange('A:B').setNumberFormat('@');
  sess.getRange(1, 1, 1, 3).setValues([['tokenHash', 'uid', 'exp']]).setFontWeight('bold');
  const acc = ss.insertSheet('Access');
  acc.getRange('A:B').setNumberFormat('@');
  acc.getRange(1, 1, 1, 2).setValues([['feature', 'roles']]).setFontWeight('bold');
  props.setProperty('AUTH_DB_ID', ss.getId());

  const tempPw = 'Gm' + Utilities.getUuid().replace(/-/g, '').slice(0, 10) + '9';
  const salt = randomHex_();
  appendUser_({
    id: 'u_' + randomHex_().slice(0, 12), username: 'admin', name: 'Administrator', nim: '', role: 'admin',
    salt: salt, hash: hashPw_(tempPw, salt), active: 'Y', mustChange: 'Y', createdAt: new Date().toISOString()
  });
  Logger.log('=== SETUP SELESAI ===');
  Logger.log('Database akun: ' + ss.getUrl());
  Logger.log('Login admin pertama -> username: admin | sandi sementara: ' + tempPw);
  Logger.log('Segera ganti sandi setelah login, lalu hapus log eksekusi ini.');
}

/* ============================ ENTRY POINT ============================ */
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: 'Permintaan tidak valid.' }); }
  try { return json_(handle_(req || {})); }
  catch (err) { Logger.log(err && err.stack || err); return json_({ ok: false, error: 'Terjadi kesalahan server.' }); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  const action = String(req.action || ''), d = req.data || {}, token = String(req.token || '');
  if (!PropertiesService.getScriptProperties().getProperty('AUTH_DB_ID')) return { ok: false, error: 'Backend belum disetup. Jalankan authSetup().' };

  if (action === 'login') return withLock_(() => login_(d));
  if (action === 'register') return withLock_(() => register_(d));

  const me = sessionUser_(token);
  if (!me) return { ok: false, error: 'Sesi tidak valid atau sudah berakhir.', code: 'UNAUTH' };

  switch (action) {
    case 'me': return { ok: true, user: pub_(me), access: accessMatrix_() };
    case 'logout': return withLock_(() => { deleteSession_(token); return { ok: true }; });
    case 'changePassword': return withLock_(() => changePassword_(me, d));
    case 'catalog': return catalog_(me);
  }

  if (action.indexOf('admin.') === 0) {
    if (me.role !== 'admin') return { ok: false, error: 'Hanya admin yang boleh melakukan ini.' };
    switch (action) {
      case 'admin.list': return { ok: true, users: readUsers_().map(pub_) };
      case 'admin.create': return withLock_(() => adminCreate_(d));
      case 'admin.update': return withLock_(() => adminUpdate_(me, d));
      case 'admin.resetPassword': return withLock_(() => adminReset_(d));
      case 'admin.delete': return withLock_(() => adminDelete_(me, d));
      case 'admin.setAccess': return withLock_(() => adminSetAccess_(d));
    }
  }
  return { ok: false, error: 'Aksi tidak dikenal.' };
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ============================ AKSI ============================ */
function login_(d) {
  const username = norm_(d.username), password = String(d.password || '');
  const cache = CacheService.getScriptCache();
  const failKey = 'fail:' + username, lockKey = 'lock:' + username;
  if (cache.get(lockKey)) return { ok: false, error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' };

  const u = readUsers_().filter(function (x) { return x.username === username; })[0];
  // Selalu hitung hash agar waktu respons tidak membocorkan keberadaan username
  const hash = hashPw_(password, u ? u.salt : 'x');
  if (!u || hash !== u.hash) {
    const n = Number(cache.get(failKey) || 0) + 1;
    if (n >= AUTH_CFG.MAX_FAILS) { cache.put(lockKey, '1', AUTH_CFG.LOCK_SECONDS); cache.remove(failKey); }
    else cache.put(failKey, String(n), AUTH_CFG.LOCK_SECONDS);
    return { ok: false, error: 'Username atau kata sandi salah.' };
  }
  if (u.active !== 'Y') return { ok: false, error: 'Akun dinonaktifkan. Hubungi admin.' };
  cache.remove(failKey);

  purgeExpiredSessions_();
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const hours = d.remember ? AUTH_CFG.SESSION_HOURS_REMEMBER : AUTH_CFG.SESSION_HOURS;
  appendSession_(sha_(token), u.id, Date.now() + hours * 3600 * 1000);
  return { ok: true, token: token, user: pub_(u), access: accessMatrix_() };
}

function register_(d) {
  if (!AUTH_CFG.OPEN_REGISTRATION) return { ok: false, error: 'Pendaftaran mandiri ditutup. Hubungi admin.' };
  const cache = CacheService.getScriptCache();
  const cnt = Number(cache.get('regcount') || 0);
  if (cnt >= AUTH_CFG.MAX_REGISTER_PER_HOUR) return { ok: false, error: 'Terlalu banyak pendaftaran. Coba lagi nanti.' };
  const err = validateNew_(d, true); if (err) return { ok: false, error: err };
  const username = norm_(d.username);
  if (readUsers_().some(function (x) { return x.username === username; })) return { ok: false, error: 'Username sudah dipakai.' };
  createUser_(username, d.name, d.nim, 'mahasiswa', d.password, false);
  cache.put('regcount', String(cnt + 1), 3600);
  return { ok: true };
}

function changePassword_(me, d) {
  if (hashPw_(String(d.oldPassword || ''), me.salt) !== me.hash) return { ok: false, error: 'Kata sandi lama salah.' };
  const e = validatePw_(d.newPassword); if (e) return { ok: false, error: e };
  const salt = randomHex_();
  updateUser_(me.id, { salt: salt, hash: hashPw_(d.newPassword, salt), mustChange: 'N' });
  return { ok: true };
}

function catalog_(me) {
  if (!canAccess_(me, 'gumateri')) return { ok: false, error: 'Anda tidak punya akses ke Gumateri.', code: 'FORBIDDEN' };
  const k = getKatalogDataDirect_(); // dari Kode.gs
  return { ok: true, data: k.data, semesters: k.semesters, courses: k.courses };
}

function adminCreate_(d) {
  const err = validateNew_(d, false); if (err) return { ok: false, error: err };
  if (AUTH_ROLES.indexOf(d.role) < 0) return { ok: false, error: 'Peran tidak valid.' };
  const username = norm_(d.username);
  if (readUsers_().some(function (x) { return x.username === username; })) return { ok: false, error: 'Username sudah dipakai.' };
  createUser_(username, d.name, d.nim, d.role, d.password, true);
  return { ok: true };
}

function adminUpdate_(me, d) {
  const list = readUsers_(), u = list.filter(function (x) { return x.id === d.id; })[0];
  if (!u) return { ok: false, error: 'Akun tidak ditemukan.' };
  const admins = list.filter(function (x) { return x.role === 'admin' && x.active === 'Y'; }).length;
  const patch = {};
  if (d.role !== undefined) {
    if (AUTH_ROLES.indexOf(d.role) < 0) return { ok: false, error: 'Peran tidak valid.' };
    if (u.role === 'admin' && d.role !== 'admin' && admins <= 1) return { ok: false, error: 'Tidak bisa menurunkan admin terakhir.' };
    patch.role = d.role;
  }
  if (d.active !== undefined) {
    if (!d.active && u.id === me.id) return { ok: false, error: 'Anda tidak dapat menonaktifkan akun sendiri.' };
    if (!d.active && u.role === 'admin' && admins <= 1) return { ok: false, error: 'Tidak bisa menonaktifkan admin terakhir.' };
    patch.active = d.active ? 'Y' : 'N';
  }
  updateUser_(u.id, patch);
  if (patch.active === 'N') deleteSessionsOf_(u.id);
  return { ok: true };
}

function adminReset_(d) {
  const e = validatePw_(d.password); if (e) return { ok: false, error: e };
  const u = readUsers_().filter(function (x) { return x.id === d.id; })[0];
  if (!u) return { ok: false, error: 'Akun tidak ditemukan.' };
  const salt = randomHex_();
  updateUser_(u.id, { salt: salt, hash: hashPw_(d.password, salt), mustChange: 'Y' });
  deleteSessionsOf_(u.id);
  return { ok: true };
}

function adminDelete_(me, d) {
  const list = readUsers_(), u = list.filter(function (x) { return x.id === d.id; })[0];
  if (!u) return { ok: false, error: 'Akun tidak ditemukan.' };
  if (u.id === me.id) return { ok: false, error: 'Anda tidak dapat menghapus akun sendiri.' };
  if (u.role === 'admin' && list.filter(function (x) { return x.role === 'admin' && x.active === 'Y'; }).length <= 1) return { ok: false, error: 'Tidak bisa menghapus admin terakhir.' };
  usersSheet_().deleteRow(u._row);
  deleteSessionsOf_(u.id);
  return { ok: true };
}

function adminSetAccess_(d) {
  const fid = String(d.feature || '');
  if (!/^[a-z0-9_-]{1,40}$/.test(fid)) return { ok: false, error: 'Fitur tidak valid.' };
  const roles = (Array.isArray(d.roles) ? d.roles : []).filter(function (r) { return AUTH_CONFIGURABLE.indexOf(r) >= 0; });
  const sh = dbSheet_('Access'), rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === fid) { sh.getRange(i + 1, 2).setValue(roles.join(',')); return { ok: true }; }
  }
  sh.appendRow([fid, roles.join(',')]);
  return { ok: true };
}

/* ============================ AKSES FITUR ============================ */
function accessMatrix_() {
  const out = {};
  Object.keys(AUTH_FEATURE_DEFAULTS).forEach(function (k) { out[k] = AUTH_FEATURE_DEFAULTS[k].slice(); });
  const rows = dbSheet_('Access').getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const fid = String(rows[i][0]);
    out[fid] = String(rows[i][1] || '').split(',').filter(function (r) { return AUTH_CONFIGURABLE.indexOf(r) >= 0; });
  }
  return out;
}
function canAccess_(user, fid) {
  if (user.role === 'admin' || user.role === 'guma') return true;
  return (accessMatrix_()[fid] || []).indexOf(user.role) >= 0;
}

/* ============================ DATA LAYER ============================ */
function db_() { return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('AUTH_DB_ID')); }
function dbSheet_(name) { return db_().getSheetByName(name); }
function usersSheet_() { return dbSheet_('Users'); }

function readUsers_() {
  const rows = usersSheet_().getDataRange().getValues(), out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const o = { _row: i + 1 };
    USER_COLS.forEach(function (c, j) { o[c] = String(rows[i][j]); });
    out.push(o);
  }
  return out;
}
function appendUser_(o) { usersSheet_().appendRow(USER_COLS.map(function (c) { return o[c]; })); }
function createUser_(username, name, nim, role, password, mustChange) {
  const salt = randomHex_();
  appendUser_({
    id: 'u_' + randomHex_().slice(0, 12), username: username, name: String(name).trim(), nim: String(nim || '').trim(),
    role: role, salt: salt, hash: hashPw_(password, salt), active: 'Y', mustChange: mustChange ? 'Y' : 'N', createdAt: new Date().toISOString()
  });
}
function updateUser_(id, patch) {
  const u = readUsers_().filter(function (x) { return x.id === id; })[0]; if (!u) return;
  const sh = usersSheet_();
  Object.keys(patch).forEach(function (k) { sh.getRange(u._row, USER_COLS.indexOf(k) + 1).setValue(patch[k]); });
}
function pub_(u) {
  return { id: u.id, username: u.username, name: u.name, nim: u.nim, role: u.role, active: u.active === 'Y', mustChange: u.mustChange === 'Y', createdAt: u.createdAt };
}

function appendSession_(tokenHash, uid, exp) { dbSheet_('Sessions').appendRow([tokenHash, uid, exp]); }
function sessionUser_(token) {
  if (!token || token.length < 32) return null;
  const th = sha_(token), rows = dbSheet_('Sessions').getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === th) {
      if (Number(rows[i][2]) < Date.now()) return null;
      const u = readUsers_().filter(function (x) { return x.id === String(rows[i][1]); })[0];
      return (u && u.active === 'Y') ? u : null;
    }
  }
  return null;
}
function deleteSession_(token) { deleteSessionRows_(function (r) { return String(r[0]) === sha_(token); }); }
function deleteSessionsOf_(uid) { deleteSessionRows_(function (r) { return String(r[1]) === uid; }); }
function purgeExpiredSessions_() { deleteSessionRows_(function (r) { return Number(r[2]) < Date.now(); }); }
function deleteSessionRows_(pred) {
  const sh = dbSheet_('Sessions'), rows = sh.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) if (pred(rows[i])) sh.deleteRow(i + 1);
}

/* ============================ UTIL ============================ */
function norm_(s) { return String(s || '').trim().toLowerCase(); }
function validatePw_(pw) {
  pw = String(pw || '');
  if (pw.length < 8) return 'Kata sandi minimal 8 karakter.';
  if (pw.length > 128) return 'Kata sandi terlalu panjang.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Kata sandi harus memuat huruf dan angka.';
  return null;
}
function validateNew_(d, isRegister) {
  const name = String(d.name || '').trim();
  if (!name || name.length > 80) return 'Nama wajib diisi (maks. 80 karakter).';
  if (!/^[a-z0-9._-]{3,24}$/.test(norm_(d.username))) return 'Username 3-24 karakter: huruf kecil, angka, titik, strip, atau garis bawah.';
  if (String(d.nim || '').length > 20) return 'NIM terlalu panjang.';
  return validatePw_(d.password);
}
function toHex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }
function sha_(s) { return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)); }
function randomHex_() { return sha_(Utilities.getUuid() + Utilities.getUuid() + Date.now()).slice(0, 32); }
function hashPw_(pw, salt) {
  let h = salt + ':' + pw;
  for (let i = 0; i < AUTH_CFG.HASH_ITERATIONS; i++) h = sha_(h + salt);
  return h;
}
