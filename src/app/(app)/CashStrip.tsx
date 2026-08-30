'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { handOverCash, type HandOverState } from './actions'

/**
 * R1's footer strip: today's own cash in hand, and the button that hands it
 * over (docs/04-SCREENS.md).
 *
 * This is the ONLY number on a rep's screen that sums anything, and it is
 * theirs alone — their own cash, collected today, not yet handed over
 * (docs/01-DECISIONS.md §7). Nothing else on this page counts, totals or
 * averages anything, because a count of the day's pickups or a total taken
 * across the company is exactly the kind of figure company revenue can be
 * inferred from.
 */
export function CashStrip({ cents }: { cents: number }) {
  const t = useTranslations('today')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<HandOverState, FormData>(handOverCash, undefined)

  const handedOver = state?.amountCents !== undefined && !state.error

  return (
    <aside
      aria-labelledby="cash-strip-title"
      className="sticky bottom-0 -mx-5 border-t border-line bg-surface px-5 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p id="cash-strip-title" className="text-[0.875rem] text-ink-soft">{t('cashInHand')}</p>
          <p className="text-[1.375rem] font-bold" role="status">€{(cents / 100).toFixed(2)}</p>
        </div>

        {cents > 0 ? (
          <form action={formAction} className="w-auto">
            <SubmitButton label={t('handOver')} variant="quiet" />
          </form>
        ) : null}
      </div>

      {state?.error ? (
        <p className="ir-notice mt-2 border-danger bg-danger-tint text-danger" role="alert">
          {te(state.error)}
        </p>
      ) : null}

      {handedOver ? (
        <p className="ir-notice mt-2 border-ok bg-ok-tint text-ok" role="status">
          {t('handedOver', { amount: ((state.amountCents ?? 0) / 100).toFixed(2) })}
        </p>
      ) : null}
    </aside>
  )
}
