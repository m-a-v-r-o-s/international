import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { todayAthens } from '@/lib/dates'
import { toFleetCsv } from '@/lib/fleet/csv'

/**
 * The whole fleet as a spreadsheet, so the client's original Excel can be
 * replaced by the fleet as it stands today. Active cars first, archived after,
 * each in plate order. Admin only, like the Fleet screen it is linked from.
 */
export async function GET() {
  await requireAdmin()
  const supabase = await supabaseServer()

  const [cars, models, categories, hotels] = await Promise.all([
    supabase.from('cars').select('plate, model_id, year, colour, stationed_at, archived_at').order('plate'),
    supabase.from('car_models')
      .select('id, make, model, category_id, transmission, fuel_type, seats, doors, tank_litres, engine_cc, horsepower'),
    supabase.from('categories').select('id, code'),
    supabase.from('hotels').select('id, name'),
  ])
  const failed = [cars, models, categories, hotels].find((r) => r.error)
  if (failed?.error) return new NextResponse('Export failed', { status: 500 })

  const modelById = new Map((models.data ?? []).map((m) => [m.id, m]))
  const groupById = new Map((categories.data ?? []).map((c) => [c.id, c.code]))
  const hotelById = new Map((hotels.data ?? []).map((h) => [h.id, h.name]))

  const rows = [...(cars.data ?? [])]
    .sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at))
    .map((car) => {
      const m = modelById.get(car.model_id)
      return [
        car.plate, m?.make ?? '', m?.model ?? '', car.year, car.colour,
        m ? groupById.get(m.category_id) ?? '' : '', m?.transmission ?? '', m?.fuel_type ?? '',
        m?.seats ?? null, m?.doors ?? null, m?.tank_litres ?? null, m?.engine_cc ?? null, m?.horsepower ?? null,
        car.stationed_at ? hotelById.get(car.stationed_at) ?? '' : '',
        car.archived_at ? car.archived_at.slice(0, 10) : '',
      ]
    })

  const csv = toFleetCsv([
    'Πινακίδα', 'Μάρκα', 'Μοντέλο', 'Έτος', 'Χρώμα',
    'Group', 'Κιβώτιο', 'Καύσιμο', 'Θέσεις', 'Πόρτες', 'Ρεζερβουάρ (λ)', 'Κυβικά', 'Ίπποι',
    'Σταθμός', 'Αρχειοθετήθηκε',
  ], rows)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="fleet-${todayAthens()}.csv"`,
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
