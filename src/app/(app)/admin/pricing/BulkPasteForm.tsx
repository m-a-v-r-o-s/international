'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { bulkPastePrices, type BulkPasteState } from './actions'

/**
 * Bulk paste from a spreadsheet (docs/04-SCREENS.md, A4): one line per
 * category, tab- or comma-separated — `A  35.00  65.00  ...  25.00` — which
 * is exactly what selecting a block of cells in a spreadsheet and pasting
 * into a textarea produces.
 */
export function BulkPasteForm({ periodId }: { periodId: string }) {
  const t = useTranslations('admin.pricing')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<BulkPasteState, FormData>(bulkPastePrices, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="period_id" value={periodId} />
      <p className="text-[0.875rem] text-ink-soft">{t('bulkPasteHint')}</p>
      <label className="sr-only" htmlFor="paste">{t('bulkPasteLabel')}</label>
      <textarea
        id="paste" name="paste" required className="ir-field min-h-32 font-mono !text-[0.9375rem]"
        placeholder={t('bulkPastePlaceholder')}
      />
      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
          {state.badLine ? t('bulkPasteLineError', { line: state.badLine }) : te(state.error)}
        </p>
      ) : null}
      <SubmitButton label={t('bulkPasteApply')} variant="quiet" />
    </form>
  )
}
