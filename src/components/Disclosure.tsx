'use client'

import { useState, type ReactNode } from 'react'

/**
 * A native <details>/<summary> disclosure — keyboard and screen-reader
 * support come from the browser rather than from ARIA we would have to get
 * right ourselves. Used for "add new" and per-row "edit" panels across the
 * admin screens so the form for a hundred cars is not rendered a hundred
 * times over.
 */
export function Disclosure({
  summary, children, defaultOpen = false,
}: {
  summary: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <details
      className="ir-card p-4"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="min-h-11 cursor-pointer list-none text-[1.0625rem] font-semibold text-ink marker:content-none">
        {summary}
      </summary>
      {open ? <div className="mt-4">{children}</div> : null}
    </details>
  )
}
