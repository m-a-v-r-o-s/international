'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { formatEuros } from '@/lib/money'
import { handOverCash, type HandOverState } from './actions'

/**
 * R1's footer strip: today's own cash in hand, and the button that hands it
 * over (docs/04-SCREENS.md).
 *
 * This is the ONLY number on a rep's screen that sums anything, and it is
 * theirs alone — their own cash, collected today, not yet CONFIRMED by the
 * boss (docs/01-DECISIONS.md §7, §31). Nothing else on this page counts,
 * totals or averages anything, because a count of the day's pickups or a
 * total taken across the company is exactly the kind of figure company
 * revenue can be inferred from.
 *
 * `cash` and `ready` are the same money seen two ways: `cash` is the
 * whole debt (docs/01-DECISIONS.md §31 — only the boss's confirmation clears
 * it), `ready` is the slice of it a tap on "hand over" would actually
 * grab right now. Almost always they're equal — the usual case is one hand-
 * over at the end of the morning shift. They part ways for the rare one that
 * follows a night-shift pickup or a delayed payment: the morning batch sits
 * with the boss awaiting confirmation (`ready` drops to 0 under a
 * `cash` that hasn't moved), then the evening's new cash reopens
 * `ready` on top of it. The button is keyed on `ready`, never
 * `cash`, so it never sits there for a rep to tap into an IR114 "nothing to
 * hand over" on money they already handed over.
 */
export function CashStrip({ cash, ready }: { cash: number; ready: number }) {
  const t = useTranslations('today')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<HandOverState, FormData>(handOverCash, undefined)

  const handedOver = state?.amount !== undefined && !state.error
  const awaitingConfirmation = !handedOver && cash > 0 && ready === 0

  return (
    <aside
      aria-labelledby="cash-strip-title"
      className="sticky bottom-0 -mx-5 border-t border-line bg-surface px-5 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p id="cash-strip-title" className="text-[0.875rem] text-ink-soft">{t('cashInHand')}</p>
          <p className="text-[1.375rem] font-bold" role="status">{formatEuros(cash)}</p>
        </div>

        {ready > 0 ? (
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
          {t('handedOver', { amount: state.amount ?? 0 })}
        </p>
      ) : null}

      {awaitingConfirmation ? (
        <p className="ir-notice mt-2 border-line bg-canvas" role="status">{t('awaitingConfirmation')}</p>
      ) : null}
    </aside>
  )
}
