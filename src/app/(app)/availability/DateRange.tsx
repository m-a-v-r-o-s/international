'use client'

import { useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

/**
 * The two dates R2 is a search of — and nothing else.
 *
 * There is no submit button, and that is the whole point: the rep changes a
 * date and the list under it re-loads. A guest at the desk asks "what about
 * the week after?", and the answer should cost one tap on a date, not a tap
 * and then a hunt for the button that makes the tap count.
 *
 * The seats and transmission filters that used to sit here are gone
 * (docs/01-DECISIONS.md §37). The results are grouped by model with a count
 * against each, so narrowing the fleet before looking at it stopped being the
 * way anyone reads this screen.
 *
 * Three details make the auto-load safe rather than merely clever:
 *
 *   · It navigates rather than holding state. The range still lives in the
 *     URL, so back, refresh and a link pasted into a rep's chat all behave —
 *     the property the old GET form had and the reason it was a form at all.
 *   · It debounces. A desktop `<input type="date">` fires `change` as each
 *     part is typed, so `2026-07-01` arrives via a year of `0002`. Waiting a
 *     beat means one navigation for one date, not four for a half-typed one.
 *   · It never navigates to a range the server would reject. An end before a
 *     start stays on screen as an error and the previous results stay put,
 *     because a rep mid-edit has not asked for anything yet.
 *
 * Without JavaScript the `<noscript>` button submits the surrounding GET form
 * to the same URL, so the screen degrades to exactly what it was before.
 */
export function DateRange({ from, to }: { from: string; to: string }) {
  const t = useTranslations('availability')
  const router = useRouter()
  // router.replace inside a transition stays pending until the server
  // component behind this form has re-rendered, so this one flag covers the
  // whole round trip — there is nothing for the server to tell us.
  const [busy, startTransition] = useTransition()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function scheduleLoad() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const form = formRef.current
      if (!form) return
      const data = new FormData(form)
      const nextFrom = String(data.get('from') ?? '')
      const nextTo = String(data.get('to') ?? '')

      // A half-typed date is not a search. The server validates these again;
      // this only decides whether to spend a navigation on them.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nextFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(nextTo)) return
      if (nextTo < nextFrom) return
      if (nextFrom === from && nextTo === to) return

      startTransition(() => {
        router.replace(`/availability?from=${nextFrom}&to=${nextTo}`, { scroll: false })
      })
    }, 400)
  }

  return (
    <form
      ref={formRef}
      className="ir-card flex flex-col gap-3 p-4"
      aria-label={t('rangeLabel')}
      onChange={scheduleLoad}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="ir-label" htmlFor="from">{t('from')}</label>
          <input id="from" name="from" type="date" defaultValue={from} className="ir-field" required />
        </div>
        <div>
          <label className="ir-label" htmlFor="to">{t('to')}</label>
          <input id="to" name="to" type="date" defaultValue={to} className="ir-field" required />
        </div>
      </div>

      {/* Announced, not merely drawn: the rep may be looking at the list, not
          at the dates, when the numbers under their thumb change. */}
      <p className="ir-hint min-h-5" role="status" aria-live="polite">
        {busy ? t('updating') : ''}
      </p>

      <noscript>
        <button type="submit" className="ir-btn-primary">{t('apply')}</button>
      </noscript>
    </form>
  )
}
