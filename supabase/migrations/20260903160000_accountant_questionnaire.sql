-- ═════════════════════════════════════════════════════════════════════════════
-- 0037 · The accountant's questionnaire
--
-- docs/01-DECISIONS.md §26 said "Invoicing, official receipts, myDATA
-- e-invoicing, accounting integration" were out of scope. The owner reversed
-- that on 3 Sep 2026. Before any of it can be designed, seventeen questions
-- have to be answered by the company's accountant, and this migration is the
-- landing ground for those answers.
--
-- IT IS NOT AN INVOICING FEATURE. Nothing here transmits anything to ΑΑΔΕ.
-- This is one public form, its replies, and the files that came with them.
--
-- THREE THINGS SHAPE THE TABLE, ALL OF THEM CONSEQUENCES OF IT BEING PUBLIC:
--
--   1. NOBODY WRITES IT THROUGH POSTGREST. The form is reachable without a
--      session, so `anon` must not hold an insert on anything — a public grant
--      is a public write endpoint, and this one would take arbitrary jsonb.
--      RLS is on with a single admin-only SELECT policy and NO insert, update
--      or delete policy at all. The only writer is the service role, from the
--      server action, after rate limiting and Zod validation. That is the same
--      shape 0021's customer ledger uses for its cross-rep lookup: the widening
--      is a function, never a grant.
--
--   2. THE REPLY IS STORED BEFORE IT IS EMAILED. src/lib/email/mailer.ts is
--      still unconfigured (client item 8, no domain, no SMTP), so `send()`
--      returns `not_configured` today and will keep doing so until the domain
--      lands. A form that only emailed would silently drop every answer the
--      accountant typed. The row is the record; the mail is a notification
--      about the row, and `mail_status` says which of the two happened.
--
--   3. IT HOLDS NO PERSONAL DATA OF GUESTS. Everything else in this schema is
--      covered by §25's retention rules because it describes a renter. This
--      describes a professional answering questions about their client's
--      books, so the retention job does not touch it and the privacy policy
--      does not need to describe it.
--
-- The `answers` jsonb is deliberately opaque to Postgres: the question set
-- lives in src/lib/accountant/questionnaire.ts and will be edited as the
-- conversation with the accountant moves, and a column per question would mean
-- a migration every time a question is reworded. What Postgres guarantees is
-- that it is an object and that it is not enormous.
-- ═════════════════════════════════════════════════════════════════════════════

create table public.accountant_replies (
  id               uuid primary key default gen_random_uuid(),
  submitted_at     timestamptz not null default now(),

  -- Who answered. All optional: an accountant who fills in the seventeen
  -- answers and leaves their name blank has still given us what we asked for,
  -- and refusing the submission over a courtesy field would be absurd.
  respondent_name  text,
  respondent_email text,
  respondent_note  text,

  -- question id → the text typed. Keys are the ids in questionnaire.ts.
  answers          jsonb not null default '{}'::jsonb,
  -- [{ path, name, type, bytes }] — one entry per file that reached the bucket.
  files            jsonb not null default '[]'::jsonb,

  locale           text not null default 'el',
  -- sha256 of the caller's IP, same as app.auth_events. Never the address.
  ip_hash          text,
  mail_status      text not null default 'not_configured'
                     check (mail_status in ('sent', 'not_configured', 'failed')),

  constraint accountant_replies_name_len  check (
    respondent_name is null or char_length(respondent_name) <= 120),
  constraint accountant_replies_email_len check (
    respondent_email is null or char_length(respondent_email) <= 254),
  constraint accountant_replies_note_len  check (
    respondent_note is null or char_length(respondent_note) <= 4000),
  constraint accountant_replies_locale    check (locale in ('el', 'en')),
  -- Shape and size, which is all the database can usefully say about content
  -- whose keys it does not own.
  --
  -- 256 KB, and the number is not arbitrary. Twenty answers at the action's
  -- 4000-character cap is 80,000 characters, and this document is answered in
  -- GREEK: every one of those characters is two bytes in UTF-8, so the real
  -- worst case is ~160 KB, not 80. A cap sized from character counts would
  -- have refused a long but entirely legitimate set of answers, in Greek only,
  -- which is the kind of bug that never shows up in an English test.
  --
  -- The action refuses at 200 KB so that a refusal comes back as a sentence in
  -- the reader's language rather than as a constraint violation. Same pairing
  -- as MAX_UPLOAD_BYTES and next.config.ts's bodySizeLimit: two numbers, the
  -- app's one lower, and moving one without the other puts the wrong one in
  -- charge.
  --
  -- octet_length(answers::text), NOT pg_column_size(answers), and the
  -- difference is not cosmetic. pg_column_size reports the size of the datum
  -- as it is actually held, which for jsonb means AFTER TOAST compression:
  -- twenty identical long answers compress to under 2 KB, so a cap written
  -- that way would have been measuring how repetitive the text was rather than
  -- how much of it there was. Serialising to text and counting bytes measures
  -- the thing the action is being held to, and measures it the same way every
  -- time.
  constraint accountant_replies_answers_object check (
    jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 262144),
  constraint accountant_replies_files_array check (
    jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 12)
);

create index on public.accountant_replies (submitted_at desc);

comment on table public.accountant_replies is
  'Replies to the myDATA questionnaire at /accountant-questionnaire. Written only by the service role from the server action; never insertable by anon or authenticated.';
comment on column public.accountant_replies.mail_status is
  'Whether the notification to the office actually went out. not_configured means SMTP is absent (client item 8), not that anything failed.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- One policy, one verb, one role. A rep has no business reading the company's
-- tax correspondence (docs/01-DECISIONS.md §8 is about bookings, but the same
-- reasoning applies with more force here), and nobody at all writes through a
-- policy.
alter table public.accountant_replies enable row level security;

grant select on public.accountant_replies to authenticated;

create policy accountant_replies_select_admin on public.accountant_replies
  for select to authenticated
  using (app.is_admin());

-- ── The bucket ──────────────────────────────────────────────────────────────
-- Separate from `booking-files` on purpose. That bucket's policies read the
-- first path segment as a booking id and hand it to app.can_read_booking()
-- (20260830120000_storage.sql); an object that is not under a booking has no
-- meaning there and would sit in a namespace whose whole authorisation model
-- does not apply to it.
--
-- Same 10 MB cap and the same four types as everywhere else, because
-- src/lib/storage/sniff.ts is the one whitelist this app has and a second one
-- would drift from it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'accountant-files', 'accountant-files', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The admin can read what was sent in. Nobody else can, and nobody at all
-- writes through a policy: the uploads arrive via the service role, which is
-- not subject to RLS, so there is deliberately no insert policy to widen.
create policy accountant_files_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'accountant-files' and app.is_admin());
