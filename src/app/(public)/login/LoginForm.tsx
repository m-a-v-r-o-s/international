'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import {
  requestSignInCode, signInWithCredential, verifySignInCode, type LoginState,
} from './actions'

const EMPTY: LoginState = {}

/**
 * The rep's door. One field, and it is a PIN: since §32 that is the only
 * credential a rep is ever given (docs/01-DECISIONS.md §32), so the label says
 * PIN and the phone offers a number pad.
 *
 * The field is not RESTRICTED to digits, though — no `pattern`, no `maxLength`
 * — because the same field still accepts the long password an account minted
 * before that decision was handed, and the boss's own account has always had
 * one. A rep in that position types letters on the keyboard's own toggle; every
 * other rep sees a keypad. Which kind of credential it turns out to be is
 * decided on the server, never here.
 */
export function CredentialForm() {
  const t = useTranslations('login')
  const [state, action] = useActionState(signInWithCredential, EMPTY)

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
        id="credential"
        label={t('pin')}
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        required
        // Kept from the password field it replaces: the boss reads a PIN out
        // once and the rep types it into a masked box at a busy desk, so being
        // able to check what is actually in there matters more, not less.
        revealable
        showLabel={t('showPin')}
        hideLabel={t('hidePin')}
        error={state.error === 'credentialMissing' ? t('credentialMissing') : undefined}
      />

      <FormError error={state.error} skip={['invalidEmail', 'credentialMissing']} />
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
