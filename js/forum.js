/* =========================================================
   FITUR FORUM DISKUSI - ruang obrolan per tingkatan
   Saat ini: satu ruang "General" untuk semua tingkatan.
   Ruang baru = baris baru di tabel guma.forum_rooms (kolom roles menentukan siapa yang boleh masuk).
   Pesan diperbarui dengan polling ringan (6 detik, hanya saat tab terlihat).
   ========================================================= */
const Forum = (() => {
  const POLL_MS = 6000;
  const esc = s => s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const $ = id => document.getElementById(id);

  let me = null, rooms = [], room = null, lastId = 0, timer = null, busy = false;

  const TEMPLATE = `
    <div class="page-head"><h2>Forum Diskusi</h2><p id="fmDesc">Memuat ruang...</p></div>
    <div id="fmTabs" class="quick-pills" style="margin-bottom:.9rem"></div>
    <section class="panel chat-panel">
      <div id="fmBox" class="chat-box" aria-live="polite"><div class="chat-empty">Memuat pesan...</div></div>
      <form id="fmForm" class="chat-form" autocomplete="off">
        <textarea id="fmInput" class="input" rows="1" maxlength="1000" placeholder="Tulis pesan... (Enter kirim, Shift+Enter baris baru)"></textarea>
        <button class="btn btn-primary" type="submit" id="fmSend">Kirim</button>
      </form>
    </section>`;

  function timeLabel(iso) {
    const d = new Date(iso), t = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
    return d.toDateString() === new Date().toDateString() ? t : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) + ' ' + t;
  }

  function msgHtml(p) {
    const mine = p.userId === me.id, canDel = mine || me.role === 'admin' || me.role === 'guma';
    return `<div class="chat-msg ${mine ? 'mine' : ''}" data-id="${p.id}">
      <div class="avatar">${esc((p.name || '?').trim().charAt(0).toUpperCase())}</div>
      <div class="chat-bubble">
        <div class="chat-meta"><strong>${esc(p.name)}</strong> ${roleBadge(p.role)} <span class="chat-time">${esc(timeLabel(p.createdAt))}</span>
          ${canDel ? `<button class="chat-del" type="button" data-del="${p.id}" title="Hapus pesan">✕</button>` : ''}</div>
        <div class="chat-text">${esc(p.body)}</div>
      </div></div>`;
  }

  function nearBottom(box) { return box.scrollHeight - box.scrollTop - box.clientHeight < 80; }

  function paint(posts, replace) {
    const box = $('fmBox'); if (!box) return;
    const stick = replace || nearBottom(box);
    if (replace) box.innerHTML = '';
    else { const e = box.querySelector('.chat-empty'); if (e) e.remove(); }
    if (replace && !posts.length) box.innerHTML = '<div class="chat-empty">Belum ada pesan. Jadilah yang pertama menyapa 👋</div>';
    if (posts.length) box.insertAdjacentHTML('beforeend', posts.map(msgHtml).join(''));
    if (posts.length) lastId = Math.max(lastId, posts[posts.length - 1].id);
    if (stick) box.scrollTop = box.scrollHeight;
  }

  async function fetchPosts(full) {
    if (!room || busy) return;
    busy = true;
    try {
      const r = await Auth.api('forum.list', { room: room.id, after: full ? 0 : lastId });
      if (!$('fmBox')) return;                       // sudah pindah halaman
      if (r.ok) paint(r.posts || [], full);
      else if (full) $('fmBox').innerHTML = `<div class="chat-empty">${esc(r.error)}</div>`;
    } finally { busy = false; }
  }

  function tick() {
    if (!$('fmBox')) { clearInterval(timer); timer = null; return; }   // fitur ditinggalkan
    if (document.visibilityState === 'visible') fetchPosts(false);
  }

  function renderTabs() {
    $('fmTabs').innerHTML = rooms.length > 1
      ? rooms.map(r => `<button class="type-pill ${r.id === room.id ? 'active' : ''}" data-room="${esc(r.id)}" type="button">${esc(r.name)}</button>`).join('')
      : '';
    $('fmDesc').textContent = `# ${room.name} — ${room.description || 'Ruang diskusi'}`;
  }

  function selectRoom(id) {
    room = rooms.find(r => r.id === id) || rooms[0];
    lastId = 0; renderTabs();
    $('fmBox').innerHTML = '<div class="chat-empty">Memuat pesan...</div>';
    fetchPosts(true);
  }

  async function send() {
    const input = $('fmInput'), body = input.value.trim();
    if (!body || !room) return;
    const btn = $('fmSend'); btn.disabled = true;
    const r = await Auth.api('forum.post', { room: room.id, body });
    btn.disabled = false;
    if (!r.ok) { App.toast(r.error, 'err'); return; }
    input.value = ''; input.style.height = ''; input.focus();
    fetchPosts(false);
  }

  function bind(host) {
    host.addEventListener('submit', e => { if (e.target.id === 'fmForm') { e.preventDefault(); send(); } });
    host.addEventListener('keydown', e => {
      if (e.target.id === 'fmInput' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    host.addEventListener('input', e => {
      if (e.target.id === 'fmInput') { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; }
    });
    host.addEventListener('click', async e => {
      const tab = e.target.closest('[data-room]'); if (tab) { selectRoom(tab.dataset.room); return; }
      const del = e.target.closest('[data-del]');
      if (del) {
        del.disabled = true;
        const r = await Auth.api('forum.delete', { id: Number(del.dataset.del) });
        if (!r.ok) { App.toast(r.error, 'err'); del.disabled = false; return; }
        fetchPosts(true);
      }
    });
  }

  async function mount(host, user) {
    me = user; rooms = []; room = null; lastId = 0; busy = false;
    host.innerHTML = TEMPLATE; bind(host);
    const r = await Auth.api('forum.rooms');
    if (!$('fmBox')) return;
    if (!r.ok || !(r.rooms || []).length) {
      $('fmDesc').textContent = '';
      $('fmBox').innerHTML = `<div class="chat-empty">${esc(r.ok ? 'Belum ada ruang yang bisa Anda akses.' : r.error)}</div>`;
      $('fmForm').classList.add('hidden'); return;
    }
    rooms = r.rooms; selectRoom(rooms[0].id);
    if (timer) clearInterval(timer);
    timer = setInterval(tick, POLL_MS);
  }

  return { mount };
})();
