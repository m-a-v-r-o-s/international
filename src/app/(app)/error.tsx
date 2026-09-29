'use client'

import { useTranslations } from 'next-intl'

/**
 * A page whose data failed to load says so, instead of rendering an empty list
 * that reads as "there is nothing here" (the fleet showed 0 cars for 91 because
 * its query named a column the database did not have yet). The real error is in
 * the server log under this digest.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('common')

  return (
    <div className="flex flex-col gap-4" role="alert">
      <p className="ir-notice border-danger bg-danger-tint text-danger">{t('loadFailed')}</p>
      {error.digest ? <p className="text-[0.875rem] text-ink-soft">{error.digest}</p> : null}
      <button type="button" className="ir-btn-quiet self-start" onClick={reset}>{t('tryAgain')}</button>
    </div>
  )
}
