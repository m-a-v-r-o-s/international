import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { addDays, todayAthens } from '@/lib/dates'
import { athensDateTime, calendarDate } from '@/lib/contract/data'
import { toCsv } from '@/lib/fleet/csv'

/**
 * The outage sheet: an evening email to the owner holding what he needs to run
 * the next 48 hours on paper if the app is down (docs/07-SEASON-ROUTINE.md,
 * "Outage sheet").
 *
 * It is sent before an outage, not during one, because an app whose server or
 * database is down cannot read the bookings it would need to send. The uptime
 * monitor's alert only has to say "open last night's sheet".
 *
 * Deliberately left out: licence data, dates of birth and guest emails. A
 * mailbox is a weaker store than the database and none of it is needed to hand
 * over or collect a car. The guest's phone is the one personal field that is.
 */

type Booking = {
  ref: string
  status: string
  car_id: string
  hotel_id: string | null
  adhoc_hotel_name: string | null
  room_number: string | null
  start_date: string
  end_date: string
  pickup_at: string | null
  dropoff_at: string | null
  cust_first: string | null
  cust_last: string | null
  cust_phone: string | null
  total: number | null
  collected: number
  paid: boolean
  created_by: string
}

export type OutageSheetData = {
  today: string
  /** Rentals `booked` or `out`, plus every `blocked` hold, that touch the window. */
  bookings: Booking[]
  blocks: { car_id: string; start_date: string; end_date: string }[]
  cars: { id: string; plate: string; model_id: string }[]
  models: { id: string; make: string; model: string; category_id: string }[]
  categories: { id: string; code: string }[]
  hotels: { id: string; name: string }[]
  reps: { id: string; full_name: string; phone: string | null }[]
  hotelReps: { hotel_id: string; profile_id: string }[]
}

export type OutageSheet = { subject: string; html: string; text: string; csv: string; filename: string }

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Null when there is nothing to hand over, collect or chase in the window. */
export function buildOutageSheet(d: OutageSheetData): OutageSheet | null {
  const from = d.today
  const to = addDays(d.today, 2)

  const pickups = d.bookings
    .filter((b) => b.status === 'booked' && b.start_date <= to && b.end_date >= from)
    .sort((a, b) => (a.pickup_at ?? a.start_date).localeCompare(b.pickup_at ?? b.start_date))
  const out = d.bookings.filter((b) => b.status === 'out')
  const returns = out
    .filter((b) => b.end_date <= to)
    .sort((a, b) => (a.dropoff_at ?? a.end_date).localeCompare(b.dropoff_at ?? b.end_date))
  const outLater = out.filter((b) => b.end_date > to).sort((a, b) => a.end_date.localeCompare(b.end_date))

  if (pickups.length + returns.length + outLater.length === 0) return null

  const carById = new Map(d.cars.map((c) => [c.id, c]))
  const modelById = new Map(d.models.map((m) => [m.id, m]))
  const groupById = new Map(d.categories.map((c) => [c.id, c.code]))
  const hotelById = new Map(d.hotels.map((h) => [h.id, h.name]))
  const repById = new Map(d.reps.map((r) => [r.id, r]))

  const carLabel = (carId: string) => {
    const car = carById.get(carId)
    const model = car ? modelById.get(car.model_id) : undefined
    return {
      plate: car?.plate ?? '',
      model: model ? `${model.make} ${model.model}` : '',
      group: model ? groupById.get(model.category_id) ?? '' : '',
    }
  }

  // A car is free only if nothing holds it on any day of the window: the safe
  // reading for a paper rental that the app cannot double-check.
  const held = new Set(
    [...d.bookings, ...d.blocks]
      .filter((b) => ('status' in b && b.status === 'out') || (b.start_date <= to && b.end_date >= from))
      .map((b) => b.car_id))
  const free = d.cars
    .filter((c) => !held.has(c.id))
    .map((c) => carLabel(c.id))
    .sort((a, b) => a.group.localeCompare(b.group) || a.plate.localeCompare(b.plate))

  type Row = { when: string; ref: string; guest: string; phone: string; hotel: string; room: string;
    plate: string; model: string; group: string; rep: string; due: string }
  const row = (b: Booking, when: string): Row => {
    const car = carLabel(b.car_id)
    const balance = !b.paid && b.total !== null ? b.total - b.collected : 0
    return {
      when,
      ref: b.ref,
      guest: [b.cust_first, b.cust_last].filter(Boolean).join(' '),
      phone: b.cust_phone ?? '',
      hotel: (b.hotel_id ? hotelById.get(b.hotel_id) : null) ?? b.adhoc_hotel_name ?? '',
      room: b.room_number ?? '',
      ...car,
      rep: repById.get(b.created_by)?.full_name ?? '',
      due: balance > 0 ? `€${balance}` : '',
    }
  }
  const at = (instant: string | null, date: string) => (instant ? athensDateTime(instant) : calendarDate(date))

  const sections: { title: string; rows: Row[] }[] = [
    { title: 'Παραλαβές', rows: pickups.map((b) => row(b, at(b.pickup_at, b.start_date))) },
    { title: 'Επιστροφές', rows: returns.map((b) => row(b, at(b.dropoff_at, b.end_date))) },
    { title: 'Έξω, επιστρέφουν αργότερα', rows: outLater.map((b) => row(b, calendarDate(b.end_date))) },
  ]
  const cols: [keyof Row, string][] = [
    ['when', 'Ώρα'], ['ref', 'Κράτηση'], ['guest', 'Πελάτης'], ['phone', 'Τηλέφωνο'],
    ['hotel', 'Ξενοδοχείο'], ['room', 'Δωμ.'], ['plate', 'Πινακίδα'], ['model', 'Μοντέλο'],
    ['rep', 'Συνεργάτης'], ['due', 'Είσπραξη'],
  ]

  const staff = d.reps.map((r) => ({
    name: r.full_name,
    phone: r.phone ?? '',
    hotels: d.hotelReps.filter((h) => h.profile_id === r.id)
      .map((h) => hotelById.get(h.hotel_id)).filter(Boolean).join(', '),
  }))

  const period = `${calendarDate(from).slice(0, 5)} – ${calendarDate(to).slice(0, 5)}`
  const steps = [
    'Συνεχίστε σε χαρτί: γράψτε κάθε παράδοση και επιστροφή (ώρα, πινακίδα, πελάτης, ποσό).',
    'Κατάσταση υπηρεσιών: status.railway.com και status.supabase.com',
    'Επικοινωνία: Akos Digital Services, +30 699 535 8972',
    'Όταν η εφαρμογή επανέλθει, περάστε τις χάρτινες εγγραφές.',
  ]

  const th = 'style="text-align:left;padding:4px 6px;border-bottom:2px solid #333;font-size:12px"'
  const td = 'style="padding:4px 6px;border-bottom:1px solid #ddd;font-size:12px;vertical-align:top"'
  const table = (heads: string[], rows: string[][]) =>
    `<table style="border-collapse:collapse;width:100%;margin-bottom:18px"><tr>${heads.map((h) => `<th ${th}>${esc(h)}</th>`).join('')}</tr>` +
    rows.map((r) => `<tr>${r.map((c) => `<td ${td}>${esc(c)}</td>`).join('')}</tr>`).join('') + '</table>'
  const heading = (t: string, n: number) => `<h2 style="font-size:15px;margin:16px 0 6px">${esc(t)} (${n})</h2>`

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#111">
<h1 style="font-size:18px;margin:0 0 4px">Φύλλο έκτακτης ανάγκης ${esc(period)}</h1>
<p style="font-size:12px;color:#555;margin:0 0 12px">Κατάσταση στις ${esc(athensDateTime(new Date().toISOString()))}. Χρειάζεται μόνο αν η εφαρμογή δεν λειτουργεί. Το ίδιο και σε CSV στο συνημμένο.</p>
<ol style="font-size:13px;padding-left:18px">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
${sections.filter((s) => s.rows.length > 0).map((s) =>
  heading(s.title, s.rows.length) + table(cols.map(([, h]) => h), s.rows.map((r) => cols.map(([k]) => r[k])))).join('\n')}
${heading('Ελεύθερα όλο το διάστημα', free.length)}${table(['Group', 'Πινακίδα', 'Μοντέλο'], free.map((c) => [c.group, c.plate, c.model]))}
${heading('Συνεργάτες', staff.length)}${table(['Όνομα', 'Τηλέφωνο', 'Ξενοδοχεία'], staff.map((s) => [s.name, s.phone, s.hotels]))}
</div>`

  const text = [
    `Φύλλο έκτακτης ανάγκης ${period}`, '', ...steps.map((s, i) => `${i + 1}. ${s}`), '',
    ...sections.flatMap((s) => s.rows.length === 0 ? [] : [
      `${s.title} (${s.rows.length})`,
      ...s.rows.map((r) => `  ${r.when} · ${r.plate} · ${r.guest} ${r.phone} · ${r.hotel} ${r.room}${r.due ? ` · ${r.due}` : ''}`),
      '',
    ]),
    `Ελεύθερα: ${free.map((c) => c.plate).join(', ') || '–'}`, '',
    'Συνεργάτες:', ...staff.map((s) => `  ${s.name} ${s.phone}`),
  ].join('\n')

  const csv = toCsv(
    ['Ενότητα', 'Group', ...cols.map(([, h]) => h)],
    [
      ...sections.flatMap((s) => s.rows.map((r) => [s.title, r.group, ...cols.map(([k]) => r[k])])),
      ...free.map((c) => ['Ελεύθερο', c.group, '', '', '', '', '', '', c.plate, c.model, '', '']),
    ],
  )

  return { subject: `Φύλλο έκτακτης ανάγκης ${period}`, html, text, csv, filename: `outage-sheet-${from}.csv` }
}

/** Service role: this runs as a scheduled job with no user session. */
export async function loadOutageSheet(): Promise<OutageSheet | null> {
  const db = supabaseAdmin()
  const today = todayAthens()
  const to = addDays(today, 2)

  const results = await Promise.all([
    db.from('bookings')
      .select('ref, status, car_id, hotel_id, adhoc_hotel_name, room_number, start_date, end_date, pickup_at, ' +
        'dropoff_at, cust_first, cust_last, cust_phone, total, collected, paid, created_by')
      .eq('kind', 'rental')
      .or(`status.eq.out,and(status.eq.booked,start_date.lte.${to},end_date.gte.${today})`),
    db.from('bookings').select('car_id, start_date, end_date')
      .eq('status', 'blocked').lte('start_date', to).gte('end_date', today),
    db.from('cars').select('id, plate, model_id').is('archived_at', null).order('plate'),
    db.from('car_models').select('id, make, model, category_id'),
    db.from('categories').select('id, code'),
    db.from('hotels').select('id, name'),
    db.from('profiles').select('id, full_name, phone').eq('role', 'rep').eq('active', true).order('full_name'),
    db.from('hotel_reps').select('hotel_id, profile_id'),
  ])
  const failed = results.find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  const [bookings, blocks, cars, models, categories, hotels, reps, hotelReps] = results.map((r) => r.data ?? [])

  return buildOutageSheet({
    today,
    bookings: bookings as unknown as Booking[],
    blocks: blocks as OutageSheetData['blocks'],
    cars: cars as OutageSheetData['cars'],
    models: models as OutageSheetData['models'],
    categories: categories as OutageSheetData['categories'],
    hotels: hotels as OutageSheetData['hotels'],
    reps: reps as OutageSheetData['reps'],
    hotelReps: hotelReps as OutageSheetData['hotelReps'],
  })
}
