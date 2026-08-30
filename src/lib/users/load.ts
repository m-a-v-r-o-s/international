import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, HotelRow, UserRole } from '../supabase/database.types'

/**
 * A8's reading half.
 *
 * Everything here goes through the CALLER'S session client, so the policies
 * decide it: `admin_list_users()` asserts app.is_admin() in the database, and
 * `hotel_reps` is admin-only for any row but the caller's own. Nothing in this
 * module reaches for the service role — the only thing that does is minting
 * the account itself (src/lib/users/accounts.ts), because that is the one
 * thing Postgres cannot do.
 */
export type StaffRow = {
  id: string
  email: string | null
  role: UserRole
  full_name: string
  phone: string | null
  lang: string
  active: boolean
  created_at: string
  last_sign_in_at: string | null
}

export type StaffWithHotels = StaffRow & {
  homeHotel: HotelRow | null
  coverHotels: HotelRow[]
}

type Client = SupabaseClient<Database>

export async function loadHotels(supabase: Client): Promise<HotelRow[]> {
  const { data } = await supabase
    .from('hotels')
    .select('id, name, area, address, active, created_at')
    .order('name')
  return (data ?? []) as HotelRow[]
}

export async function loadStaff(supabase: Client): Promise<StaffRow[]> {
  const { data } = await supabase.rpc('admin_list_users')
  return (data ?? []) as StaffRow[]
}

export type Assignment = { hotel_id: string; profile_id: string; is_primary: boolean }

export async function loadAssignments(supabase: Client): Promise<Assignment[]> {
  const { data } = await supabase.from('hotel_reps').select('hotel_id, profile_id, is_primary')
  return (data ?? []) as Assignment[]
}

/**
 * The staff list with each person's hotels attached.
 *
 * The three reads are separate on purpose rather than one nested select:
 * `admin_list_users()` is a SECURITY DEFINER function, not a table, so
 * PostgREST cannot embed a relation into it. Joining here also keeps the
 * hotel names coming from the `hotels` policy rather than from the function,
 * which means a hotel the admin cannot see cannot arrive by the side door.
 */
export async function loadStaffWithHotels(supabase: Client): Promise<{
  staff: StaffWithHotels[]
  hotels: HotelRow[]
}> {
  const [staff, hotels, assignments] = await Promise.all([
    loadStaff(supabase),
    loadHotels(supabase),
    loadAssignments(supabase),
  ])

  const hotelById = new Map(hotels.map((h) => [h.id, h]))

  return {
    hotels,
    staff: staff.map((person) => {
      const mine = assignments.filter((a) => a.profile_id === person.id)
      const home = mine.find((a) => a.is_primary)
      return {
        ...person,
        homeHotel: home ? hotelById.get(home.hotel_id) ?? null : null,
        coverHotels: mine
          .filter((a) => !a.is_primary)
          .map((a) => hotelById.get(a.hotel_id))
          .filter((h): h is HotelRow => Boolean(h))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }
    }),
  }
}

/** How many staff each hotel has, for the hotels screen. An ADMIN aggregate. */
export function repCountByHotel(assignments: Assignment[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const a of assignments) counts.set(a.hotel_id, (counts.get(a.hotel_id) ?? 0) + 1)
  return counts
}
