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
}: {
  label: string
  variant?: 'primary' | 'quiet'
}) {
  const { pending } = useFormStatus()
  const t = useTranslations('common')

  return (
    <button
      type="submit"
      disabled={pending}
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
