import { DIAGRAM_VIEWBOX, MIRROR_TRANSFORM, shapesFor } from '@/lib/damage/shapes'

/**
 * The five schematic views of a car that damage marks are placed on
 * (`damage_marks.view` — front, rear, left, right, top). Every view is drawn
 * into the SAME viewBox, because `damage_marks.x`/`.y` are relative 0–1
 * coordinates inside the diagram box: if the boxes differed between views, a
 * mark recorded at pickup would move when it was redrawn at return.
 *
 * The outlines themselves live in src/lib/damage/shapes.ts as data, because
 * the contract PDF draws the same five views with a different renderer
 * (@react-pdf/renderer's SVG primitives) and the two must not drift.
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

export function CarDiagram({ view }: { view: DamageView }) {
  const { shapes, mirrored } = shapesFor(view)

  return (
    <svg
      viewBox={`0 0 ${DIAGRAM_VIEWBOX.width} ${DIAGRAM_VIEWBOX.height}`}
      className="block h-auto w-full text-line-strong"
      aria-hidden="true"
      focusable="false"
    >
      <g transform={mirrored ? MIRROR_TRANSFORM : undefined}>
        {shapes.map((shape, index) => {
          if (shape.kind === 'path') return <path key={index} {...stroke} d={shape.d} />
          if (shape.kind === 'circle') {
            return <circle key={index} {...stroke} cx={shape.cx} cy={shape.cy} r={shape.r} />
          }
          return (
            <rect
              key={index} {...stroke}
              x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx}
            />
          )
        })}
      </g>
    </svg>
  )
}
