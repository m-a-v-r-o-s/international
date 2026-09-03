import Link from 'next/link'
import { fmtTime, type Movement } from '@/lib/movements/data'

/**
 * One pickup or drop-off row, shared by the Today screen and the dedicated
 * Pickups/Drop-offs screens. `done` swaps the action button for a tick — the
 * card never disappears once handled, so a rep working the list can see what
 * they've already done alongside what's left.
 */
export function MovementCard({
  booking, kind, done, car, model, hotelName, statusLabel, actionLabel, doneLabel, roomLabel,
}: {
  booking: Movement
  kind: 'pickup' | 'return'
  done: boolean
  car: { plate: string } | undefined
  model: { make: string; model: string } | undefined
  hotelName: string | undefined
  statusLabel: string
  actionLabel: string
  doneLabel: string
  roomLabel: string | null
}) {
  const time = fmtTime(kind === 'pickup' ? booking.pickup_at : booking.dropoff_at)

  return (
    <li className={`ir-card p-4 ${done ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[1.0625rem] font-semibold">
            <span className="tabular-nums">{time}</span> · {car?.plate ?? '–'}
          </p>
          <p className="text-[0.9375rem] text-ink-soft">
            {model ? `${model.make} ${model.model}` : '–'}
          </p>
          <p className="mt-1 text-[0.9375rem]">
            {booking.cust_first} {booking.cust_last}
          </p>
          <p className="text-[0.875rem] text-ink-soft">
            {hotelName ?? '–'}
            {roomLabel ? ` · ${roomLabel}` : ''}
          </p>
        </div>
        <span className="shrink-0 rounded-field bg-brand-tint px-2.5 py-1 text-[0.8125rem] font-medium text-brand">
          {statusLabel}
        </span>
      </div>

      {done ? (
        <p className="mt-3 flex items-center gap-1.5 text-[0.9375rem] font-medium text-brand">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0" fill="none"
               stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5 9.5 17 19 7" />
          </svg>
          {doneLabel}
        </p>
      ) : (
        <Link href={`/bookings/${booking.id}/${kind}`} className="ir-btn-primary mt-3">
          {actionLabel}
        </Link>
      )}
    </li>
  )
}
