'use client'

import { useActionState, useState } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { CLEAR_LEDGER_PHRASE } from '@/lib/customers/ledger'
import {
  searchCustomerLedger, eraseLedgerCustomer, clearCustomerLedger, type LedgerState,
} from './actions'

/**
 * A10 · Ψηφιακό πελατολόγιο (docs/01-DECISIONS.md §25a).
 *
 * The screen has to tell the truth about a store the owner chose to keep
 * indefinitely: what is in it, how to take one person out of it on request,
 * and how to empty it. There is deliberately no "retention window" field here
 * to sit next to the licence one — there is no window, and rendering a
 * disabled box implying there might be would be worse than the absence.
 */
function Notice({ state }: { state: LedgerState }) {
  const t = useTranslations('adminLedger')
  const te = useTranslations('errors')

  if (state?.error) {
    return (
      <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
        {te(state.error)}
      </p>
    )
  }
  if (state?.cleared !== undefined) {
    return (
      <p className="ir-notice border-ok bg-ok-tint text-ok" role="status">
        {t('clearDone', { n: state.cleared })}
      </p>
    )
  }
  if (state?.erased) {
    return (
      <p className="ir-notice border-ok bg-ok-tint text-ok" role="status">
        {t('eraseDone', { n: state.erased.imagesDeleted })}
      </p>
    )
  }
  return null
}

/**
 * The right-to-erasure desk: find a guest who has written in, and remove them.
 *
 * Searching before erasing is not a convenience — it is the only way to be
 * sure the row about to go is the right person's, and the result line shows
 * the phone number alongside the name for exactly that reason.
 */
export function LedgerErasureForm() {
  const t = useTranslations('adminLedger')
  const tc = useTranslations('common')
  const format = useFormatter()
  const [search, searchAction] = useActionState<LedgerState, FormData>(
    searchCustomerLedger, undefined)
  const [erase, eraseAction] = useActionState<LedgerState, FormData>(
    eraseLedgerCustomer, undefined)

  return (
    <div className="flex flex-col gap-4">
      <Notice state={erase} />

      <form action={searchAction} className="flex flex-col gap-3">
        <div>
          <label className="ir-label" htmlFor="ledger_query">{t('searchLabel')}</label>
          <input
            id="ledger_query" name="query" className="ir-field" required
            minLength={2} maxLength={64} autoComplete="off"
            aria-describedby="ledger_query_hint"
          />
          <p className="ir-hint" id="ledger_query_hint">{t('searchHint')}</p>
        </div>
        <SubmitButton label={t('searchAction')} variant="quiet" />
      </form>

      {search?.error ? <Notice state={search} /> : null}

      {search?.searched ? (
        search.results && search.results.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {search.results.map((row) => (
              <li key={row.id} className="rounded-field border border-line p-3">
                <p className="font-medium">{row.name}</p>
                <p className="text-[0.875rem] text-ink-soft">
                  {t('lastSeen', {
                    when: format.dateTime(new Date(row.lastSeenAt), { dateStyle: 'medium' }),
                  })}
                  {row.hasImages ? ` · ${t('hasImages')}` : ''}
                </p>
                <form action={eraseAction} className="mt-2">
                  <input type="hidden" name="customer_id" value={row.id} />
                  <button
                    type="submit"
                    className="min-h-11 text-[0.9375rem] font-medium text-danger underline underline-offset-2"
                  >
                    {t('eraseAction')}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.9375rem] text-ink-soft">{tc('noResults')}</p>
        )
      ) : null}
    </div>
  )
}

/**
 * Emptying the whole ledger.
 *
 * Three confirmations, because the owner asked for three and because this is
 * the ONLY retention mechanism this table has. Each one is a different kind of
 * act rather than the same act three times — read a count, type a phrase,
 * accept that it does not come back — so getting through all three by reflex
 * is not possible. The submit stays disabled until all three are satisfied,
 * and the action re-checks every one of them server-side, as does the
 * database function underneath it.
 */
export function ClearLedgerForm({ total }: { total: number }) {
  const t = useTranslations('adminLedger')
  const [state, formAction] = useActionState<LedgerState, FormData>(
    clearCustomerLedger, undefined)

  const [understood, setUnderstood] = useState(false)
  const [irreversible, setIrreversible] = useState(false)
  const [phrase, setPhrase] = useState('')
  const ready = understood && irreversible && phrase.trim() === CLEAR_LEDGER_PHRASE

  if (total === 0) {
    return (
      <>
        <Notice state={state} />
        <p className="text-[0.9375rem] text-ink-soft">{t('clearNothing')}</p>
      </>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Notice state={state} />

      <p className="ir-notice border-danger bg-danger-tint text-danger">
        {t('clearWarning', { n: total })}
      </p>

      <label className="flex items-start gap-3 text-[0.9375rem]">
        <input
          type="checkbox" name="understood" value="yes"
          checked={understood} onChange={(e) => setUnderstood(e.target.checked)}
          className="mt-1 size-5 shrink-0"
        />
        <span>{t('clearConfirm1', { n: total })}</span>
      </label>

      <div>
        <label className="ir-label" htmlFor="clear_confirm">
          {t('clearConfirm2', { phrase: CLEAR_LEDGER_PHRASE })}
        </label>
        <input
          id="clear_confirm" name="confirm" className="ir-field"
          value={phrase} onChange={(e) => setPhrase(e.target.value)}
          autoComplete="off" autoCapitalize="characters" spellCheck={false}
          aria-describedby="clear_confirm_hint"
        />
        <p className="ir-hint" id="clear_confirm_hint">{t('clearConfirm2Hint')}</p>
      </div>

      <label className="flex items-start gap-3 text-[0.9375rem]">
        <input
          type="checkbox" name="irreversible" value="yes"
          checked={irreversible} onChange={(e) => setIrreversible(e.target.checked)}
          className="mt-1 size-5 shrink-0"
        />
        <span>{t('clearConfirm3')}</span>
      </label>

      <SubmitButton label={t('clearAction')} variant="quiet" disabled={!ready} />
    </form>
  )
}
