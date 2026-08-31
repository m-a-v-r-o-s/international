'use client'

import { useEffect, useId, useState } from 'react'
import { useTranslations } from 'next-intl'

const CONFIRM_SECONDS = 3

/**
 * Wraps the sign-out trigger (icon + label, styled by the caller) with a
 * confirm dialog. A rep's thumb lands near this button often on a shared
 * front-desk tablet, and "Yes" staying disabled for a few seconds means a
 * stray double-tap can't end the shift the same reflex motion that opened
 * the dialog.
 */
export function SignOutButton({ className, children }: { className: string; children: React.ReactNode }) {
  const t = useTranslations('common')
  const [open, setOpen] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(CONFIRM_SECONDS)
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    if (!open) return
    setSecondsLeft(CONFIRM_SECONDS)
    const id = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const ready = secondsLeft === 0

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>

      {open && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            className="ir-card w-full max-w-sm bg-surface p-5 shadow-[0_12px_32px_rgba(11,20,32,0.18)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={titleId} className="text-[1.0625rem] font-semibold text-ink">
              {t('signOutConfirmTitle')}
            </h2>
            <p id={bodyId} className="mt-2 text-[0.9375rem] text-ink-soft">
              {t('signOutConfirmBody')}
            </p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setOpen(false)} className="ir-btn-quiet !w-auto flex-1">
                {t('cancel')}
              </button>
              <a
                href="/signed-out"
                aria-disabled={!ready}
                tabIndex={ready ? 0 : -1}
                onClick={(e) => {
                  if (!ready) e.preventDefault()
                }}
                className={`ir-btn !w-auto flex-1 border border-danger text-danger hover:bg-danger-tint ${
                  ready ? '' : 'pointer-events-none opacity-60'
                }`}
              >
                {ready ? t('signOut') : t('signOutConfirmWait', { seconds: secondsLeft })}
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
