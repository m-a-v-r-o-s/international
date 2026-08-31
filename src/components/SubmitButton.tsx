'use client'

import { useFormStatus } from 'react-dom'
import { useTranslations } from 'next-intl'

/**
 * Never a silent freeze: anything async says so, and says so to a screen
 * reader as well as on screen.
 */
export function SubmitButton({
  label,
  variant = 'primary',
  disabled = false,
}: {
  label: string
  variant?: 'primary' | 'quiet'
  /**
   * For a form that is not yet safe to submit — the ledger clear-all, whose
   * three confirmations must all be satisfied first. It is a hint to the
   * person, never the control: every action re-checks its own preconditions
   * server-side, because a disabled attribute is a suggestion to a browser.
   */
  disabled?: boolean
}) {
  const { pending } = useFormStatus()
  const t = useTranslations('common')

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={variant === 'primary' ? 'ir-btn-primary' : 'ir-btn-quiet'}
    >
      {pending ? (
        <>
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          {t('loading')}
        </>
      ) : (
        label
      )}
    </button>
  )
}
