export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          company: Json
          dropoff_window: string
          fuel_charge_per_eighth: number
          id: number
          licence_retention_months: number
          pickup_window: string
          updated_at: string
        }
        Insert: {
          company?: Json
          dropoff_window?: string
          fuel_charge_per_eighth?: number
          id?: number
          licence_retention_months?: number
          pickup_window?: string
          updated_at?: string
        }
        Update: {
          company?: Json
          dropoff_window?: string
          fuel_charge_per_eighth?: number
          id?: number
          licence_retention_months?: number
          pickup_window?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          at: string
          before: Json | null
          entity: string
          entity_id: string | null
          id: number
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          entity: string
          entity_id?: string | null
          id?: number
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          entity?: string
          entity_id?: string | null
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_drivers: {
        Row: {
          back_image_path: string | null
          booking_id: string
          created_at: string
          dob: string
          first_name: string
          front_image_path: string | null
          id: string
          images_purged_at: string | null
          is_main: boolean
          last_name: string
          licence_country: string | null
          licence_expires_on: string | null
          licence_issued_on: string | null
          licence_number: string | null
          ocr_confidence: number | null
          ocr_reviewed: boolean
        }
        Insert: {
          back_image_path?: string | null
          booking_id: string
          created_at?: string
          dob: string
          first_name: string
          front_image_path?: string | null
          id?: string
          images_purged_at?: string | null
          is_main?: boolean
          last_name: string
          licence_country?: string | null
          licence_expires_on?: string | null
          licence_issued_on?: string | null
          licence_number?: string | null
          ocr_confidence?: number | null
          ocr_reviewed?: boolean
        }
        Update: {
          back_image_path?: string | null
          booking_id?: string
          created_at?: string
          dob?: string
          first_name?: string
          front_image_path?: string | null
          id?: string
          images_purged_at?: string | null
          is_main?: boolean
          last_name?: string
          licence_country?: string | null
          licence_expires_on?: string | null
          licence_issued_on?: string | null
          licence_number?: string | null
          ocr_confidence?: number | null
          ocr_reviewed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "booking_drivers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_extras: {
        Row: {
          booking_id: string
          id: string
          qty: number
          seat: Database["public"]["Enums"]["seat_type"]
        }
        Insert: {
          booking_id: string
          id?: string
          qty?: number
          seat: Database["public"]["Enums"]["seat_type"]
        }
        Update: {
          booking_id?: string
          id?: string
          qty?: number
          seat?: Database["public"]["Enums"]["seat_type"]
        }
        Relationships: [
          {
            foreignKeyName: "booking_extras_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          block_reason: string | null
          car_id: string
          cash_handover_id: string | null
          category_id: string | null
          collected: number
          created_at: string
          created_by: string
          cust_dob: string | null
          cust_email: string | null
          cust_first: string | null
          cust_last: string | null
          cust_phone: string | null
          cust_phone_e164: string | null
          days: number | null
          dropoff_at: string | null
          eligibility_override_at: string | null
          eligibility_override_by: string | null
          end_date: string
          exception_status: string | null
          fuel_charge: number | null
          hotel_id: string | null
          id: string
          kind: Database["public"]["Enums"]["booking_kind"]
          paid: boolean
          pay_method: Database["public"]["Enums"]["pay_method"] | null
          period_id: string | null
          pickup_at: string | null
          pickup_exception: boolean
          pickup_exception_reason: string | null
          ref: string
          returned_at: string | null
          room_number: string | null
          start_date: string
          status: Database["public"]["Enums"]["booking_status"]
          total: number | null
          updated_at: string
          window_override: boolean
        }
        Insert: {
          block_reason?: string | null
          car_id: string
          cash_handover_id?: string | null
          category_id?: string | null
          collected?: number
          created_at?: string
          created_by: string
          cust_dob?: string | null
          cust_email?: string | null
          cust_first?: string | null
          cust_last?: string | null
          cust_phone?: string | null
          cust_phone_e164?: string | null
          days?: number | null
          dropoff_at?: string | null
          eligibility_override_at?: string | null
          eligibility_override_by?: string | null
          end_date: string
          exception_status?: string | null
          fuel_charge?: number | null
          hotel_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["booking_kind"]
          paid?: boolean
          pay_method?: Database["public"]["Enums"]["pay_method"] | null
          period_id?: string | null
          pickup_at?: string | null
          pickup_exception?: boolean
          pickup_exception_reason?: string | null
          ref: string
          returned_at?: string | null
          room_number?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["booking_status"]
          total?: number | null
          updated_at?: string
          window_override?: boolean
        }
        Update: {
          block_reason?: string | null
          car_id?: string
          cash_handover_id?: string | null
          category_id?: string | null
          collected?: number
          created_at?: string
          created_by?: string
          cust_dob?: string | null
          cust_email?: string | null
          cust_first?: string | null
          cust_last?: string | null
          cust_phone?: string | null
          cust_phone_e164?: string | null
          days?: number | null
          dropoff_at?: string | null
          eligibility_override_at?: string | null
          eligibility_override_by?: string | null
          end_date?: string
          exception_status?: string | null
          fuel_charge?: number | null
          hotel_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["booking_kind"]
          paid?: boolean
          pay_method?: Database["public"]["Enums"]["pay_method"] | null
          period_id?: string | null
          pickup_at?: string | null
          pickup_exception?: boolean
          pickup_exception_reason?: string | null
          ref?: string
          returned_at?: string | null
          room_number?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["booking_status"]
          total?: number | null
          updated_at?: string
          window_override?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "bookings_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_cash_handover_fk"
            columns: ["cash_handover_id"]
            isOneToOne: false
            referencedRelation: "cash_handovers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_eligibility_override_by_fkey"
            columns: ["eligibility_override_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "pricing_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      car_models: {
        Row: {
          aircon: boolean
          category_id: string
          doors: number
          fuel_type: string
          id: string
          make: string
          model: string
          photo_path: string | null
          seats: number
          tank_litres: number | null
          transmission: string
        }
        Insert: {
          aircon?: boolean
          category_id: string
          doors: number
          fuel_type: string
          id?: string
          make: string
          model: string
          photo_path?: string | null
          seats: number
          tank_litres?: number | null
          transmission: string
        }
        Update: {
          aircon?: boolean
          category_id?: string
          doors?: number
          fuel_type?: string
          id?: string
          make?: string
          model?: string
          photo_path?: string | null
          seats?: number
          tank_litres?: number | null
          transmission?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_models_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      cars: {
        Row: {
          archived_at: string | null
          colour: string | null
          created_at: string
          id: string
          model_id: string
          notes: string | null
          photo_path: string | null
          plate: string
          updated_at: string
          year: number | null
        }
        Insert: {
          archived_at?: string | null
          colour?: string | null
          created_at?: string
          id?: string
          model_id: string
          notes?: string | null
          photo_path?: string | null
          plate: string
          updated_at?: string
          year?: number | null
        }
        Update: {
          archived_at?: string | null
          colour?: string | null
          created_at?: string
          id?: string
          model_id?: string
          notes?: string | null
          photo_path?: string | null
          plate?: string
          updated_at?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cars_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "car_models"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_handovers: {
        Row: {
          amount: number
          confirmed_by: string | null
          handed_at: string
          id: string
          rep_id: string
        }
        Insert: {
          amount: number
          confirmed_by?: string | null
          handed_at?: string
          id?: string
          rep_id: string
        }
        Update: {
          amount?: number
          confirmed_by?: string | null
          handed_at?: string
          id?: string
          rep_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_handovers_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_handovers_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          code: string
          id: string
          min_driver_age: number
          min_licence_years: number
          name_el: string
          name_en: string
          sort_order: number
        }
        Insert: {
          code: string
          id?: string
          min_driver_age: number
          min_licence_years?: number
          name_el: string
          name_en: string
          sort_order: number
        }
        Update: {
          code?: string
          id?: string
          min_driver_age?: number
          min_licence_years?: number
          name_el?: string
          name_en?: string
          sort_order?: number
        }
        Relationships: []
      }
      contracts: {
        Row: {
          booking_id: string
          emailed_at: string | null
          emailed_to: string | null
          id: string
          pdf_path: string
          signature_path: string
          signed_at: string
          signer_name: string
          version: number
        }
        Insert: {
          booking_id: string
          emailed_at?: string | null
          emailed_to?: string | null
          id?: string
          pdf_path: string
          signature_path: string
          signed_at?: string
          signer_name: string
          version?: number
        }
        Update: {
          booking_id?: string
          emailed_at?: string | null
          emailed_to?: string | null
          id?: string
          pdf_path?: string
          signature_path?: string
          signed_at?: string
          signer_name?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "contracts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_bookings: {
        Row: {
          booking_id: string
          consent_at: string
          consent_by: string | null
          created_at: string
          customer_id: string
        }
        Insert: {
          booking_id: string
          consent_at?: string
          consent_by?: string | null
          created_at?: string
          customer_id: string
        }
        Update: {
          booking_id?: string
          consent_at?: string
          consent_by?: string | null
          created_at?: string
          customer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_bookings_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_bookings_consent_by_fkey"
            columns: ["consent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          dob: string | null
          first_name: string | null
          first_seen_at: string
          id: string
          last_name: string | null
          last_seen_at: string
          licence_back_path: string | null
          licence_booking_id: string | null
          licence_country: string | null
          licence_expires_on: string | null
          licence_front_path: string | null
          licence_issued_on: string | null
          licence_number: string | null
          phone_e164: string
          updated_at: string
        }
        Insert: {
          dob?: string | null
          first_name?: string | null
          first_seen_at?: string
          id?: string
          last_name?: string | null
          last_seen_at?: string
          licence_back_path?: string | null
          licence_booking_id?: string | null
          licence_country?: string | null
          licence_expires_on?: string | null
          licence_front_path?: string | null
          licence_issued_on?: string | null
          licence_number?: string | null
          phone_e164: string
          updated_at?: string
        }
        Update: {
          dob?: string | null
          first_name?: string | null
          first_seen_at?: string
          id?: string
          last_name?: string | null
          last_seen_at?: string
          licence_back_path?: string | null
          licence_booking_id?: string | null
          licence_country?: string | null
          licence_expires_on?: string | null
          licence_front_path?: string | null
          licence_issued_on?: string | null
          licence_number?: string | null
          phone_e164?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_licence_booking_id_fkey"
            columns: ["licence_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      damage_marks: {
        Row: {
          car_id: string
          created_at: string
          handover_id: string
          id: string
          mark_type: string
          note: string | null
          photo_path: string | null
          pre_existing: boolean
          view: string
          x: number
          y: number
        }
        Insert: {
          car_id: string
          created_at?: string
          handover_id: string
          id?: string
          mark_type: string
          note?: string | null
          photo_path?: string | null
          pre_existing?: boolean
          view: string
          x: number
          y: number
        }
        Update: {
          car_id?: string
          created_at?: string
          handover_id?: string
          id?: string
          mark_type?: string
          note?: string | null
          photo_path?: string | null
          pre_existing?: boolean
          view?: string
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "damage_marks_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "damage_marks_handover_id_fkey"
            columns: ["handover_id"]
            isOneToOne: false
            referencedRelation: "handovers"
            referencedColumns: ["id"]
          },
        ]
      }
      handovers: {
        Row: {
          booking_id: string
          by_profile: string
          fuel_cash_handover_id: string | null
          fuel_collected: number
          fuel_eighths: number | null
          fuel_pay_method: Database["public"]["Enums"]["pay_method"] | null
          id: string
          kind: string
          notes: string | null
          occurred_at: string
        }
        Insert: {
          booking_id: string
          by_profile: string
          fuel_cash_handover_id?: string | null
          fuel_collected?: number
          fuel_eighths?: number | null
          fuel_pay_method?: Database["public"]["Enums"]["pay_method"] | null
          id?: string
          kind: string
          notes?: string | null
          occurred_at?: string
        }
        Update: {
          booking_id?: string
          by_profile?: string
          fuel_cash_handover_id?: string | null
          fuel_collected?: number
          fuel_eighths?: number | null
          fuel_pay_method?: Database["public"]["Enums"]["pay_method"] | null
          id?: string
          kind?: string
          notes?: string | null
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "handovers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handovers_by_profile_fkey"
            columns: ["by_profile"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handovers_fuel_cash_handover_id_fkey"
            columns: ["fuel_cash_handover_id"]
            isOneToOne: false
            referencedRelation: "cash_handovers"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_reps: {
        Row: {
          hotel_id: string
          is_primary: boolean
          profile_id: string
        }
        Insert: {
          hotel_id: string
          is_primary?: boolean
          profile_id: string
        }
        Update: {
          hotel_id?: string
          is_primary?: boolean
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_reps_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_reps_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hotels: {
        Row: {
          active: boolean
          address: string | null
          area: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          area?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          address?: string | null
          area?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      incident_photos: {
        Row: {
          added_at: string
          added_by: string | null
          id: string
          incident_id: string
          path: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          id?: string
          incident_id: string
          path: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          id?: string
          incident_id?: string
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_photos_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_photos_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
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
          charge?: number | null
          id?: string
          note?: string | null
          notified_at?: string | null
          raised_at?: string
          raised_by?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          booking_id?: string
          charge?: number | null
          id?: string
          note?: string | null
          notified_at?: string | null
          raised_at?: string
          raised_by?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incidents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      price_extra_day: {
        Row: {
          category_id: string
          period_id: string
          price: number
        }
        Insert: {
          category_id: string
          period_id: string
          price: number
        }
        Update: {
          category_id?: string
          period_id?: string
          price?: number
        }
        Relationships: [
          {
            foreignKeyName: "price_extra_day_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_extra_day_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "pricing_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      price_rows: {
        Row: {
          category_id: string
          days: number
          period_id: string
          total: number
        }
        Insert: {
          category_id: string
          days: number
          period_id: string
          total: number
        }
        Update: {
          category_id?: string
          days?: number
          period_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "price_rows_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_rows_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "pricing_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_periods: {
        Row: {
          created_at: string
          end_date: string
          id: string
          name: string
          season_year: number
          start_date: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          name: string
          season_year: number
          start_date: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          name?: string
          season_year?: number
          start_date?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          full_name: string
          id: string
          lang: string
          notify_evening: boolean
          notify_incidents: boolean
          notify_morning: boolean
          phone: string | null
          pin_hash: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          full_name?: string
          id: string
          lang?: string
          notify_evening?: boolean
          notify_incidents?: boolean
          notify_morning?: boolean
          phone?: string | null
          pin_hash?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          full_name?: string
          id?: string
          lang?: string
          notify_evening?: boolean
          notify_incidents?: boolean
          notify_morning?: boolean
          phone?: string | null
          pin_hash?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          keys: Json
          profile_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          keys: Json
          profile_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          keys?: Json
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rep_devices: {
        Row: {
          bound_at: string
          device_id: string
          last_seen_at: string
          profile_id: string
          user_agent: string | null
        }
        Insert: {
          bound_at?: string
          device_id: string
          last_seen_at?: string
          profile_id: string
          user_agent?: string | null
        }
        Update: {
          bound_at?: string
          device_id?: string
          last_seen_at?: string
          profile_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rep_devices_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_approve_exception_booking: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      admin_audit_entities: {
        Args: never
        Returns: {
          entity: string
        }[]
      }
      admin_audit_log: {
        Args: {
          p_actor?: string
          p_entity?: string
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_to?: string
        }
        Returns: {
          action: string
          actor_id: string
          actor_name: string
          after: Json
          at: string
          before: Json
          entity: string
          entity_id: string
          id: number
        }[]
      }
      admin_blocks: {
        Args: { p_from: string; p_to: string }
        Returns: {
          block_reason: string
          car_id: string
          end_date: string
          id: string
          start_date: string
        }[]
      }
      admin_car_notes: { Args: { p_car_id: string }; Returns: string }
      admin_clear_customer_ledger: {
        Args: {
          p_confirm: string
          p_irreversible: boolean
          p_understood: boolean
        }
        Returns: number
      }
      admin_confirm_cash_handover: {
        Args: { p_id: string }
        Returns: undefined
      }
      admin_create_block: {
        Args: {
          p_car_id: string
          p_end: string
          p_reason: string
          p_start: string
        }
        Returns: string
      }
      admin_customer_ledger_status: {
        Args: never
        Returns: {
          last_cleared_at: string
          last_erasure_at: string
          linked_bookings: number
          newest_seen: string
          oldest_seen: string
          total: number
          with_licence_images: number
        }[]
      }
      admin_delete_block: { Args: { p_id: string }; Returns: undefined }
      admin_deny_exception_booking: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      admin_erase_customer: {
        Args: { p_customer_id: string }
        Returns: {
          back_path: string
          front_path: string
        }[]
      }
      admin_incident_detail: {
        Args: { p_id: string }
        Returns: {
          booking_id: string
          charge: number
          id: string
          note: string
          raised_at: string
          raised_by: string
          resolution: string
          resolved_at: string
          resolved_by: string
        }[]
      }
      admin_licence_retention_status: {
        Args: never
        Returns: {
          cutoff: string
          due_count: number
          last_purge_at: string
          oldest_due: string
          orphan_count: number
          purged_drivers: number
          retention_months: number
        }[]
      }
      admin_list_users: {
        Args: never
        Returns: {
          active: boolean
          created_at: string
          email: string
          full_name: string
          id: string
          lang: string
          last_sign_in_at: string
          phone: string
          role: Database["public"]["Enums"]["user_role"]
        }[]
      }
      admin_override_eligibility: {
        Args: { p_booking_id: string; p_note: string }
        Returns: undefined
      }
      admin_pending_cash_handovers: {
        Args: never
        Returns: {
          amount: number
          handed_at: string
          id: string
          rep_id: string
          rep_name: string
        }[]
      }
      admin_pending_exception_bookings: {
        Args: never
        Returns: {
          booking_id: string
          guest: string
          hotel_name: string
          pickup_at: string
          plate: string
          reason: string
          ref: string
          room_number: string
        }[]
      }
      admin_resolve_incident: {
        Args: { p_charge: number; p_id: string; p_resolution: string }
        Returns: undefined
      }
      admin_set_booking_price: {
        Args: { p_booking_id: string; p_total: number }
        Returns: undefined
      }
      admin_set_car_notes: {
        Args: { p_car_id: string; p_notes: string }
        Returns: undefined
      }
      admin_set_cover: {
        Args: { p_covers: boolean; p_hotel_id: string; p_profile_id: string }
        Returns: undefined
      }
      admin_set_home_hotel: {
        Args: { p_hotel_id: string; p_profile_id: string }
        Returns: undefined
      }
      admin_set_user_active: {
        Args: { p_active: boolean; p_profile_id: string }
        Returns: undefined
      }
      admin_set_user_role: {
        Args: {
          p_profile_id: string
          p_role: Database["public"]["Enums"]["user_role"]
        }
        Returns: undefined
      }
      admin_update_block: {
        Args: { p_end: string; p_id: string; p_reason: string; p_start: string }
        Returns: undefined
      }
      availability: {
        Args: { from_date: string; to_date: string }
        Returns: {
          car_id: string
          occupied_dates: string[]
        }[]
      }
      bind_rep_device: {
        Args: {
          p_device_id: string
          p_profile_id: string
          p_user_agent?: string
        }
        Returns: boolean
      }
      booking_windows: {
        Args: never
        Returns: {
          dropoff_from: string
          dropoff_to: string
          pickup_from: string
          pickup_to: string
        }[]
      }
      check_eligibility: {
        Args: {
          p_category_id: string
          p_dob: string
          p_end: string
          p_licence_expires_on: string
          p_licence_issued_on: string
          p_start: string
        }
        Returns: {
          failures: string[]
          ok: boolean
        }[]
      }
      credential_lookup_for_email: {
        Args: { p_email: string }
        Returns: {
          active: boolean
          id: string
          pin_hash: string
          role: Database["public"]["Enums"]["user_role"]
        }[]
      }
      customer_by_phone: {
        Args: { p_phone: string }
        Returns: {
          customer_id: string
          dob: string
          first_name: string
          has_licence_images: boolean
          last_name: string
          last_seen_at: string
          licence_country: string
          licence_expires_on: string
          licence_issued_on: string
          licence_number: string
        }[]
      }
      customer_licence_images: {
        Args: { p_customer_id: string }
        Returns: {
          back_path: string
          front_path: string
          source_booking_id: string
        }[]
      }
      drop_push_subscription: { Args: { p_endpoint: string }; Returns: number }
      licence_images_due_for_purge: {
        Args: { p_limit?: number }
        Returns: {
          booking_id: string
          ended_on: string
          object_name: string
        }[]
      }
      log_security_event: {
        Args: {
          p_detail?: Json
          p_email_hash?: string
          p_ip_hash?: string
          p_kind: string
          p_profile_id?: string
        }
        Returns: undefined
      }
      mark_incidents_notified: { Args: { p_ids: string[] }; Returns: number }
      mark_licences_purged: {
        Args: { p_booking_ids: string[] }
        Returns: number
      }
      my_cash_in_hand: { Args: never; Returns: number }
      my_cash_ready_to_hand_over: { Args: never; Returns: number }
      my_hand_over_cash: {
        Args: never
        Returns: {
          amount: number
          handover_id: string
        }[]
      }
      pending_incident_notifications: {
        Args: { p_limit?: number }
        Returns: {
          booking_ref: string
          id: string
          note: string
          plate: string
          raised_at: string
        }[]
      }
      push_targets: {
        Args: { p_kind: string }
        Returns: {
          endpoint: string
          keys: Json
          lang: string
          profile_id: string
        }[]
      }
      quote: {
        Args: { p_category_id: string; p_end: string; p_start: string }
        Returns: {
          days: number
          period_id: string
          total: number
        }[]
      }
      rate_limit_hit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number }
        Returns: boolean
      }
      record_customer_consent: {
        Args: { p_booking_id: string }
        Returns: string
      }
      rental_days: { Args: { p_end: string; p_start: string }; Returns: number }
      rep_day_movements: {
        Args: { p_on: string; p_profile_id: string }
        Returns: {
          at: string
          booking_id: string
          guest: string
          kind: string
          plate: string
          room: string
        }[]
      }
      rep_device_matches: {
        Args: { p_device_id: string; p_profile_id: string }
        Returns: boolean
      }
      role_for_email: {
        Args: { p_email: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      set_pin_hash: {
        Args: { p_hash: string; p_profile_id: string }
        Returns: undefined
      }
      staff_hotels: {
        Args: never
        Returns: {
          area: string
          id: string
          name: string
        }[]
      }
      withdraw_customer_consent: {
        Args: { p_booking_id: string }
        Returns: boolean
      }
    }
    Enums: {
      booking_kind: "rental" | "block"
      booking_status:
        | "booked"
        | "out"
        | "returned"
        | "cancelled"
        | "no_show"
        | "blocked"
      pay_method: "cash" | "card" | "transfer"
      seat_type: "infant" | "child" | "booster"
      user_role: "admin" | "rep"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      booking_kind: ["rental", "block"],
      booking_status: [
        "booked",
        "out",
        "returned",
        "cancelled",
        "no_show",
        "blocked",
      ],
      pay_method: ["cash", "card", "transfer"],
      seat_type: ["infant", "child", "booster"],
      user_role: ["admin", "rep"],
    },
  },
} as const
