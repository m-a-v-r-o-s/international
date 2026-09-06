'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { SubmitButton } from '@/components/SubmitButton'
import { FormActions } from '@/components/FormActions'
import { archiveCar, unarchiveCar, deleteCar, setCarNotes, setCarStation, type FormState } from './actions'

export function ArchiveToggle({ id, archived }: { id: string; archived: boolean }) {
  const t = useTranslations('admin.fleet')
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
  const t = useTranslations('admin.fleet')
  const te = useTranslations('errors')
  const router = useRouter()
  const [state, formAction] = useActionState<FormState, FormData>(async (prev, fd) => {
    const result = await deleteCar(prev, fd)
    if (!result?.error) router.push('/admin/fleet')
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
  const t = useTranslations('admin.fleet')
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
      <FormActions label={tc('save')} variant="quiet" saved={state && !state.error} />
    </form>
  )
}

/**
 * Where this plate is based. A correction tool, not a workflow: every return
 * sets this by itself (docs/01-DECISIONS.md §45), so a person only comes here
 * for a car the triggers could not place.
 */
export function StationForm({
  id, station, hotels,
}: {
  id: string
  station: string | null
  hotels: { id: string; name: string; is_depot: boolean }[]
}) {
  const t = useTranslations('admin.fleet')
  const tr = useTranslations('admin.relocations')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<FormState, FormData>(setCarStation, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
      ) : null}
      <div>
        <label className="ir-label" htmlFor="station">{t('station')}</label>
        <select id="station" name="station" className="ir-field" defaultValue={station ?? ''}>
          <option value="">{t('stationNone')}</option>
          {hotels.map((h) => (
            <option key={h.id} value={h.id}>
              {h.is_depot ? `${h.name} · ${tr('depot')}` : h.name}
            </option>
          ))}
        </select>
        <p className="ir-hint">{t('stationHint')}</p>
      </div>
      <FormActions label={tc('save')} variant="quiet" saved={state && !state.error} />
    </form>
  )
}
