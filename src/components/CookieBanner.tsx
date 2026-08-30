'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

const KEY = 'ir_cookie_notice'

/**
 * The app sets no advertising or analytics cookie — only the session, the
 * language and the CSRF/rate-limit protections — so this is a notice with an
 * acknowledgement rather than a consent gate with a reject button that would
 * have nothing to reject. The acknowledgement is remembered in this browser
 * and never sent anywhere.
 */
export function CookieBanner() {
  const t = useTranslations('cookies')
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem(KEY) !== 'seen')
    } catch {
      setVisible(true)
    }
  }, [])

  if (!visible) return null

  return (
    <div
      role="region"
      aria-label={t('title')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface p-4 shadow-[0_-4px_16px_rgba(11,20,32,0.08)]"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <p className="text-[0.9375rem] text-ink-soft">
          {t('body')}{' '}
          <Link href="/privacy" className="underline underline-offset-2 text-ink">
            {t('more')}
          </Link>
        </p>
        <button
          type="button"
          className="ir-btn-primary sm:w-auto sm:self-end sm:px-8"
          onClick={() => {
            try {
              window.localStorage.setItem(KEY, 'seen')
            } catch {
              /* private mode: the notice simply shows again next time */
            }
            setVisible(false)
          }}
        >
          {t('accept')}
        </button>
      </div>
    </div>
  )
}
