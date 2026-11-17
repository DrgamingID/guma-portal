/* =========================================================
   SERVER TIRUAN LOKAL untuk Forum & Peminjaman (mode prototipe)
   Meniru fungsi guma.f_forum / guma.f_loan di backend/database.sql.
   Data di localStorage browser ini saja. Dipanggil dari LocalServer (auth.js).
   ========================================================= */
const LocalExtra = (() => {
  const K = { forum: 'guma.forum.v1', loan: 'guma.loan.v1' };
  const DEFAULT_ACCESS = { forum: ['mahasiswa', 'civimat'], peminjaman: ['mahasiswa', 'civimat'] };
  const ALL_ROLES = ['admin', 'guma', 'civimat', 'mahasiswa'];

  const get = (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (e) { return f; } };
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
  const uid = () => 'l_' + Math.random().toString(16).slice(2, 12) + Date.now().toString(16);
  const err = (error, code) => code ? { ok: false, error, code } : { ok: false, error };
  const ok = extra => Object.assign({ ok: true }, extra || {});
  const fmt = iso => new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');

  function forumDb() {
    const db = get(K.forum, null);
    if (db) return db;
    const fresh = { seq: 0, rooms: [{ id: 'general', name: 'General', description: 'Ruang obrolan terbuka untuk semua civitas.', roles: ALL_ROLES.slice() }], posts: [] };
    set(K.forum, fresh); return fresh;
  }
  function loanDb() {
    const db = get(K.loan, null);
    if (db) return db;
    const fresh = { resources: [
      { id: uid(), kind: 'ruangan', name: 'Ruang Sekretariat', note: 'Contoh data, silakan ubah' },
      { id: uid(), kind: 'alat', name: 'Proyektor', note: 'Contoh data, silakan ubah' }
    ], bookings: [] };
    set(K.loan, fresh); return fresh;
  }

  function can(me, fid, access) {
    if (me.role === 'admin' || me.role === 'guma') return true;
    return (Array.isArray(access[fid]) ? access[fid] : DEFAULT_ACCESS[fid] || []).includes(me.role);
  }

  function forum(action, me, d, users) {
    const db = forumDb();
    const roomOk = r => me.role === 'admin' || r.roles.includes(me.role);
    if (action === 'forum.rooms') return ok({ rooms: db.rooms.filter(roomOk).map(r => ({ id: r.id, name: r.name, description: r.description })) });
    if (action === 'forum.delete') {
      const p = db.posts.find(x => x.id === Number(d.id));
      if (!p) return err('Pesan tidak ditemukan.');
      if (p.userId !== me.id && !['admin', 'guma'].includes(me.role)) return err('Anda hanya dapat menghapus pesan sendiri.');
      db.posts = db.posts.filter(x => x.id !== p.id); set(K.forum, db); return ok();
    }
    const room = db.rooms.find(r => r.id === d.room);
    if (!room || !roomOk(room)) return err('Ruang tidak ditemukan atau tidak dapat diakses.', 'FORBIDDEN');
    if (action === 'forum.list') {
      const after = Number(d.after) || 0;
      const rows = db.posts.filter(p => p.room === room.id && (!after || p.id > after)).slice(-60).map(p => {
        const u = users.find(x => x.id === p.userId);
        return { id: p.id, body: p.body, createdAt: p.createdAt, userId: p.userId, name: u ? u.name : '(akun dihapus)', role: u ? u.role : 'mahasiswa' };
      });
      return ok({ posts: rows });
    }
    if (action === 'forum.post') {
      const body = String(d.body || '').trim();
      if (!body) return err('Pesan tidak boleh kosong.');
      if (body.length > 1000) return err('Pesan maksimal 1000 karakter.');
      const last = db.posts.filter(p => p.userId === me.id).pop();
      if (last && Date.now() - new Date(last.createdAt).getTime() < 2000) return err('Terlalu cepat. Tunggu sebentar sebelum mengirim lagi.');
      db.posts.push({ id: ++db.seq, room: room.id, userId: me.id, body, createdAt: new Date().toISOString() });
      if (db.posts.length > 500) db.posts = db.posts.slice(-500);   // batasi penyimpanan browser
      set(K.forum, db); return ok();
    }
    return err('Aksi tidak dikenal.');
  }

  function loan(action, me, d) {
    const db = loanDb(), mgr = ['admin', 'guma'].includes(me.role), now = Date.now();
    if (action === 'loan.overview') {
      const f = new Date(d.from).getTime(), tt = new Date(d.to).getTime(), ranged = !isNaN(f) && !isNaN(tt);
      const bookings = db.bookings.filter(b => ranged ? new Date(b.startsAt).getTime() < tt && new Date(b.endsAt).getTime() > f : new Date(b.endsAt).getTime() > now - 12 * 3600e3)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      return ok({ now: new Date().toISOString(), canManage: mgr, isAdmin: me.role === 'admin', resources: db.resources.slice().sort((a, b) => (a.kind + a.name).localeCompare(b.kind + b.name)), bookings });
    }
    if (['loan.book', 'loan.cancel', 'loan.finish'].includes(action) && !mgr) return err('Hanya Admin dan Member Guma yang dapat mencatat peminjaman.');
    if (['loan.resourceSave', 'loan.resourceDelete'].includes(action) && me.role !== 'admin') return err('Hanya admin yang dapat mengelola daftar ruangan/alat.');

    if (action === 'loan.book') {
      const res = db.resources.find(r => r.id === d.resourceId);
      if (!res) return err('Ruangan/alat tidak ditemukan.');
      if (!['birdept', 'person'].includes(d.borrowerType)) return err('Jenis peminjam tidak valid.');
      const who = String(d.borrower || '').trim();
      if (!who || who.length > 80) return err('Nama peminjam wajib diisi (maks. 80 karakter).');
      if (String(d.purpose || '').length > 200) return err('Keperluan maksimal 200 karakter.');
      const s = new Date(d.startsAt).getTime(), e = new Date(d.endsAt).getTime();
      if (isNaN(s) || isNaN(e)) return err('Waktu mulai/selesai tidak valid.');
      if (e <= s) return err('Waktu selesai harus setelah waktu mulai.');
      if (e <= now) return err('Waktu selesai sudah lewat.');
      if (e - s > 14 * 86400e3) return err('Satu peminjaman maksimal 14 hari.');
      const c = db.bookings.filter(b => b.resourceId === res.id && new Date(b.startsAt).getTime() < e && new Date(b.endsAt).getTime() > s)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
      if (c) return err(`${res.name} sudah dipinjam ${c.borrower} (${fmt(c.startsAt)} - ${fmt(c.endsAt)}).`, 'CONFLICT');
      db.bookings.push({ id: uid(), resourceId: res.id, borrowerType: d.borrowerType, borrower: who, purpose: String(d.purpose || '').trim(), startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString() });
      set(K.loan, db); return ok();
    }
    if (action === 'loan.cancel') { db.bookings = db.bookings.filter(b => b.id !== d.id); set(K.loan, db); return ok(); }
    if (action === 'loan.finish') {
      const b = db.bookings.find(x => x.id === d.id);
      if (!b) return err('Peminjaman tidak ditemukan.');
      if (new Date(b.startsAt).getTime() > now) db.bookings = db.bookings.filter(x => x.id !== b.id);
      else b.endsAt = new Date(Math.min(now, new Date(b.endsAt).getTime())).toISOString();
      set(K.loan, db); return ok();
    }
    if (action === 'loan.resourceSave') {
      const name = String(d.name || '').trim();
      if (!['ruangan', 'alat'].includes(d.kind)) return err('Jenis harus ruangan atau alat.');
      if (!name || name.length > 80) return err('Nama wajib diisi (maks. 80 karakter).');
      if (String(d.note || '').length > 200) return err('Catatan maksimal 200 karakter.');
      if (db.resources.some(r => r.name === name)) return err('Nama itu sudah ada.');
      db.resources.push({ id: uid(), kind: d.kind, name, note: String(d.note || '').trim() });
      set(K.loan, db); return ok();
    }
    if (action === 'loan.resourceDelete') {
      db.resources = db.resources.filter(r => r.id !== d.id);
      db.bookings = db.bookings.filter(b => b.resourceId !== d.id);
      set(K.loan, db); return ok();
    }
    return err('Aksi tidak dikenal.');
  }

  function handle(action, me, d, users, access) {
    const fid = action.startsWith('forum.') ? 'forum' : 'peminjaman';
    if (!can(me, fid, access)) return err(fid === 'forum' ? 'Anda tidak punya akses ke Forum.' : 'Anda tidak punya akses ke Peminjaman.', 'FORBIDDEN');
    return fid === 'forum' ? forum(action, me, d, users) : loan(action, me, d);
  }
  return { handle };
})();
