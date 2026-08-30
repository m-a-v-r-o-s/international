'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { emailContract, type ContractState } from './contract-actions'

/**
 * R4 step 6 — the optional copy (docs/01-DECISIONS.md §16, §9).
 *
 * The guest's email is asked for HERE and nowhere else in the app, because §9
 * says so: it is optional, and the only reason to hold it is to send this one
 * document. Declining is a link to the next step rather than an action —
 * refusing to give an address is not an event worth recording.
 */
export function ContractCopyForm({
  bookingId, contractId, defaultEmail, alreadySentTo, alreadySentAt, skipHref, mailConfigured,
}: {
  bookingId: string
  contractId: string
  defaultEmail: string
  alreadySentTo: string | null
  alreadySentAt: string | null
  skipHref: string
  mailConfigured: boolean
}) {
  const t = useTranslations('contractStep')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<ContractState, FormData>(emailContract, undefined)

  return (
    <div className="flex flex-col gap-4">
      {!mailConfigured ? (
        <p className="ir-notice border-warn bg-warn-tint text-warn" role="status">
          {t('mailNotConfigured')}
        </p>
      ) : null}

      {alreadySentTo && alreadySentAt ? (
        <p className="ir-notice border-ok bg-ok-tint text-ok" role="status">
          {t('copySent', { email: alreadySentTo })}
        </p>
      ) : alreadySentTo ? (
        <p className="ir-notice border-warn bg-warn-tint text-warn" role="status">
          {t('copyRecorded', { email: alreadySentTo })}
        </p>
      ) : null}

      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="booking_id" value={bookingId} />
        <input type="hidden" name="contract_id" value={contractId} />

        {state?.error ? (
          <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
            {te(state.error)}
          </p>
        ) : null}

        {state?.saved && !state.mailPending ? (
          <p className="ir-notice border-ok bg-ok-tint text-ok" role="status">{t('copySentNow')}</p>
        ) : null}

        {state?.mailPending ? (
          <p className="ir-notice border-warn bg-warn-tint text-warn" role="status">
            {t(state.mailPending === 'not_configured' ? 'copyRecordedOnly' : 'copyFailed')}
          </p>
        ) : null}

        <div>
          <label className="ir-label" htmlFor="guest_email">{t('emailLabel')}</label>
          <input
            id="guest_email"
            name="email"
            type="email"
            className="ir-field"
            defaultValue={alreadySentTo ?? defaultEmail}
            maxLength={254}
            required
            autoComplete="off"
            inputMode="email"
            aria-describedby="guest_email_hint"
          />
          <p className="ir-hint" id="guest_email_hint">{t('emailHint')}</p>
        </div>

        <SubmitButton label={t('sendCopy')} variant="quiet" />
      </form>

      <a href={skipHref} className="ir-btn-primary">{t('skipCopy')}</a>
      <p className="ir-hint">{t('skipHint')}</p>
    </div>
  )
}
