-- =====================================================================
-- GUMA PORTAL - DATABASE (Supabase / PostgreSQL)
-- Tempel SELURUH isi file ini di Supabase > SQL Editor > New query > Run.
-- Aman dijalankan ulang (idempotent): data akun yang sudah ada tidak dihapus.
--
-- Keamanan:
--  * Semua tabel ada di schema "guma" yang TIDAK terbuka lewat API Supabase.
--  * Satu-satunya pintu masuk adalah fungsi public.guma_api(). Sandi disimpan
--    sebagai hash bcrypt, token sesi disimpan sebagai hash SHA-256.
--  * Kunci "anon" di js/config.js memang publik; ia hanya bisa memanggil guma_api().
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists guma;

-- ---------------------------------------------------------------- TABEL
create table if not exists guma.users (
  id          uuid primary key default gen_random_uuid(),
  username    text not null unique check (username ~ '^[a-z0-9._-]{3,24}$'),
  name        text not null check (char_length(name) between 1 and 80),
  nim         text not null default '' check (char_length(nim) <= 20),
  role        text not null default 'mahasiswa' check (role in ('admin','guma','civimat','mahasiswa')),
  pw_hash     text not null,
  active      boolean not null default true,
  must_change boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists guma.sessions (
  token_hash text primary key,
  user_id    uuid not null references guma.users(id) on delete cascade,
  expires_at timestamptz not null
);
create index if not exists sessions_user_idx on guma.sessions(user_id);
create index if not exists sessions_exp_idx  on guma.sessions(expires_at);

create table if not exists guma.access (
  feature text primary key check (feature ~ '^[a-z0-9_-]{1,40}$'),
  roles   text[] not null default '{}'
);

create table if not exists guma.login_fails (
  username     text primary key,
  fails        int not null default 0,
  locked_until timestamptz
);

create table if not exists guma.reg_log (
  id bigserial primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists reg_log_at_idx on guma.reg_log(at);

alter table guma.users       enable row level security;
alter table guma.sessions    enable row level security;
alter table guma.access      enable row level security;
alter table guma.login_fails enable row level security;
alter table guma.reg_log     enable row level security;

-- ------------------------------------------------------------ HELPER
create or replace function guma.h(t text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(coalesce(t, ''), 'utf8')), 'hex')
$$;

create or replace function guma.err(msg text, code text default null) returns jsonb
language sql immutable as $$
  select case when code is null then jsonb_build_object('ok', false, 'error', msg)
              else jsonb_build_object('ok', false, 'error', msg, 'code', code) end
$$;

create or replace function guma.try_uuid(t text) returns uuid
language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

create or replace function guma.pub(u guma.users) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', u.id, 'username', u.username, 'name', u.name, 'nim', u.nim,
                            'role', u.role, 'active', u.active, 'mustChange', u.must_change,
                            'createdAt', u.created_at)
$$;

create or replace function guma.access_matrix() returns jsonb
language sql stable as $$
  select coalesce(jsonb_object_agg(feature, to_jsonb(roles)), '{}'::jsonb) from guma.access
$$;

create or replace function guma.pw_error(pw text) returns text
language sql immutable as $$
  select case
    when pw is null or char_length(pw) < 8 then 'Kata sandi minimal 8 karakter.'
    when char_length(pw) > 128 then 'Kata sandi terlalu panjang.'
    when pw !~ '[A-Za-z]' or pw !~ '[0-9]' then 'Kata sandi harus memuat huruf dan angka.'
  end
$$;

create or replace function guma.new_user_error(d jsonb) returns text
language sql immutable as $$
  select case
    when coalesce(trim(d->>'name'), '') = '' or char_length(trim(d->>'name')) > 80
      then 'Nama wajib diisi (maks. 80 karakter).'
    when lower(trim(coalesce(d->>'username', ''))) !~ '^[a-z0-9._-]{3,24}$'
      then 'Username 3-24 karakter: huruf kecil, angka, titik, strip, atau garis bawah.'
    when char_length(coalesce(d->>'nim', '')) > 20 then 'NIM terlalu panjang.'
    else guma.pw_error(d->>'password')
  end
$$;

-- Mengembalikan baris user bila token valid & akun aktif; bila tidak, semua kolom NULL.
create or replace function guma.auth_user(p_token text) returns guma.users
language plpgsql stable as $$
declare r guma.users;
begin
  if p_token is null or char_length(p_token) < 32 then return r; end if;
  select u.* into r
    from guma.sessions s join guma.users u on u.id = s.user_id
   where s.token_hash = guma.h(p_token) and s.expires_at > now() and u.active;
  return r;
end $$;

create or replace function guma.new_session(p_user uuid, p_remember boolean) returns text
language plpgsql set search_path = guma, extensions, public as $$
declare t text := encode(gen_random_bytes(32), 'hex');
begin
  delete from guma.sessions where expires_at < now();
  insert into guma.sessions(token_hash, user_id, expires_at)
  values (guma.h(t), p_user, now() + case when p_remember then interval '14 days' else interval '8 hours' end);
  return t;
end $$;

-- ------------------------------------------------------ LOGIN & DAFTAR
create or replace function guma.f_login(d jsonb) returns jsonb
language plpgsql set search_path = guma, extensions, public as $$
declare
  uname text := lower(trim(coalesce(d->>'username', '')));
  pw    text := coalesce(d->>'password', '');
  u     guma.users;
  f     guma.login_fails;
  good  boolean := false;
  t     text;
begin
  if char_length(pw) > 128 or char_length(uname) > 24 then
    return guma.err('Username atau kata sandi salah.');
  end if;

  select * into f from guma.login_fails where username = uname;
  if f.locked_until is not null and f.locked_until > now() then
    return guma.err('Terlalu banyak percobaan. Coba lagi beberapa menit lagi.');
  end if;

  select * into u from guma.users where username = uname;
  if u.id is null then
    perform crypt(pw, gen_salt('bf', 10));   -- samakan waktu respons agar username tidak bocor
  else
    good := (u.pw_hash = crypt(pw, u.pw_hash));
  end if;

  if not good then
    if u.id is not null then
      insert into guma.login_fails(username, fails) values (uname, 1)
      on conflict (username) do update set
        fails        = case when guma.login_fails.fails + 1 >= 5 then 0 else guma.login_fails.fails + 1 end,
        locked_until = case when guma.login_fails.fails + 1 >= 5 then now() + interval '5 minutes'
                            else guma.login_fails.locked_until end;
    end if;
    return guma.err('Username atau kata sandi salah.');
  end if;

  if not u.active then return guma.err('Akun dinonaktifkan. Hubungi admin.'); end if;

  delete from guma.login_fails where username = uname;
  t := guma.new_session(u.id, coalesce((d->>'remember')::boolean, false));
  return jsonb_build_object('ok', true, 'token', t, 'user', guma.pub(u), 'access', guma.access_matrix());
end $$;

create or replace function guma.f_register(d jsonb) returns jsonb
language plpgsql set search_path = guma, extensions, public as $$
declare
  e     text := guma.new_user_error(d);
  uname text := lower(trim(coalesce(d->>'username', '')));
  hdr   jsonb;
  v_ip  text;
begin
  if e is not null then return guma.err(e); end if;

  begin
    hdr := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  exception when others then
    hdr := '{}'::jsonb;
  end;
  v_ip := coalesce(nullif(trim(split_part(coalesce(hdr->>'x-forwarded-for', ''), ',', 1)), ''), '?');

  delete from guma.reg_log where at < now() - interval '1 day';
  -- Batas pendaftaran per jam (per IP dilonggarkan karena wifi kampus berbagi satu IP)
  if (select count(*) from guma.reg_log where at > now() - interval '1 hour') >= 200
     or (select count(*) from guma.reg_log where ip = v_ip and at > now() - interval '1 hour') >= 60 then
    return guma.err('Terlalu banyak pendaftaran. Coba lagi nanti.');
  end if;

  insert into guma.users(username, name, nim, role, pw_hash, must_change)
  values (uname, trim(d->>'name'), trim(coalesce(d->>'nim', '')), 'mahasiswa',
          crypt(d->>'password', gen_salt('bf', 10)), false);
  insert into guma.reg_log(ip) values (v_ip);
  return jsonb_build_object('ok', true);
exception when unique_violation then
  return guma.err('Username sudah dipakai.');
end $$;

-- ============================================================ FORUM
create table if not exists guma.forum_rooms (
  id          text primary key check (id ~ '^[a-z0-9_-]{1,30}$'),
  name        text not null check (char_length(name) between 1 and 60),
  description text not null default '',
  roles       text[] not null default '{admin,guma,civimat,mahasiswa}'   -- tingkatan yang boleh masuk ruang ini
);
create table if not exists guma.forum_posts (
  id         bigserial primary key,
  room       text not null references guma.forum_rooms(id) on delete cascade,
  user_id    uuid not null references guma.users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists forum_posts_room_idx on guma.forum_posts(room, id desc);
alter table guma.forum_rooms enable row level security;
alter table guma.forum_posts enable row level security;

-- ===================================================== PEMINJAMAN
create table if not exists guma.loan_resources (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('ruangan', 'alat')),
  name       text not null unique check (char_length(name) between 1 and 80),
  note       text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create table if not exists guma.loan_bookings (
  id            uuid primary key default gen_random_uuid(),
  resource_id   uuid not null references guma.loan_resources(id) on delete cascade,
  borrower_type text not null check (borrower_type in ('birdept', 'person')),   -- biro/departemen atau perorangan
  borrower      text not null check (char_length(borrower) between 1 and 80),
  purpose       text not null default '' check (char_length(purpose) <= 200),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  created_by    uuid references guma.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists loan_bookings_res_idx on guma.loan_bookings(resource_id, starts_at);
create index if not exists loan_bookings_end_idx on guma.loan_bookings(ends_at);
alter table guma.loan_resources enable row level security;
alter table guma.loan_bookings  enable row level security;

create or replace function guma.try_ts(t text) returns timestamptz
language plpgsql immutable as $$
begin
  return t::timestamptz;
exception when others then
  return null;
end $$;

-- Apakah pengguna boleh memakai fitur (sama dengan matriks hak akses di Panel Admin)
create or replace function guma.can(u guma.users, fid text) returns boolean
language sql stable as $$
  select u.role in ('admin', 'guma')
      or exists (select 1 from guma.access a where a.feature = fid and u.role = any(a.roles))
$$;

create or replace function guma.f_forum(me guma.users, p_action text, d jsonb) returns jsonb
language plpgsql as $$
declare
  v_room  text := d->>'room';
  v_after bigint := case when coalesce(d->>'after', '') ~ '^[0-9]{1,18}$' then (d->>'after')::bigint else 0 end;
  v_body  text;
  r       guma.forum_rooms;
  p       guma.forum_posts;
begin
  if not guma.can(me, 'forum') then return guma.err('Anda tidak punya akses ke Forum.', 'FORBIDDEN'); end if;

  if p_action = 'forum.rooms' then
    return jsonb_build_object('ok', true, 'rooms',
      (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'description', x.description) order by x.name), '[]'::jsonb)
         from guma.forum_rooms x where me.role = 'admin' or me.role = any(x.roles)));
  end if;

  if p_action = 'forum.delete' then
    select * into p from guma.forum_posts where id = case when coalesce(d->>'id', '') ~ '^[0-9]{1,18}$' then (d->>'id')::bigint else 0 end;
    if p.id is null then return guma.err('Pesan tidak ditemukan.'); end if;
    if p.user_id <> me.id and me.role not in ('admin', 'guma') then return guma.err('Anda hanya dapat menghapus pesan sendiri.'); end if;
    delete from guma.forum_posts where id = p.id;
    return jsonb_build_object('ok', true);
  end if;

  -- list & post butuh ruang yang boleh dimasuki
  select * into r from guma.forum_rooms where id = coalesce(v_room, '');
  if r.id is null or not (me.role = 'admin' or me.role = any(r.roles)) then
    return guma.err('Ruang tidak ditemukan atau tidak dapat diakses.', 'FORBIDDEN');
  end if;

  if p_action = 'forum.list' then
    return jsonb_build_object('ok', true, 'posts',
      (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from (
         select fp.id, fp.body, fp.created_at as "createdAt", fp.user_id as "userId", u.name, u.role
           from guma.forum_posts fp join guma.users u on u.id = fp.user_id
          where fp.room = r.id and (v_after = 0 or fp.id > v_after)
          order by fp.id desc limit 60) x));
  end if;

  if p_action = 'forum.post' then
    v_body := trim(coalesce(d->>'body', ''));
    if v_body = '' then return guma.err('Pesan tidak boleh kosong.'); end if;
    if char_length(v_body) > 1000 then return guma.err('Pesan maksimal 1000 karakter.'); end if;
    if exists (select 1 from guma.forum_posts where user_id = me.id and created_at > now() - interval '2 seconds') then
      return guma.err('Terlalu cepat. Tunggu sebentar sebelum mengirim lagi.');
    end if;
    insert into guma.forum_posts(room, user_id, body) values (r.id, me.id, v_body);
    return jsonb_build_object('ok', true);
  end if;

  return guma.err('Aksi tidak dikenal.');
end $$;

create or replace function guma.f_loan(me guma.users, p_action text, d jsonb) returns jsonb
language plpgsql as $$
declare
  v_mgr   boolean := me.role in ('admin', 'guma');   -- pengelola: boleh mencatat peminjaman
  res     guma.loan_resources;
  c       guma.loan_bookings;
  b       guma.loan_bookings;
  v_start timestamptz;
  v_end   timestamptz;
  v_type  text;
  v_who   text;
  v_kind  text;
  v_name  text;
  v_from  timestamptz := guma.try_ts(d->>'from');   -- opsional: rentang untuk tampilan kalender
  v_to    timestamptz := guma.try_ts(d->>'to');
begin
  if not guma.can(me, 'peminjaman') then return guma.err('Anda tidak punya akses ke Peminjaman.', 'FORBIDDEN'); end if;

  if p_action = 'loan.overview' then
    return jsonb_build_object('ok', true, 'now', now(), 'canManage', v_mgr, 'isAdmin', me.role = 'admin',
      'resources', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'name', x.name, 'note', x.note) order by x.kind, x.name), '[]'::jsonb)
                      from guma.loan_resources x),
      'bookings', (select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'resourceId', y.resource_id, 'borrowerType', y.borrower_type,
                      'borrower', y.borrower, 'purpose', y.purpose, 'startsAt', y.starts_at, 'endsAt', y.ends_at) order by y.starts_at), '[]'::jsonb)
                     from (select * from guma.loan_bookings
                             where case when v_from is not null and v_to is not null
                                        then starts_at < v_to and ends_at > v_from
                                        else ends_at > now() - interval '12 hours' end
                             order by starts_at limit 500) y));
  end if;

  if p_action in ('loan.book', 'loan.cancel', 'loan.finish') and not v_mgr then
    return guma.err('Hanya Admin dan Member Guma yang dapat mencatat peminjaman.');
  end if;
  if p_action in ('loan.resourceSave', 'loan.resourceDelete') and me.role <> 'admin' then
    return guma.err('Hanya admin yang dapat mengelola daftar ruangan/alat.');
  end if;

  if p_action = 'loan.book' then
    select * into res from guma.loan_resources where id = guma.try_uuid(d->>'resourceId');
    if res.id is null then return guma.err('Ruangan/alat tidak ditemukan.'); end if;
    v_type := d->>'borrowerType';
    if v_type is null or v_type not in ('birdept', 'person') then return guma.err('Jenis peminjam tidak valid.'); end if;
    v_who := trim(coalesce(d->>'borrower', ''));
    if v_who = '' or char_length(v_who) > 80 then return guma.err('Nama peminjam wajib diisi (maks. 80 karakter).'); end if;
    if char_length(coalesce(d->>'purpose', '')) > 200 then return guma.err('Keperluan maksimal 200 karakter.'); end if;
    v_start := guma.try_ts(d->>'startsAt');
    v_end   := guma.try_ts(d->>'endsAt');
    if v_start is null or v_end is null then return guma.err('Waktu mulai/selesai tidak valid.'); end if;
    if v_end <= v_start then return guma.err('Waktu selesai harus setelah waktu mulai.'); end if;
    if v_end <= now() then return guma.err('Waktu selesai sudah lewat.'); end if;
    if v_end - v_start > interval '14 days' then return guma.err('Satu peminjaman maksimal 14 hari.'); end if;

    perform pg_advisory_xact_lock(hashtext(res.id::text));   -- cegah dua pencatatan bentrok bersamaan
    select * into c from guma.loan_bookings
     where resource_id = res.id and starts_at < v_end and ends_at > v_start
     order by starts_at limit 1;
    if c.id is not null then
      return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'error',
        res.name || ' sudah dipinjam ' || c.borrower || ' (' ||
        to_char(c.starts_at at time zone 'Asia/Jakarta', 'DD/MM HH24:MI') || ' - ' ||
        to_char(c.ends_at at time zone 'Asia/Jakarta', 'DD/MM HH24:MI') || ' WIB).');
    end if;
    insert into guma.loan_bookings(resource_id, borrower_type, borrower, purpose, starts_at, ends_at, created_by)
    values (res.id, v_type, v_who, trim(coalesce(d->>'purpose', '')), v_start, v_end, me.id);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'loan.cancel' then
    delete from guma.loan_bookings where id = guma.try_uuid(d->>'id');
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'loan.finish' then   -- tandai selesai sekarang (barang/ruangan sudah dikembalikan)
    select * into b from guma.loan_bookings where id = guma.try_uuid(d->>'id');
    if b.id is null then return guma.err('Peminjaman tidak ditemukan.'); end if;
    if b.starts_at > now() then delete from guma.loan_bookings where id = b.id;
    else update guma.loan_bookings set ends_at = least(ends_at, now()) where id = b.id; end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'loan.resourceSave' then
    v_kind := d->>'kind';
    v_name := trim(coalesce(d->>'name', ''));
    if v_kind is null or v_kind not in ('ruangan', 'alat') then return guma.err('Jenis harus ruangan atau alat.'); end if;
    if v_name = '' or char_length(v_name) > 80 then return guma.err('Nama wajib diisi (maks. 80 karakter).'); end if;
    if char_length(coalesce(d->>'note', '')) > 200 then return guma.err('Catatan maksimal 200 karakter.'); end if;
    begin
      insert into guma.loan_resources(kind, name, note) values (v_kind, v_name, trim(coalesce(d->>'note', '')));
    exception when unique_violation then
      return guma.err('Nama itu sudah ada.');
    end;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'loan.resourceDelete' then
    delete from guma.loan_resources where id = guma.try_uuid(d->>'id');   -- peminjamannya ikut terhapus
    return jsonb_build_object('ok', true);
  end if;

  return guma.err('Aksi tidak dikenal.');
end $$;

-- ---------------------------------------------------- PINTU MASUK API
create or replace function public.guma_api(p_action text, p_token text default null, p_data jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = guma, extensions, public as $$
declare
  d       jsonb := coalesce(p_data, '{}'::jsonb);
  me      guma.users;
  tgt     guma.users;
  e       text;
  n_admin int;
  v_roles text[];
  v_fid   text;
  v_role  text;
  v_act   boolean;
begin
  if p_action = 'login'    then return guma.f_login(d); end if;
  if p_action = 'register' then return guma.f_register(d); end if;

  me := guma.auth_user(p_token);
  if me.id is null then return guma.err('Sesi tidak valid atau sudah berakhir.', 'UNAUTH'); end if;

  if p_action = 'me' then
    return jsonb_build_object('ok', true, 'user', guma.pub(me), 'access', guma.access_matrix());
  end if;

  if p_action = 'logout' then
    delete from guma.sessions where token_hash = guma.h(p_token);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'changePassword' then
    if me.pw_hash <> crypt(coalesce(d->>'oldPassword', ''), me.pw_hash) then
      return guma.err('Kata sandi lama salah.');
    end if;
    e := guma.pw_error(d->>'newPassword');
    if e is not null then return guma.err(e); end if;
    update guma.users set pw_hash = crypt(d->>'newPassword', gen_salt('bf', 10)), must_change = false where id = me.id;
    delete from guma.sessions where user_id = me.id and token_hash <> guma.h(p_token);
    return jsonb_build_object('ok', true);
  end if;

  if left(p_action, 6) = 'forum.' then return guma.f_forum(me, p_action, d); end if;
  if left(p_action, 5) = 'loan.'  then return guma.f_loan(me, p_action, d); end if;

  if left(p_action, 6) = 'admin.' then
    if me.role <> 'admin' then return guma.err('Hanya admin yang boleh melakukan ini.'); end if;

    if p_action = 'admin.list' then
      return jsonb_build_object('ok', true,
        'users', (select coalesce(jsonb_agg(guma.pub(u) order by u.created_at), '[]'::jsonb) from guma.users u));
    end if;

    if p_action = 'admin.create' then
      e := guma.new_user_error(d);
      if e is not null then return guma.err(e); end if;
      v_role := d->>'role';
      if v_role is null or v_role not in ('admin', 'guma', 'civimat', 'mahasiswa') then return guma.err('Peran tidak valid.'); end if;
      begin
        insert into guma.users(username, name, nim, role, pw_hash, must_change)
        values (lower(trim(d->>'username')), trim(d->>'name'), trim(coalesce(d->>'nim', '')), v_role,
                crypt(d->>'password', gen_salt('bf', 10)), true);
      exception when unique_violation then
        return guma.err('Username sudah dipakai.');
      end;
      return jsonb_build_object('ok', true);
    end if;

    if p_action = 'admin.setAccess' then
      v_fid := coalesce(d->>'feature', '');
      if v_fid !~ '^[a-z0-9_-]{1,40}$' then return guma.err('Fitur tidak valid.'); end if;
      select coalesce(array_agg(distinct x), '{}') into v_roles
        from jsonb_array_elements_text(case when jsonb_typeof(d->'roles') = 'array' then d->'roles' else '[]'::jsonb end) x
       where x in ('mahasiswa', 'civimat');
      insert into guma.access(feature, roles) values (v_fid, v_roles)
      on conflict (feature) do update set roles = excluded.roles;
      return jsonb_build_object('ok', true);
    end if;

    -- Aksi di bawah ini butuh akun target
    select * into tgt from guma.users where id = guma.try_uuid(d->>'id');
    if tgt.id is null then return guma.err('Akun tidak ditemukan.'); end if;
    select count(*) into n_admin from guma.users where role = 'admin' and active;

    if p_action = 'admin.update' then
      v_role := d->>'role';
      if v_role is not null then
        if v_role not in ('admin', 'guma', 'civimat', 'mahasiswa') then return guma.err('Peran tidak valid.'); end if;
        if tgt.role = 'admin' and v_role <> 'admin' and n_admin <= 1 then return guma.err('Tidak bisa menurunkan admin terakhir.'); end if;
      end if;
      if jsonb_typeof(d->'active') = 'boolean' then
        v_act := (d->>'active')::boolean;
        if not v_act and tgt.id = me.id then return guma.err('Anda tidak dapat menonaktifkan akun sendiri.'); end if;
        if not v_act and tgt.role = 'admin' and n_admin <= 1 then return guma.err('Tidak bisa menonaktifkan admin terakhir.'); end if;
      end if;
      update guma.users set role = coalesce(v_role, role), active = coalesce(v_act, active) where id = tgt.id;
      if v_act is false then delete from guma.sessions where user_id = tgt.id; end if;
      return jsonb_build_object('ok', true);
    end if;

    if p_action = 'admin.resetPassword' then
      e := guma.pw_error(d->>'password');
      if e is not null then return guma.err(e); end if;
      update guma.users set pw_hash = crypt(d->>'password', gen_salt('bf', 10)), must_change = true where id = tgt.id;
      delete from guma.sessions where user_id = tgt.id;
      return jsonb_build_object('ok', true);
    end if;

    if p_action = 'admin.delete' then
      if tgt.id = me.id then return guma.err('Anda tidak dapat menghapus akun sendiri.'); end if;
      if tgt.role = 'admin' and n_admin <= 1 then return guma.err('Tidak bisa menghapus admin terakhir.'); end if;
      delete from guma.users where id = tgt.id;   -- sesi ikut terhapus (cascade)
      return jsonb_build_object('ok', true);
    end if;
  end if;

  return guma.err('Aksi tidak dikenal.');
end $$;

revoke all on function public.guma_api(text, text, jsonb) from public;
grant execute on function public.guma_api(text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------- DATA AWAL
-- Admin bawaan: username "admin", sandi "admin123" (diminta diganti saat masuk).
insert into guma.users(username, name, role, pw_hash, must_change)
values ('admin', 'Administrator', 'admin', crypt('admin123', gen_salt('bf', 10)), true)
on conflict (username) do nothing;

insert into guma.access(feature, roles) values
  ('gumateri',  '{mahasiswa,civimat}'),
  ('agenda',    '{mahasiswa,civimat}'),
  ('forum',     '{mahasiswa,civimat}'),
  ('peminjaman','{mahasiswa,civimat}'),
  ('ruangguma', '{}')
on conflict (feature) do nothing;

-- Bila database sudah pernah dijalankan sebelum fitur ini, jalankan 2 baris ini sekali:
--   update guma.access set roles = '{mahasiswa,civimat}' where feature = 'forum';
--   (baris 'peminjaman' otomatis ditambahkan oleh insert di atas)

-- Ruang forum awal: "General", terbuka untuk semua tingkatan.
insert into guma.forum_rooms(id, name, description, roles)
values ('general', 'General', 'Ruang obrolan terbuka untuk semua civitas.', '{admin,guma,civimat,mahasiswa}')
on conflict (id) do nothing;

-- Contoh ruangan/alat (admin bisa menambah/menghapus di halaman Peminjaman).
insert into guma.loan_resources(kind, name, note) values
  ('ruangan', 'Ruang Sekretariat', 'Contoh data, silakan ubah'),
  ('alat',    'Proyektor',         'Contoh data, silakan ubah')
on conflict (name) do nothing;
