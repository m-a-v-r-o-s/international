'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { changePin, type ChangePinState } from './actions'

const EMPTY: ChangePinState = {}

/** Six digits now (§38), but an old PIN being replaced may still be up to eight. */
const PIN_PROPS = {
  inputMode: 'numeric' as const,
  pattern: '[0-9]*',
  maxLength: 8,
  autoComplete: 'off' as const,
  type: 'password' as const,
}

export function ChangePinForm({ forced }: { forced: boolean }) {
  const t = useTranslations('changePin')
  const [state, action] = useActionState(changePin, EMPTY)

  if (state.done) {
    return (
      <div className="flex flex-col gap-4">
        <p className="ir-notice border-ok bg-ok-tint text-ok" role="status">
          {t('doneBody')}
        </p>
        {/*
          A real navigation rather than a router push: the PIN that was just
          written is what (app)/layout.tsx re-reads to decide whether this
          screen is still owed, and that decision is made on the server.
        */}
        <a href="/" className="ir-btn-primary">{t('continue')}</a>
      </div>
    )
  }

  const newPinError =
    state.error === 'digitsOnly' ? t('digitsOnly')
      : state.error === 'length' ? t('length')
        : state.error === 'weak' ? t('weak')
          : state.error === 'reused' ? t('reused')
            : undefined

  const banner =
    state.error === 'rateLimited' ? t('rateLimited')
      : state.error === 'unknown' ? t('unknown')
        : undefined

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <p className="text-[0.9375rem] text-ink-soft">{forced ? t('introForced') : t('intro')}</p>

      <Field
        id="current"
        label={t('current')}
        {...PIN_PROPS}
        autoComplete="current-password"
        required
        autoFocus
        revealable
        showLabel={t('show')}
        hideLabel={t('hide')}
        error={state.error === 'wrong' ? t('wrong') : undefined}
      />

      <Field
        id="pin"
        label={t('newPin')}
        {...PIN_PROPS}
        required
        revealable
        showLabel={t('show')}
        hideLabel={t('hide')}
        hint={t('newPinHint')}
        error={newPinError}
      />

      <Field
        id="confirm"
        label={t('confirmPin')}
        {...PIN_PROPS}
        required
        error={state.error === 'mismatch' ? t('mismatch') : undefined}
      />

      {banner ? (
        <p className="ir-notice border-danger bg-danger-tint text-ink" role="alert">
          {banner}
        </p>
      ) : null}

      <SubmitButton label={t('action')} />
    </form>
  )
}
