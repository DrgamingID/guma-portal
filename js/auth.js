/* =========================================================
   AUTH CLIENT
   ---------------------------------------------------------
   Dua mode dengan antarmuka identik:
   - REMOTE : SUPABASE_URL + SUPABASE_ANON_KEY terisi -> memanggil fungsi guma_api()
              di database Supabase (backend/database.sql). Mode untuk dipakai bersama.
   - LOKAL  : kosong -> "server tiruan" di browser (localStorage).
              Hanya untuk demo/pengembangan, TIDAK aman.
   Semua keputusan hak akses yang sebenarnya dibuat oleh server; sisi klien
   hanya menyembunyikan tampilan.
   ========================================================= */
const Auth = (() => {
  const CFG = window.GUMA_CONFIG || {};
  const SB_URL = String(CFG.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const SB_KEY = String(CFG.SUPABASE_ANON_KEY || '').trim();
  const SCRIPT_URL = String(CFG.APPS_SCRIPT_URL || '').trim();
  const REMOTE = !!(SB_URL && SB_KEY);
  const TOKEN_KEY = 'guma.token.v1';

  const ROLES = {
    admin:     { label: 'Admin',        desc: 'Mengelola seluruh fitur, akun, dan hak akses' },
    guma:      { label: 'Member Guma',  desc: 'Mengakses seluruh fitur web' },
    civimat:   { label: 'CiviMat',      desc: 'Mahasiswa Matematika, fitur lebih luas' },
    mahasiswa: { label: 'Mahasiswa',    desc: 'Akses fitur dasar' }
  };
  const ROLE_KEYS = Object.keys(ROLES);
  const CONFIGURABLE_ROLES = ['mahasiswa', 'civimat'];

  /* ---------- State cache (agar UI bisa membaca sinkron) ---------- */
  let cache = { user: null, access: {} };
  let defaults = {};

  /* ---------- Token ---------- */
  const tokenStore = {
    get() { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } },
    set(t, persist) { try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); (persist ? localStorage : sessionStorage).setItem(TOKEN_KEY, t); } catch (e) { /* ignore */ } },
    clear() { try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } }
  };

  /* ---------- Transport ---------- */
  const NET_ERR = { ok: false, error: 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.', code: 'NETWORK' };

  async function rpc(action, data) {
    const token = tokenStore.get();
    if (!REMOTE) return LocalServer.handle({ action, token, data: data || {} });
    try {
      const res = await fetch(SB_URL + '/rest/v1/rpc/guma_api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
        body: JSON.stringify({ p_action: action, p_token: token || null, p_data: data || {} })
      });
      if (!res.ok) return { ok: false, error: 'Server database sedang bermasalah (' + res.status + '). Coba lagi sebentar.', code: 'NETWORK' };
      return await res.json();
    } catch (e) {
      return NET_ERR;
    }
  }

  // Memanggil Apps Script (Deep Search / Sinkronisasi Drive). Token sesi dikirim agar Apps Script
  // bisa memverifikasinya ke database. text/plain menghindari preflight CORS.
  async function callScript(action, data) {
    if (!SCRIPT_URL) return { success: false, error: 'APPS_SCRIPT_URL belum diisi di js/config.js.', code: 'NOCONFIG' };
    try {
      const res = await fetch(SCRIPT_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
        body: JSON.stringify({ action, token: tokenStore.get(), data: data || {} })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: NET_ERR.error, code: 'NETWORK' };
    }
  }

  function applySession(r) {
    cache.user = r.user || null;
    cache.access = r.access || {};
  }

  /* ---------- API publik ---------- */
  function configure(featureDefaults) { defaults = featureDefaults || {}; }

  async function init() {
    if (!REMOTE) await LocalServer.ensureSeed();
    return refresh();
  }

  // Validasi ulang sesi ke server. Mengembalikan user atau null.
  async function refresh() {
    if (!tokenStore.get()) { cache = { user: null, access: {} }; return null; }
    const r = await rpc('me');
    if (r.ok) { applySession(r); return cache.user; }
    if (r.code === 'NETWORK') return cache.user; // jangan paksa keluar karena jaringan putus
    tokenStore.clear(); cache = { user: null, access: {} }; return null;
  }

  async function login(username, password, remember) {
    const r = await rpc('login', { username, password, remember: !!remember });
    if (!r.ok) return r;
    tokenStore.set(r.token, !!remember); applySession(r);
    return { ok: true, user: r.user };
  }
  const register = data => rpc('register', data);
  async function logout() { try { await rpc('logout'); } catch (e) { /* ignore */ } tokenStore.clear(); cache = { user: null, access: {} }; }
  async function changePassword(oldPassword, newPassword) {
    const r = await rpc('changePassword', { oldPassword, newPassword });
    if (r.ok) { const m = await rpc('me'); if (m.ok) applySession(m); }
    return r;
  }

  const current = () => cache.user;

  function getAccessMatrix() {
    const out = {};
    Object.keys(defaults).forEach(f => { out[f] = Array.isArray(cache.access[f]) ? cache.access[f] : defaults[f].slice(); });
    return out;
  }
  function canAccess(user, fid) {
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'guma') return true;
    return (getAccessMatrix()[fid] || []).includes(user.role);
  }

  /* ----- Admin ----- */
  async function adminList() { const r = await rpc('admin.list'); return r.ok ? r.users : []; }
  const adminCreateUser = d => rpc('admin.create', d);
  const adminUpdate = (id, patch) => rpc('admin.update', Object.assign({ id }, patch));
  const adminResetPassword = (id, password) => rpc('admin.resetPassword', { id, password });
  const adminDelete = id => rpc('admin.delete', { id });
  async function setAccess(feature, role, allowed) {
    if (!CONFIGURABLE_ROLES.includes(role)) return { ok: false, error: 'Peran ini selalu punya akses penuh.' };
    const set = new Set(getAccessMatrix()[feature] || []);
    allowed ? set.add(role) : set.delete(role);
    const roles = Array.from(set);
    const r = await rpc('admin.setAccess', { feature, roles });
    if (r.ok) cache.access[feature] = roles;
    return r;
  }

  const SCRIPT_READY = !!SCRIPT_URL;

  return { REMOTE, ROLES, ROLE_KEYS, CONFIGURABLE_ROLES, configure, init, refresh, login, register, logout, changePassword, current,
           getAccessMatrix, canAccess, adminList, adminCreateUser, adminUpdate, adminResetPassword, adminDelete, setAccess, callScript, SCRIPT_READY,
           api: rpc };   // pemanggil generik untuk fitur lain (Forum, Peminjaman)
})();


/* =========================================================
   SERVER TIRUAN LOKAL (hanya untuk mode demo tanpa backend)
   Meniru perilaku backend/database.sql, data di localStorage.
   ========================================================= */
const LocalServer = (() => {
  const K = { users: 'guma.users.v1', sessions: 'guma.sessions.v2', access: 'guma.access.v1', lock: 'guma.lock.v1' };
  const SESSION_MS = 8 * 3600 * 1000, REMEMBER_MS = 14 * 24 * 3600 * 1000, MAX_FAILS = 5, LOCK_MS = 30000;
  const CONFIGURABLE = ['mahasiswa', 'civimat'];
  const ROLE_LIST = ['admin', 'guma', 'civimat', 'mahasiswa'];

  const get = (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (e) { return f; } };
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
  const hex = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); };
  const norm = s => String(s || '').trim().toLowerCase();
  const users = () => get(K.users, []);

  async function hashPw(password, salt) {
    if (window.crypto && crypto.subtle) {
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
      return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 2166136261; for (const b of new TextEncoder().encode(salt + ':' + password)) { h ^= b; h = Math.imul(h, 16777619) >>> 0; }
    return 'weak-' + h.toString(16);
  }
  const pub = u => ({ id: u.id, username: u.username, name: u.name, nim: u.nim, role: u.role, active: u.active, mustChange: u.mustChange, createdAt: u.createdAt });
  const pwErr = pw => (!pw || pw.length < 8) ? 'Kata sandi minimal 8 karakter.' : (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) ? 'Kata sandi harus memuat huruf dan angka.' : null;
  const newErr = d => !String(d.name || '').trim() ? 'Nama wajib diisi.' : !/^[a-z0-9._-]{3,24}$/.test(norm(d.username)) ? 'Username 3-24 karakter: huruf kecil, angka, titik, strip, atau garis bawah.' : pwErr(d.password);

  async function ensureSeed() {
    if (users().length) return;
    const salt = hex(16);
    set(K.users, [{ id: 'u_' + hex(6), username: 'admin', name: 'Administrator', nim: '', role: 'admin', salt, hash: await hashPw('admin123', salt), active: true, mustChange: true, createdAt: new Date().toISOString() }]);
  }

  const accessMap = () => get(K.access, {});
  function sessionUser(token) {
    if (!token) return null;
    const s = get(K.sessions, {})[token];
    if (!s || s.exp < Date.now()) return null;
    const u = users().find(x => x.id === s.uid);
    return u && u.active ? u : null;
  }
  const adminCount = l => l.filter(u => u.role === 'admin' && u.active).length;

  async function handle({ action, token, data: d }) {
    if (action === 'login') {
      const lk = get(K.lock, { fails: 0, until: 0 });
      if (lk.until > Date.now()) return { ok: false, error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil((lk.until - Date.now()) / 1000)} detik.` };
      const u = users().find(x => x.username === norm(d.username));
      const hash = u ? await hashPw(String(d.password || ''), u.salt) : null;
      if (!u || hash !== u.hash) {
        lk.fails++; if (lk.fails >= MAX_FAILS) { lk.until = Date.now() + LOCK_MS; lk.fails = 0; } set(K.lock, lk);
        return { ok: false, error: 'Username atau kata sandi salah.' };
      }
      if (!u.active) return { ok: false, error: 'Akun dinonaktifkan. Hubungi admin.' };
      set(K.lock, { fails: 0, until: 0 });
      const sessions = get(K.sessions, {}); const t = hex(24);
      Object.keys(sessions).forEach(k => { if (sessions[k].exp < Date.now()) delete sessions[k]; });
      sessions[t] = { uid: u.id, exp: Date.now() + (d.remember ? REMEMBER_MS : SESSION_MS) }; set(K.sessions, sessions);
      return { ok: true, token: t, user: pub(u), access: accessMap() };
    }
    if (action === 'register') {
      const e = newErr(d); if (e) return { ok: false, error: e };
      const list = users(); const un = norm(d.username);
      if (list.some(x => x.username === un)) return { ok: false, error: 'Username sudah dipakai.' };
      const salt = hex(16);
      list.push({ id: 'u_' + hex(6), username: un, name: String(d.name).trim(), nim: String(d.nim || '').trim(), role: 'mahasiswa', salt, hash: await hashPw(d.password, salt), active: true, mustChange: false, createdAt: new Date().toISOString() });
      set(K.users, list); return { ok: true };
    }

    const me = sessionUser(token);
    if (!me) return { ok: false, error: 'Sesi tidak valid atau sudah berakhir.', code: 'UNAUTH' };
    const list = users();

    switch (action) {
      case 'me': return { ok: true, user: pub(me), access: accessMap() };
      case 'logout': { const s = get(K.sessions, {}); delete s[token]; set(K.sessions, s); return { ok: true }; }
      case 'changePassword': {
        if (await hashPw(String(d.oldPassword || ''), me.salt) !== me.hash) return { ok: false, error: 'Kata sandi lama salah.' };
        const e = pwErr(d.newPassword); if (e) return { ok: false, error: e };
        const u = list.find(x => x.id === me.id); u.salt = hex(16); u.hash = await hashPw(d.newPassword, u.salt); u.mustChange = false;
        set(K.users, list); return { ok: true };
      }
    }

    if (action.startsWith('forum.') || action.startsWith('loan.')) return LocalExtra.handle(action, me, d, list, accessMap());

    if (action.startsWith('admin.')) {
      if (me.role !== 'admin') return { ok: false, error: 'Hanya admin yang boleh melakukan ini.' };
      const u = list.find(x => x.id === d.id);
      switch (action) {
        case 'admin.list': return { ok: true, users: list.map(pub) };
        case 'admin.create': {
          const e = newErr(d); if (e) return { ok: false, error: e };
          if (!ROLE_LIST.includes(d.role)) return { ok: false, error: 'Peran tidak valid.' };
          const un = norm(d.username); if (list.some(x => x.username === un)) return { ok: false, error: 'Username sudah dipakai.' };
          const salt = hex(16);
          list.push({ id: 'u_' + hex(6), username: un, name: String(d.name).trim(), nim: String(d.nim || '').trim(), role: d.role, salt, hash: await hashPw(d.password, salt), active: true, mustChange: true, createdAt: new Date().toISOString() });
          set(K.users, list); return { ok: true };
        }
        case 'admin.update': {
          if (!u) return { ok: false, error: 'Akun tidak ditemukan.' };
          if (d.role !== undefined) {
            if (!ROLE_LIST.includes(d.role)) return { ok: false, error: 'Peran tidak valid.' };
            if (u.role === 'admin' && d.role !== 'admin' && adminCount(list) <= 1) return { ok: false, error: 'Tidak bisa menurunkan admin terakhir.' };
            u.role = d.role;
          }
          if (d.active !== undefined) {
            if (!d.active && u.id === me.id) return { ok: false, error: 'Anda tidak dapat menonaktifkan akun sendiri.' };
            if (!d.active && u.role === 'admin' && adminCount(list) <= 1) return { ok: false, error: 'Tidak bisa menonaktifkan admin terakhir.' };
            u.active = !!d.active;
          }
          set(K.users, list); return { ok: true };
        }
        case 'admin.resetPassword': {
          if (!u) return { ok: false, error: 'Akun tidak ditemukan.' };
          const e = pwErr(d.password); if (e) return { ok: false, error: e };
          u.salt = hex(16); u.hash = await hashPw(d.password, u.salt); u.mustChange = true; set(K.users, list); return { ok: true };
        }
        case 'admin.delete': {
          if (!u) return { ok: false, error: 'Akun tidak ditemukan.' };
          if (u.id === me.id) return { ok: false, error: 'Anda tidak dapat menghapus akun sendiri.' };
          if (u.role === 'admin' && adminCount(list) <= 1) return { ok: false, error: 'Tidak bisa menghapus admin terakhir.' };
          set(K.users, list.filter(x => x.id !== u.id)); return { ok: true };
        }
        case 'admin.setAccess': {
          if (!/^[a-z0-9_-]{1,40}$/.test(String(d.feature || ''))) return { ok: false, error: 'Fitur tidak valid.' };
          const m = accessMap(); m[d.feature] = (Array.isArray(d.roles) ? d.roles : []).filter(r => CONFIGURABLE.includes(r)); set(K.access, m); return { ok: true };
        }
      }
    }
    return { ok: false, error: 'Aksi tidak dikenal.' };
  }
  return { handle, ensureSeed };
})();
