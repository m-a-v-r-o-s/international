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
 * What the generator has not caught up with yet.
 *
 * `database.generated.ts` is regenerated from the real project, and the last
 * few migrations have not been applied there — so this intersection stands in
 * for them. It shadows the `Database` that `export *` above re-exports, and
 * every caller imports `Database` from HERE (nothing imports
 * `database.generated` directly), so what is added below is what the app sees.
 * Each block names the migration that will delete it once `supabase gen types`
 * picks the change up.
 */
type GenPublic = GeneratedDatabase['public']
type GenTable = { Row: object; Insert: object; Update: object }

/**
 * One table, plus columns the generator has not seen yet. `Insert` and
 * `Update` take them as optional throughout: every column added below is
 * either derived by a trigger or has a default, so no caller ever sends one.
 */
type WithColumns<T extends GenTable, C> = Omit<T, 'Row' | 'Insert' | 'Update'> & {
  Row: T['Row'] & C
  Insert: T['Insert'] & Partial<C>
  Update: T['Update'] & Partial<C>
}

/** The same, for a column that was renamed rather than added. */
type RenameColumn<T extends GenTable, From extends string, C> =
  Omit<T, 'Row' | 'Insert' | 'Update'> & {
    Row: Omit<T['Row'], From> & C
    Insert: Omit<T['Insert'], From> & Partial<C>
    Update: Omit<T['Update'], From> & Partial<C>
  }

/** 20260902100000_incidents.sql · `exceptions` became `incidents`. */
type IncidentsTable = {
  Row: {
    booking_id: string
    charge: number | null
    id: string
    note: string | null
    notified_at: string | null
    raised_at: string
    raised_by: string | null
    resolution: string | null
    resolved_at: string | null
    resolved_by: string | null
  }
  Insert: {
    booking_id: string
    id?: string
    note?: string | null
    raised_by?: string | null
  }
  Update: {
    note?: string | null
    resolved_at?: string | null
  }
  Relationships: []
}

/** 20260902100000_incidents.sql · the photos a rep attaches to one. */
type IncidentPhotosTable = {
  Row: {
    added_at: string
    added_by: string | null
    id: string
    incident_id: string
    path: string
  }
  Insert: {
    added_by?: string | null
    id?: string
    incident_id: string
    path: string
  }
  Update: { path?: string }
  Relationships: []
}

export type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<GenPublic, 'Functions' | 'Tables'> & {
    Tables: Omit<
      GenPublic['Tables'],
      'exceptions' | 'bookings' | 'app_settings' | 'profiles'
    > & {
      incidents: IncidentsTable
      incident_photos: IncidentPhotosTable
      // 20260901150000_booking_exception_approval.sql and
      // 20260902100000_incidents.sql.
      bookings: WithColumns<GenPublic['Tables']['bookings'], {
        exception_status: 'pending' | 'approved' | 'denied' | null
        fuel_charge: number | null
      }>
      // 20260902100000_incidents.sql.
      app_settings: WithColumns<GenPublic['Tables']['app_settings'], {
        fuel_charge_per_eighth: number
      }>
      profiles: RenameColumn<
        GenPublic['Tables']['profiles'], 'notify_exceptions',
        { notify_incidents: boolean }
      >
    }
    Functions: Omit<
      GenPublic['Functions'],
      'admin_resolve_exception' | 'admin_exception_detail'
      | 'pending_exception_notifications' | 'mark_exceptions_notified'
    > & {
      // 20260901150000_booking_exception_approval.sql
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
      // 20260902100000_incidents.sql
      admin_resolve_incident: {
        Args: { p_id: string; p_charge: number | null; p_resolution: string | null }
        Returns: void
      }
      admin_incident_detail: {
        Args: { p_id: string }
        Returns: {
          id: string
          booking_id: string
          note: string | null
          raised_by: string | null
          raised_at: string
          resolved_by: string | null
          resolved_at: string | null
          charge: number | null
          resolution: string | null
        }[]
      }
      pending_incident_notifications: {
        Args: { p_limit?: number }
        Returns: {
          id: string
          note: string | null
          raised_at: string
          booking_ref: string
          plate: string
        }[]
      }
      mark_incidents_notified: { Args: { p_ids: string[] }; Returns: number }
    }
  }
}

type Tbl = Database['public']['Tables']
type Row<T extends keyof Tbl> = Tbl[T]['Row']

// ── Enums, straight from the generated ones ─────────────────────────────────
export type UserRole = Database['public']['Enums']['user_role']
export type BookingKind = Database['public']['Enums']['booking_kind']
export type BookingStatus = Database['public']['Enums']['booking_status']
export type PayMethod = Database['public']['Enums']['pay_method']
export type SeatType = Database['public']['Enums']['seat_type']

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
export type BookingRow = Row<'bookings'>
export type BookingExtraRow = Row<'booking_extras'>
export type BookingDriverRow = Row<'booking_drivers'>
export type ContractRow = Row<'contracts'>
export type IncidentRow = Row<'incidents'>
export type IncidentPhotoRow = Row<'incident_photos'>
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
 * `status`, `days`, `category_id`, `period_id`, `total`, `block_reason`,
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

