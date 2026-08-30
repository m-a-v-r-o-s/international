-- ═════════════════════════════════════════════════════════════════════════════
-- 0017 · Signing the agreement, and posting a copy of it
--
-- Three gaps found building R4 steps 5 and 6, probed against the running
-- schema before anything here was written (docs/06-IMPLEMENTATION-NOTES.md).
--
-- 1. NOBODY COULD RECORD THAT A COPY WAS EMAILED. `contracts.emailed_to` and
--    `.emailed_at` have existed since Phase 1, and 0011_rls.sql grants
--    `select, insert` on `contracts` and nothing else — so an UPDATE is 42501
--    for a rep AND for the admin. docs/01-DECISIONS.md §16 asks for "optional
--    email delivery at the signing step", which happens after the agreement is
--    signed and therefore after the row exists. The two columns were
--    unreachable by any caller.
--
-- 2. A REP COULD BACK-DATE A SIGNATURE. `signed_at` defaults to now() but is
--    accepted from the client, and `version` likewise: a rep inserted a
--    contract stamped 2001-01-01 at version 99 and the database took it. When
--    a document was signed is a fact about the write, not a client's opinion,
--    and it is exactly the kind of fact a dispute turns on.
--
-- 3. NEITHER `contracts` NOR `damage_marks` WAS AUDIT-LOGGED. HANDOFF.md:
--    "Every write is audit-logged — actor, entity, before, after, timestamp."
--    Both were missed from the trigger list in 0010_guards.sql. A signed
--    agreement and the damage recorded on it are the two things most likely to
--    be argued about later.
--
-- The fix is narrow in the same shape as staff_hotels() and
-- my_hand_over_cash(): the smallest grant that makes the flow possible, with a
-- guard trigger so a future widening of that grant does not quietly widen what
-- can be changed.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. The emailed copy ─────────────────────────────────────────────────────
-- Two columns and no others. `pdf_path`, `signature_path`, `signer_name`,
-- `signed_at` and `version` stay out of the grant entirely, so the document
-- itself remains what the object policies already say it is: immutable.
grant update (emailed_to, emailed_at) on public.contracts to authenticated;

create policy contracts_update_email on public.contracts
  for update to authenticated
  using (app.can_read_booking(booking_id))
  with check (app.can_read_booking(booking_id));

-- ── 2. When it was signed is decided here ───────────────────────────────────
create or replace function app.contracts_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Facts about the write, not fields. Both apply to the admin too: there is
    -- no legitimate caller who knows better than the database when a row was
    -- written, and a second signature on the same booking is a new version
    -- rather than an edit of the first.
    new.signed_at := now();
    new.version := coalesce(
      (select max(c.version) from public.contracts c where c.booking_id = new.booking_id), 0) + 1;
    return new;
  end if;

  -- UPDATE: the only two fields anybody may move are the ones the copy step
  -- writes. Everything else is restored from OLD, so even if the column grant
  -- above were ever widened, a signed agreement still cannot be re-pointed at
  -- another file or re-attributed to another signer.
  new.id             := old.id;
  new.booking_id     := old.booking_id;
  new.pdf_path       := old.pdf_path;
  new.signature_path := old.signature_path;
  new.signed_at      := old.signed_at;
  new.signer_name    := old.signer_name;
  new.version        := old.version;

  return new;
end;
$$;

create trigger contracts_guard
  before insert or update on public.contracts
  for each row execute function app.contracts_before_write();

-- ── 3. Audit ────────────────────────────────────────────────────────────────
-- The stored paths join the list of things the log does not keep a second copy
-- of, for the same reason the licence image paths are already on it: the log is
-- for accountability, not for a duplicate index of where the personal data
-- lives. Who signed what, and when, is still recorded in full.
create or replace function app.audit_redact(p_row jsonb)
returns jsonb
language sql
immutable
as $$
  select p_row - 'pin_hash'
                - 'licence_number'
                - 'front_image_path'
                - 'back_image_path'
                - 'pdf_path'
                - 'signature_path'
                - 'photo_path'
                - 'keys'
$$;

create trigger audit_contracts    after insert or update or delete on public.contracts
  for each row execute function app.audit();
create trigger audit_damage_marks after insert or update or delete on public.damage_marks
  for each row execute function app.audit();
