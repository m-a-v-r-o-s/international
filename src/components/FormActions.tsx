'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { useTranslations } from 'next-intl'
import { SubmitButton } from './SubmitButton'

/**
 * Everything the surrounding form currently holds, as one comparable string.
 *
 * A file is compared by its name, size and date rather than its bytes — enough
 * to notice that a different photograph was picked, and it never reads the
 * file. Unchecked boxes are simply absent, the same way they are absent from
 * the submission itself, so the comparison sees exactly what a save would send.
 */
function snapshot(form: HTMLFormElement) {
  const parts: string[] = []
  for (const [name, value] of new FormData(form)) {
    parts.push(value instanceof File
      ? `${name}\u0001${value.name}\u0001${value.size}\u0001${value.lastModified}`
      : `${name}\u0001${value}`)
  }
  return parts.join('\u0000')
}

/**
 * Save and cancel, as one pair, for any form that edits something that already
 * exists.
 *
 * Two rules the whole app now keeps: a save that would write nothing cannot be
 * pressed, and anywhere there is a save there is also a way out of it. The
 * first is what stops a rep at a desk wondering whether the tap registered and
 * pressing it twice; the second is what makes a half-typed correction
 * abandonable without reloading the screen.
 *
 * How "changed" is decided: the form's own fields are read at mount and
 * compared against what they hold now — no per-field wiring, no controlled
 * copies of values that already live in the DOM. It re-reads on every field
 * event AND after every render, because those catch different things. A person
 * typing changes a field without re-rendering anything; a field the page drives
 * from React state (the fuel slider) changes without ever firing an event.
 *
 * Cancel is `form.reset()`, which is the browser restoring each field to the
 * value the server rendered — the same values the baseline was taken from.
 * `onCancel` is for the rest: closing the panel the form sits in, or resetting
 * a value the form holds in React state rather than in a field.
 *
 * The disabled attribute is a hint to the person, never the control. Every
 * action re-checks its own preconditions server-side, exactly as before.
 */
export function FormActions({
  label,
  cancelLabel,
  variant = 'primary',
  requireChanges = true,
  saved,
  disabled = false,
  onCancel,
}: {
  label: string
  /** Defaults to the shared "Cancel". */
  cancelLabel?: string
  variant?: 'primary' | 'quiet'
  /**
   * False where the initial values are themselves worth saving because nothing
   * has been saved yet — adding a row, or a fuel reading that is legitimately
   * "full" on a handover no one has recorded. Gating those would leave a rep
   * unable to record the very thing the screen is asking for.
   */
  requireChanges?: boolean
  /**
   * Truthy when the last submission succeeded, so what is on screen becomes the
   * new baseline and the button goes quiet again. Where an action reports
   * nothing but errors, `state && !state.error` is that signal.
   */
  saved?: unknown
  /** A precondition of the form's own, as on SubmitButton. */
  disabled?: boolean
  /** Anything cancelling must do beyond restoring the fields. */
  onCancel?: () => void
}) {
  const tc = useTranslations('common')
  const anchor = useRef<HTMLDivElement>(null)
  const baseline = useRef('')
  const wasPending = useRef(false)
  const [changed, setChanged] = useState(false)
  const { pending } = useFormStatus()

  const formOf = useCallback(() => anchor.current?.closest('form') ?? null, [])

  const measure = useCallback(() => {
    const form = formOf()
    if (form) setChanged(snapshot(form) !== baseline.current)
  }, [formOf])

  useEffect(() => {
    const form = formOf()
    if (!form) return
    baseline.current = snapshot(form)
    setChanged(false)
    form.addEventListener('input', measure)
    form.addEventListener('change', measure)
    return () => {
      form.removeEventListener('input', measure)
      form.removeEventListener('change', measure)
    }
  }, [formOf, measure])

  // A save that landed makes what is on screen the new saved truth. A save that
  // failed does not: the values stay changed, so the button stays pressable and
  // the person can try again without having to retype something first.
  useEffect(() => {
    if (wasPending.current && !pending && saved) {
      const form = formOf()
      if (form) baseline.current = snapshot(form)
    }
    wasPending.current = pending
  }, [pending, saved, formOf])

  useEffect(measure)

  const gated = requireChanges && !changed

  return (
    <div ref={anchor} className="flex flex-col gap-2">
      <div className="flex gap-3">
        <SubmitButton label={label} variant={variant} disabled={disabled || gated} />
        <button
          type="button"
          className="ir-btn-quiet"
          onClick={() => {
            formOf()?.reset()
            onCancel?.()
            measure()
          }}
          disabled={pending || (!changed && !onCancel)}
        >
          {cancelLabel ?? tc('cancel')}
        </button>
      </div>
      {gated ? <p className="ir-hint">{tc('noChanges')}</p> : null}
    </div>
  )
}
