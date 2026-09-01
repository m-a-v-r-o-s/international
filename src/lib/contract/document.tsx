import React from 'react'
import {
  Document, Page, Text, View, Image, Svg, Path, Circle, Rect, G, StyleSheet,
} from '@react-pdf/renderer'
import { DIAGRAM_VIEWBOX, MIRROR_TRANSFORM, shapesFor } from '@/lib/damage/shapes'
import type { DamageView } from '@/app/(app)/bookings/[id]/CarDiagram'
import { both, type Bilingual, type ContractLabels } from './labels'
import {
  athensDateTime, athensTime, calendarDate, euros,
  type ContractData, type ContractMark,
} from './data'

/**
 * The bilingual rental agreement (docs/01-DECISIONS.md §16).
 *
 * Greek and English on the SAME document, never two documents and never a
 * language toggle: every label prints as "Ελληνικά / English", and the terms
 * print in full in each language one after the other. The guest signs one
 * piece of paper and both texts are on it.
 *
 * Rendered server-side with @react-pdf/renderer, into a Noto Sans embedded
 * from assets/fonts (see render.ts). That combination is a deliberate answer
 * to the CSP in src/proxy.ts: `font-src 'self'` blocks a CDN font outright,
 * and `script-src` is nonce + strict-dynamic with no unsafe-eval in
 * production, so a client-side generator that eval()s a template or fetches a
 * font at runtime would pass in dev and fail in production. Nothing here runs
 * in a browser and nothing is fetched at run time.
 *
 * The component makes no decisions. Everything it prints was decided in
 * data.ts, including the DRAFT stamp, which is the guard that keeps an unfilled
 * app_settings.company from producing something that looks like a real
 * agreement.
 */
const PALETTE = {
  ink: '#111827',
  soft: '#4b5563',
  line: '#d1d5db',
  danger: '#b91c1c',
  faint: '#f3f4f6',
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 36, paddingBottom: 46, paddingHorizontal: 36,
    fontFamily: 'NotoSans', fontSize: 8.5, color: PALETTE.ink, lineHeight: 1.45,
  },
  title: { fontSize: 14, fontWeight: 700 },
  subtitle: { fontSize: 8.5, color: PALETTE.soft },
  draft: {
    marginTop: 8, padding: 8,
    border: `1.5pt solid ${PALETTE.danger}`, color: PALETTE.danger,
  },
  draftTitle: { fontSize: 11, fontWeight: 700, marginBottom: 3 },
  section: { marginTop: 12 },
  sectionTitle: {
    fontSize: 9.5, fontWeight: 700,
    borderBottom: `0.75pt solid ${PALETTE.line}`, paddingBottom: 2, marginBottom: 5,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%', paddingRight: 10, marginBottom: 4 },
  cellThird: { width: '33.33%', paddingRight: 10, marginBottom: 4 },
  label: { color: PALETTE.soft, fontSize: 7 },
  value: { fontSize: 9 },
  driver: {
    borderLeft: `2pt solid ${PALETTE.line}`, paddingLeft: 6, marginBottom: 6,
  },
  driverRole: { fontSize: 8, fontWeight: 700, marginBottom: 2 },
  diagrams: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  diagram: { width: '33.33%', paddingRight: 6, marginBottom: 6 },
  diagramTitle: { fontSize: 7, color: PALETTE.soft, marginBottom: 2 },
  markLine: { marginBottom: 1.5 },
  terms: { marginTop: 6, fontSize: 7.5, lineHeight: 1.5, color: PALETTE.ink },
  signatureBox: {
    marginTop: 6, width: 220, height: 80,
    border: `0.75pt solid ${PALETTE.line}`, backgroundColor: PALETTE.faint,
    alignItems: 'center', justifyContent: 'center',
  },
  signatureImage: { width: 210, height: 70, objectFit: 'contain' },
  footer: {
    position: 'absolute', bottom: 22, left: 36, right: 36,
    flexDirection: 'row', justifyContent: 'space-between',
    fontSize: 6.5, color: PALETTE.soft,
    borderTop: `0.5pt solid ${PALETTE.line}`, paddingTop: 4,
  },
})

export function ContractDocument({ data, labels }: { data: ContractData; labels: ContractLabels }) {
  const viewsWithMarks = (['front', 'rear', 'left', 'right', 'top'] as DamageView[])
    .filter((view) => data.marks.some((m) => m.view === view))

  return (
    <Document title={`${both(labels.title)} · ${data.ref}`}>
      <Page size="A4" style={styles.page} wrap>
        <View>
          <Text style={styles.title}>{both(labels.title)}</Text>
          <Text style={styles.subtitle}>{both(labels.ref)}: {data.ref}</Text>
        </View>

        {data.draft ? (
          <View style={styles.draft}>
            <Text style={styles.draftTitle}>{labels.draftTitle.el}</Text>
            <Text>{labels.draftBody.el}</Text>
            <Text style={{ ...styles.draftTitle, marginTop: 5 }}>{labels.draftTitle.en}</Text>
            <Text>{labels.draftBody.en}</Text>
          </View>
        ) : null}

        <Section title={labels.lessor}>
          <Text style={{ fontSize: 10, fontWeight: 700 }}>{data.company.legal_name || '—'}</Text>
          <Text style={{ color: PALETTE.soft }}>{data.company.address || '—'}</Text>
          <View style={styles.row}>
            <Cell label={labels.vat} value={data.company.vat_number} />
            <Cell label={labels.phone} value={data.company.phone} />
            {data.company.email ? <Cell label={labels.email} value={data.company.email} /> : null}
            <Cell label={labels.insurer} value={data.company.insurer} />
            {data.company.insurance_policy
              ? <Cell label={labels.policy} value={data.company.insurance_policy} />
              : null}
          </View>
        </Section>

        <Section title={labels.rental}>
          <View style={styles.row}>
            <Cell third label={labels.pickupDate} value={calendarDate(data.startDate)} />
            <Cell third label={labels.returnDate} value={calendarDate(data.endDate)} />
            {/* §4: the day count is inclusive — Mon → Wed is 3 days — and the
                number printed here is the one the engine charged for. */}
            <Cell third label={labels.days} value={data.days === null ? '—' : String(data.days)} />
            <Cell third label={labels.pickupTime} value={athensTime(data.pickupAt)} />
            <Cell third label={labels.returnTime} value={athensTime(data.dropoffAt)} />
            <Cell third label={labels.hotel} value={data.hotelName} />
            <Cell third label={labels.room} value={data.roomNumber} />
          </View>
        </Section>

        <Section title={labels.vehicle}>
          <View style={styles.row}>
            <Cell third label={labels.plate} value={data.plate} />
            <Cell
              third
              label={labels.makeModel}
              value={[data.make, data.model].filter(Boolean).join(' ') || null}
            />
            <Cell
              third
              label={labels.category}
              value={data.categoryEl && data.categoryEn
                ? both({ el: data.categoryEl, en: data.categoryEn })
                : data.categoryEn ?? data.categoryEl}
            />
            <Cell third label={labels.year} value={data.year === null ? null : String(data.year)} />
            <Cell third label={labels.colour} value={data.colour} />
            <Cell
              third
              label={labels.fuelOut}
              value={data.fuelOutEighths === null ? null : `${data.fuelOutEighths}/8`}
            />
          </View>
        </Section>

        <Section title={labels.drivers}>
          {data.drivers.map((driver, index) => (
            <View key={index} style={styles.driver}>
              <Text style={styles.driverRole}>
                {both(driver.isMain ? labels.mainDriver : labels.additionalDriver)}
              </Text>
              <View style={styles.row}>
                <Cell third label={labels.name} value={`${driver.firstName} ${driver.lastName}`} />
                <Cell third label={labels.dob} value={calendarDate(driver.dob)} />
                <Cell third label={labels.licenceNumber} value={driver.licenceNumber} />
                <Cell third label={labels.licenceCountry} value={driver.licenceCountry} />
                <Cell third label={labels.licenceIssued} value={calendarDate(driver.licenceIssuedOn)} />
                <Cell third label={labels.licenceExpires} value={calendarDate(driver.licenceExpiresOn)} />
              </View>
            </View>
          ))}
        </Section>

        <Section title={labels.payment}>
          <View style={styles.row}>
            <Cell third label={labels.total} value={euros(data.totalCents)} />
            <Cell third label={labels.collected} value={euros(data.collectedCents)} />
            <Cell
              third
              label={labels.method}
              value={data.payMethod ? both(labels.payMethod[data.payMethod]) : null}
            />
          </View>
          <Text style={{ fontWeight: 700 }}>{both(data.paid ? labels.paid : labels.unpaid)}</Text>
        </Section>

        <Section title={labels.condition}>
          <Text style={{ color: PALETTE.soft }}>
            {both(data.marks.length === 0 ? labels.damageNone : labels.damageNote)}
          </Text>

          {viewsWithMarks.length > 0 ? (
            <View style={styles.diagrams}>
              {viewsWithMarks.map((view) => (
                <View key={view} style={styles.diagram}>
                  <Text style={styles.diagramTitle}>{both(labels.view[view])}</Text>
                  <DiagramView view={view} marks={data.marks.filter((m) => m.view === view)} />
                </View>
              ))}
            </View>
          ) : null}

          {data.marks.map((mark) => (
            <Text key={mark.index} style={styles.markLine}>
              {mark.index}. {both(labels.view[mark.view])} · {both(labels.zone[mark.zone]!)}
              {' · '}{both(labels.type[mark.markType])}
              {mark.note ? ` — ${mark.note}` : ''}
            </Text>
          ))}
        </Section>

        <Section title={labels.signature}>
          {data.signature ? (
            <>
              <View style={styles.signatureBox}>
                <Image style={styles.signatureImage} src={Buffer.from(data.signature)} />
              </View>
              <View style={{ ...styles.row, marginTop: 4 }}>
                <Cell label={labels.signedBy} value={data.signerName} />
                <Cell label={labels.signedAt} value={athensDateTime(data.signedAt)} />
              </View>
            </>
          ) : (
            <View style={styles.signatureBox}>
              <Text style={{ color: PALETTE.soft }}>{both(labels.signaturePending)}</Text>
            </View>
          )}
        </Section>

        <Footer labels={labels} />
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.title}>{both(labels.terms)}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{labels.terms.el}</Text>
          <Text style={styles.terms}>
            {data.company.terms_el || labels.termsPending.el}
          </Text>
        </View>

        <View style={styles.section} break={false}>
          <Text style={styles.sectionTitle}>{labels.terms.en}</Text>
          <Text style={styles.terms}>
            {data.company.terms_en || labels.termsPending.en}
          </Text>
        </View>

        {/*
          German terms are supplementary, not part of the required bilingual
          agreement (contractReadiness() never checks terms_de) — so unlike
          the two blocks above, this prints only when the boss has actually
          pasted something in, with no "pending" placeholder for an empty one.
          The heading is the literal word "Deutsch" rather than routed through
          Bilingual/both(), which is hard-coded to an EL/EN pair throughout
          labels.ts.
        */}
        {data.company.terms_de ? (
          <View style={styles.section} break={false}>
            <Text style={styles.sectionTitle}>Deutsch</Text>
            <Text style={styles.terms}>{data.company.terms_de}</Text>
          </View>
        ) : null}

        <Footer labels={labels} />
      </Page>
    </Document>
  )
}

function Section({ title, children }: { title: Bilingual; children: React.ReactNode }) {
  return (
    <View style={styles.section} wrap={false}>
      <Text style={styles.sectionTitle}>{both(title)}</Text>
      {children}
    </View>
  )
}

function Cell({
  label, value, third = false,
}: { label: Bilingual; value: string | null | undefined; third?: boolean }) {
  return (
    <View style={third ? styles.cellThird : styles.cell}>
      <Text style={styles.label}>{both(label)}</Text>
      <Text style={styles.value}>{value && value.length > 0 ? value : '—'}</Text>
    </View>
  )
}

function Footer({ labels }: { labels: ContractLabels }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{both(labels.generated)}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}

/**
 * One view of the car with its marks, drawn from the same shape data the
 * screen uses (src/lib/damage/shapes.ts). The marks are placed from the same
 * relative 0–1 coordinates, so a mark the rep tapped at the desk sits in the
 * same spot on the agreement the guest signs.
 */
function DiagramView({ view, marks }: { view: DamageView; marks: ContractMark[] }) {
  const { shapes, mirrored } = shapesFor(view)
  const w = DIAGRAM_VIEWBOX.width
  const h = DIAGRAM_VIEWBOX.height
  const stroke = { stroke: PALETTE.soft, strokeWidth: 3, fill: 'none' }

  return (
    <Svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 96 }}>
      <G transform={mirrored ? MIRROR_TRANSFORM : undefined}>
        {shapes.map((shape, index) => {
          if (shape.kind === 'path') return <Path key={index} {...stroke} d={shape.d} />
          if (shape.kind === 'circle') {
            return <Circle key={index} {...stroke} cx={shape.cx} cy={shape.cy} r={shape.r} />
          }
          return (
            <Rect
              key={index} {...stroke}
              x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx}
            />
          )
        })}
      </G>
      {marks.map((mark) => (
        <G key={mark.index}>
          <Circle cx={mark.x * w} cy={mark.y * h} r={11} fill={PALETTE.danger} />
          <Text
            x={mark.x * w}
            y={mark.y * h + 5}
            fill="#ffffff"
            style={{ fontSize: 14, fontWeight: 700, textAlign: 'center' }}
          >
            {mark.index}
          </Text>
        </G>
      ))}
    </Svg>
  )
}
