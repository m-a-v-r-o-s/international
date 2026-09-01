/**
 * The app's view of the database types.
 *
 * `./database.generated` is regenerated from the real project after every
 * migration and is never edited. This file is the thin hand-written layer over
 * it, and it exists for three reasons — each one a place where the generated
 * types are correct about the TABLE and wrong about what the app actually
 * works with.
 *
 * 1. NAMES. The generator exposes rows as
 *    Database['public']['Tables']['bookings']['Row']. Thirty-odd modules ask
 *    for `BookingRow`. The aliases below are that, and nothing more.
 *
 * 2. THE CHECK-CONSTRAINED COLUMNS. `car_models.transmission`,
 *    `car_models.fuel_type`, `handovers.kind`, `damage_marks.view` and
 *    `damage_marks.mark_type` are `text` with a CHECK constraint rather than
 *    Postgres enums, so the generator can only report `string` — a CHECK is
 *    invisible to it in a way that a real enum is not. The database still
 *    enforces the value; TypeScript simply cannot see the enforcement. The
 *    unions are declared once here rather than asserted at each read.
 *    Worth doing properly one day: making these five columns real enums would
 *    delete this section and let the generator carry the unions itself. That
 *    is a schema change and wants its own migration, not a provisioning
 *    session — recorded in docs/06-IMPLEMENTATION-NOTES.md.
 *
 * 3. THE INSERT GRANT. See `BookingInsert` at the bottom.
 */
export * from './database.generated'

import type { Database as GeneratedDatabase } from './database.generated'

/**
 * Three RPCs from 20260901150000_booking_exception_approval.sql, not yet in
 * database.generated.ts for the same reason `pickup_exception` isn't (see the
 * BookingRow note below): the migration hasn't been applied to the project
 * this file was last generated from. A local export of `Database` shadows the
 * one `export *` above re-exports from the generated file — every caller that
 * imports `Database` from here (which is all of them; nothing imports
 * `database.generated` directly) sees the three added below. Delete this
 * intersection once `supabase gen types` picks the functions up.
 */
export type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<GeneratedDatabase['public'], 'Functions'> & {
    Functions: GeneratedDatabase['public']['Functions'] & {
      admin_approve_exception_booking: { Args: { p_booking_id: string }; Returns: void }
      admin_deny_exception_booking: { Args: { p_booking_id: string }; Returns: void }
      admin_pending_exception_bookings: {
        Args: Record<string, never>
        Returns: {
          booking_id: string
          ref: string
          plate: string
          hotel_name: string | null
          room_number: string | null
          guest: string | null
          pickup_at: string | null
          reason: string | null
        }[]
      }
    }
  }
}

type Tbl = GeneratedDatabase['public']['Tables']
type Row<T extends keyof Tbl> = Tbl[T]['Row']

// ── Enums, straight from the generated ones ─────────────────────────────────
export type UserRole = Database['public']['Enums']['user_role']
export type BookingKind = Database['public']['Enums']['booking_kind']
export type BookingStatus = Database['public']['Enums']['booking_status']
export type PayMethod = Database['public']['Enums']['pay_method']
export type SeatType = Database['public']['Enums']['seat_type']
export type ExceptionType = Database['public']['Enums']['exception_type']

// ── The unions a CHECK constraint enforces and the generator cannot see ─────
// Each one names the migration that constrains it, so a change there has an
// obvious second place to change.
/** `car_models.transmission` — CHECK in 20260830090300_fleet.sql. */
export type Transmission = 'manual' | 'automatic'
/** `car_models.fuel_type` — CHECK in 20260830090300_fleet.sql. */
export type FuelType = 'petrol' | 'diesel' | 'hybrid' | 'electric'
/** `handovers.kind` — CHECK in 20260830090600_operations.sql. */
export type HandoverKind = 'pickup' | 'return'
/** `damage_marks.view` — CHECK in 20260830090600_operations.sql. */
export type DamageViewCol = 'front' | 'rear' | 'left' | 'right' | 'top'
/** `damage_marks.mark_type` — CHECK in 20260830090600_operations.sql. */
export type MarkTypeCol = 'scratch' | 'dent' | 'chip' | 'crack' | 'other'

// ── Row aliases ─────────────────────────────────────────────────────────────
export type ProfileRow = Row<'profiles'>
export type HotelRow = Row<'hotels'>
export type HotelRepRow = Row<'hotel_reps'>
export type RepDeviceRow = Row<'rep_devices'>
export type CategoryRow = Row<'categories'>
export type CarRow = Row<'cars'>
export type PricingPeriodRow = Row<'pricing_periods'>
export type PriceRowRow = Row<'price_rows'>
export type PriceExtraDayRow = Row<'price_extra_day'>
/**
 * `exception_status`: added by 20260901150000_booking_exception_approval.sql,
 * not yet in database.generated.ts because that migration has not been
 * applied to the project this file was last generated from (`pickup_exception`
 * / `pickup_exception_reason` from 20260901130000 landed and are folded into
 * the generator's own `Row<'bookings'>` now — that half of this intersection
 * is gone). Fold `exception_status` in too and delete this intersection once
 * `supabase gen types` picks the column up.
 */
export type BookingRow = Row<'bookings'> & {
  exception_status: 'pending' | 'approved' | 'denied' | null
}
export type BookingExtraRow = Row<'booking_extras'>
export type BookingDriverRow = Row<'booking_drivers'>
export type ContractRow = Row<'contracts'>
export type ExceptionRow = Row<'exceptions'>
export type CashHandoverRow = Row<'cash_handovers'>
export type AuditLogRow = Row<'audit_log'>
export type AppSettingsRow = Row<'app_settings'>
export type PushSubscriptionRow = Row<'push_subscriptions'>

/** Narrowed per note 2 above. */
export type CarModelRow = Omit<Row<'car_models'>, 'transmission' | 'fuel_type'> & {
  transmission: Transmission
  fuel_type: FuelType
}

/** Narrowed per note 2 above. */
export type HandoverRow = Omit<Row<'handovers'>, 'kind'> & { kind: HandoverKind }

/** Narrowed per note 2 above. */
export type DamageMarkRow = Omit<Row<'damage_marks'>, 'view' | 'mark_type'> & {
  view: DamageViewCol
  mark_type: MarkTypeCol
}

/**
 * What a client may actually INSERT into `bookings`.
 *
 * The generated `Insert` requires `ref` and `created_by`, because both are NOT
 * NULL with no column default — which is true of the TABLE and wrong about the
 * GRANT. 20260830091100_rls.sql's insert grant omits both, along with `kind`,
 * `status`, `days`, `category_id`, `period_id`, `total_cents`, `block_reason`,
 * `returned_at` and `cash_handover_id`; app.bookings_before_write() derives
 * every one of them, and a rep who sends one is refused at the privilege check
 * before any policy runs. So the app cannot send what the generated type
 * demands, and must not.
 *
 * This type is the grant. The cast at the one insert site is what bridges the
 * two, and it is a cast rather than a widening because the trigger — not the
 * caller — is what makes the row valid.
 */
export type BookingInsert = Pick<
  Tbl['bookings']['Insert'],
  'car_id' | 'hotel_id' | 'room_number' | 'start_date' | 'end_date'
  | 'pickup_at' | 'dropoff_at' | 'cust_first' | 'cust_last' | 'cust_phone'
  | 'cust_dob' | 'cust_email' | 'pickup_exception' | 'pickup_exception_reason'
>

