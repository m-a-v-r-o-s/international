'use client'

import { useActionState, useState, type MouseEvent } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { CarDiagram, DAMAGE_VIEWS, type DamageView } from './CarDiagram'
import { ZONES, pointToZone, clamp01, roundCoord, type Zone } from '@/lib/damage/zones'
import { addDamageMark, removeDamageMark, type DamageState } from './damage-actions'

export type MarkType = 'scratch' | 'dent' | 'chip' | 'crack' | 'other'

export type DiagramMark = {
  id: string
  view: DamageView
  x: number
  y: number
  mark_type: MarkType
  note: string | null
}

/**
 * The car diagram (docs/01-DECISIONS.md §12) — tappable, and reachable
 * entirely without tapping.
 *
 * Three things are true of every mark on this screen at once:
 *   · it is a real <button>, so a keyboard or switch reaches it in tab order;
 *   · it appears in an ordered list beside the diagram, in words, so the
 *     diagram is never the only way to know what has been recorded; and
 *   · it can be ADDED from the form alone — pick a view, pick one of nine
 *     named zones — so placing damage never requires pointing at a pixel.
 * The drawing itself is aria-hidden. It is a convenience for a rep with a
 * thumb, not the interface (WCAG 2.1 AA, HANDOFF.md's mobile-first rule).
 *
 * At return, marks carried forward from the pickup handover come in through
 * `carriedForward` and are drawn muted and read-only; marks added here are
 * drawn in the alert colour. Colour is never the only signal — the two sets
 * are separate lists with their own headings, and each pin carries its own
 * label.
 */
export function DamageDiagram({
  handoverId, marks, carriedForward = [], editable = true, tone = 'existing',
}: {
  handoverId: string
  marks: DiagramMark[]
  carriedForward?: DiagramMark[]
  editable?: boolean
  tone?: 'existing' | 'new'
}) {
  const t = useTranslations('damage')
  const tc = useTranslations('common')
  const te = useTranslations('errors')

  const [view, setView] = useState<DamageView>('front')
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
  const [zone, setZone] = useState<Zone>('midCentre')

  const [addState, addAction] = useActionState<DamageState, FormData>(addDamageMark, undefined)
  const [removeState, removeAction] = useActionState<DamageState, FormData>(removeDamageMark, undefined)

  const onSurfaceClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!editable) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const x = roundCoord(clamp01((event.clientX - rect.left) / rect.width))
    const y = roundCoord(clamp01((event.clientY - rect.top) / rect.height))
    setPoint({ x, y })
    setZone(pointToZone(x, y))
  }

  const describe = (mark: DiagramMark) =>
    `${t(`view.${mark.view}`)} · ${t(`zone.${pointToZone(mark.x, mark.y)}`)} · ${t(`type.${mark.mark_type}`)}`

  const inView = (list: DiagramMark[]) => list.filter((m) => m.view === view)
  const newTone = tone === 'new'

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="ir-label" id="damage-view-label">{t('viewLabel')}</p>
        <div role="tablist" aria-labelledby="damage-view-label" className="-mx-1 flex flex-wrap gap-1 px-1">
          {DAMAGE_VIEWS.map((v) => {
            const count = marks.filter((m) => m.view === v).length + carriedForward.filter((m) => m.view === v).length
            const selected = v === view
            return (
              <button
                key={v}
                type="button"
                role="tab"
                id={`damage-tab-${v}`}
                aria-selected={selected}
                aria-controls="damage-surface"
                onClick={() => { setView(v); setPoint(null) }}
                className={`min-h-11 rounded-field border px-3 text-[0.9375rem] font-medium transition-colors duration-150 ease-ui ${
                  selected ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface text-ink hover:bg-brand-tint'
                }`}
              >
                {t(`view.${v}`)}
                {count > 0 ? <span className="ml-1.5 font-semibold">({count})</span> : null}
              </button>
            )
          })}
        </div>
      </div>

      <div
        id="damage-surface"
        role="tabpanel"
        aria-labelledby={`damage-tab-${view}`}
        className="ir-card p-3"
      >
        <p className="mb-2 text-[0.875rem] text-ink-soft">
          {editable ? t('surfaceHint') : t('surfaceHintReadOnly')}
        </p>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div className="relative select-none" onClick={onSurfaceClick}>
          <CarDiagram view={view} />

          {inView(carriedForward).map((mark, index) => (
            <span
              key={mark.id}
              style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink-soft px-2 py-0.5 text-[0.75rem] font-bold text-white"
            >
              <span aria-hidden="true">{index + 1}</span>
              <span className="sr-only">{t('carriedMarkLabel', { what: describe(mark) })}</span>
            </span>
          ))}

          {inView(marks).map((mark, index) => (
            <MarkPin
              key={mark.id}
              label={`${index + 1}`}
              description={describe(mark)}
              tone={newTone ? 'new' : 'existing'}
              x={mark.x}
              y={mark.y}
            />
          ))}

          {point && editable ? (
            <span
              aria-hidden="true"
              style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
              className="absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand bg-brand-tint"
            />
          ) : null}
        </div>
      </div>

      {editable ? (
        <form action={addAction} className="ir-card flex flex-col gap-3 p-4">
          <h3 className="text-[1.0625rem] font-semibold">{t('addTitle')}</h3>

          {addState?.error ? (
            <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(addState.error)}</p>
          ) : null}

          <input type="hidden" name="handover_id" value={handoverId} />
          {point ? <input type="hidden" name="x" value={point.x} /> : null}
          {point ? <input type="hidden" name="y" value={point.y} /> : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ir-label" htmlFor="mark_view">{t('viewLabel')}</label>
              <select
                id="mark_view" name="view" className="ir-field" value={view}
                onChange={(e) => { setView(e.target.value as DamageView); setPoint(null) }}
              >
                {DAMAGE_VIEWS.map((v) => <option key={v} value={v}>{t(`view.${v}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="ir-label" htmlFor="mark_zone">{t('zoneLabel')}</label>
              <select
                id="mark_zone" name="zone" className="ir-field" value={zone}
                onChange={(e) => { setZone(e.target.value as Zone); setPoint(null) }}
              >
                {ZONES.map((z) => <option key={z} value={z}>{t(`zone.${z}`)}</option>)}
              </select>
              <p className="ir-hint">{point ? t('zoneFromTap') : t('zoneHint')}</p>
            </div>
          </div>

          <div>
            <label className="ir-label" htmlFor="mark_type">{t('typeLabel')}</label>
            <select id="mark_type" name="mark_type" className="ir-field" defaultValue="scratch">
              {(['scratch', 'dent', 'chip', 'crack', 'other'] as MarkType[]).map((m) => (
                <option key={m} value={m}>{t(`type.${m}`)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="ir-label" htmlFor="mark_note">{t('noteLabel')}</label>
            <input id="mark_note" name="note" className="ir-field" maxLength={500} />
            <p className="ir-hint">{t('noteHint')}</p>
          </div>

          <SubmitButton label={t('addAction')} variant="quiet" />
        </form>
      ) : null}

      {carriedForward.length > 0 ? (
        <section>
          <h3 className="mb-2 text-[1.0625rem] font-semibold">{t('carriedTitle')}</h3>
          <ol className="flex flex-col gap-2">
            {carriedForward.map((mark, index) => (
              <li key={mark.id} className="ir-card flex items-start gap-3 p-3">
                <span className="mt-0.5 shrink-0 rounded-full bg-ink-soft px-2 py-0.5 text-[0.75rem] font-bold text-white">
                  {index + 1}
                </span>
                <span className="text-[0.9375rem]">
                  {describe(mark)}
                  {mark.note ? <span className="block text-ink-soft">{mark.note}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 text-[1.0625rem] font-semibold">
          {newTone ? t('newTitle') : t('listTitle')}
        </h3>

        {removeState?.error ? (
          <p className="ir-notice mb-2 border-danger bg-danger-tint text-danger" role="alert">{te(removeState.error)}</p>
        ) : null}

        {marks.length === 0 ? (
          <p className="text-ink-soft">{newTone ? t('noneNew') : t('none')}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {marks.map((mark, index) => (
              <li key={mark.id} className="ir-card flex items-start justify-between gap-3 p-3">
                <span className="flex items-start gap-3">
                  <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[0.75rem] font-bold text-white ${
                    newTone ? 'bg-danger' : 'bg-brand'
                  }`}>
                    {index + 1}
                  </span>
                  <span className="text-[0.9375rem]">
                    {describe(mark)}
                    {mark.note ? <span className="block text-ink-soft">{mark.note}</span> : null}
                  </span>
                </span>

                {editable ? (
                  <form action={removeAction} className="shrink-0">
                    <input type="hidden" name="id" value={mark.id} />
                    <input type="hidden" name="handover_id" value={handoverId} />
                    <button type="submit" className="min-h-11 rounded-field px-3 text-[0.9375rem] font-medium text-danger underline underline-offset-2">
                      <span aria-hidden="true">{tc('cancel')}</span>
                      <span className="sr-only">{t('removeMark', { what: describe(mark) })}</span>
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

/**
 * One mark on the drawing. A button rather than a dot: every recorded mark has
 * to be reachable in tab order and has to announce what it is, or the diagram
 * becomes a pointer-only interface.
 */
function MarkPin({
  label, description, tone, x, y,
}: {
  label: string
  description: string
  tone: 'existing' | 'new'
  x: number
  y: number
}) {
  return (
    <button
      type="button"
      onClick={(e) => e.stopPropagation()}
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
      className={`absolute min-h-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface px-2 py-0.5 text-[0.75rem] font-bold text-white ${
        tone === 'new' ? 'bg-danger' : 'bg-brand'
      }`}
    >
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{description}</span>
    </button>
  )
}
