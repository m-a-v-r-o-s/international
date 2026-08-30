'use client'

/** A1 is the boss's morning paper replacement — it has to come out of a printer. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="ir-btn-quiet !w-auto">
      {label}
    </button>
  )
}
