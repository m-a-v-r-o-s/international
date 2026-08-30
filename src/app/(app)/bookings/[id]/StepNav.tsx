import Link from 'next/link'

export type StepState = {
  key: string
  label: string
  href: string
  current: boolean
  done: boolean
  reachable: boolean
}

/**
 * The pickup and return flows are "one thing per screen, resumable if the app
 * is closed" (docs/04-SCREENS.md, R4). Nothing about where the rep has got to
 * is held in the browser: each step writes its own rows, and which steps are
 * done is read back off those rows on every request. Closing the app mid-
 * pickup and reopening it lands on the same place, on any device.
 *
 * A step that is not yet reachable is rendered as text rather than a link, and
 * says so — never a link that looks live and then refuses.
 */
export function StepNav({ steps, label, doneLabel }: { steps: StepState[]; label: string; doneLabel: string }) {
  return (
    <nav aria-label={label} className="-mx-5 overflow-x-auto px-5">
      <ol className="flex gap-1.5 whitespace-nowrap">
        {steps.map((step, index) => {
          const inner = (
            <>
              <span aria-hidden="true" className="font-semibold">{index + 1}.</span> {step.label}
              {step.done ? (
                <>
                  <span aria-hidden="true"> ✓</span>
                  <span className="sr-only"> — {doneLabel}</span>
                </>
              ) : null}
            </>
          )

          const base = 'inline-flex min-h-11 items-center gap-1.5 rounded-field border px-3 text-[0.9375rem]'

          return (
            <li key={step.key}>
              {step.current ? (
                <span aria-current="step" className={`${base} border-brand bg-brand text-brand-ink font-medium`}>
                  {inner}
                </span>
              ) : step.reachable ? (
                <Link href={step.href} className={`${base} border-line bg-surface text-ink hover:bg-brand-tint`}>
                  {inner}
                </Link>
              ) : (
                <span className={`${base} border-line bg-canvas text-ink-faint`}>{inner}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
