import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, getFormatter } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { RestoreForm } from './RestoreForm'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminSettings')
  return { title: t('binTitle') }
}

type Row = Record<string, string | number | null>

/**
 * Recycle bin: the last 30 days of hotels, cars, price sheets, date ranges and
 * blocks the boss deleted, each with a restore button. Read straight off the
 * audit log (20260930120000_recycle_bin.sql), so there is nothing to empty.
 */
export default async function RecycleBinPage() {
  await requireAdmin()
  const t = await getTranslations('adminSettings')
  const format = await getFormatter()
  const supabase = await supabaseServer()

  const [{ data }, { data: cars }, { data: sheets }] = await Promise.all([
    supabase.rpc('admin_recycle_bin'),
    supabase.from('cars').select('id, plate'),
    supabase.from('pricing_periods').select('id, name'),
  ])
  const plate = new Map((cars ?? []).map((c) => [c.id, c.plate]))
  const sheet = new Map((sheets ?? []).map((s) => [s.id, s.name]))
  const entries = data ?? []

  const kinds = {
    hotels: t('binHotel'), cars: t('binCar'), pricing_periods: t('binSheet'),
    pricing_period_ranges: t('binRange'), bookings: t('binBlock'),
  } as Record<string, string>

  const label = (entity: string, r: Row) => {
    const dates = `${r.start_date} – ${r.end_date}`
    switch (entity) {
      case 'hotels': return String(r.name)
      case 'cars': return String(r.plate)
      case 'pricing_periods': return `${r.name} (${r.season_year})`
      case 'pricing_period_ranges': return `${sheet.get(String(r.period_id)) ?? ''} ${dates}`.trim()
      default: return `${plate.get(String(r.car_id)) ?? ''} ${dates}`.trim()
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/admin/settings" className="text-[0.9375rem] text-brand underline-offset-2 hover:underline">
        ← {t('title')}
      </Link>

      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('binTitle')}</h1>
        <p className="text-ink-soft">{t('binIntro')}</p>
      </div>

      {entries.length === 0 ? (
        <p className="ir-card p-5 text-ink-soft">{t('binEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((e) => (
            <li key={e.id} className="ir-card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-[0.875rem] text-ink-soft">{kinds[e.entity] ?? e.entity}</span>
                <span className="font-semibold">{label(e.entity, e.row_data as Row)}</span>
                <span className="text-[0.875rem] text-ink-soft">
                  {t('binDeleted', {
                    when: format.dateTime(new Date(e.at), { dateStyle: 'medium', timeStyle: 'short' }),
                    who: e.actor_name ?? '—',
                  })}
                </span>
              </div>
              <RestoreForm id={e.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
