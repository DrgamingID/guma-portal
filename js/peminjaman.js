/* =========================================================
   FITUR PEMINJAMAN - ruangan & alat: siapa yang sedang memakai
   - Dua tampilan: Daftar (kartu status + tabel) dan Kalender bulanan.
   - Status "Sedang dipakai / Tersedia" dihitung otomatis dari jadwal peminjaman.
   - Peminjam bisa Birdept (biro/departemen) atau perorangan; bisa dicari per nama.
   - Pencatatan baru yang bentrok jadwal ditolak server (menyebut siapa pemakainya).
   - Yang boleh mencatat: Admin & Member Guma. Yang lain hanya melihat.
   ========================================================= */
const Peminjaman = (() => {
  const esc = s => s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const $ = id => document.getElementById(id);
  const TYPE = { birdept: 'Birdept', person: 'Perorangan' };
  const KIND = { ruangan: 'Ruangan', alat: 'Alat' };
  const DOW = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
  const MAX_CHIPS = 3, PALETTE = 6;

  let data = { resources: [], bookings: [], canManage: false, isAdmin: false };
  let skew = 0, refetchTimer = null, repaintTimer = null;
  let view = 'list', calMonth = monthStart(new Date()), selDay = dayKey(new Date()), calBookings = [], calReq = 0;
  const nowMs = () => Date.now() + skew;
  const t = iso => new Date(iso).getTime();

  function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function dayKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  const keyToDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  function gridStart() { const f = monthStart(calMonth); return addDays(f, -((f.getDay() + 6) % 7)); }   // pekan mulai Senin

  const fmt = iso => new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const hhmm = iso => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const span = b => sameDay(b.startsAt, b.endsAt) ? `${fmt(b.startsAt)} – ${hhmm(b.endsAt)}` : `${fmt(b.startsAt)} – ${fmt(b.endsAt)}`;
  const typeTag = b => `<span class="tag ${b.borrowerType === 'birdept' ? 'tag-semester' : 'tag-modul'}">${TYPE[b.borrowerType] || ''}</span>`;
  const toLocalInput = ms => { const d = new Date(ms); return dayKey(d) + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const colorOf = resId => Math.max(0, data.resources.findIndex(r => r.id === resId)) % PALETTE;

  const TEMPLATE = `
    <div class="page-head"><h2>Peminjaman Ruangan &amp; Alat</h2><p>Lihat siapa yang sedang memakai ruangan atau alat, dan jadwal peminjamannya.</p></div>
    <div class="stat-row" id="pjStats"></div>
    <div class="toolbar">
      <input class="input" id="pjSearch" placeholder="Cari peminjam (Birdept / nama orang), ruangan, alat...">
      <select class="input" id="pjKind" style="max-width:150px"><option value="">Semua jenis</option><option value="ruangan">Ruangan</option><option value="alat">Alat</option></select>
      <label class="check" style="text-transform:none;letter-spacing:0;font-weight:600;font-size:.85rem"><input type="checkbox" id="pjActive"> Sedang dipakai saja</label>
      <span style="flex:1"></span>
      <div class="view-toggle"><button class="view-btn active" id="pjViewList" type="button">☰ Daftar</button><button class="view-btn" id="pjViewCal" type="button">▦ Kalender</button></div>
      <button class="btn btn-primary hidden" id="pjAdd" type="button">+ Catat Peminjaman</button>
      <button class="btn hidden" id="pjManage" type="button">Kelola Daftar</button>
    </div>

    <div id="pjListView">
      <div class="section-title">Status Sekarang</div>
      <div id="pjCards" class="cards-grid"></div>
      <div class="section-title" style="margin-top:1.5rem">Jadwal Peminjaman</div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Ruangan / Alat</th><th>Peminjam</th><th>Keperluan</th><th>Waktu</th><th>Status</th><th style="text-align:right">Aksi</th></tr></thead>
        <tbody id="pjRows"></tbody></table></div>
    </div>

    <div id="pjCalView" class="hidden">
      <div class="cal-head">
        <button class="btn btn-sm" id="calPrev" type="button" aria-label="Bulan sebelumnya">‹</button>
        <h3 id="calTitle"></h3>
        <button class="btn btn-sm" id="calNext" type="button" aria-label="Bulan berikutnya">›</button>
        <button class="btn btn-sm" id="calToday" type="button">Hari ini</button>
      </div>
      <div id="calLegend" class="cal-legend"></div>
      <div class="cal-wrap">
        <div class="cal-dow">${DOW.map(d => `<div>${d}</div>`).join('')}</div>
        <div id="calGrid" class="cal-grid"></div>
      </div>
      <div class="panel" id="calDay" style="margin-top:1rem"></div>
    </div>`;

  /* ---------- Hitung status & filter ---------- */
  function statusOf(b) { const n = nowMs(); return t(b.endsAt) <= n ? 'done' : t(b.startsAt) <= n ? 'live' : 'soon'; }
  const resOf = id => data.resources.find(r => r.id === id) || {};
  const resName = id => resOf(id).name || '(dihapus)';
  const filters = () => ({ q: $('pjSearch').value.toLowerCase().trim(), kind: $('pjKind').value, active: $('pjActive').checked });
  const matchB = (b, q) => !q || [b.borrower, b.purpose, resName(b.resourceId), TYPE[b.borrowerType]].some(x => String(x).toLowerCase().includes(q));
  const passes = (b, f) => matchB(b, f.q) && (!f.kind || resOf(b.resourceId).kind === f.kind) && (!f.active || statusOf(b) === 'live');
  const actionsOf = b => {
    if (!data.canManage) return '';
    const st = statusOf(b);
    return `<div class="row-actions">${st === 'live' ? `<button class="btn btn-sm" data-act="finish" data-id="${esc(b.id)}" type="button">Selesai</button>` : ''}
      ${st !== 'done' ? `<button class="btn btn-sm btn-danger" data-act="cancel" data-id="${esc(b.id)}" type="button">Batalkan</button>` : ''}</div>`;
  };
  const statusTag = st => st === 'live' ? '<span class="tag tag-exam">Berlangsung</span>' : st === 'soon' ? '<span class="tag tag-modul">Terjadwal</span>' : '<span class="tag tag-quiz">Selesai</span>';

  /* ---------- Tampilan Daftar ---------- */
  function paintStats() {
    const bs = data.bookings, live = {};
    bs.forEach(b => { if (statusOf(b) === 'live') live[b.resourceId] = true; });
    const inUse = data.resources.filter(r => live[r.id]).length;
    $('pjStats').innerHTML = `
      <div class="stat-card"><div class="num">${inUse}</div><div class="lbl">Sedang dipakai</div></div>
      <div class="stat-card"><div class="num">${data.resources.length - inUse}</div><div class="lbl">Tersedia</div></div>
      <div class="stat-card"><div class="num">${bs.filter(b => statusOf(b) === 'soon').length}</div><div class="lbl">Terjadwal</div></div>`;
  }

  function paintList() {
    const f = filters(), bs = data.bookings;
    const liveBy = {}, nextBy = {};
    bs.forEach(b => {
      const st = statusOf(b);
      if (st === 'live') liveBy[b.resourceId] = b;
      else if (st === 'soon' && (!nextBy[b.resourceId] || t(b.startsAt) < t(nextBy[b.resourceId].startsAt))) nextBy[b.resourceId] = b;
    });

    let list = data.resources.filter(r => !f.kind || r.kind === f.kind);
    if (f.q) list = list.filter(r => r.name.toLowerCase().includes(f.q) || bs.some(b => b.resourceId === r.id && statusOf(b) !== 'done' && matchB(b, f.q)));
    if (f.active) list = list.filter(r => liveBy[r.id] && (!f.q || r.name.toLowerCase().includes(f.q) || matchB(liveBy[r.id], f.q)));

    $('pjCards').innerHTML = list.map(r => {
      const l = liveBy[r.id], n = nextBy[r.id];
      return `<div class="material-card pj-card ${l ? 'busy' : 'free'}"><div>
        <div class="card-top"><div class="card-tags"><span class="tag tag-semester">${KIND[r.kind]}</span>
          <span class="pj-state ${l ? 'busy' : 'free'}">${l ? '● Sedang dipakai' : '● Tersedia'}</span></div></div>
        <h3 class="card-title" style="margin:.7rem 0 .3rem">${esc(r.name)}</h3>
        ${r.note ? `<div class="pj-note">${esc(r.note)}</div>` : ''}
        ${l ? `<div class="pj-who"><strong>${esc(l.borrower)}</strong> ${typeTag(l)}</div>
               <div class="pj-note">${l.purpose ? esc(l.purpose) + ' · ' : ''}sampai ${esc(sameDay(l.endsAt, nowMs()) ? hhmm(l.endsAt) : fmt(l.endsAt))}</div>` : ''}
        ${n ? `<div class="pj-next">Berikutnya: <strong>${esc(n.borrower)}</strong>, ${esc(fmt(n.startsAt))}</div>` : ''}
      </div>${l && data.canManage ? `<div class="card-footer"><span></span><button class="btn btn-sm" data-act="finish" data-id="${esc(l.id)}" type="button">Tandai selesai</button></div>` : ''}</div>`;
    }).join('') || `<div class="state-panel" style="grid-column:1/-1;display:block"><h3>${data.resources.length ? 'Tidak ada yang cocok' : 'Belum ada ruangan/alat'}</h3><p>${data.isAdmin && !data.resources.length ? 'Tambahkan lewat tombol Kelola Daftar.' : ''}</p></div>`;

    $('pjRows').innerHTML = bs.filter(b => passes(b, f)).map(b => `<tr>
      <td><strong>${esc(resName(b.resourceId))}</strong></td>
      <td>${esc(b.borrower)} ${typeTag(b)}</td><td>${esc(b.purpose || '-')}</td><td>${esc(span(b))}</td>
      <td>${statusTag(statusOf(b))}</td><td style="text-align:right">${actionsOf(b)}</td></tr>`).join('')
      || '<tr><td colspan="6" style="text-align:center;padding:1.5rem">Tidak ada peminjaman.</td></tr>';
  }

  /* ---------- Tampilan Kalender ---------- */
  function paintCal() {
    if (!$('calGrid')) return;
    const f = filters(), gs = gridStart(), todayK = dayKey(new Date(nowMs()));
    const items = calBookings.filter(b => passes(b, f));
    $('calTitle').textContent = calMonth.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    $('calLegend').innerHTML = data.resources.map(r => `<span class="cal-key"><i class="pj-c${colorOf(r.id)}"></i>${esc(r.name)}</span>`).join('');

    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d0 = addDays(gs, i), d1 = addDays(gs, i + 1), k = dayKey(d0);
      const dayItems = items.filter(b => t(b.startsAt) < d1.getTime() && t(b.endsAt) > d0.getTime());
      const chips = dayItems.slice(0, MAX_CHIPS).map(b => {
        const startsToday = t(b.startsAt) >= d0.getTime();
        return `<div class="pj-chip pj-c${colorOf(b.resourceId)} ${statusOf(b) === 'done' ? 'done' : ''}" title="${esc(resName(b.resourceId) + ' · ' + b.borrower + ' · ' + span(b))}">${startsToday ? esc(hhmm(b.startsAt)) + ' ' : '↳ '}${esc(b.borrower)}</div>`;
      }).join('');
      const more = dayItems.length > MAX_CHIPS ? `<div class="pj-more">+${dayItems.length - MAX_CHIPS} lagi</div>` : '';
      cells.push(`<button type="button" class="cal-cell ${d0.getMonth() !== calMonth.getMonth() ? 'out' : ''} ${k === todayK ? 'today' : ''} ${k === selDay ? 'sel' : ''}" data-day="${k}">
        <span class="cal-num">${d0.getDate()}</span>${chips}${more}</button>`);
    }
    $('calGrid').innerHTML = cells.join('');
    paintDay(items);
  }

  function paintDay(items) {
    const d0 = keyToDate(selDay), d1 = addDays(d0, 1);
    const list = items.filter(b => t(b.startsAt) < d1.getTime() && t(b.endsAt) > d0.getTime());
    const title = d0.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('calDay').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:.75rem;flex-wrap:wrap;margin-bottom:.8rem">
        <h3 style="margin:0">${esc(title)}</h3>
        ${data.canManage ? '<button class="btn btn-sm btn-primary" data-newday type="button">+ Catat di tanggal ini</button>' : ''}</div>
      ${list.length ? list.map(b => `<div class="cal-item pj-c${colorOf(b.resourceId)}">
          <div class="cal-item-main"><strong>${esc(resName(b.resourceId))}</strong> <span class="tag tag-semester">${KIND[resOf(b.resourceId).kind] || ''}</span> ${statusTag(statusOf(b))}
            <div class="pj-note">${esc(b.borrower)} ${typeTag(b)} · ${esc(span(b))}${b.purpose ? ' · ' + esc(b.purpose) : ''}</div></div>
          ${actionsOf(b)}</div>`).join('') : '<p class="hint" style="margin:0">Tidak ada peminjaman pada tanggal ini.</p>'}`;
  }

  /* ---------- Pemuatan data ---------- */
  function paint() {
    if (!$('pjStats')) return;
    paintStats();
    if (view === 'list') paintList(); else paintCal();
  }

  async function load() {
    const r = await Auth.api('loan.overview');
    if (!$('pjStats')) return false;
    if (!r.ok) { $('pjCards').innerHTML = `<div class="state-panel" style="grid-column:1/-1;display:block"><h3>Gagal memuat</h3><p>${esc(r.error)}</p></div>`; return false; }
    data = r; skew = t(r.now) - Date.now();
    $('pjAdd').classList.toggle('hidden', !r.canManage);
    $('pjManage').classList.toggle('hidden', !r.isAdmin);
    paint(); return true;
  }

  // Kalender meminta jadwal untuk rentang 6 pekan yang sedang tampil (bisa bulan lampau/depan).
  async function loadCal() {
    const gs = gridStart(), req = ++calReq;
    const r = await Auth.api('loan.overview', { from: gs.toISOString(), to: addDays(gs, 42).toISOString() });
    if (req !== calReq || !$('calGrid')) return;   // permintaan usang / pindah halaman
    if (!r.ok) { App.toast(r.error, 'err'); return; }
    calBookings = r.bookings; paintCal();
  }
  const refreshAll = async () => { await load(); if (view === 'cal') loadCal(); };

  function setView(v) {
    view = v;
    $('pjListView').classList.toggle('hidden', v !== 'list');
    $('pjCalView').classList.toggle('hidden', v !== 'cal');
    $('pjViewList').classList.toggle('active', v === 'list');
    $('pjViewCal').classList.toggle('active', v === 'cal');
    if (v === 'cal') { paintCal(); loadCal(); } else paintList();
  }

  function moveMonth(delta) {
    calMonth = delta === 0 ? monthStart(new Date()) : new Date(calMonth.getFullYear(), calMonth.getMonth() + delta, 1);
    if (delta === 0) selDay = dayKey(new Date());
    calBookings = []; paintCal(); loadCal();
  }

  /* ---------- Modal ---------- */
  function openBook(presetId, presetDay) {
    if (!data.resources.length) { App.toast('Belum ada ruangan/alat. Admin perlu menambahkannya dulu.', 'warn'); return; }
    let start = Math.ceil(nowMs() / 900000) * 900000;   // dibulatkan ke 15 menit berikut
    if (presetDay && presetDay !== dayKey(new Date(nowMs()))) { const d = keyToDate(presetDay); d.setHours(8, 0, 0, 0); start = d.getTime(); }
    const people = Array.from(new Set(data.bookings.concat(calBookings).map(b => b.borrower)));
    const root = App.openModal(`<h3>Catat Peminjaman</h3><p>Jadwal yang bentrok akan ditolak otomatis.</p>
      <form id="pjForm"><div id="pjErr" class="auth-error" role="alert"></div>
        <div class="field"><label>Ruangan / alat</label><select class="input" id="pjRes">${data.resources.map(r => `<option value="${esc(r.id)}" ${r.id === presetId ? 'selected' : ''}>${KIND[r.kind]} · ${esc(r.name)}</option>`).join('')}</select></div>
        <div class="form-grid"><div class="field"><label>Jenis peminjam</label><select class="input" id="pjType"><option value="birdept">Birdept (biro/departemen)</option><option value="person">Perorangan</option></select></div>
        <div class="field"><label>Nama peminjam</label><input class="input" id="pjWho" list="pjPeople" required maxlength="80" placeholder="mis. Birdept Akademik / nama orang" autocomplete="off"><datalist id="pjPeople">${people.map(p => `<option value="${esc(p)}">`).join('')}</datalist></div></div>
        <div class="field"><label>Keperluan (opsional)</label><input class="input" id="pjWhy" maxlength="200"></div>
        <div class="form-grid"><div class="field"><label>Mulai</label><input class="input" type="datetime-local" id="pjFrom" required value="${toLocalInput(start)}"></div>
        <div class="field"><label>Selesai</label><input class="input" type="datetime-local" id="pjTo" required value="${toLocalInput(start + 3600000)}"></div></div>
        <div class="modal-actions"><button type="button" class="btn" data-close>Batal</button><button class="btn btn-primary" type="submit">Simpan</button></div></form>`);
    root.querySelector('#pjForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      const from = new Date($('pjFrom').value), to = new Date($('pjTo').value);
      const r = (isNaN(from) || isNaN(to)) ? { ok: false, error: 'Waktu mulai/selesai tidak valid.' } : await Auth.api('loan.book', {
        resourceId: $('pjRes').value, borrowerType: $('pjType').value, borrower: $('pjWho').value, purpose: $('pjWhy').value,
        startsAt: from.toISOString(), endsAt: to.toISOString() });
      btn.disabled = false;
      if (!r.ok) { const el = $('pjErr'); el.textContent = r.error; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); return; }
      App.closeModal(); App.toast('Peminjaman dicatat.', 'ok'); refreshAll();
    });
  }

  function openManage() {
    const draw = () => `<h3>Kelola Ruangan &amp; Alat</h3><p>Menghapus item juga menghapus jadwal peminjamannya.</p>
      <div class="table-wrap" style="max-height:220px;overflow:auto;margin-bottom:1rem"><table class="data"><tbody>${data.resources.map(r =>
        `<tr><td><span class="tag tag-semester">${KIND[r.kind]}</span></td><td><strong>${esc(r.name)}</strong></td>
         <td style="text-align:right"><button class="btn btn-sm btn-danger" data-rdel="${esc(r.id)}" type="button">Hapus</button></td></tr>`).join('') || '<tr><td style="padding:1rem;text-align:center">Kosong.</td></tr>'}</tbody></table></div>
      <form id="pjResForm"><div class="form-grid"><div class="field"><label>Jenis</label><select class="input" id="prKind"><option value="ruangan">Ruangan</option><option value="alat">Alat</option></select></div>
        <div class="field"><label>Nama</label><input class="input" id="prName" required maxlength="80"></div></div>
        <div class="field"><label>Catatan (opsional)</label><input class="input" id="prNote" maxlength="200"></div>
        <div class="modal-actions"><button type="button" class="btn" data-close>Tutup</button><button class="btn btn-primary" type="submit">+ Tambah</button></div></form>`;
    const root = App.openModal(draw());
    const redraw = async () => { await refreshAll(); root.querySelector('.modal-box').innerHTML = draw(); wire(); };
    const wire = () => {
      root.querySelector('#pjResForm').addEventListener('submit', async e => {
        e.preventDefault();
        const r = await Auth.api('loan.resourceSave', { kind: $('prKind').value, name: $('prName').value, note: $('prNote').value });
        if (!r.ok) return App.toast(r.error, 'err');
        redraw();
      });
      root.querySelectorAll('[data-rdel]').forEach(b => b.addEventListener('click', async () => {
        const r = await Auth.api('loan.resourceDelete', { id: b.dataset.rdel });
        if (!r.ok) return App.toast(r.error, 'err');
        redraw();
      }));
    };
    wire();
  }

  /* ---------- Pasang ---------- */
  function mount(host) {
    view = 'list'; calMonth = monthStart(new Date()); selDay = dayKey(new Date()); calBookings = [];
    host.innerHTML = TEMPLATE;
    let deb; $('pjSearch').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(paint, 120); });
    $('pjKind').addEventListener('change', paint); $('pjActive').addEventListener('change', paint);
    $('pjAdd').addEventListener('click', () => openBook());
    $('pjManage').addEventListener('click', openManage);
    $('pjViewList').addEventListener('click', () => setView('list'));
    $('pjViewCal').addEventListener('click', () => setView('cal'));
    $('calPrev').addEventListener('click', () => moveMonth(-1));
    $('calNext').addEventListener('click', () => moveMonth(1));
    $('calToday').addEventListener('click', () => moveMonth(0));
    host.addEventListener('click', async e => {
      const cell = e.target.closest('[data-day]');
      if (cell) {
        selDay = cell.dataset.day;
        const d = keyToDate(selDay);
        if (d.getMonth() !== calMonth.getMonth()) { calMonth = monthStart(d); calBookings = []; paintCal(); loadCal(); }
        else paintCal();
        return;
      }
      if (e.target.closest('[data-newday]')) { openBook(null, selDay); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      b.disabled = true;
      const r = await Auth.api(b.dataset.act === 'finish' ? 'loan.finish' : 'loan.cancel', { id: b.dataset.id });
      if (!r.ok) { App.toast(r.error, 'err'); b.disabled = false; return; }
      App.toast(b.dataset.act === 'finish' ? 'Ditandai selesai.' : 'Peminjaman dibatalkan.', 'ok'); refreshAll();
    });
    load();
    clearInterval(refetchTimer); clearInterval(repaintTimer);
    refetchTimer = setInterval(() => {
      if (!$('pjStats')) { clearInterval(refetchTimer); clearInterval(repaintTimer); }
      else if (document.visibilityState === 'visible') refreshAll();
    }, 60000);
    repaintTimer = setInterval(() => { if ($('pjStats')) paint(); }, 20000);   // status berganti tepat waktu tanpa unduh ulang
  }

  return { mount };
})();
