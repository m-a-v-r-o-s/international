/**
 * The five schematic views of a car that damage marks are placed on
 * (`damage_marks.view` — front, rear, left, right, top). Every view is drawn
 * into the SAME viewBox, because `damage_marks.x`/`.y` are relative 0–1
 * coordinates inside the diagram box: if the boxes differed between views, a
 * mark recorded at pickup would move when it was redrawn at return.
 *
 * These are outlines, not artwork. They are `aria-hidden` on purpose — the
 * meaning of the screen lives in the marks themselves, which are real buttons,
 * and in the list of marks rendered beside the diagram. A blind or
 * keyboard-only rep never has to interpret this drawing to do their job
 * (docs/02-ARCHITECTURE.md, "the camera and signature flows need accessible
 * non-visual paths too").
 */
export type DamageView = 'front' | 'rear' | 'left' | 'right' | 'top'

export const DAMAGE_VIEWS: DamageView[] = ['front', 'rear', 'left', 'right', 'top']

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 3,
  strokeLinejoin: 'round' as const,
  strokeLinecap: 'round' as const,
}

function SideView({ mirrored }: { mirrored: boolean }) {
  return (
    <g transform={mirrored ? 'translate(300,0) scale(-1,1)' : undefined}>
      <path {...stroke} d="M18 128 L18 96 Q20 84 42 81 L92 50 Q104 43 126 43 L188 43 Q210 45 224 57 L258 80 Q280 85 282 98 L282 128 Z" />
      <path {...stroke} d="M100 78 L128 55 L166 55 L166 78 Z" />
      <path {...stroke} d="M176 55 L196 56 L220 78 L176 78 Z" />
      <circle {...stroke} cx="82" cy="128" r="21" />
      <circle {...stroke} cx="228" cy="128" r="21" />
    </g>
  )
}

function EndView({ rear }: { rear: boolean }) {
  return (
    <g>
      <path {...stroke} d="M52 146 L52 84 Q56 62 78 56 L104 44 L196 44 L222 56 Q244 62 248 84 L248 146 Z" />
      <path {...stroke} d={rear ? 'M92 58 L208 58 L200 92 L100 92 Z' : 'M96 58 L204 58 L214 94 L86 94 Z'} />
      <rect {...stroke} x="62" y="104" width="34" height="18" rx="6" />
      <rect {...stroke} x="204" y="104" width="34" height="18" rx="6" />
      <path {...stroke} d="M108 132 L192 132" />
    </g>
  )
}

function TopView() {
  return (
    <g>
      <path {...stroke} d="M112 22 Q150 14 188 22 L206 44 Q222 70 222 100 Q222 130 206 156 L188 172 Q150 180 112 172 L94 156 Q78 130 78 100 Q78 70 94 44 Z" />
      <path {...stroke} d="M100 58 Q150 50 200 58" />
      <path {...stroke} d="M100 142 Q150 150 200 142" />
      <rect {...stroke} x="104" y="72" width="92" height="56" rx="10" />
    </g>
  )
}

export function CarDiagram({ view }: { view: DamageView }) {
  return (
    <svg
      viewBox="0 0 300 200"
      className="block h-auto w-full text-line-strong"
      aria-hidden="true"
      focusable="false"
    >
      {view === 'left' ? <SideView mirrored={false} /> : null}
      {view === 'right' ? <SideView mirrored /> : null}
      {view === 'front' ? <EndView rear={false} /> : null}
      {view === 'rear' ? <EndView rear /> : null}
      {view === 'top' ? <TopView /> : null}
    </svg>
  )
}
