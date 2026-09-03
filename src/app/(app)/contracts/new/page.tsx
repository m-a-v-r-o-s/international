import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import type { BookingRow } from '@/lib/supabase/database.types'
import { searchUnsignedBookings } from './actions'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('writeContract')
  return { title: t('title') }
}

/**
 * R4b · Write up the contract (docs/04-SCREENS.md, docs/01-DECISIONS.md §30).
 *
 * None of the contract flow is new. Licence capture, the OCR autofill, the
 * editable driver form, the eligibility gate, the signature and the PDF are
 * R4's agreement step and stay exactly where they are. What was missing was a
 * way IN that is not "first find the right booking, then open it, then start
 * pickup" — a rep with a licence in one hand needs the flow, not the route to
 * it.
 *
 * So this screen is two doors and no logic of its own:
 *
 *   1. a booking that exists — every slip of the caller's that has no signed
 *      agreement against it yet, straight into that booking's pickup flow;
 *   2. no booking at all — the walk-in, who is booked and picked up in one
 *      motion, because `contracts.booking_id` is a NOT NULL foreign key and a
 *      contract genuinely cannot exist without a rental underneath it.
 *
 * Both doors open at the FIRST step of the pickup flow, never at the
 * signature. That is §30 decision 3 and it is deliberate: R4 already refuses
 * to show the agreement step until the eligibility gate passes, and an entry
 * point that jumped past it would quietly delete a check that exists today —
 * a guest signing a rental agreement for a car they are not allowed to drive
 * (§11).
 *
 * The list is what a signed agreement is missing FROM, so it holds `booked`
 * rentals only. A rental already `out` cannot be taken through the pickup
 * flow — R4 stops at "already out" — so listing one here would be a link to a
 * dead end.
 */
export default async function WriteContractPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireUnlocked()
  const t = await getTranslations('writeContract')
  const tb = await getTranslations('bookingDetail')
  const tc = await getTranslations('common')
  const params = await searchParams
  const q = params.q?.trim() ?? ''
  const supabase = await supabaseServer()

  // RLS narrows this to the caller's own bookings and their hotel's — the same
  // set R6 shows them — and gives the admin every one. No second filter here.
  const { data: bookings } = await supabase.from('bookings')
    .select('id, ref, status, car_id, start_date, end_date, room_number, cust_first, cust_last, cust_phone')
    .eq('kind', 'rental')
    .eq('status', 'booked')
    .order('start_date')
    .limit(300)

  let rows = (bookings ?? []) as Pick<
    BookingRow, 'id' | 'ref' | 'status' | 'car_id' | 'start_date' | 'end_date'
    | 'room_number' | 'cust_first' | 'cust_last' | 'cust_phone'
  >[]

  // "Has no signed agreement yet" is the absence of a contracts row, asked as
  // its own read rather than as an embedded join: `contracts` carries its own
  // policy, and a booking whose contract this caller may not read must still
  // count as signed rather than silently reappear here as unsigned.
  const ids = rows.map((r) => r.id)
  const [{ data: contracts }, { data: cars }] = await Promise.all([
    ids.length > 0
      ? supabase.from('contracts').select('booking_id').in('booking_id', ids)
      : Promise.resolve({ data: [] as { booking_id: string }[] }),
    ids.length > 0
      ? supabase.from('cars').select('id, plate').in('id', [...new Set(rows.map((r) => r.car_id))])
      : Promise.resolve({ data: [] as { id: string; plate: string }[] }),
  ])
  const signed = new Set((contracts ?? []).map((c) => c.booking_id))
  const plateById = new Map((cars ?? []).map((c) => [c.id, c.plate]))

  rows = rows.filter((r) => !signed.has(r.id))

  if (q) {
    const needle = q.toLowerCase()
    rows = rows.filter((r) =>
      r.cust_first?.toLowerCase().includes(needle)
      || r.cust_last?.toLowerCase().includes(needle)
      || r.cust_phone?.toLowerCase().includes(needle)
      || r.ref.toLowerCase().includes(needle)
      || (plateById.get(r.car_id) ?? '').toLowerCase().includes(needle)
      || r.start_date.includes(needle))
  }
  rows = rows.slice(0, 100)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('intro')}</p>
      </div>

      <section className="ir-card flex flex-col gap-3 p-4" aria-labelledby="walk-in-heading">
        <h2 id="walk-in-heading" className="text-[1.0625rem] font-semibold">{t('walkInTitle')}</h2>
        <p className="text-[0.9375rem] text-ink-soft">{t('walkInIntro')}</p>
        <Link href="/contracts/new/walk-in" className="ir-btn-primary sm:!w-auto sm:self-start">
          {t('walkInAction')}
        </Link>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="pick-heading">
        <h2 id="pick-heading" className="text-[1.0625rem] font-semibold">{t('pickTitle')}</h2>
        <p className="text-[0.9375rem] text-ink-soft">{t('pickIntro')}</p>

        <form action={searchUnsignedBookings} className="flex gap-2">
          <label className="sr-only" htmlFor="q">{t('searchLabel')}</label>
          <input
            id="q" name="q" type="search" defaultValue={q} className="ir-field"
            placeholder={t('searchPlaceholder')}
          />
          <button type="submit" className="ir-btn-quiet !w-auto">{tc('continue')}</button>
        </form>

        {rows.length === 0 ? (
          <p className="text-ink-soft">{q ? tc('noResults') : t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((booking) => (
              <li key={booking.id}>
                <Link
                  href={`/bookings/${booking.id}/pickup`}
                  className="ir-card flex items-center justify-between gap-3 p-3.5"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {`${booking.cust_first ?? ''} ${booking.cust_last ?? ''}`.trim()
                        || booking.cust_phone
                        || booking.ref}
                      {' · '}{plateById.get(booking.car_id) ?? '–'}
                    </p>
                    <p className="truncate text-[0.8125rem] text-ink-soft">
                      {booking.start_date} → {booking.end_date}
                      {booking.room_number ? ` · ${tb('hotelRoom')} ${booking.room_number}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-[0.875rem] font-medium text-brand">
                    {t('pickAction')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
