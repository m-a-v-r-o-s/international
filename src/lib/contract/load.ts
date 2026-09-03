import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, DamageViewCol, MarkTypeCol } from '@/lib/supabase/database.types'
import { pointToZone } from '@/lib/damage/zones'
import { parseCompany, contractReadiness, type ContractReadiness } from './company'
import type { ContractData, ContractDriver, ContractMark } from './data'

/**
 * Everything the agreement prints, gathered from the booking.
 *
 * Every read goes through the caller's own session, so RLS decides what comes
 * back: a rep reaching for a booking that is neither theirs nor their hotel's
 * gets nothing, and there is no service-role shortcut here to make the PDF
 * "just work". `select *` is refused on `bookings`, so the columns are named.
 */
export type ContractSource = {
  data: ContractData
  readiness: ContractReadiness
  /** The signed agreement already on file, if the guest has signed. */
  contract: {
    id: string
    pdf_path: string
    signed_at: string
    signer_name: string
    emailed_to: string | null
    emailed_at: string | null
    version: number
  } | null
  custEmail: string | null
}

export async function loadContractSource(
  supabase: SupabaseClient<Database>, bookingId: string,
): Promise<ContractSource | null> {
  const { data: booking } = await supabase.from('bookings')
    .select('id, ref, kind, status, car_id, category_id, hotel_id, room_number, start_date, end_date, pickup_at, dropoff_at, cust_email, days, total, collected, pay_method, paid')
    .eq('id', bookingId).eq('kind', 'rental').maybeSingle()
  if (!booking) return null

  const [{ data: settings }, { data: car }, { data: drivers }, { data: handovers }, { data: hotel }] =
    await Promise.all([
      supabase.from('app_settings').select('id, company').eq('id', 1).maybeSingle(),
      supabase.from('cars').select('id, plate, model_id, year, colour').eq('id', booking.car_id).maybeSingle(),
      supabase.from('booking_drivers')
        .select('id, is_main, first_name, last_name, dob, licence_number, licence_country, licence_issued_on, licence_expires_on')
        .eq('booking_id', bookingId)
        .order('is_main', { ascending: false }).order('created_at'),
      supabase.from('handovers')
        .select('id, kind, fuel_eighths').eq('booking_id', bookingId).eq('kind', 'pickup'),
      booking.hotel_id
        ? supabase.from('hotels').select('id, name').eq('id', booking.hotel_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

  const { data: model } = car
    ? await supabase.from('car_models').select('id, make, model, category_id').eq('id', car.model_id).maybeSingle()
    : { data: null }

  const { data: category } = booking.category_id
    ? await supabase.from('categories').select('id, code, name_el, name_en')
        .eq('id', booking.category_id).maybeSingle()
    : { data: null }

  const pickup = handovers?.[0] ?? null

  // The condition recorded at PICK-UP is what the agreement states. Marks
  // added at return are a different conversation, held with the boss through
  // the exceptions queue (docs/01-DECISIONS.md §14), and have no business on a
  // document the guest signed on the way out.
  const { data: marks } = pickup
    ? await supabase.from('damage_marks')
        .select('id, view, x, y, mark_type, note, created_at')
        .eq('handover_id', pickup.id).order('created_at')
    : { data: [] }

  const { data: contracts } = await supabase.from('contracts')
    .select('id, pdf_path, signed_at, signer_name, emailed_to, emailed_at, version')
    .eq('booking_id', bookingId).order('version', { ascending: false }).limit(1)

  const company = parseCompany(settings?.company)
  const readiness = contractReadiness(company)

  const contractMarks: ContractMark[] = (marks ?? []).map((mark, index) => {
    const x = Number(mark.x)
    const y = Number(mark.y)
    return {
      // CHECK-constrained text — see src/lib/supabase/database.types.ts.
      view: mark.view as DamageViewCol,
      x, y,
      zone: pointToZone(x, y),
      markType: mark.mark_type as MarkTypeCol,
      note: mark.note,
      index: index + 1,
    }
  })

  const contractDrivers: ContractDriver[] = (drivers ?? []).map((d) => ({
    isMain: d.is_main,
    firstName: d.first_name,
    lastName: d.last_name,
    dob: d.dob,
    licenceNumber: d.licence_number,
    licenceCountry: d.licence_country,
    licenceIssuedOn: d.licence_issued_on,
    licenceExpiresOn: d.licence_expires_on,
  }))

  return {
    readiness,
    contract: contracts?.[0] ?? null,
    custEmail: booking.cust_email,
    data: {
      company,
      draft: !readiness.ready,
      ref: booking.ref,
      startDate: booking.start_date,
      endDate: booking.end_date,
      days: booking.days,
      pickupAt: booking.pickup_at,
      dropoffAt: booking.dropoff_at,
      hotelName: hotel?.name ?? null,
      roomNumber: booking.room_number,
      plate: car?.plate ?? '–',
      make: model?.make ?? null,
      model: model?.model ?? null,
      categoryEl: category ? `${category.code} · ${category.name_el}` : null,
      categoryEn: category ? `${category.code} · ${category.name_en}` : null,
      year: car?.year ?? null,
      colour: car?.colour ?? null,
      drivers: contractDrivers,
      fuelOutEighths: pickup?.fuel_eighths ?? null,
      marks: contractMarks,
      total: booking.total,
      collected: booking.collected,
      payMethod: booking.pay_method,
      paid: booking.paid,
      signature: null,
      signerName: null,
      signedAt: null,
    },
  }
}
