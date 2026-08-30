import type { InputHTMLAttributes } from 'react'

type Props = InputHTMLAttributes<HTMLInputElement> & {
  id: string
  label: string
  hint?: string
  error?: string
}

/**
 * One input, always labelled, with the error wired to the input by id so a
 * screen reader reads the problem rather than announcing "invalid" and leaving
 * the reason on screen.
 */
export function Field({ id, label, hint, error, ...props }: Props) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined

  return (
    <div>
      <label className="ir-label" htmlFor={id}>{label}</label>
      <input
        {...props}
        id={id}
        name={props.name ?? id}
        className="ir-field"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
      />
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
