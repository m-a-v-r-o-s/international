import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { todayAthens } from '@/lib/dates'
import { loadRelocationBoard } from '@/lib/relocations/data'
import { PrintButton } from '../movements/PrintButton'
import { RelocationRow } from './RelocationRow'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.relocations')
  return { title: t('title') }
}

/**
 * A13 · Μετακινήσεις οχημάτων (docs/04-SCREENS.md, docs/01-DECISIONS.md §45).
 *
 * A1 is the boss's morning screen. This is his evening one: the cars that have
 * to be driven somewhere tonight so that tomorrow's 09:00 pick-ups have a car
 * standing at the right hotel. Every row is derived from bookings on read; the
 * only stored thing is a decision he made himself.
 *
 * Printable, because the person who actually drives the cars is holding paper
 * in a car park at 22:00.
 */
export default async function RelocationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireAdmin()
  const t = await getTranslations('admin.relocations')
  const params = await searchParams
  const night = /^\d{4}-\d{2}-\d{2}$/.test(params.night ?? '') ? params.night! : todayAthens()

  const supabase = await supabaseServer()
  const board = await loadRelocationBoard(supabase, night)

  const moves = board.rows.filter((r) => r.to.label !== null)
  const stays = board.rows.filter((r) => r.to.label === null)
  const outstanding = moves.filter((r) => r.doneAt === null).length

  return (
    <div className="flex flex-col gap-6 print:gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
          <p className="text-[0.9375rem] text-ink-soft">{t('subtitle')}</p>
        </div>
        <div className="flex items-end gap-2">
          <form className="flex items-end gap-2">
            <div>
              <label className="ir-label" htmlFor="night">{t('night')}</label>
              <input id="night" name="night" type="date" defaultValue={night} className="ir-field" />
            </div>
            <button type="submit" className="ir-btn-quiet !w-auto">{t('go')}</button>
          </form>
          <PrintButton label={t('print')} />
        </div>
      </div>

      <p className="hidden text-[1.125rem] font-semibold print:block">
        {t('printHeading', { night, morning: board.morning })}
      </p>

      <p className="text-[0.9375rem] text-ink-soft print:hidden">
        {t('summary', { moves: moves.length, outstanding, morning: board.morning })}
      </p>

      <section className="ir-card p-4 print:border-0 print:p-0">
        <h2 className="mb-1 text-[1.0625rem] font-semibold">
          {t('toMove')} ({moves.length})
        </h2>
        {moves.length === 0 ? (
          <p className="text-ink-soft">{t('noMoves')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {moves.map((row) => (
              <RelocationRow
                key={row.carId} row={row} night={night} destinations={board.destinations}
              />
            ))}
          </ul>
        )}
      </section>

      {/*
        Cars that came back tonight and are wanted nowhere in the morning. They
        are listed rather than hidden precisely so the boss can send one
        somewhere anyway — a hotel that is about to get busy, or the yard —
        which is a decision no booking will ever imply for him.
      */}
      <section className="ir-card p-4 print:border-0 print:p-0">
        <h2 className="mb-1 text-[1.0625rem] font-semibold">
          {t('staying')} ({stays.length})
        </h2>
        <p className="mb-2 text-[0.875rem] text-ink-soft print:hidden">{t('stayingHint')}</p>
        {stays.length === 0 ? (
          <p className="text-ink-soft">{t('noStays')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {stays.map((row) => (
              <RelocationRow
                key={row.carId} row={row} night={night} destinations={board.destinations}
              />
            ))}
          </ul>
        )}
      </section>

      {board.destinations.every((h) => !h.is_depot) ? (
        <p className="ir-notice border-warn bg-warn-tint text-warn print:hidden">
          {t('noDepot')}
        </p>
      ) : null}
    </div>
  )
}
