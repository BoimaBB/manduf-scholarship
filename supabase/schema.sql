-- =====================================================================
-- Mandu Foundation (ManDuF) Scholarship Portal — database schema
-- Run this whole file once in Supabase: Dashboard → SQL Editor → New query.
-- Safe to re-run: objects are created "if not exists" or replaced.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Settings (single row, edited by admins, readable by everyone)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                 int primary key default 1 check (id = 1),
  academic_year      text    not null default '2026/2027',
  applications_open  boolean not null default true,
  closing_date       date,
  submit_note        text,
  contact_phone      text,
  contact_email      text,
  updated_at         timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Staff (who may use the admin dashboard) — role: admin | assessor
-- ---------------------------------------------------------------------
create table if not exists public.staff (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null,
  role        text not null check (role in ('admin', 'assessor')),
  created_at  timestamptz not null default now()
);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and role = 'admin');
$$;

-- ---------------------------------------------------------------------
-- 3. Applications
-- ---------------------------------------------------------------------
create sequence if not exists public.application_seq;

create table if not exists public.applications (
  id                   uuid primary key,
  app_no               text unique not null,
  access_code_hash     text not null,
  academic_year        text not null,
  submitted_at         timestamptz not null default now(),

  -- key fields copied out of the form for listing / searching
  full_name            text not null,
  gender               text,
  mobile               text,
  email                text,
  nin                  text,
  section              text,
  institution          text,
  programme            text,
  level                text,
  amount_requested     numeric(14,2),

  form                 jsonb not null,               -- the complete application
  documents            jsonb not null default '[]',  -- [{key, path, name, size, mime}]

  -- review & decision (staff only)
  status               text not null default 'submitted'
                         check (status in ('submitted','under_review','shortlisted',
                                           'awarded','waitlisted','not_awarded','ineligible')),
  screen_form_complete boolean not null default false,
  screen_docs_complete boolean not null default false,
  screen_year_one      boolean not null default false,
  screen_origin        boolean not null default false,
  eligibility          text check (eligibility in ('eligible','not_eligible')),
  ineligible_reason    text,
  interview_date       date,
  interview_outcome    text,
  amount_awarded       numeric(14,2),
  award_covers         text[],
  award_period         text check (award_period in ('one_year','renewable','full_programme')),
  public_message       text,          -- shown to the applicant on the status page
  internal_notes       text,          -- staff only
  decided_at           timestamptz,
  decided_by           uuid,
  updated_at           timestamptz not null default now()
);

-- one application per National ID per academic year
create unique index if not exists applications_nin_year_uq
  on public.applications (academic_year, upper(nin))
  where nin is not null and nin <> '';
create index if not exists applications_status_idx on public.applications (status);

-- ---------------------------------------------------------------------
-- 4. Scores — one row per assessor per application
--    Weighted total = Score × Weight ÷ 10 (weights 40/30/20/10) → out of 100
-- ---------------------------------------------------------------------
create table if not exists public.scores (
  application_id      uuid not null references public.applications(id) on delete cascade,
  assessor_id         uuid not null references public.staff(user_id) on delete cascade,
  financial_need      numeric(4,1) check (financial_need     between 0 and 10),
  academic_merit      numeric(4,1) check (academic_merit     between 0 and 10),
  personal_statement  numeric(4,1) check (personal_statement between 0 and 10),
  leadership          numeric(4,1) check (leadership         between 0 and 10),
  weighted_total      numeric(5,1) generated always as
                        (financial_need * 4 + academic_merit * 3 + personal_statement * 2 + leadership * 1) stored,
  comments            text,
  updated_at          timestamptz not null default now(),
  primary key (application_id, assessor_id)
);

-- ---------------------------------------------------------------------
-- 5. Housekeeping triggers
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.track_decision() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status
     and new.status in ('awarded','waitlisted','not_awarded','ineligible') then
    new.decided_at := now();
    new.decided_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists applications_touch on public.applications;
create trigger applications_touch before update on public.applications
  for each row execute function public.touch_updated_at();
drop trigger if exists applications_decision on public.applications;
create trigger applications_decision before update on public.applications
  for each row execute function public.track_decision();
drop trigger if exists scores_touch on public.scores;
create trigger scores_touch before update on public.scores
  for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 6. Overview for the dashboard (respects the caller's permissions)
-- ---------------------------------------------------------------------
create or replace view public.application_overview with (security_invoker = true) as
select a.id, a.app_no, a.academic_year, a.submitted_at, a.full_name, a.gender, a.mobile,
       a.email, a.section, a.institution, a.programme, a.level, a.amount_requested,
       a.status, a.eligibility, a.amount_awarded,
       a.screen_form_complete, a.screen_docs_complete, a.screen_year_one, a.screen_origin,
       count(s.weighted_total)                    as n_scores,
       round(avg(s.weighted_total), 1)            as avg_score,
       round(avg(s.financial_need), 1)            as avg_need,
       round(avg(s.academic_merit), 1)            as avg_merit,
       round(avg(s.personal_statement), 1)        as avg_statement,
       round(avg(s.leadership), 1)                as avg_leadership
from public.applications a
left join public.scores s on s.application_id = a.id
group by a.id;

-- ---------------------------------------------------------------------
-- 7. Public functions used by applicants (no login)
-- ---------------------------------------------------------------------
create or replace function public.application_exists(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.applications where id = p_id);
$$;

-- Submit a completed application. Documents must already be uploaded to
-- storage under "<p_id>/...". Returns the application number and a
-- one-time access code (only its hash is stored).
create or replace function public.submit_application(p_id uuid, p_form jsonb)
returns table (app_no text, access_code text)
language plpgsql security definer set search_path = public as $$
declare
  s            public.settings;
  v_code       text := '';
  v_alphabet   text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_app_no     text;
  v_docs       jsonb := '[]'::jsonb;
  d            jsonb;
  v_obj        record;
  v_required   text[] := array['admission_letter','wassce_slip','fee_structure','id_document','photo'];
  k            text;
  v_requested  numeric := 0;
  i            int;
  v_words      int;
  v_rand       bytea;
begin
  select * into s from public.settings where id = 1;
  if not s.applications_open or (s.closing_date is not null and current_date > s.closing_date) then
    raise exception 'Applications are closed.' using errcode = 'P0001';
  end if;
  if public.application_exists(p_id) then
    raise exception 'This application has already been submitted.' using errcode = 'P0001';
  end if;

  -- spam trap (hidden field must be empty)
  if coalesce(p_form->>'website','') <> '' then
    raise exception 'Submission rejected.' using errcode = 'P0001';
  end if;

  -- eligibility: Year One entrants with an admission letter, from Mandu Chiefdom
  if coalesce(p_form->>'year_one','') <> 'yes' or coalesce(p_form->>'has_admission_letter','') <> 'yes' then
    raise exception 'Only students entering Year One with an admission letter may apply.' using errcode = 'P0001';
  end if;
  if coalesce(p_form->>'from_mandu','') <> 'yes' then
    raise exception 'Only students from Mandu Chiefdom may apply.' using errcode = 'P0001';
  end if;
  if coalesce((p_form->>'declaration')::boolean, false) is not true
     or coalesce((p_form->>'guardian_consent')::boolean, false) is not true then
    raise exception 'The declaration and parent/guardian endorsement must be confirmed.' using errcode = 'P0001';
  end if;

  -- essential fields
  foreach k in array array['surname','first_names','gender','mobile','section','institution',
                           'programme','admission_no','guardian_name','statement','signature_name'] loop
    if coalesce(trim(p_form->>k), '') = '' then
      raise exception 'Missing required field: %', k using errcode = 'P0001';
    end if;
  end loop;
  v_words := coalesce(array_length(regexp_split_to_array(trim(p_form->>'statement'), '\s+'), 1), 0);
  if v_words > 520 then
    raise exception 'Personal statement is longer than 500 words.' using errcode = 'P0001';
  end if;

  -- documents: every path must exist in this application's folder
  for d in select * from jsonb_array_elements(coalesce(p_form->'documents','[]'::jsonb)) loop
    if position((p_id::text || '/') in coalesce(d->>'path','')) <> 1 then
      raise exception 'Invalid document path.' using errcode = 'P0001';
    end if;
    select o.name, (o.metadata->>'size')::bigint as size, o.metadata->>'mimetype' as mime
      into v_obj from storage.objects o
     where o.bucket_id = 'documents' and o.name = d->>'path';
    if not found then
      raise exception 'Document % was not uploaded completely. Please upload it again.', d->>'key'
        using errcode = 'P0001';
    end if;
    v_docs := v_docs || jsonb_build_object('key', d->>'key', 'path', v_obj.name,
              'name', d->>'name', 'size', v_obj.size, 'mime', v_obj.mime);
  end loop;
  foreach k in array v_required loop
    if not exists (select 1 from jsonb_array_elements(v_docs) x where x->>'key' = k) then
      raise exception 'Required document missing: %', k using errcode = 'P0001';
    end if;
  end loop;

  -- total amount requested (accommodation is not covered and not collected)
  select coalesce(sum(nullif(regexp_replace(c->>'requested', '[^0-9.]', '', 'g'), '')::numeric), 0)
    into v_requested
    from jsonb_array_elements(coalesce(p_form->'costs','[]'::jsonb)) c;

  -- application number and access code
  v_app_no := 'MDF-' || left(s.academic_year, 4) || '-' || lpad(nextval('public.application_seq')::text, 4, '0');
  -- 6 characters from a cryptographically random UUID (no ambiguous 0/O, 1/I/L)
  v_rand := uuid_send(gen_random_uuid());
  for i in 0..5 loop
    v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_rand, i) % length(v_alphabet)), 1);
  end loop;

  begin
    insert into public.applications (
      id, app_no, access_code_hash, academic_year, full_name, gender, mobile, email, nin,
      section, institution, programme, level, amount_requested, form, documents)
    values (
      p_id, v_app_no, encode(sha256(convert_to(v_code || p_id::text, 'UTF8')), 'hex'),
      s.academic_year,
      trim(concat_ws(' ', p_form->>'first_names', p_form->>'other_names', upper(p_form->>'surname'))),
      p_form->>'gender', p_form->>'mobile', nullif(p_form->>'email',''), nullif(trim(p_form->>'nin'),''),
      p_form->>'section', p_form->>'institution', p_form->>'programme', p_form->>'level',
      v_requested, p_form - 'website', v_docs);
  exception when unique_violation then
    raise exception 'An application with this National ID / passport number has already been submitted this year.'
      using errcode = 'P0001';
  end;

  return query select v_app_no, v_code;
end $$;

-- Applicant status lookup (application number + access code)
create or replace function public.check_status(p_app_no text, p_code text)
returns table (app_no text, first_name text, status text, public_message text,
               amount_awarded numeric, submitted_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.app_no, split_part(a.form->>'first_names', ' ', 1), a.status, a.public_message,
         case when a.status = 'awarded' then a.amount_awarded end,
         a.submitted_at, a.updated_at
    from public.applications a
   where a.app_no = upper(trim(p_app_no))
     and a.access_code_hash = encode(sha256(convert_to(upper(trim(p_code)) || a.id::text, 'UTF8')), 'hex');
$$;

-- Admins add a staff member who already has a login (Authentication → Users)
create or replace function public.add_staff(p_email text, p_full_name text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Only admins can add staff.' using errcode = 'P0001'; end if;
  select id into v_id from auth.users where lower(email) = lower(trim(p_email));
  if v_id is null then
    raise exception 'No login exists for %. Create or invite the user in Supabase first.', p_email using errcode = 'P0001';
  end if;
  insert into public.staff (user_id, email, full_name, role)
  values (v_id, lower(trim(p_email)), p_full_name, p_role)
  on conflict (user_id) do update set full_name = excluded.full_name, role = excluded.role;
end $$;

-- ---------------------------------------------------------------------
-- 8. Row-level security
-- ---------------------------------------------------------------------
alter table public.settings     enable row level security;
alter table public.staff        enable row level security;
alter table public.applications enable row level security;
alter table public.scores       enable row level security;

revoke all on public.applications, public.scores, public.staff from anon;
revoke all on public.application_overview from anon;
revoke all on sequence public.application_seq from anon, authenticated;

drop policy if exists settings_read  on public.settings;
drop policy if exists settings_write on public.settings;
create policy settings_read  on public.settings for select to anon, authenticated using (true);
create policy settings_write on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists staff_read  on public.staff;
drop policy if exists staff_admin on public.staff;
create policy staff_read  on public.staff for select to authenticated using (public.is_staff());
create policy staff_admin on public.staff for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists apps_read   on public.applications;
drop policy if exists apps_update on public.applications;
drop policy if exists apps_delete on public.applications;
create policy apps_read   on public.applications for select to authenticated using (public.is_staff());
create policy apps_update on public.applications for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy apps_delete on public.applications for delete to authenticated using (public.is_admin());
-- no insert policy: applicants can only submit through submit_application()

drop policy if exists scores_read   on public.scores;
drop policy if exists scores_insert on public.scores;
drop policy if exists scores_update on public.scores;
drop policy if exists scores_delete on public.scores;
create policy scores_read   on public.scores for select to authenticated using (public.is_staff());
create policy scores_insert on public.scores for insert to authenticated with check (public.is_staff() and assessor_id = auth.uid());
create policy scores_update on public.scores for update to authenticated using (assessor_id = auth.uid()) with check (assessor_id = auth.uid());
create policy scores_delete on public.scores for delete to authenticated using (assessor_id = auth.uid() or public.is_admin());

grant execute on function public.submit_application(uuid, jsonb) to anon, authenticated;
grant execute on function public.check_status(text, text)        to anon, authenticated;
grant execute on function public.add_staff(text, text, text)     to authenticated;
revoke execute on function public.add_staff(text, text, text)    from anon;

-- ---------------------------------------------------------------------
-- 9. Document storage (private bucket; 5 MB per file; images and PDF)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 5242880,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "manduf applicants upload" on storage.objects;
drop policy if exists "manduf staff read"        on storage.objects;
drop policy if exists "manduf admin delete"      on storage.objects;

-- Applicants may add files to the folder of an application that has not been
-- submitted yet. They cannot read, list, overwrite or delete anything.
create policy "manduf applicants upload" on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and not public.application_exists(((storage.foldername(name))[1])::uuid)
  );
create policy "manduf staff read" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_staff());
create policy "manduf admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.is_admin());

-- =====================================================================
-- AFTER RUNNING THIS FILE — make yourself the first admin:
--   1. Authentication → Users → Add user → Create new user (your email + password,
--      tick "Auto Confirm User").
--   2. Run (replace the email and name):
--        insert into public.staff (user_id, email, full_name, role)
--        select id, email, 'Your Name', 'admin' from auth.users where email = 'you@example.com';
-- =====================================================================
