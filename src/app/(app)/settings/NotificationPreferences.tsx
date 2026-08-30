'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { saveNotificationPreferences, type NotifyState } from './actions'

/**
 * Which of §22's messages this person wants. A rep is offered the two rep
 * kinds and the boss the one admin kind, because §22 gives them different
 * messages — and public.push_targets() checks the role again in SQL, so the
 * shape of this form is a convenience rather than the control.
 */
export function NotificationPreferences({
  role, prefs,
}: {
  role: 'admin' | 'rep'
  prefs: { morning: boolean; evening: boolean; exceptions: boolean }
}) {
  const t = useTranslations('settings')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<NotifyState, FormData>(
    saveNotificationPreferences, undefined)

  const options = role === 'admin'
    ? [{ name: 'notify_exceptions', on: prefs.exceptions, label: t('notifyExceptions'), hint: t('notifyExceptionsHint') }]
    : [
        { name: 'notify_morning', on: prefs.morning, label: t('notifyMorning'), hint: t('notifyMorningHint') },
        { name: 'notify_evening', on: prefs.evening, label: t('notifyEvening'), hint: t('notifyEveningHint') },
      ]

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

      {/*
        * The kinds this person is not offered are still submitted, at their
        * stored value, so saving the form cannot silently turn off a
        * preference the screen never showed.
        */}
      {role === 'admin' ? (
        <>
          {prefs.morning ? <input type="hidden" name="notify_morning" value="on" /> : null}
          {prefs.evening ? <input type="hidden" name="notify_evening" value="on" /> : null}
        </>
      ) : (
        prefs.exceptions ? <input type="hidden" name="notify_exceptions" value="on" /> : null
      )}

      <ul className="flex flex-col gap-3">
        {options.map((option) => (
          <li key={option.name}>
            <label className="flex items-start gap-3">
              <input
                type="checkbox" name={option.name} defaultChecked={option.on}
                className="mt-1 size-5 shrink-0"
                aria-describedby={`${option.name}-hint`}
              />
              <span>
                <span className="block text-[0.9375rem] font-medium">{option.label}</span>
                <span className="ir-hint" id={`${option.name}-hint`}>{option.hint}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <SubmitButton label={tc('save')} variant="quiet" />
    </form>
  )
}
