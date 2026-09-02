'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { saveNotificationPreferences, type NotifyState } from './actions'

/**
 * The one admin kind (§22) — a rep's two kinds are always on now, not a
 * preference, so there is no rep-facing form left to offer (0027). This is
 * admin-only, and saveNotificationPreferences() refuses the write for anyone
 * else regardless of what a request claims.
 */
export function NotificationPreferences({ incidents }: { incidents: boolean }) {
  const t = useTranslations('settings')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<NotifyState, FormData>(
    saveNotificationPreferences, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
          {te(state.error)}
        </p>
      ) : null}
      {state?.saved ? (
        <p className="ir-notice border-ok bg-ok-tint text-ok" role="status">{t('saved')}</p>
      ) : null}

      <ul className="flex flex-col gap-3">
        <li>
          <label className="flex items-start gap-3">
            <input
              type="checkbox" name="notify_incidents" defaultChecked={incidents}
              className="mt-1 size-5 shrink-0"
              aria-describedby="notify_incidents-hint"
            />
            <span>
              <span className="block text-[0.9375rem] font-medium">{t('notifyIncidents')}</span>
              <span className="ir-hint" id="notify_incidents-hint">{t('notifyIncidentsHint')}</span>
            </span>
          </label>
        </li>
      </ul>

      <SubmitButton label={tc('save')} variant="quiet" />
    </form>
  )
}
