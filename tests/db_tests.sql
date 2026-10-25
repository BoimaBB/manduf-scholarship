\set ON_ERROR_STOP on
-- helper: run a statement and require that it fails with a message matching a pattern
create or replace function public.t_expect_error(p_sql text, p_pattern text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ~* p_pattern then raise notice 'PASS (error as expected): %', sqlerrm; return; end if;
    raise exception 'FAIL: wrong error "%" for: %', sqlerrm, p_sql;
  end;
  raise exception 'FAIL: expected an error for: %', p_sql;
end $$;
grant execute on function public.t_expect_error(text, text) to anon, authenticated;

create or replace function public.t_assert(p_ok boolean, p_msg text) returns void
language plpgsql as $$ begin
  if p_ok then raise notice 'PASS: %', p_msg; else raise exception 'FAIL: %', p_msg; end if;
end $$;
grant execute on function public.t_assert(boolean, text) to anon, authenticated;

-- test users
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@manduf.org'),
  ('00000000-0000-0000-0000-00000000000b', 'assessor@manduf.org'),
  ('00000000-0000-0000-0000-00000000000c', 'stranger@example.com');
insert into public.staff (user_id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@manduf.org', 'Admin One', 'admin');

-- a valid form
create table t_form as select jsonb_build_object(
  'year_one','yes','has_admission_letter','yes','from_mandu','yes',
  'surname','Kamara','first_names','Fatmata Isha','other_names','','gender','Female',
  'mobile','076123456','email','fatmata@example.com','nin','NIN123','section','Bombohun',
  'institution','Njala University','programme','BSc Nursing','level','Bachelor''s',
  'admission_no','NU/2026/001','guardian_name','Musa Kamara',
  'statement','I am from Mandu Chiefdom and I want to become a nurse.',
  'signature_name','Fatmata Kamara','declaration',true,'guardian_consent',true,'website','',
  'costs', jsonb_build_array(
     jsonb_build_object('item','tuition','total','5000','covered','1000','requested','4000'),
     jsonb_build_object('item','registration','total','500','covered','0','requested','500')),
  'documents', jsonb_build_array(
     jsonb_build_object('key','admission_letter','path','11111111-1111-4111-8111-111111111111/admission_letter-1.jpg','name','adm.jpg'),
     jsonb_build_object('key','wassce_slip','path','11111111-1111-4111-8111-111111111111/wassce_slip-1.jpg','name','w.jpg'),
     jsonb_build_object('key','fee_structure','path','11111111-1111-4111-8111-111111111111/fee_structure-1.pdf','name','f.pdf'),
     jsonb_build_object('key','id_document','path','11111111-1111-4111-8111-111111111111/id_document-1.jpg','name','id.jpg'),
     jsonb_build_object('key','photo','path','11111111-1111-4111-8111-111111111111/photo-1.jpg','name','p.jpg'))
) as f;
grant select on t_form to anon, authenticated;

-- ===================== APPLICANT (anon) =====================
set role anon;
select set_config('request.jwt.claim.sub', '', false);

insert into storage.objects (bucket_id, name, metadata)
select 'documents', d->>'path', '{"size": 1200, "mimetype": "image/jpeg"}'
from t_form, jsonb_array_elements(f->'documents') d;
select t_assert(true, 'anon can upload documents to an unsubmitted application folder');

select t_expect_error($$insert into storage.objects (bucket_id, name, metadata) values ('documents','not-a-uuid/x.jpg','{}')$$, 'row-level security');
select t_assert((select count(*) from storage.objects) = 0, 'anon cannot list uploaded documents');

-- missing required documents
select t_expect_error(format($$select * from submit_application('22222222-2222-4222-8222-222222222222', %L)$$,
  (select (f - 'documents') || '{"documents":[]}' from t_form)), 'Required document missing');
-- not Year One
select t_expect_error(format($$select * from submit_application('11111111-1111-4111-8111-111111111111', %L)$$,
  (select f || '{"year_one":"no"}' from t_form)), 'Year One');
-- spam trap
select t_expect_error(format($$select * from submit_application('11111111-1111-4111-8111-111111111111', %L)$$,
  (select f || '{"website":"http://spam"}' from t_form)), 'rejected');
-- document path from another folder
select t_expect_error(format($$select * from submit_application('33333333-3333-4333-8333-333333333333', %L)$$,
  (select f from t_form)), 'Invalid document path');

-- valid submission
create temp table t_result as select * from submit_application('11111111-1111-4111-8111-111111111111', (select f from t_form));
select t_assert((select app_no from t_result) = 'MDF-2026-0001', 'application number generated: ' || (select app_no from t_result));
select t_assert((select access_code from t_result) ~ '^[A-HJKMNP-Z2-9]{6}$', 'access code format: ' || (select access_code from t_result));

select t_expect_error(format($$select * from submit_application('11111111-1111-4111-8111-111111111111', %L)$$,
  (select f from t_form)), 'already been submitted');
select t_expect_error($$insert into storage.objects (bucket_id, name, metadata) values ('documents','11111111-1111-4111-8111-111111111111/extra.jpg','{}')$$, 'row-level security');
select t_assert(true, 'anon cannot add files after submission');

-- status lookup
select t_assert((select status from check_status((select lower(app_no) from t_result), (select lower(access_code) from t_result))) = 'submitted',
  'status lookup works (case-insensitive)');
select t_assert((select count(*) from check_status((select app_no from t_result), 'WRONG1')) = 0, 'wrong access code returns nothing');

-- direct table access is blocked
select t_expect_error($$select * from applications$$, 'permission denied');
select t_expect_error($$select * from application_overview$$, 'permission denied');
select t_expect_error($$insert into applications (id, app_no, access_code_hash, academic_year, full_name, form) values (gen_random_uuid(),'X','x','2026','x','{}')$$, 'permission denied');
update settings set applications_open = false;
select t_assert((select applications_open from settings), 'anon cannot change settings');

reset role;
-- duplicate national ID (second applicant, same NIN)
insert into storage.objects (bucket_id, name, metadata)
select 'documents', replace(d->>'path', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444'), '{"size":1,"mimetype":"image/jpeg"}'
from t_form, jsonb_array_elements(f->'documents') d;
set role anon;
select t_expect_error(format($$select * from submit_application('44444444-4444-4444-8444-444444444444', %L)$$,
  (select jsonb_set(f, '{documents}', replace((f->'documents')::text, '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444')::jsonb) from t_form)),
  'already been submitted this year');

-- ===================== STRANGER (logged in, not staff) =====================
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select t_assert((select count(*) from applications) = 0, 'logged-in non-staff sees no applications');
select t_assert((select count(*) from storage.objects) = 0, 'logged-in non-staff sees no documents');
select t_expect_error($$select add_staff('stranger@example.com','Me','admin')$$, 'Only admins');

-- ===================== ADMIN =====================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select add_staff('Assessor@manduf.org', 'Assessor Two', 'assessor');
select t_assert((select count(*) from staff) = 2, 'admin added an assessor');
select t_assert((select count(*) from applications) = 1, 'admin sees the application');
select t_assert((select amount_requested from applications) = 4500, 'amount requested totalled = 4500');
select t_assert((select count(*) from storage.objects) = 10, 'admin can read documents');
update applications set screen_year_one = true, eligibility = 'eligible', status = 'shortlisted';
insert into scores (application_id, assessor_id, financial_need, academic_merit, personal_statement, leadership)
values ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-00000000000a', 8, 7, 6, 5);
select t_assert((select weighted_total from scores) = 70, 'weighted total = 8*4+7*3+6*2+5 = 70');

-- ===================== ASSESSOR =====================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select t_assert((select count(*) from applications) = 1, 'assessor sees the application');
update applications set status = 'awarded';
select t_assert((select status from applications) = 'shortlisted', 'assessor cannot change decisions');
insert into scores (application_id, assessor_id, financial_need, academic_merit, personal_statement, leadership)
values ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-00000000000b', 10, 9, 8, 7);
select t_expect_error($$insert into scores (application_id, assessor_id, financial_need) values ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-00000000000a', 1)$$, 'row-level security|duplicate');
update scores set financial_need = 0 where assessor_id = '00000000-0000-0000-0000-00000000000a';
select t_assert((select financial_need from scores where assessor_id = '00000000-0000-0000-0000-00000000000a') = 8, 'assessor cannot edit another assessor''s score');
select t_assert((select avg_score from application_overview) = 80.0, 'overview averages scores: (70+90)/2 = 80');
select t_expect_error($$select add_staff('stranger@example.com','X','admin')$$, 'Only admins');

-- ===================== ADMIN decision + status page =====================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update applications set status = 'awarded', amount_awarded = 4000, public_message = 'Congratulations! Visit the office with your ID.';
select t_assert((select decided_by from applications) = '00000000-0000-0000-0000-00000000000a', 'decision is stamped with the admin');
update settings set applications_open = false;

set role anon;
select set_config('request.jwt.claim.sub', '', false);
select t_assert((select amount_awarded from check_status((select app_no from t_result), (select access_code from t_result))) = 4000,
  'applicant sees award amount and message');
select t_expect_error(format($$select * from submit_application('55555555-5555-4555-8555-555555555555', %L)$$, (select f from t_form)), 'closed');
reset role;
\echo ALL DATABASE TESTS PASSED
