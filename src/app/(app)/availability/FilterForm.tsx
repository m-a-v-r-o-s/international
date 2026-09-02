'use client'

import { useTranslations } from 'next-intl'
import { SEAT_CHOICES } from '@/lib/availability/types'

/**
 * A plain GET form: the range and filters live in the URL, so a rep can share
 * a link, use the back button, or refresh without losing their search — no
 * client state to keep in sync with the server-rendered results.
 *
 * What is NOT here matters as much as what is (docs/01-DECISIONS.md §36).
 * No category: the rep looks up a car for a guest who asked for a size and a
 * gearbox, and the results are grouped by category anyway. No A/C: every car
 * has it, so the box could only ever narrow the fleet to itself.
 */
export function FilterForm({
  from, to, searchParams,
}: {
  from: string
  to: string
  searchParams: Record<string, string | undefined>
}) {
  const t = useTranslations('availability')
  const tc = useTranslations('common')
  const seats = searchParams.seats ?? ''

  return (
    <form className="ir-card flex flex-col gap-4 p-4" aria-label={t('filtersLabel')}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="ir-label" htmlFor="from">{t('from')}</label>
          <input id="from" name="from" type="date" defaultValue={from} className="ir-field" required />
        </div>
        <div>
          <label className="ir-label" htmlFor="to">{t('to')}</label>
          <input id="to" name="to" type="date" defaultValue={to} className="ir-field" required />
        </div>
      </div>

      {/* Radios, not a select: four choices a thumb can hit without opening
          anything, and the current one is readable at arm's length. Two by two
          on a phone so each label keeps its full words at full size. */}
      <fieldset>
        <legend className="ir-label">{t('seatsLabel')}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {['', ...SEAT_CHOICES].map((value) => (
            <label key={value || 'any'} className="cursor-pointer">
              <input
                type="radio" name="seats" value={value}
                defaultChecked={seats === value}
                className="peer sr-only"
              />
              <span
                className="flex min-h-12 items-center justify-center rounded-field border
                           border-control bg-surface px-2 text-[0.9375rem] font-medium text-ink
                           transition-colors duration-150 ease-ui hover:bg-brand-tint
                           peer-checked:border-brand peer-checked:bg-brand peer-checked:text-brand-ink
                           peer-checked:hover:bg-brand
                           peer-focus-visible:outline peer-focus-visible:outline-[3px]
                           peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand"
              >
                {value ? t(`seatsChoice.${value}`) : t('seatsAny')}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label className="ir-label" htmlFor="transmission">{t('transmissionLabel')}</label>
        <select id="transmission" name="transmission" defaultValue={searchParams.transmission ?? ''} className="ir-field">
          <option value="">{t('any')}</option>
          <option value="manual">{t('transmission.manual')}</option>
          <option value="automatic">{t('transmission.automatic')}</option>
        </select>
      </div>

      <button type="submit" className="ir-btn-primary">{tc('continue')}</button>
    </form>
  )
}
