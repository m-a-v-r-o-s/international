'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { setPin, unlock, type UnlockState } from './actions'

const EMPTY: UnlockState = {}
const PIN_PROPS = {
  inputMode: 'numeric' as const,
  pattern: '[0-9]*',
  maxLength: 8,
  autoComplete: 'off' as const,
}

export function UnlockForm() {
  const t = useTranslations('unlock')
  const [state, action] = useActionState(unlock, EMPTY)

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <p className="text-[0.9375rem] text-ink-soft">{t('intro')}</p>
      <Field
        id="pin"
        label={t('pin')}
        type="password"
        {...PIN_PROPS}
        required
        autoFocus
        error={state.error === 'wrong' ? t('wrong') : undefined}
      />
      {state.error === 'rateLimited' ? (
        <p className="ir-notice border-danger bg-danger-tint text-ink" role="alert">
          {t('rateLimited')}
        </p>
      ) : null}
      <SubmitButton label={t('unlock')} />
    </form>
  )
}

export function SetPinForm() {
  const t = useTranslations('unlock')
  const [state, action] = useActionState(setPin, EMPTY)

  const pinError =
    state.error === 'tooShort' ? t('tooShort')
      : state.error === 'digitsOnly' ? t('digitsOnly')
        : undefined

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <p className="text-[0.9375rem] text-ink-soft">{t('setIntro')}</p>
      <Field
        id="pin"
        label={t('newPin')}
        type="password"
        {...PIN_PROPS}
        required
        autoFocus
        error={pinError}
      />
      <Field
        id="confirm"
        label={t('confirmPin')}
        type="password"
        {...PIN_PROPS}
        required
        error={state.error === 'mismatch' ? t('mismatch') : undefined}
      />
      <SubmitButton label={t('setAction')} />
    </form>
  )
}
