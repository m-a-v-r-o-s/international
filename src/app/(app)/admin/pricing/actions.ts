'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { parseBulkPaste } from '@/lib/pricing/bulk-paste'

export type FormState = { error?: ErrorKey } | undefined

const uuidSchema = z.string().uuid()
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const yearSchema = z.coerce.number().int().min(2020).max(2100)
const nameSchema = z.string().trim().min(1).max(60)
const centsSchema = z.coerce.number().int().min(0).max(100_000_00)

/**
 * A4 · Pricing periods — arbitrary date ranges, re-editable every season
 * (docs/01-DECISIONS.md §6). Nothing about months or season boundaries is
 * hard-coded; the exclusion constraint on `pricing_periods` is what actually
 * prevents two periods in one season overlapping — this action just surfaces
 * the resulting error.
 */
export async function createPeriod(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    season_year: yearSchema,
    name: nameSchema,
    start_date: dateSchema,
    end_date: dateSchema,
  }).safeParse({
    season_year: formData.get('season_year'),
    name: formData.get('name'),
    start_date: formData.get('start_date'),
    end_date: formData.get('end_date'),
  })
  if (!parsed.success) return { error: 'IR104' }
  if (parsed.data.end_date < parsed.data.start_date) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('pricing_periods').insert(parsed.data)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/pricing')
  return undefined
}

export async function updatePeriod(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    id: uuidSchema,
    season_year: yearSchema,
    name: nameSchema,
    start_date: dateSchema,
    end_date: dateSchema,
  }).safeParse({
    id: formData.get('id'),
    season_year: formData.get('season_year'),
    name: formData.get('name'),
    start_date: formData.get('start_date'),
    end_date: formData.get('end_date'),
  })
  if (!parsed.success) return { error: 'IR104' }
  if (parsed.data.end_date < parsed.data.start_date) return { error: 'IR104' }

  const { id, ...rest } = parsed.data
  const supabase = await supabaseServer()
  const { error } = await supabase.from('pricing_periods').update(rest).eq('id', id)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/pricing')
  return undefined
}

/**
 * Editing a price table does not alter any existing booking's stored total —
 * `total_cents` and `period_id` are frozen on the booking at the time it was
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
    total_cents: centsSchema,
  }).safeParse({
    period_id: formData.get('period_id'),
    category_id: formData.get('category_id'),
    days: formData.get('days'),
    total_cents: formData.get('total_cents'),
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
    cents: centsSchema,
  }).safeParse({
    period_id: formData.get('period_id'),
    category_id: formData.get('category_id'),
    cents: formData.get('cents'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('price_extra_day')
    .upsert(parsed.data, { onConflict: 'period_id,category_id' })

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/pricing')
  return undefined
}

export type PreviewState = { error?: ErrorKey; totalCents?: number; days?: number } | undefined

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

  return { totalCents: row.total_cents, days: row.days }
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

  const rows: { period_id: string; category_id: string; days: number; total_cents: number }[] = []
  const extras: { period_id: string; category_id: string; cents: number }[] = []

  for (const row of parsed.rows) {
    const categoryId = byCode.get(row.categoryCode)!
    for (let day = 1; day <= 7; day++) {
      rows.push({ period_id: periodId.data, category_id: categoryId, days: day, total_cents: row.cents[day - 1]! })
    }
    extras.push({ period_id: periodId.data, category_id: categoryId, cents: row.cents[7] })
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
