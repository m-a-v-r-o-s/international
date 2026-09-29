'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { euroAmountSchema } from '@/lib/money'
import { parseBulkPaste } from '@/lib/pricing/bulk-paste'

export type FormState = { error?: ErrorKey } | undefined

const uuidSchema = z.string().uuid()
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const yearSchema = z.coerce.number().int().min(2020).max(2100)
const nameSchema = z.string().trim().min(1).max(60)

/**
 * A4 · Price sheets (docs/01-DECISIONS.md §6). A sheet is a name, a season
 * and its prices; WHEN it applies lives in `pricing_period_ranges`, any number
 * of stretches per sheet, so May and October can share one set of numbers.
 * A sheet with no ranges is a draft the quote engine never picks. The
 * exclusion constraint on the ranges is what stops two sheets claiming one
 * date; these actions just surface the resulting error.
 */
function parsePeriod(formData: FormData) {
  const parsed = z.object({ season_year: yearSchema, name: nameSchema }).safeParse({
    season_year: formData.get('season_year'),
    name: formData.get('name'),
  })
  return parsed.success ? parsed.data : null
}

export async function createPeriod(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const period = parsePeriod(formData)
  if (!period) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('pricing_periods').insert(period)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/pricing')
  return undefined
}

export async function updatePeriod(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const id = uuidSchema.safeParse(formData.get('id'))
  const period = parsePeriod(formData)
  if (!id.success || !period) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('pricing_periods').update(period).eq('id', id.data)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/pricing')
  return undefined
}

export async function addPeriodRange(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    period_id: uuidSchema,
    start_date: dateSchema,
    end_date: dateSchema,
  }).safeParse({
    period_id: formData.get('period_id'),
    start_date: formData.get('start_date'),
    end_date: formData.get('end_date'),
  })
  if (!parsed.success) return { error: 'IR104' }
  if (parsed.data.end_date < parsed.data.start_date) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('pricing_period_ranges').insert(parsed.data)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/pricing')
  return undefined
}

export async function deletePeriodRange(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()
  const id = uuidSchema.safeParse(formData.get('id'))
  if (!id.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('pricing_period_ranges').delete().eq('id', id.data)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/pricing')
  return undefined
}

/**
 * Editing a price table does not alter any existing booking's stored total —
 * `total` and `period_id` are frozen on the booking at the time it was
 * priced (docs/05-BUILD-PLAN.md, "Pricing" tests). This action only ever
 * touches `price_rows` / `price_extra_day`, never `bookings`.
 */
export async function deletePeriod(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()
  const id = uuidSchema.safeParse(formData.get('id'))
  if (!id.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('pricing_periods').delete().eq('id', id.data)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/pricing')
  return undefined
}

/** One cell of the 8×7 grid: a total for one category at one duration, 1–7 days. */
export async function setPriceRow(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    period_id: uuidSchema,
    category_id: uuidSchema,
    days: z.coerce.number().int().min(1).max(7),
    total: euroAmountSchema,
  }).safeParse({
    period_id: formData.get('period_id'),
    category_id: formData.get('category_id'),
    days: formData.get('days'),
    total: formData.get('total'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('price_rows')
    .upsert(parsed.data, { onConflict: 'period_id,category_id,days' })

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/pricing')
  return undefined
}

/** The 8+ day extra-day rate, one per category per period. */
export async function setExtraDayRate(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    period_id: uuidSchema,
    category_id: uuidSchema,
    price: euroAmountSchema,
  }).safeParse({
    period_id: formData.get('period_id'),
    category_id: formData.get('category_id'),
    price: formData.get('price'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('price_extra_day')
    .upsert(parsed.data, { onConflict: 'period_id,category_id' })

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/pricing')
  return undefined
}

export type PreviewState = { error?: ErrorKey; total?: number; days?: number } | undefined

/**
 * A preview of what a sample rental would cost (docs/04-SCREENS.md, A4). This
 * calls the same quote() engine a booking uses — the preview and the real
 * price can never disagree, because they are the same code path.
 */
export async function previewQuote(_prev: PreviewState, formData: FormData): Promise<PreviewState> {
  await requireAdmin()

  const parsed = z.object({
    category_id: uuidSchema,
    start_date: dateSchema,
    days: z.coerce.number().int().min(1).max(60),
  }).safeParse({
    category_id: formData.get('category_id'),
    start_date: formData.get('start_date'),
    days: formData.get('days'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const end = new Date(`${parsed.data.start_date}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + parsed.data.days - 1)
  const endDate = end.toISOString().slice(0, 10)

  const supabase = await supabaseServer()
  const { data, error } = await supabase.rpc('quote', {
    p_category_id: parsed.data.category_id,
    p_start: parsed.data.start_date,
    p_end: endDate,
  })

  if (error) return { error: errorKey(error) }
  const row = data?.[0]
  if (!row) return { error: 'unknown' }

  return { total: row.total, days: row.days }
}

/**
 * Bulk paste from a spreadsheet (docs/04-SCREENS.md, A4). Rows are
 * `category_code\tday1\tday2\t...\tday7\textra`, one line per category —
 * exactly what pasting a block out of a spreadsheet into a textarea produces.
 * Every row is validated before anything is written; a bad row stops the
 * whole paste rather than writing half a table.
 */
export type BulkPasteState = { error?: ErrorKey; badLine?: number } | undefined

export async function bulkPastePrices(
  _prev: BulkPasteState, formData: FormData,
): Promise<BulkPasteState> {
  await requireAdmin()

  const periodId = uuidSchema.safeParse(formData.get('period_id'))
  const text = z.string().max(20_000).safeParse(formData.get('paste'))
  if (!periodId.success || !text.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { data: categories, error: catErr } = await supabase
    .from('categories').select('id, code')
  if (catErr) return { error: errorKey(catErr) }

  const byCode = new Map((categories ?? []).map((c) => [(c as { code: string }).code, (c as { id: string }).id]))
  const parsed = parseBulkPaste(text.data, new Set(byCode.keys()))
  if (!parsed.ok) return { error: 'IR104', badLine: parsed.badLine }

  const rows: { period_id: string; category_id: string; days: number; total: number }[] = []
  const extras: { period_id: string; category_id: string; price: number }[] = []

  for (const row of parsed.rows) {
    const categoryId = byCode.get(row.categoryCode)!
    for (let day = 1; day <= 7; day++) {
      rows.push({ period_id: periodId.data, category_id: categoryId, days: day, total: row.euros[day - 1]! })
    }
    extras.push({ period_id: periodId.data, category_id: categoryId, price: row.euros[7] })
  }

  const { error: rowsErr } = await supabase.from('price_rows')
    .upsert(rows, { onConflict: 'period_id,category_id,days' })
  if (rowsErr) return { error: errorKey(rowsErr) }

  const { error: extraErr } = await supabase.from('price_extra_day')
    .upsert(extras, { onConflict: 'period_id,category_id' })
  if (extraErr) return { error: errorKey(extraErr) }

  revalidatePath('/admin/pricing')
  return undefined
}

/**
 * "+€5 on everything": adds a whole-euro amount (negative lowers) to every
 * total and extra-day rate on one sheet, atomically, in the database.
 */
export async function adjustPeriodPrices(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    period_id: uuidSchema,
    delta: z.coerce.number().int().min(-1000).max(1000).refine((n) => n !== 0),
  }).safeParse({
    period_id: formData.get('period_id'),
    delta: formData.get('delta'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('adjust_period_prices', {
    p_period_id: parsed.data.period_id,
    p_delta: parsed.data.delta,
  })

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/pricing')
  return undefined
}
