/* =========================================================
   FITUR GUMATERI - Katalog materi, diktat & arsip ujian
   Sumber data: Google Spreadsheet (lihat Database.txt / java.js)
   ========================================================= */
const Gumateri = (() => {
  const SHEET_ID = '1XjMqwUw8bjpxm1VKGIfjGK9QHIMGbEZzdKQx3gYAY6c';
  const SHEET_NAME = 'KatalogMateri';
  const HAS_APPS_SCRIPT = () => typeof google !== 'undefined' && google.script && google.script.run;

  let all = [], semesters = [], courses = [];
  let displayed = [], viewMode = 'card', quickType = 'ALL';
  let loaded = false, loading = null, mounted = false, isAdmin = false;
  const listeners = [];

  const $ = id => document.getElementById(id);
  const esc = s => s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* ---------- Data ---------- */
  function buildFromRows(rows) {
    const data = [], sem = {}, crs = {};
    rows.slice(1).forEach(r => {
      const namaFile = (r[3] || '').trim(); if (!namaFile) return;
      const semester = (r[0] || '').trim(), matkul = (r[2] || '').trim(), link = (r[4] || '').trim();
      data.push({
        semester: semester || 'Umum', tipe: (r[1] || '').trim() || 'Materi', matkul: matkul || 'Umum',
        namaFile, linkPreview: /^https?:\/\//i.test(link) ? link : '#', lastUpdated: (r[5] || '').trim() || '-'
      });
      if (semester) sem[semester] = true;
      if (matkul && matkul !== '-') crs[matkul] = true;
    });
    return { data, semesters: Object.keys(sem).sort(), courses: Object.keys(crs).sort() };
  }

  function fetchSheet() {
    return new Promise((resolve, reject) => {
      const cb = '__gumaSheet' + Date.now();
      const s = document.createElement('script');
      window[cb] = resp => {
        try {
          if (!resp || resp.status !== 'ok') throw new Error('Respons tidak valid dari Google Sheets');
          const rows = [[]].concat(resp.table.rows.map(r => (r.c || []).map(c => c ? (c.f != null ? c.f : (c.v != null ? c.v : '')) : '')));
          resolve(buildFromRows(rows));
        } catch (e) { reject(e); } finally { delete window[cb]; s.remove(); }
      };
      s.src = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:json;responseHandler:' + cb +
        '&sheet=' + encodeURIComponent(SHEET_NAME) + '&_=' + Date.now();
      s.onerror = () => { delete window[cb]; s.remove(); reject(new Error('tidak dapat terhubung ke Google Sheets')); };
      document.head.appendChild(s);
    });
  }

  function load(force) {
    if (loaded && !force) return Promise.resolve();
    if (loading) return loading;
    const fromAppsScript = HAS_APPS_SCRIPT() && typeof google.script.run.getKatalogData === 'function';
    const source = fromAppsScript
      ? new Promise((res, rej) => google.script.run.withSuccessHandler(res).withFailureHandler(rej).getKatalogData())
      : fetchSheet();
    loading = source.then(cat => {
      all = cat.data || []; semesters = cat.semesters || []; courses = cat.courses || []; loaded = true;
      listeners.forEach(fn => fn({ files: all.length, courses: courses.length }));
    }).finally(() => { loading = null; });
    return loading;
  }

  /* ---------- Template ---------- */
  const TEMPLATE = `
    <div class="gt-top">
      <div class="page-head" style="margin:0">
        <span class="eyebrow"><span class="live-dot"></span> Repositori Akademik Mahasiswa Matematika</span>
        <h2>Gumateri</h2>
        <p>Modul kuliah, diktat, latihan soal, hingga arsip UTS/UAS Departemen Matematika FMIPA IPB.</p>
      </div>
      <div class="gt-hero-stats">
        <div class="stat-card"><div id="gtStatFiles" class="num">0</div><div class="lbl">Dokumen PDF</div></div>
        <div class="stat-card"><div id="gtStatCourses" class="num">0</div><div class="lbl">Mata Kuliah</div></div>
        <button id="gtSyncBtn" class="btn hidden" type="button">&#8635; <span id="gtSyncText">Sinkronkan Drive</span></button>
      </div>
    </div>

    <section class="search-console">
      <div class="search-row">
        <div class="search-input-wrapper">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="gtSearch" class="search-input" placeholder="Ketik judul modul, nama mata kuliah (misal: Kalkulus, PDB, Aljabar)..." autocomplete="off">
          <button id="gtClear" class="clear-input-btn" type="button" title="Bersihkan">&#10005;</button>
        </div>
        <button id="gtSearchBtn" class="btn btn-primary" type="button"><span>Cari Materi</span></button>
      </div>
      <div class="quick-pills" id="gtPills">
        <span class="pill-label">Kategori Cepat:</span>
        <button class="type-pill active" data-type="ALL" type="button">Semua Dokumen</button>
        <button class="type-pill" data-type="MODUL" type="button">📘 Modul &amp; Diktat</button>
        <button class="type-pill" data-type="UTS" type="button">📝 Soal UTS</button>
        <button class="type-pill" data-type="UAS" type="button">🎓 Soal UAS</button>
        <button class="type-pill" data-type="LATIHAN" type="button">✏️ Kuis &amp; Latihan</button>
        <button class="type-pill" data-type="CATATAN" type="button">📒 Catatan Kuliah</button>
      </div>
      <div class="filter-options">
        <div class="dropdown-group">
          <div class="select-wrapper"><select id="gtSemester" class="filter-select"><option value="">Semua Semester / Kategori</option></select></div>
          <div class="select-wrapper"><select id="gtCourse" class="filter-select"><option value="">Semua Mata Kuliah</option></select></div>
          <button id="gtReset" class="btn-reset" type="button">&#8634; Reset Filter</button>
        </div>
        <label class="deep-search-toggle" title="Mencari kata kunci hingga ke dalam teks halaman PDF">
          <input type="checkbox" id="gtDeep"><span>Cari di dalam isi teks PDF (Deep Search)</span>
        </label>
      </div>
    </section>

    <div class="status-bar">
      <div class="status-info"><span id="gtCount" class="results-count">Memuat katalog...</span><span id="gtTag"></span></div>
      <div class="view-toggle">
        <button id="gtCardBtn" class="view-btn active" type="button">▦ Kartu</button>
        <button id="gtTableBtn" class="view-btn" type="button">☰ Tabel</button>
      </div>
    </div>

    <div id="gtLoading" class="state-panel" style="display:none">
      <div class="spinner"></div><h3 id="gtLoadTitle">Memuat Database Gumateri...</h3><p id="gtLoadDesc">Menyiapkan daftar modul dan arsip soal.</p>
    </div>
    <div id="gtEmpty" class="state-panel" style="display:none">
      <div class="state-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
      <h3>Dokumen Tidak Ditemukan</h3>
      <p>Tidak ada berkas yang cocok dengan filter saat ini. Coba kata kunci lain atau aktifkan fitur <strong>Deep Search</strong>.</p>
    </div>
    <div id="gtError" class="state-panel" style="display:none">
      <div class="state-icon">!</div><h3>Gagal Memuat Database</h3>
      <p id="gtErrorMsg"></p><div style="margin-top:1rem"><button id="gtRetry" class="btn btn-primary" type="button">Coba Lagi</button></div>
    </div>
    <section id="gtCards" class="cards-grid" style="display:none"></section>
    <section id="gtTable" class="table-container" style="display:none">
      <table class="data">
        <thead><tr><th>Semester / Kategori</th><th>Mata Kuliah</th><th>Judul Dokumen PDF</th><th>Jenis Berkas</th><th style="text-align:right">Tautan</th></tr></thead>
        <tbody id="gtTableBody"></tbody>
      </table>
    </section>

    <div id="gtPinModal" class="modal-backdrop">
      <div class="modal-box">
        <h3>Sinkronisasi Folder Drive</h3>
        <p>Memindai ulang file baru di Google Drive (estimasi proses 2–3 menit).</p>
        <input type="password" id="gtPin" class="input" placeholder="Masukkan PIN Admin..." style="margin-bottom:1rem">
        <div class="modal-actions"><button id="gtPinCancel" class="btn" type="button">Batal</button><button id="gtPinOk" class="btn btn-primary" type="button">Mulai Pindai</button></div>
      </div>
    </div>`;

  /* ---------- UI helpers ---------- */
  function showLoading(show, title, desc) {
    $('gtLoading').style.display = show ? 'block' : 'none';
    if (show) {
      if (title) $('gtLoadTitle').textContent = title;
      if (desc) $('gtLoadDesc').textContent = desc;
      ['gtCards', 'gtTable', 'gtEmpty', 'gtError'].forEach(i => $(i).style.display = 'none');
    }
  }

  function populate() {
    const fill = (el, first, items) => {
      el.innerHTML = '';
      el.appendChild(new Option(first, ''));
      items.forEach(v => el.appendChild(new Option(v, v)));
    };
    fill($('gtSemester'), 'Semua Semester / Kategori', semesters);
    fill($('gtCourse'), 'Semua Mata Kuliah', courses);
    $('gtStatFiles').textContent = all.length;
    $('gtStatCourses').textContent = courses.length;
  }

  function badgeClass(t) {
    const u = (t || '').toUpperCase();
    if (u.includes('UTS') || u.includes('UAS') || u.includes('KOMPRE')) return 'tag-exam';
    if (u.includes('KUIS') || u.includes('LATIHAN') || u.includes('SOAL')) return 'tag-quiz';
    return 'tag-modul';
  }

  function applyFilters() {
    const kw = $('gtSearch').value.toLowerCase().trim();
    const sem = $('gtSemester').value, crs = $('gtCourse').value;
    displayed = all.filter(it => {
      const okKw = !kw || [it.namaFile, it.matkul, it.semester, it.tipe].some(x => x.toLowerCase().includes(kw));
      const t = (it.tipe || '').toUpperCase();
      let okType = true;
      if (quickType === 'MODUL') okType = ['MODUL', 'DIKTAT', 'MATERI', 'REFERENSI'].some(k => t.includes(k));
      else if (quickType === 'UTS') okType = t.includes('UTS');
      else if (quickType === 'UAS') okType = t.includes('UAS') || t.includes('KOMPRE');
      else if (quickType === 'LATIHAN') okType = ['KUIS', 'LATIHAN', 'SOAL', 'TUGAS'].some(k => t.includes(k));
      else if (quickType === 'CATATAN') okType = t.includes('CATATAN');
      return okKw && (!sem || it.semester === sem) && (!crs || it.matkul === crs) && okType;
    });
    render(displayed, false);
  }

  function render(data, deep) {
    $('gtCount').textContent = deep ? `Ditemukan ${data.length} dokumen yang memuat kata kunci` : `Menampilkan ${data.length} dari ${all.length} dokumen`;
    $('gtTag').innerHTML = deep ? '<span class="tag tag-deep-search">Hasil Deep Search Isi Teks</span>' : '';
    $('gtError').style.display = 'none';
    if (!data.length) { $('gtCards').style.display = 'none'; $('gtTable').style.display = 'none'; $('gtEmpty').style.display = 'block'; return; }
    $('gtEmpty').style.display = 'none';

    $('gtCards').innerHTML = data.map(it => `
      <div class="material-card">
        <div>
          <div class="card-top"><div class="card-tags">
            <span class="tag tag-semester">${esc(it.semester)}</span>
            <span class="tag ${badgeClass(it.tipe)}">${esc(it.tipe)}</span>
            ${it.isDeepSearchResult ? '<span class="tag tag-deep-search">Cocok Isi PDF</span>' : ''}
          </div></div>
          <div class="card-body">
            <div class="pdf-icon-box"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div>
            <div class="card-info">
              <div class="card-matkul" title="${esc(it.matkul)}">${esc(it.matkul)}</div>
              <h3 class="card-title" title="${esc(it.namaFile)}">${esc(it.namaFile)}</h3>
            </div>
          </div>
        </div>
        <div class="card-footer">
          <span class="card-date">🕒 ${esc(it.lastUpdated)}</span>
          <a href="${esc(it.linkPreview)}" target="_blank" rel="noopener noreferrer" class="btn-open">Buka PDF ↗</a>
        </div>
      </div>`).join('');

    $('gtTableBody').innerHTML = data.map(it => `
      <tr>
        <td><span class="tag tag-semester">${esc(it.semester)}</span></td>
        <td><strong>${esc(it.matkul)}</strong></td>
        <td>${esc(it.namaFile)}</td>
        <td><span class="tag ${badgeClass(it.tipe)}">${esc(it.tipe)}</span></td>
        <td style="text-align:right"><a href="${esc(it.linkPreview)}" target="_blank" rel="noopener noreferrer" class="btn-open" style="padding:.3rem .7rem;font-size:.75rem">Buka</a></td>
      </tr>`).join('');
    setView(viewMode);
  }

  function setView(mode) {
    viewMode = mode;
    $('gtCardBtn').classList.toggle('active', mode === 'card');
    $('gtTableBtn').classList.toggle('active', mode === 'table');
    if (displayed.length) {
      $('gtCards').style.display = mode === 'card' ? 'grid' : 'none';
      $('gtTable').style.display = mode === 'table' ? 'block' : 'none';
    }
  }

  function toast(msg, kind) { if (window.App) App.toast(msg, kind); else alert(msg); }

  // Deep Search & Sinkronisasi berjalan di Apps Script (butuh akses Drive).
  // Dibuka dari Apps Script -> google.script.run; dibuka dari hosting biasa -> fetch ke APPS_SCRIPT_URL.
  // Di mode prototipe (tanpa database) token tidak bisa diverifikasi Apps Script, jadi tidak dipakai.
  const SCRIPT_AVAILABLE = () => HAS_APPS_SCRIPT() || (Auth.REMOTE && Auth.SCRIPT_READY);
  function runScript(action, data, fnName, fnArg) {
    if (HAS_APPS_SCRIPT()) {
      return new Promise((res, rej) => google.script.run.withSuccessHandler(res).withFailureHandler(rej)[fnName](fnArg));
    }
    return Auth.callScript(action, data);
  }

  let deepBusy = false;
  function deepSearch(keyword) {
    if (!SCRIPT_AVAILABLE()) {
      toast('Mode prototipe: Deep Search isi PDF butuh backend (Supabase + Apps Script). Sementara memakai pencarian judul, mata kuliah, dan semester.', 'warn');
      applyFilters(); return;
    }
    if (deepBusy) return;
    deepBusy = true;
    showLoading(true, 'Memindai Isi Dokumen PDF...', 'Mencari kata "' + keyword + '" di dalam lembar PDF Google Drive...');
    runScript('deepSearch', { keyword }, 'searchFullText', keyword)
      .then(r => {
        showLoading(false);
        if (r && r.success) { displayed = r.results || []; render(displayed, true); }
        else { toast((r && (r.message || r.error)) || 'Pencarian tidak membuahkan hasil.', 'warn'); applyFilters(); }
      })
      .catch(e => { showLoading(false); toast('Pencarian isi gagal: ' + e, 'err'); applyFilters(); })
      .finally(() => { deepBusy = false; });
  }

  function runSearch() {
    const kw = $('gtSearch').value.trim();
    if ($('gtDeep').checked) {
      if (kw.length < 3) { toast('Masukkan kata kunci minimal 3 karakter untuk Deep Search.', 'warn'); return; }
      deepSearch(kw);
    } else applyFilters();
  }

  function resetFilters() {
    $('gtSearch').value = ''; $('gtClear').style.display = 'none';
    $('gtSemester').value = ''; $('gtCourse').value = '';
    $('gtDeep').checked = false; $('gtSearchBtn').firstElementChild.textContent = 'Cari Materi';
    quickType = 'ALL';
    document.querySelectorAll('#gtPills .type-pill').forEach(b => b.classList.toggle('active', b.dataset.type === 'ALL'));
    applyFilters();
  }

  function sync() {
    if (!isAdmin) return; // pengaman sisi tampilan; PIN tetap divalidasi di backend
    const pin = $('gtPin').value.trim(); if (!pin) return;
    $('gtPinModal').classList.remove('show');
    if (!SCRIPT_AVAILABLE()) { toast('Mode prototipe: Sinkronisasi Drive butuh backend Apps Script.', 'warn'); return; }
    const btn = $('gtSyncBtn'); btn.disabled = true; $('gtSyncText').textContent = 'Memindai...';
    showLoading(true, 'Mengindeks Folder Google Drive...', 'Menelusuri struktur Gumateri. Memerlukan waktu 2–3 menit...');
    const done = () => { btn.disabled = false; $('gtSyncText').textContent = 'Sinkronkan Drive'; };
    runScript('sync', { pin }, 'syncFolderWithAuth', pin)
      .then(r => { done(); if (r && r.success) { toast(r.message, 'ok'); loaded = false; init(true); } else { showLoading(false); toast((r && r.error) || 'Gagal sinkronisasi.', 'err'); applyFilters(); } })
      .catch(e => { done(); showLoading(false); toast('Gagal sinkronisasi: ' + e, 'err'); applyFilters(); });
  }

  function init(force) {
    showLoading(true, 'Memuat Database Gumateri...', 'Mengambil data dari Google Spreadsheet.');
    $('gtCount').textContent = 'Memuat katalog...';
    load(force).then(() => { showLoading(false); populate(); applyFilters(); })
      .catch(err => {
        showLoading(false);
        $('gtCount').textContent = 'Gagal memuat database';
        $('gtErrorMsg').textContent = 'Pesan: ' + err.message + '. Pastikan spreadsheet dibagikan sebagai "Siapa saja yang memiliki link" dan nama sheet benar (' + SHEET_NAME + ').';
        $('gtError').style.display = 'block';
      });
  }

  function bind() {
    let t;
    $('gtSearch').addEventListener('input', () => {
      $('gtClear').style.display = $('gtSearch').value ? 'flex' : 'none';
      if (!$('gtDeep').checked) { clearTimeout(t); t = setTimeout(applyFilters, 120); }
    });
    $('gtSearch').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
    $('gtClear').addEventListener('click', () => { $('gtSearch').value = ''; $('gtClear').style.display = 'none'; applyFilters(); });
    $('gtSearchBtn').addEventListener('click', runSearch);
    $('gtSemester').addEventListener('change', applyFilters);
    $('gtCourse').addEventListener('change', applyFilters);
    $('gtReset').addEventListener('click', resetFilters);
    $('gtDeep').addEventListener('change', () => {
      $('gtSearchBtn').firstElementChild.textContent = $('gtDeep').checked ? 'Cari Isi PDF' : 'Cari Materi';
      if (!$('gtDeep').checked) applyFilters();
    });
    $('gtPills').addEventListener('click', e => {
      const b = e.target.closest('.type-pill'); if (!b) return;
      quickType = b.dataset.type;
      document.querySelectorAll('#gtPills .type-pill').forEach(x => x.classList.toggle('active', x === b));
      applyFilters();
    });
    $('gtCardBtn').addEventListener('click', () => setView('card'));
    $('gtTableBtn').addEventListener('click', () => setView('table'));
    $('gtRetry').addEventListener('click', () => init(true));
    $('gtSyncBtn').addEventListener('click', () => { $('gtPin').value = ''; $('gtPinModal').classList.add('show'); $('gtPin').focus(); });
    $('gtPinCancel').addEventListener('click', () => $('gtPinModal').classList.remove('show'));
    $('gtPinOk').addEventListener('click', sync);
    $('gtPin').addEventListener('keydown', e => { if (e.key === 'Enter') sync(); });
  }

  /* ---------- API publik ---------- */
  function mount(container, user) {
    isAdmin = !!user && user.role === 'admin';
    container.innerHTML = TEMPLATE;
    bind();
    $('gtSyncBtn').classList.toggle('hidden', !isAdmin);
    init(false);
  }

  return {
    mount,
    preload: () => load(false).catch(() => {}),
    onStats: fn => { listeners.push(fn); if (loaded) fn({ files: all.length, courses: courses.length }); },
    stats: () => ({ files: all.length, courses: courses.length, loaded })
  };
})();
