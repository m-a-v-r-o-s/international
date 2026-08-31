'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import {
  requestSignInCode, signInWithPassword, verifySignInCode, type LoginState,
} from './actions'

const EMPTY: LoginState = {}

export function PasswordForm() {
  const t = useTranslations('login')
  const [state, action] = useActionState(signInWithPassword, EMPTY)

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <p className="text-[0.9375rem] text-ink-soft">{t('staffIntro')}</p>

      <Field
        id="email"
        label={t('email')}
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        defaultValue={state.email}
        error={state.error === 'invalidEmail' ? t('invalidEmail') : undefined}
      />
      <Field
        id="password"
        label={t('password')}
        type="password"
        autoComplete="current-password"
        required
        revealable
        showLabel={t('showPassword')}
        hideLabel={t('hidePassword')}
        error={state.error === 'passwordTooShort' ? t('passwordTooShort') : undefined}
      />

      <FormError error={state.error} skip={['invalidEmail', 'passwordTooShort']} />
      <SubmitButton label={t('signIn')} />
    </form>
  )
}

export function CodeForm() {
  const t = useTranslations('login')
  const [requestState, requestAction] = useActionState(requestSignInCode, EMPTY)
  const [verifyState, verifyAction] = useActionState(verifySignInCode, EMPTY)

  const sent = requestState.codeSent || verifyState.codeSent
  const email = verifyState.email ?? requestState.email

  if (!sent) {
    return (
      <form action={requestAction} className="flex flex-col gap-4" noValidate>
        <p className="text-[0.9375rem] text-ink-soft">{t('managerIntro')}</p>
        <Field
          id="manager-email"
          name="email"
          label={t('email')}
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={requestState.email}
          error={requestState.error === 'invalidEmail' ? t('invalidEmail') : undefined}
        />
        <FormError error={requestState.error} skip={['invalidEmail']} />
        <SubmitButton label={t('sendCode')} />
      </form>
    )
  }

  return (
    <form action={verifyAction} className="flex flex-col gap-4" noValidate>
      <p className="ir-notice border-ok bg-ok-tint text-ink" role="status">
        {t('codeSent')}
      </p>
      <input type="hidden" name="email" value={email ?? ''} />
      <Field
        id="code"
        label={t('code')}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        autoFocus
        error={verifyState.error === 'invalidCode' ? t('invalidCode') : undefined}
      />
      <FormError error={verifyState.error} skip={['invalidCode']} />
      <SubmitButton label={t('verify')} />
      <Link href="/login?as=manager" className="text-center text-[0.9375rem] underline">
        {t('useAnotherEmail')}
      </Link>
    </form>
  )
}

function FormError({
  error, skip = [],
}: { error: LoginState['error']; skip?: NonNullable<LoginState['error']>[] }) {
  const t = useTranslations('login')
  if (!error || skip.includes(error)) return null

  return (
    <p className="ir-notice border-danger bg-danger-tint text-ink" role="alert">
      {t(error)}
    </p>
  )
}
