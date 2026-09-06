'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { useTranslations } from 'next-intl'
import type { RelocationRow as Row, RelocationBoard } from '@/lib/relocations/data'
import { fmtTime } from '@/lib/relocations/data'
import {
  clearRelocation, completeRelocation, setRelocation, type RelocationState,
} from './actions'

type Destinations = RelocationBoard['destinations']

/** Stands in for an unregistered hotel in the select; never submitted. */
const ADHOC = '__adhoc'

function Problem({ state }: { state: RelocationState }) {
  const te = useTranslations('errors')
  if (!state?.error) return null
  return (
    <p className="ir-notice border-danger bg-danger-tint text-danger !py-1.5 print:hidden" role="alert">
      {te(state.error)}
    </p>
  )
}

/** A quiet inline button that shows its own pending state. */
function InlineButton({ label, tone }: { label: string; tone: 'go' | 'off' }) {
  const { pending } = useFormStatus()
  const tc = useTranslations('common')

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`min-h-11 rounded-field border px-3 text-[0.875rem] font-medium disabled:opacity-60 ${
        tone === 'go'
          ? 'border-ok bg-ok-tint text-ok hover:brightness-95'
          : 'border-line-strong bg-canvas text-ink-soft hover:text-ink'
      }`}
    >
      {pending ? tc('loading') : label}
    </button>
  )
}

/**
 * One car's night: where it is, where it has to be, and the three decisions the
 * boss can make about it — send it somewhere, tick it off, or take it back.
 *
 * The select is CONTROLLED against `chosen`, which is what the sheet currently
 * says. That matters for `Reset`: dropping an override changes the row's
 * destination underneath a select whose DOM value the browser is still holding,
 * and an uncontrolled one would then show a hotel the sheet no longer names.
 */
export function RelocationRow({
  row, night, destinations,
}: {
  row: Row
  night: string
  destinations: Destinations
}) {
  const t = useTranslations('admin.relocations')
  const tc = useTranslations('common')
  // What the sheet currently says, and what the person has picked since.
  const chosen = row.to.adhoc ? ADHOC : (row.to.hotelId ?? '')
  const [choice, setChoice] = useState(chosen)
  useEffect(() => { setChoice(chosen) }, [chosen])

  const [setState, setAction] = useActionState<RelocationState, FormData>(setRelocation, undefined)
  const [doneState, doneAction] = useActionState<RelocationState, FormData>(completeRelocation, undefined)
  const [clearState, clearAction] = useActionState<RelocationState, FormData>(clearRelocation, undefined)

  const moving = row.to.label !== null
  const isDone = row.doneAt !== null
  // An ad-hoc destination is a hotel that has no row to point at (§42), so
  // there is no id to record a completed move against. It is shown, because
  // the car still has to be driven there, but it cannot be ticked off until
  // the place is a registered hotel.
  const tickable = moving && row.to.hotelId !== null

  const context = [
    row.guest,
    row.dropoffAt ? t('backAt', { time: fmtTime(row.dropoffAt) }) : null,
    row.pickupAt ? t('dueAt', { time: fmtTime(row.pickupAt) }) : null,
  ].filter(Boolean).join(' · ')

  return (
    <li className={`flex flex-col gap-3 py-3 ${isDone ? 'opacity-60 print:opacity-100' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="text-[1.0625rem] font-semibold">{row.plate}</span>
            {row.model ? <span className="text-[0.875rem] text-ink-soft">{row.model}</span> : null}
            {row.reason === 'manual' ? (
              <span className="rounded-field border border-line-strong px-2 py-0.5 text-[0.75rem] text-ink-soft">
                {t('reason.manual')}
              </span>
            ) : null}
            {row.overridden ? (
              <span className="rounded-field bg-brand-tint px-2 py-0.5 text-[0.75rem] font-medium text-brand">
                {t('yourCall')}
              </span>
            ) : null}
            {isDone ? (
              <span className="rounded-field bg-ok-tint px-2 py-0.5 text-[0.75rem] font-medium text-ok">
                {t('doneAt', { time: fmtTime(row.doneAt) })}
              </span>
            ) : null}
          </p>

          <p className="mt-1 text-[1.0625rem]">
            <span className={row.from.label ? '' : 'text-ink-soft'}>
              {row.from.label ?? t('unplaced')}
            </span>
            {moving ? (
              <>
                <span aria-hidden="true" className="mx-2 text-ink-soft">→</span>
                <span className="sr-only"> {t('movesTo')} </span>
                <span className="font-semibold text-brand">{row.to.label}</span>
              </>
            ) : (
              <span className="ml-2 text-[0.9375rem] text-ink-soft">· {t('stays')}</span>
            )}
          </p>

          {context ? <p className="mt-0.5 text-[0.875rem] text-ink-soft">{context}</p> : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 print:hidden">
          {tickable && !isDone ? (
            <form action={doneAction}>
              <input type="hidden" name="night" value={night} />
              <input type="hidden" name="car" value={row.carId} />
              <input type="hidden" name="to" value={row.to.hotelId ?? ''} />
              <InlineButton label={t('markDone')} tone="go" />
            </form>
          ) : null}
          {row.overridden ? (
            <form action={clearAction}>
              <input type="hidden" name="night" value={night} />
              <input type="hidden" name="car" value={row.carId} />
              <InlineButton label={t('reset')} tone="off" />
            </form>
          ) : null}
        </div>
      </div>

      {moving && !tickable ? (
        <p className="ir-hint print:hidden">{t('adhocDestination')}</p>
      ) : null}

      <form action={setAction} className="flex flex-wrap items-center gap-2 print:hidden">
        <input type="hidden" name="night" value={night} />
        <input type="hidden" name="car" value={row.carId} />
        <label className="text-[0.875rem] text-ink-soft" htmlFor={`to-${row.carId}`}>
          {t('sendTo')}
        </label>
        <select
          id={`to-${row.carId}`}
          name="to"
          className="ir-field !w-auto !min-w-52"
          value={choice}
          onChange={(e) => setChoice(e.currentTarget.value)}
        >
          {/*
            An ad-hoc destination has no id to select, so it shows as itself and
            cannot be re-chosen: disabled means the person can only move OFF it.
            The value never reaches the action either — the save button appears
            only once the choice DIFFERS from this one — and the action's schema
            would refuse it regardless.
          */}
          {row.to.adhoc ? (
            <option value={ADHOC} disabled>{row.to.label}</option>
          ) : null}
          <option value="">{t('staysOption')}</option>
          {destinations.map((h) => (
            <option key={h.id} value={h.id}>
              {h.is_depot ? `${h.name} · ${t('depot')}` : h.name}
            </option>
          ))}
        </select>
        {/*
          Shown only once the choice differs from what is on the sheet, the same
          rule FormActions applies everywhere else: a save that would write
          nothing cannot be pressed. It is a button rather than a submit on
          `change` because arrow-keying a closed <select> fires `change` on
          every keypress in some browsers — which would write a row per press.
        */}
        {choice !== chosen ? <InlineButton label={tc('save')} tone="go" /> : null}
      </form>

      <Problem state={setState} />
      <Problem state={doneState} />
      <Problem state={clearState} />
    </li>
  )
}
