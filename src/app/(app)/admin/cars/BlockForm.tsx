'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { createBlock, updateBlock, deleteBlock, type FormState } from './actions'

export type BlockRow = { id: string; car_id: string; start_date: string; end_date: string; block_reason: string | null }

/**
 * Blocks are how service, repair and write-offs leave availability
 * (docs/01-DECISIONS.md §17). The reason is admin-only text — this form is
 * one of the very few places in the app that reads or writes it.
 */
export function BlockForm({ carId, block, onDone }: { carId: string; block?: BlockRow; onDone?: () => void }) {
  const t = useTranslations('admin.blocks')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const action = block ? updateBlock : createBlock
  const [state, formAction] = useActionState<FormState, FormData>(action, undefined)
  const [deleteState, deleteAction] = useActionState<FormState, FormData>(deleteBlock, undefined)

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="car_id" value={carId} />
        {block ? <input type="hidden" name="id" value={block.id} /> : null}

        {state?.error ? (
          <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field id="start" name="start" type="date" label={t('start')} defaultValue={block?.start_date} required />
          <Field id="end" name="end" type="date" label={t('end')} defaultValue={block?.end_date} required />
        </div>

        <div>
          <label className="ir-label" htmlFor="reason">{t('reason')}</label>
          <textarea
            id="reason" name="reason" className="ir-field min-h-24" maxLength={500}
            defaultValue={block?.block_reason ?? ''}
          />
          <p className="ir-hint">{t('reasonHint')}</p>
        </div>

        <div className="flex gap-3">
          <SubmitButton label={block ? tc('save') : t('add')} />
          {onDone ? (
            <button type="button" onClick={onDone} className="ir-btn-quiet">{tc('cancel')}</button>
          ) : null}
        </div>
      </form>

      {block ? (
        <form action={deleteAction} className="border-t border-line pt-4">
          <input type="hidden" name="id" value={block.id} />
          <input type="hidden" name="car_id" value={carId} />
          {deleteState?.error ? (
            <p className="ir-notice border-danger bg-danger-tint text-danger mb-3" role="alert">
              {te(deleteState.error)}
            </p>
          ) : null}
          <SubmitButton label={t('remove')} variant="quiet" />
        </form>
      ) : null}
    </div>
  )
}
