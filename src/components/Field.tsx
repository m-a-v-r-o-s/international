'use client'

import { useState, type InputHTMLAttributes } from 'react'

type Props = InputHTMLAttributes<HTMLInputElement> & {
  id: string
  label: string
  hint?: string
  error?: string
  /** Adds a show/hide toggle. Only meaningful when `type` is `password`. */
  revealable?: boolean
  showLabel?: string
  hideLabel?: string
}

/**
 * One input, always labelled, with the error wired to the input by id so a
 * screen reader reads the problem rather than announcing "invalid" and leaving
 * the reason on screen.
 */
export function Field({
  id, label, hint, error, revealable, showLabel, hideLabel, ...props
}: Props) {
  const [visible, setVisible] = useState(false)
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const toggle = revealable && props.type === 'password'

  return (
    <div>
      <label className="ir-label" htmlFor={id}>{label}</label>
      <div className={toggle ? 'relative' : undefined}>
        <input
          {...props}
          type={toggle && visible ? 'text' : props.type}
          id={id}
          name={props.name ?? id}
          className={toggle ? 'ir-field pr-12' : 'ir-field'}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        />
        {toggle ? (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={(visible ? hideLabel : showLabel) ?? (visible ? 'Hide password' : 'Show password')}
            aria-pressed={visible}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-ink-soft hover:text-ink"
          >
            {visible ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3l18 18" />
                <path d="M10.58 10.58a2 2 0 0 0 2.83 2.83" />
                <path d="M9.88 4.62A10.94 10.94 0 0 1 12 4.5c5 0 9 3.5 10 7.5a11.6 11.6 0 0 1-2.16 3.94M6.6 6.6C4.4 8 2.9 9.9 2 12c1 4 5 7.5 10 7.5 1.35 0 2.63-.25 3.8-.7" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12c1-4 5-7.5 10-7.5s9 3.5 10 7.5c-1 4-5 7.5-10 7.5S3 16 2 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        ) : null}
      </div>
      {hint ? <p className="ir-hint" id={hintId}>{hint}</p> : null}
      {error ? (
        <p className="ir-error" id={errorId} role="alert">
          <span aria-hidden="true">!</span>
          {error}
        </p>
      ) : null}
    </div>
  )
}
