/**
 * Database types.
 *
 * Hand-written to match supabase/migrations while there is no Supabase project
 * to generate against. Once one exists, replace this file wholesale with
 *
 *   npx supabase gen types typescript --project-id <id> > src/lib/supabase/database.types.ts
 *
 * and keep the shape below in mind when reading it: the client only needs Row,
 * Insert and Update per table, and Args/Returns per function.
 */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type UserRole = 'admin' | 'rep'
export type BookingKind = 'rental' | 'block'
export type BookingStatus = 'booked' | 'out' | 'returned' | 'cancelled' | 'no_show' | 'blocked'
export type PayMethod = 'cash' | 'card' | 'transfer'
export type SeatType = 'infant' | 'child' | 'booster'
export type ExceptionType =
  | 'fuel_short' | 'new_damage' | 'late_return' | 'no_show' | 'eligibility_override' | 'other'

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export type ProfileRow = {
  id: string
  role: UserRole
  full_name: string
  phone: string | null
  lang: 'el' | 'en'
  pin_hash: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export type BookingRow = {
  id: string
  ref: string
  kind: BookingKind
  status: BookingStatus
  car_id: string
  category_id: string | null
  hotel_id: string | null
  room_number: string | null
  start_date: string
  end_date: string
  pickup_at: string | null
  dropoff_at: string | null
  window_override: boolean
  cust_first: string | null
  cust_last: string | null
  cust_phone: string | null
  cust_dob: string | null
  cust_email: string | null
  period_id: string | null
  days: number | null
  total_cents: number | null
  collected_cents: number
  pay_method: PayMethod | null
  paid: boolean
  block_reason: string | null
  eligibility_override_by: string | null
  eligibility_override_at: string | null
  created_by: string
  returned_at: string | null
  created_at: string
  updated_at: string
  cash_handover_id: string | null
}

/** The columns a client may actually send when creating a booking. Everything
 *  else on the row is derived server-side or refused by the column grant. */
export type BookingInsert = {
  car_id: string
  hotel_id?: string | null
  room_number?: string | null
  start_date: string
  end_date: string
  pickup_at?: string | null
  dropoff_at?: string | null
  window_override?: boolean
  cust_first?: string | null
  cust_last?: string | null
  cust_phone?: string | null
  cust_dob?: string | null
  cust_email?: string | null
}

export type BookingUpdate = Partial<BookingInsert> & {
  status?: BookingStatus
  collected_cents?: number
  pay_method?: PayMethod | null
  paid?: boolean
}

export type CarRow = {
  id: string
  plate: string
  model_id: string
  year: number | null
  colour: string | null
  photo_path: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type CategoryRow = {
  id: string
  code: string
  name_el: string
  name_en: string
  min_driver_age: number
  min_licence_years: number
  sort_order: number
}

export type CarModelRow = {
  id: string
  make: string
  model: string
  category_id: string
  transmission: 'manual' | 'automatic'
  fuel_type: 'petrol' | 'diesel' | 'hybrid' | 'electric'
  seats: number
  doors: number
  aircon: boolean
  tank_litres: number | null
  photo_path: string | null
}

export type HotelRow = {
  id: string
  name: string
  area: string | null
  address: string | null
  active: boolean
  created_at: string
}

export type BookingDriverRow = {
  id: string
  booking_id: string
  is_main: boolean
  first_name: string
  last_name: string
  dob: string
  licence_number: string | null
  licence_country: string | null
  licence_issued_on: string | null
  licence_expires_on: string | null
  front_image_path: string | null
  back_image_path: string | null
  ocr_confidence: number | null
  ocr_reviewed: boolean
  images_purged_at: string | null
  created_at: string
}

export type HandoverRow = {
  id: string
  booking_id: string
  kind: 'pickup' | 'return'
  occurred_at: string
  by_profile: string
  fuel_eighths: number | null
  notes: string | null
}

export type ExceptionRow = {
  id: string
  booking_id: string
  type: ExceptionType
  detail: string | null
  raised_by: string | null
  raised_at: string
  resolved_at: string | null
}

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, never, Partial<Pick<ProfileRow, 'full_name' | 'phone' | 'lang'>>>
      hotels: Table<HotelRow>
      hotel_reps: Table<{ hotel_id: string; profile_id: string; is_primary: boolean }>
      categories: Table<CategoryRow>
      car_models: Table<CarModelRow>
      cars: Table<CarRow>
      pricing_periods: Table<{
        id: string; season_year: number; name: string
        start_date: string; end_date: string; created_at: string
      }>
      price_rows: Table<{
        period_id: string; category_id: string; days: number; total_cents: number
      }>
      price_extra_day: Table<{ period_id: string; category_id: string; cents: number }>
      bookings: Table<BookingRow, BookingInsert, BookingUpdate>
      booking_drivers: Table<BookingDriverRow>
      booking_extras: Table<{ id: string; booking_id: string; seat: SeatType; qty: number }>
      handovers: Table<HandoverRow>
      damage_marks: Table<{
        id: string; handover_id: string; car_id: string
        view: 'front' | 'rear' | 'left' | 'right' | 'top'
        x: number; y: number
        mark_type: 'scratch' | 'dent' | 'chip' | 'crack' | 'other'
        note: string | null; photo_path: string | null; pre_existing: boolean; created_at: string
      }>
      contracts: Table<{
        id: string; booking_id: string; pdf_path: string; signature_path: string
        signed_at: string; signer_name: string
        emailed_to: string | null; emailed_at: string | null; version: number
      }>
      exceptions: Table<ExceptionRow>
      cash_handovers: Table<{
        id: string; rep_id: string; amount_cents: number; handed_at: string
      }>
      audit_log: Table<{
        id: number; actor_id: string | null; entity: string; entity_id: string | null
        action: 'insert' | 'update' | 'delete'; before: Json | null; after: Json | null; at: string
      }>
      app_settings: Table<{
        id: number; licence_retention_months: number
        pickup_window: string; dropoff_window: string; company: Json; updated_at: string
      }>
      push_subscriptions: Table<{
        id: string; profile_id: string; endpoint: string; keys: Json; created_at: string
      }>
    }
    Views: Record<string, never>
    Functions: {
      // ── The engines ──────────────────────────────────────────────────────
      availability: {
        Args: { from_date: string; to_date: string }
        Returns: { car_id: string; occupied_dates: string[] }[]
      }
      quote: {
        Args: { p_category_id: string; p_start: string; p_end: string }
        Returns: { days: number; period_id: string; total_cents: number }[]
      }
      check_eligibility: {
        Args: {
          p_category_id: string; p_dob: string | null
          p_licence_issued_on: string | null; p_licence_expires_on: string | null
          p_start: string; p_end: string
        }
        Returns: { ok: boolean; failures: string[] }[]
      }
      my_cash_in_hand: { Args: Record<string, never>; Returns: number }
      my_hand_over_cash: {
        Args: Record<string, never>
        Returns: { handover_id: string; amount_cents: number }[]
      }
      staff_hotels: {
        Args: Record<string, never>
        Returns: { id: string; name: string; area: string | null }[]
      }
      rental_days: { Args: { p_start: string; p_end: string }; Returns: number }

      // ── Admin only ───────────────────────────────────────────────────────
      admin_create_block: {
        Args: { p_car_id: string; p_start: string; p_end: string; p_reason: string | null }
        Returns: string
      }
      admin_update_block: {
        Args: { p_id: string; p_start: string | null; p_end: string | null; p_reason: string | null }
        Returns: undefined
      }
      admin_delete_block: { Args: { p_id: string }; Returns: undefined }
      admin_blocks: {
        Args: { p_from: string; p_to: string }
        Returns: {
          id: string; car_id: string; start_date: string; end_date: string
          block_reason: string | null
        }[]
      }
      admin_car_notes: { Args: { p_car_id: string }; Returns: string | null }
      admin_set_car_notes: { Args: { p_car_id: string; p_notes: string | null }; Returns: undefined }
      admin_set_booking_price: {
        Args: { p_booking_id: string; p_total_cents: number }; Returns: undefined
      }
      admin_resolve_exception: {
        Args: { p_id: string; p_charge_cents: number | null; p_resolution: string | null }
        Returns: undefined
      }
      admin_exception_detail: {
        Args: { p_id: string }
        Returns: {
          id: string; booking_id: string; type: ExceptionType; detail: string | null
          raised_by: string | null; raised_at: string; resolved_by: string | null
          resolved_at: string | null; charge_cents: number | null; resolution: string | null
        }[]
      }
      admin_override_eligibility: {
        Args: { p_booking_id: string; p_note: string | null }; Returns: undefined
      }
      admin_set_user_role: { Args: { p_profile_id: string; p_role: UserRole }; Returns: undefined }
      admin_set_user_active: {
        Args: { p_profile_id: string; p_active: boolean }; Returns: undefined
      }
      admin_confirm_cash_handover: { Args: { p_id: string }; Returns: undefined }

      // ── Server only (service_role) ───────────────────────────────────────
      rate_limit_hit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number }
        Returns: boolean
      }
      log_security_event: {
        Args: {
          p_kind: string; p_profile_id?: string | null; p_email_hash?: string | null
          p_ip_hash?: string | null; p_detail?: Json
        }
        Returns: undefined
      }
      bind_rep_device: {
        Args: { p_profile_id: string; p_device_id: string; p_user_agent?: string | null }
        Returns: boolean
      }
      rep_device_matches: {
        Args: { p_profile_id: string; p_device_id: string }; Returns: boolean
      }
      set_pin_hash: { Args: { p_profile_id: string; p_hash: string }; Returns: undefined }
      role_for_email: { Args: { p_email: string }; Returns: UserRole | null }
    }
    Enums: {
      user_role: UserRole
      booking_kind: BookingKind
      booking_status: BookingStatus
      pay_method: PayMethod
      seat_type: SeatType
      exception_type: ExceptionType
    }
    CompositeTypes: Record<string, never>
  }
}
