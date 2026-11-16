/* =========================================================
   GUMA PORTAL - App shell, router, tampilan
   ========================================================= */
const FEATURES = [
  { id: 'gumateri', title: 'Gumateri', icon: 'book', status: 'live', defaults: ['mahasiswa', 'civimat'],
    desc: 'Katalog modul, diktat, catatan, dan arsip UTS/UAS Matematika IPB.' },
  { id: 'agenda', title: 'Agenda & Kegiatan', icon: 'calendar', status: 'soon', defaults: ['mahasiswa', 'civimat'],
    desc: 'Kalender kegiatan, kepanitiaan, dan pengumuman prodi.' },
  { id: 'forum', title: 'Forum Diskusi', icon: 'chat', status: 'soon', defaults: ['civimat'],
    desc: 'Ruang tanya jawab dan diskusi khusus CiviMat.' },
  { id: 'ruangguma', title: 'Ruang Member Guma', icon: 'shield', status: 'soon', defaults: [],
    desc: 'Area internal untuk Member Guma.' }
];
const DEFAULTS = Object.fromEntries(FEATURES.map(f => [f.id, f.defaults]));

const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  admin: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'
};
const icon = (n, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${ICONS[n] || ''}</svg>`;
const esc = s => s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const $ = id => document.getElementById(id);
const roleBadge = r => `<span class="role-badge role-${esc(r)}">${esc(Auth.ROLES[r] ? Auth.ROLES[r].label : r)}</span>`;
const roleHint = f => {
  const roles = ['Admin', 'Member Guma'].concat(Auth.CONFIGURABLE_ROLES.filter(r => (Auth.getAccessMatrix(DEFAULTS)[f.id] || []).includes(r)).map(r => Auth.ROLES[r].label));
  return roles.join(', ');
};

const App = (() => {
  let user = null;
  let ticker = null;

  /* ---------- Toast & modal ---------- */
  function toast(msg, kind) {
    const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
    $('toasts').appendChild(t); setTimeout(() => t.remove(), 4800);
  }
  function openModal(html) {
    const root = $('modalRoot'); root.innerHTML = `<div class="modal-box">${html}</div>`;
    root.classList.add('show'); document.body.classList.add('modal-open');
    const first = root.querySelector('input,select'); if (first) first.focus();
    return root;
  }
  function closeModal() { $('modalRoot').classList.remove('show'); $('modalRoot').innerHTML = ''; document.body.classList.remove('modal-open'); }

  /* ---------- Auth screen ---------- */
  const FORMULAS = ['e^{iπ} + 1 = 0', '∫₀^∞ e^{-x²} dx = √π / 2', 'Σ 1/n² = π² / 6', '∇ · E = ρ / ε₀', 'lim (1 + 1/n)ⁿ = e', 'a² + b² = c²'];
  function startTicker() {
    const el = $('eqTicker'); if (!el || ticker) return;
    let i = 0, j = 0, del = false;
    ticker = setInterval(() => {
      const s = FORMULAS[i];
      if (!del) { j++; el.textContent = s.slice(0, j); if (j === s.length) { del = true; j = s.length + 18; } }
      else { j--; if (j <= s.length) el.textContent = s.slice(0, Math.max(j, 0)); if (j <= 0) { del = false; i = (i + 1) % FORMULAS.length; j = 0; } }
    }, 70);
  }

  function showAuth(tab) {
    user = null;
    $('appShell').classList.add('hidden'); $('authScreen').classList.remove('hidden');
    setAuthTab(tab || 'login'); startTicker();
  }
  function setAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('loginForm').classList.toggle('hidden', tab !== 'login');
    $('registerForm').classList.toggle('hidden', tab !== 'register');
    hideAuthError();
  }
  function authError(msg) { const e = $('authError'); e.textContent = msg; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show'); }
  function hideAuthError() { $('authError').classList.remove('show'); }

  async function submitLogin(ev) {
    ev.preventDefault(); hideAuthError();
    const btn = ev.submitter || ev.target.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const r = await Auth.login($('loginUser').value, $('loginPass').value, $('loginRemember').checked);
      if (!r.ok) return authError(r.error);
      $('loginPass').value = '';
      enterApp(r.user);
    } finally { btn.disabled = false; }
  }
  async function submitRegister(ev) {
    ev.preventDefault(); hideAuthError();
    if ($('regPass').value !== $('regPass2').value) return authError('Konfirmasi kata sandi tidak sama.');
    const btn = ev.submitter || ev.target.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const r = await Auth.register({ name: $('regName').value, nim: $('regNim').value, username: $('regUser').value, password: $('regPass').value });
      if (!r.ok) return authError(r.error);
      $('registerForm').reset(); setAuthTab('login'); $('loginUser').value = ''; toast('Akun dibuat sebagai Mahasiswa. Silakan masuk.', 'ok');
    } finally { btn.disabled = false; }
  }

  /* ---------- Shell ---------- */
  function enterApp(u) {
    user = u;
    $('authScreen').classList.add('hidden'); $('appShell').classList.remove('hidden');
    $('userAvatar').textContent = (u.name || u.username).trim().charAt(0).toUpperCase();
    $('userName').textContent = u.name; $('userRole').textContent = Auth.ROLES[u.role].label;
    Gumateri.preload();
    if (!location.hash || location.hash === '#/') location.hash = '#/home';
    route();
  }

  async function logout() {
    await Auth.logout(); closeModal(); location.hash = ''; showAuth('login'); toast('Anda telah keluar.', 'ok');
  }

  function navItems() {
    const items = [{ id: 'home', title: 'Beranda', icon: 'home', state: '' }];
    FEATURES.forEach(f => {
      const ok = Auth.canAccess(user, f.id, DEFAULTS);
      items.push({ id: f.id, title: f.title, icon: f.icon, locked: !ok, state: !ok ? 'lock' : (f.status === 'soon' ? 'soon' : '') });
    });
    return items;
  }

  function renderSidebar(active) {
    let h = '<div class="nav-label">Menu</div>';
    navItems().forEach(n => {
      h += `<button class="nav-item ${n.id === active ? 'active' : ''} ${n.locked ? 'locked' : ''}" data-route="${n.id}">
        ${icon(n.locked ? 'lock' : n.icon)}<span>${esc(n.title)}</span>
        ${n.state === 'soon' ? '<span class="nav-state">SEGERA</span>' : ''}</button>`;
    });
    h += '<div class="nav-label" style="margin-top:.75rem">Akun</div>';
    h += `<button class="nav-item ${active === 'profile' ? 'active' : ''}" data-route="profile">${icon('user')}<span>Profil Saya</span></button>`;
    if (user.role === 'admin') h += `<button class="nav-item ${active === 'admin' ? 'active' : ''}" data-route="admin">${icon('admin')}<span>Panel Admin</span></button>`;
    h += `<div class="sidebar-foot">Masuk sebagai<br>${roleBadge(user.role)}</div>`;
    $('sidebar').innerHTML = h;
  }

  /* ---------- Router ---------- */
  function route() {
    user = Auth.current();
    if (!user) { showAuth('login'); return; } // sesi habis / akun dinonaktifkan
    const id = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
    const view = $('view'); $('sidebar').classList.remove('open');
    renderSidebar(id);
    const feature = FEATURES.find(f => f.id === id);
    let html = '';

    if (id === 'home') { html = viewHome(); }
    else if (id === 'profile') { html = viewProfile(); }
    else if (id === 'admin') { html = user.role === 'admin' ? viewAdmin() : viewLocked({ title: 'Panel Admin', roles: 'Admin' }); }
    else if (feature) {
      if (!Auth.canAccess(user, feature.id, DEFAULTS)) html = viewLocked({ title: feature.title, roles: roleHint(feature) });
      else if (feature.status === 'soon') html = viewSoon(feature);
      else html = '<div id="featureHost"></div>';
    } else { location.hash = '#/home'; return; }

    view.innerHTML = `<div class="view">${mustChangeBanner()}${html}</div>`;
    window.scrollTo({ top: 0 });
    if (feature && feature.id === 'gumateri' && Auth.canAccess(user, 'gumateri', DEFAULTS)) Gumateri.mount($('featureHost'), user);
    if (id === 'home') afterHome();
    if (id === 'admin' && user.role === 'admin') afterAdmin();
  }

  function mustChangeBanner() {
    if (!user.mustChange) return '';
    return `<div class="notice"><span>⚠️</span><span>Anda masih memakai kata sandi sementara/bawaan. Segera <a href="#/profile">ganti kata sandi</a> demi keamanan.</span></div>`;
  }

  /* ---------- Views ---------- */
  function viewHome() {
    const hour = new Date().getHours();
    const greet = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam';
    const open = FEATURES.filter(f => Auth.canAccess(user, f.id, DEFAULTS)).length + 1;
    const cards = FEATURES.map(f => {
      const ok = Auth.canAccess(user, f.id, DEFAULTS);
      const cls = !ok ? 'locked' : f.status === 'soon' ? 'soon' : '';
      const st = !ok ? '<span class="f-status lock">🔒 Terkunci</span>' : f.status === 'soon' ? '<span class="f-status soon">◔ Segera hadir</span>' : '<span class="f-status open">● Terbuka</span>';
      return `<button class="feature-card ${cls}" data-route="${f.id}"><div class="f-icon">${icon(f.icon)}</div><h3>${esc(f.title)}</h3><p>${esc(f.desc)}</p>${st}</button>`;
    }).join('');
    return `
      <section class="hero">
        <div class="hero-row">${roleBadge(user.role)}<span class="eyebrow" style="margin:0"><span class="live-dot"></span> Sistem aktif</span></div>
        <h2>${greet}, ${esc(user.name.split(' ')[0])} 👋</h2>
        <p>Selamat datang di portal digital civitas Matematika IPB. ${esc(Auth.ROLES[user.role].desc)}.</p>
      </section>
      <div class="stat-row">
        <div class="stat-card"><div class="num" id="stFiles" data-count="0">–</div><div class="lbl">Dokumen Gumateri</div></div>
        <div class="stat-card"><div class="num" id="stCourses" data-count="0">–</div><div class="lbl">Mata Kuliah</div></div>
        <div class="stat-card"><div class="num" data-count="${open}">0</div><div class="lbl">Fitur Dapat Diakses</div></div>
        <div class="stat-card"><div class="num" style="font-size:1.35rem;padding-top:.35rem">${esc(Auth.ROLES[user.role].label)}</div><div class="lbl">Tingkatan Anda</div></div>
      </div>
      <div class="section-title">Fitur</div>
      <div class="feature-grid">${cards}</div>`;
  }

  function countUp(el, to) {
    if (!el) return; const t0 = performance.now(), dur = 900;
    const step = now => { const p = Math.min(1, (now - t0) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function afterHome() {
    document.querySelectorAll('.stat-card .num[data-count]').forEach(el => { const v = +el.dataset.count; if (v) countUp(el, v); });
    Gumateri.onStats(s => { if ($('stFiles')) { countUp($('stFiles'), s.files); countUp($('stCourses'), s.courses); } });
  }

  function viewLocked({ title, roles }) {
    return `<div class="empty-lock"><div class="f-icon">${icon('lock')}</div><h3>${esc(title)} terkunci</h3>
      <p>Fitur ini hanya untuk: <strong>${esc(roles)}</strong>. Tingkatan Anda saat ini adalah ${esc(Auth.ROLES[user.role].label)}. Hubungi admin bila perlu akses.</p>
      <button class="btn btn-primary" data-route="home">Kembali ke Beranda</button></div>`;
  }
  function viewSoon(f) {
    return `<div class="page-head"><h2>${esc(f.title)}</h2><p>${esc(f.desc)}</p></div>
      <div class="empty-lock"><div class="f-icon">${icon(f.icon)}</div><h3>Sedang dikembangkan</h3><p>Fitur ini akan tersedia pada tahap berikutnya. Anda sudah punya hak aksesnya.</p></div>`;
  }

  function viewProfile() {
    return `<div class="page-head"><h2>Profil Saya</h2><p>Kelola informasi dan keamanan akun.</p></div>
      <div class="panel"><h3>Informasi Akun</h3><div style="margin-top:.75rem;display:grid;gap:.5rem;font-size:.9rem">
        <div><span style="color:var(--text-mute)">Nama</span> &nbsp; <strong>${esc(user.name)}</strong></div>
        <div><span style="color:var(--text-mute)">Username</span> &nbsp; <strong>${esc(user.username)}</strong></div>
        <div><span style="color:var(--text-mute)">NIM</span> &nbsp; <strong>${esc(user.nim || '-')}</strong></div>
        <div><span style="color:var(--text-mute)">Tingkatan</span> &nbsp; ${roleBadge(user.role)}</div></div></div>
      <div class="panel" style="max-width:480px"><h3>Ganti Kata Sandi</h3><p class="hint">Minimal 8 karakter, memuat huruf dan angka.</p>
        <form id="pwForm"><div class="field"><label>Kata sandi lama</label><input class="input" type="password" id="pwOld" autocomplete="current-password" required></div>
        <div class="field"><label>Kata sandi baru</label><input class="input" type="password" id="pwNew" autocomplete="new-password" required></div>
        <div class="field"><label>Ulangi kata sandi baru</label><input class="input" type="password" id="pwNew2" autocomplete="new-password" required></div>
        <button class="btn btn-primary" type="submit">Simpan Kata Sandi</button></form></div>`;
  }

  /* ---------- Admin ---------- */
  function viewAdmin() {
    const matrix = Auth.getAccessMatrix(DEFAULTS);
    const rows = FEATURES.map(f => `<tr><td><strong>${esc(f.title)}</strong>${f.status === 'soon' ? ' <span class="tag tag-deep-search">segera</span>' : ''}</td>
      ${Auth.CONFIGURABLE_ROLES.map(r => `<td style="text-align:center"><input type="checkbox" class="matrix-check" data-fid="${f.id}" data-role="${r}" ${matrix[f.id].includes(r) ? 'checked' : ''}></td>`).join('')}
      <td style="text-align:center"><input type="checkbox" class="matrix-check" checked disabled></td><td style="text-align:center"><input type="checkbox" class="matrix-check" checked disabled></td></tr>`).join('');
    return `<div class="page-head"><h2>Panel Admin</h2><p>Kelola akun pengguna dan hak akses tiap fitur.</p></div>
      ${Auth.REMOTE
        ? '<div class="notice" style="background:rgba(52,211,153,.08);border-color:rgba(52,211,153,.35);color:#a7f3d0"><span>✅</span><span>Terhubung ke <strong>backend Apps Script</strong>. Akun dan hak akses tersimpan di server.</span></div>'
        : '<div class="notice"><span>⚠️</span><span>Mode <strong>lokal/demo</strong>: akun hanya tersimpan di browser ini dan tidak aman. Isi <code>API_URL</code> di <code>js/config.js</code> untuk memakai backend.</span></div>'}
      <div class="panel"><h3>Hak Akses Fitur</h3><p class="hint">Centang untuk memberi akses. Admin dan Member Guma selalu punya akses penuh.</p>
        <div class="table-wrap"><table class="data"><thead><tr><th>Fitur</th><th style="text-align:center">Mahasiswa</th><th style="text-align:center">CiviMat</th><th style="text-align:center">Member Guma</th><th style="text-align:center">Admin</th></tr></thead><tbody>${rows}</tbody></table></div></div>
      <div class="panel"><h3>Manajemen Akun</h3><p class="hint">Ubah tingkatan, nonaktifkan, reset kata sandi, atau hapus akun.</p>
        <div class="toolbar"><input class="input" id="userSearch" placeholder="Cari nama / username..."><button class="btn btn-primary" id="addUserBtn" type="button">+ Tambah Akun</button></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Nama</th><th>Username</th><th>NIM</th><th>Tingkatan</th><th>Status</th><th style="text-align:right">Aksi</th></tr></thead><tbody id="userRows"></tbody></table></div></div>`;
  }

  let userCache = [];
  async function renderUserRows(refetch = true) {
    if (refetch) {
      $('userRows').innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem">Memuat akun...</td></tr>';
      userCache = await Auth.adminList();
      if (!$('userRows')) return; // pengguna sudah pindah halaman
    }
    const q = ($('userSearch').value || '').toLowerCase().trim();
    const list = userCache.filter(u => !q || u.name.toLowerCase().includes(q) || u.username.includes(q));
    $('userRows').innerHTML = list.map(u => {
      const self = u.id === user.id;
      return `<tr><td><strong>${esc(u.name)}</strong>${self ? ' <span class="tag tag-semester">Anda</span>' : ''}</td><td>${esc(u.username)}</td><td>${esc(u.nim || '-')}</td>
        <td><select class="input" style="padding:.35rem .6rem;font-size:.8rem;min-width:130px" data-act="role" data-id="${esc(u.id)}">${Auth.ROLE_KEYS.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${esc(Auth.ROLES[r].label)}</option>`).join('')}</select></td>
        <td>${u.active ? '<span class="tag tag-quiz">Aktif</span>' : '<span class="tag tag-exam">Nonaktif</span>'}</td>
        <td><div class="row-actions"><button class="btn btn-sm" data-act="toggle" data-id="${esc(u.id)}">${u.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
        <button class="btn btn-sm" data-act="reset" data-id="${esc(u.id)}">Reset Sandi</button>
        <button class="btn btn-sm btn-danger" data-act="del" data-id="${esc(u.id)}" ${self ? 'disabled' : ''}>Hapus</button></div></td></tr>`;
    }).join('') || '<tr><td colspan="6" style="text-align:center;padding:2rem">Tidak ada akun.</td></tr>';
  }

  function afterAdmin() {
    renderUserRows();
    $('userSearch').addEventListener('input', () => renderUserRows(false));
    $('addUserBtn').addEventListener('click', () => {
      openModal(`<h3>Tambah Akun</h3><p>Pengguna akan diminta mengganti sandi sementara ini.</p>
        <form id="addUserForm"><div class="field"><label>Nama lengkap</label><input class="input" id="nuName" required></div>
        <div class="form-grid"><div class="field"><label>Username</label><input class="input" id="nuUser" required autocomplete="off"></div>
        <div class="field"><label>NIM (opsional)</label><input class="input" id="nuNim"></div></div>
        <div class="form-grid"><div class="field"><label>Tingkatan</label><select class="input" id="nuRole">${Auth.ROLE_KEYS.map(r => `<option value="${r}" ${r === 'mahasiswa' ? 'selected' : ''}>${esc(Auth.ROLES[r].label)}</option>`).join('')}</select></div>
        <div class="field"><label>Sandi sementara</label><input class="input" id="nuPass" type="text" autocomplete="off" required></div></div>
        <div class="modal-actions"><button type="button" class="btn" data-close>Batal</button><button class="btn btn-primary" type="submit">Buat Akun</button></div></form>`);
    });
  }

  /* ---------- Event delegation ---------- */
  document.addEventListener('click', async e => {
    const r = e.target.closest('[data-route]');
    if (r) {
      const id = r.dataset.route;
      const f = FEATURES.find(x => x.id === id);
      if (f && !Auth.canAccess(user, id, DEFAULTS)) toast(`"${f.title}" khusus: ${roleHint(f)}.`, 'warn');
      if (location.hash === '#/' + id) route(); else location.hash = '#/' + id;
      return;
    }
    if (e.target.closest('[data-close]') || e.target === $('modalRoot')) { closeModal(); return; }
    if (e.target.closest('#logoutBtn')) { logout(); return; }
    if (e.target.closest('#menuBtn')) { $('sidebar').classList.toggle('open'); return; }
    const tab = e.target.closest('.auth-tab'); if (tab) { setAuthTab(tab.dataset.tab); return; }
    const pwt = e.target.closest('.pw-toggle');
    if (pwt) { const inp = pwt.parentElement.querySelector('input'); const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; pwt.textContent = show ? 'SEMBUNYI' : 'LIHAT'; return; }

    const btn = e.target.closest('[data-act]');
    if (btn && btn.tagName === 'BUTTON') {
      const id = btn.dataset.id, act = btn.dataset.act;
      if (act === 'toggle') {
        const u = userCache.find(x => x.id === id); btn.disabled = true;
        const res = await Auth.adminUpdate(id, { active: !u.active });
        res.ok ? (toast(u.active ? 'Akun dinonaktifkan.' : 'Akun diaktifkan.', 'ok'), renderUserRows()) : (toast(res.error, 'err'), btn.disabled = false);
      } else if (act === 'del') {
        const u = userCache.find(x => x.id === id);
        openModal(`<h3>Hapus akun?</h3><p>Akun <strong>${esc(u.username)}</strong> (${esc(u.name)}) akan dihapus permanen.</p><div class="modal-actions"><button class="btn" data-close>Batal</button><button class="btn btn-danger" id="confirmDel" data-id="${esc(id)}">Ya, Hapus</button></div>`);
      } else if (act === 'reset') {
        openModal(`<h3>Reset kata sandi</h3><p>Masukkan sandi sementara baru. Pengguna wajib menggantinya setelah masuk.</p><form id="resetForm" data-id="${esc(id)}"><div class="field"><input class="input" id="rsPass" type="text" autocomplete="off" required placeholder="Sandi sementara"></div><div class="modal-actions"><button type="button" class="btn" data-close>Batal</button><button class="btn btn-primary" type="submit">Reset</button></div></form>`);
      }
      return;
    }
    if (e.target.id === 'confirmDel') {
      e.target.disabled = true;
      const res = await Auth.adminDelete(e.target.dataset.id); closeModal();
      res.ok ? (toast('Akun dihapus.', 'ok'), renderUserRows()) : toast(res.error, 'err'); return;
    }
  });

  document.addEventListener('change', async e => {
    const t = e.target;
    if (t.matches('select[data-act="role"]')) {
      t.disabled = true;
      const res = await Auth.adminUpdate(t.dataset.id, { role: t.value });
      res.ok ? toast('Tingkatan diperbarui.', 'ok') : toast(res.error, 'err');
      renderUserRows();
    } else if (t.matches('.matrix-check[data-fid]')) {
      t.disabled = true;
      const res = await Auth.setAccess(t.dataset.fid, t.dataset.role, t.checked);
      t.disabled = false;
      res.ok ? toast('Hak akses disimpan.', 'ok') : (toast(res.error, 'err'), t.checked = !t.checked);
      renderSidebar('admin');
    }
  });

  document.addEventListener('submit', async e => {
    const f = e.target;
    if (f.id === 'loginForm') return submitLogin(e);
    if (f.id === 'registerForm') return submitRegister(e);
    e.preventDefault();
    if (f.id === 'pwForm') {
      if ($('pwNew').value !== $('pwNew2').value) return toast('Konfirmasi kata sandi baru tidak sama.', 'err');
      const r = await Auth.changePassword($('pwOld').value, $('pwNew').value);
      if (!r.ok) return toast(r.error, 'err');
      f.reset(); toast('Kata sandi berhasil diganti.', 'ok'); route();
    } else if (f.id === 'addUserForm') {
      const r = await Auth.adminCreateUser({ name: $('nuName').value, username: $('nuUser').value, nim: $('nuNim').value, role: $('nuRole').value, password: $('nuPass').value });
      if (!r.ok) return toast(r.error, 'err');
      closeModal(); toast('Akun dibuat.', 'ok'); renderUserRows();
    } else if (f.id === 'resetForm') {
      const r = await Auth.adminResetPassword(f.dataset.id, $('rsPass').value);
      if (!r.ok) return toast(r.error, 'err');
      closeModal(); toast('Kata sandi direset.', 'ok');
    }
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); $('sidebar').classList.remove('open'); } });
  document.addEventListener('mousemove', e => {
    const c = e.target.closest && e.target.closest('.feature-card'); if (!c) return;
    const b = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - b.left) + 'px'); c.style.setProperty('--my', (e.clientY - b.top) + 'px');
  }, { passive: true });
  window.addEventListener('hashchange', () => { if (user) route(); });
  // Cek sesi berkala (sesi habis / akun dinonaktifkan oleh admin)
  setInterval(async () => {
    if (!user) return;
    const u = await Auth.refresh();
    if (!u) { showAuth('login'); toast('Sesi berakhir. Silakan masuk kembali.', 'warn'); }
    else if (u.role !== user.role) { toast('Tingkatan akun Anda diubah admin.', 'warn'); route(); }
  }, 60000);

  async function boot() {
    Auth.configure(DEFAULTS);
    $('bootMsg').classList.remove('hidden');
    let u = null;
    try { u = await Auth.init(); } catch (e) { console.error(e); }
    $('bootMsg').classList.add('hidden');
    u ? enterApp(u) : showAuth('login');
  }
  return { boot, toast };
})();

window.App = App;
App.boot();
