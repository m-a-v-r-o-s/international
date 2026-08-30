'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { SubmitButton } from '@/components/SubmitButton'
import { archiveCar, unarchiveCar, deleteCar, setCarNotes, type FormState } from './actions'

export function ArchiveToggle({ id, archived }: { id: string; archived: boolean }) {
  const t = useTranslations('admin.cars')
  const te = useTranslations('errors')
  const action = archived ? unarchiveCar : archiveCar
  const [state, formAction] = useActionState<FormState, FormData>(action, undefined)

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger mb-3" role="alert">{te(state.error)}</p>
      ) : null}
      <SubmitButton label={archived ? t('unarchive') : t('archive')} variant="quiet" />
    </form>
  )
}

export function DeleteCarForm({ id }: { id: string }) {
  const t = useTranslations('admin.cars')
  const te = useTranslations('errors')
  const router = useRouter()
  const [state, formAction] = useActionState<FormState, FormData>(async (prev, fd) => {
    const result = await deleteCar(prev, fd)
    if (!result?.error) router.push('/admin/cars')
    return result
  }, undefined)

  return (
    <form
      action={formAction}
      onSubmit={(e) => { if (!confirm(t('deleteConfirm'))) e.preventDefault() }}
    >
      <input type="hidden" name="id" value={id} />
      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger mb-3" role="alert">{te(state.error)}</p>
      ) : null}
      <SubmitButton label={t('delete')} variant="quiet" />
    </form>
  )
}

export function NotesForm({ id, notes }: { id: string; notes: string | null }) {
  const t = useTranslations('admin.cars')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<FormState, FormData>(setCarNotes, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
      ) : null}
      <div>
        <label className="ir-label" htmlFor="notes">{t('notes')}</label>
        <textarea id="notes" name="notes" className="ir-field min-h-24" maxLength={2000} defaultValue={notes ?? ''} />
        <p className="ir-hint">{t('notesHint')}</p>
      </div>
      <SubmitButton label={tc('save')} variant="quiet" />
    </form>
  )
}
