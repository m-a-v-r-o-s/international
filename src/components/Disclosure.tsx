'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A native <details>/<summary> disclosure — keyboard and screen-reader
 * support come from the browser rather than from ARIA we would have to get
 * right ourselves. Used for "add new" and per-row "edit" panels across the
 * admin screens so the form for a hundred cars is not rendered a hundred
 * times over. A press anywhere outside an open panel folds it away.
 */
export function Disclosure({
  summary, children, defaultOpen = false, className, summaryClassName,
}: {
  summary: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  className?: string
  summaryClassName?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const ref = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <details
      ref={ref}
      className={`ir-card p-4${className ? ` ${className}` : ''}`}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary
        className={`min-h-11 cursor-pointer list-none text-[1.0625rem] font-semibold marker:content-none ${summaryClassName ?? 'text-ink'}`}
      >
        {summary}
      </summary>
      {open ? <div className="mt-4">{children}</div> : null}
    </details>
  )
}
