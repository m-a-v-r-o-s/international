'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { changeGratisCode, lockGratis, unlockGratis, type GratisState } from './gratis-actions'

/**
 * §48 · Nothing on screen until Ctrl+Alt+G. Matched on the physical key
 * (`code`), so it works the same on a Greek or a Latin layout. The code is
 * checked on the server; this dialog only asks for it.
 */
export function GratisLock({ unlocked }: { unlocked: boolean }) {
  const t = useTranslations('admin.gratisLock')
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)

  const [unlockState, unlockAction] = useActionState<GratisState, FormData>(unlockGratis, undefined)
  const [changeState, changeAction] = useActionState<GratisState, FormData>(changeGratisCode, undefined)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyG' || !e.ctrlKey || !e.altKey || e.metaKey || e.repeat) return
      e.preventDefault()
      const d = dialog.current
      if (d?.open) d.close()
      else d?.showModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (unlockState?.done) {
      dialog.current?.close()
      router.refresh()
    }
  }, [unlockState, router])

  const error = (state: GratisState) => state?.error ? (
    <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{t(`error.${state.error}`)}</p>
  ) : null

  const codeField = (id: string, name: 'code' | 'confirm', label: string) => (
    <div>
      <label className="ir-label" htmlFor={id}>{label}</label>
      <input
        id={id} name={name}
        type="password" inputMode="numeric" pattern="\d{4}" minLength={4} maxLength={4}
        autoComplete="off" required className="ir-field"
      />
    </div>
  )

  return (
    <dialog
      ref={dialog}
      aria-labelledby="gratis-lock-title"
      className="ir-dialog m-auto w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-5 text-ink backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-4">
        <h2 id="gratis-lock-title" className="text-[1.125rem] font-semibold">{t('title')}</h2>

        {unlocked ? (
          <>
            <p role="status">{t('unlockedFor')}</p>
            <form action={async () => { await lockGratis(); dialog.current?.close(); router.refresh() }}>
              <SubmitButton label={t('lock')} variant="primary" />
            </form>
            <form action={changeAction} className="flex flex-col gap-3 border-t border-line pt-4">
              <p className="font-medium">{t('changeTitle')}</p>
              {error(changeState)}
              {changeState?.done ? <p className="text-ok" role="status">{t('changed')}</p> : null}
              {codeField('gratis-new', 'code', t('code'))}
              {codeField('gratis-new-confirm', 'confirm', t('confirm'))}
              <SubmitButton label={t('change')} variant="quiet" />
            </form>
          </>
        ) : (
          <form action={unlockAction} className="flex flex-col gap-3">
            {unlockState?.setup ? <p>{t('setupHint')}</p> : null}
            {error(unlockState)}
            {codeField('gratis-code', 'code', t('code'))}
            {unlockState?.setup ? codeField('gratis-confirm', 'confirm', t('confirm')) : null}
            <SubmitButton label={t('unlock')} />
          </form>
        )}

        <button type="button" className="ir-btn-quiet" onClick={() => dialog.current?.close()}>
          {t('close')}
        </button>
      </div>
    </dialog>
  )
}
