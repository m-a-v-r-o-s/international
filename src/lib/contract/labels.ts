import el from '../../../messages/el.json'
import en from '../../../messages/en.json'

/**
 * The contract's own wording, in BOTH languages at once.
 *
 * §16 and §24 are explicit: the agreement is bilingual on the same document,
 * always. That makes it the one screen in this app that does not switch
 * languages — it needs Greek and English side by side in the same render — so
 * next-intl's per-request locale is the wrong instrument, and the two
 * catalogues are read directly instead.
 *
 * They are still the catalogues, not a private word list: every string below
 * lives in messages/el.json and messages/en.json under `contract`, and
 * tests/unit/messages-parity.test.ts holds them to exact key parity like
 * everything else. Nothing user-facing is hard-coded here either.
 */
export type Bilingual = { el: string; en: string }

type Catalogue = Record<string, unknown>

function lookup(tree: Catalogue, path: string): string {
  const value = path.split('.').reduce<unknown>(
    (node, key) => (node && typeof node === 'object' ? (node as Catalogue)[key] : undefined), tree)
  // A missing key is a bug in the catalogue, and it should look like one on
  // the page rather than silently printing an empty label on a legal document.
  return typeof value === 'string' ? value : `[${path}]`
}

/** One label, in both languages, from the same key in each catalogue. */
export function pair(path: string): Bilingual {
  return { el: lookup(el as Catalogue, path), en: lookup(en as Catalogue, path) }
}

/** "Ελληνικά / English" — how every label prints on the document. */
export function both(label: Bilingual): string {
  return label.el === label.en ? label.el : `${label.el} / ${label.en}`
}

/** Every label the document uses, resolved once so the renderer stays dumb. */
export function contractLabels() {
  const c = (key: string) => pair(`contract.${key}`)
  return {
    title: c('title'),
    draftTitle: c('draftTitle'),
    draftBody: c('draftBody'),
    ref: c('ref'),
    lessor: c('lessor'),
    vat: c('vat'),
    phone: c('phone'),
    email: c('email'),
    insurer: c('insurer'),
    policy: c('policy'),
    rental: c('rental'),
    pickupDate: c('pickupDate'),
    returnDate: c('returnDate'),
    days: c('days'),
    pickupTime: c('pickupTime'),
    returnTime: c('returnTime'),
    hotel: c('hotel'),
    room: c('room'),
    vehicle: c('vehicle'),
    plate: c('plate'),
    makeModel: c('makeModel'),
    category: c('category'),
    year: c('year'),
    colour: c('colour'),
    fuelOut: c('fuelOut'),
    drivers: c('drivers'),
    mainDriver: c('mainDriver'),
    additionalDriver: c('additionalDriver'),
    name: c('name'),
    dob: c('dob'),
    licenceNumber: c('licenceNumber'),
    licenceCountry: c('licenceCountry'),
    licenceIssued: c('licenceIssued'),
    licenceExpires: c('licenceExpires'),
    payment: c('payment'),
    total: c('total'),
    collected: c('collected'),
    method: c('method'),
    paid: c('paid'),
    unpaid: c('unpaid'),
    condition: c('condition'),
    damageNone: c('damageNone'),
    damageNote: c('damageNote'),
    terms: c('terms'),
    termsPending: c('termsPending'),
    signature: c('signature'),
    signedBy: c('signedBy'),
    signedAt: c('signedAt'),
    signaturePending: c('signaturePending'),
    generated: c('generated'),
    view: {
      front: pair('damage.view.front'),
      rear: pair('damage.view.rear'),
      left: pair('damage.view.left'),
      right: pair('damage.view.right'),
      top: pair('damage.view.top'),
    },
    type: {
      scratch: pair('damage.type.scratch'),
      dent: pair('damage.type.dent'),
      chip: pair('damage.type.chip'),
      crack: pair('damage.type.crack'),
      other: pair('damage.type.other'),
    },
    zone: Object.fromEntries(([
      'topLeft', 'topCentre', 'topRight',
      'midLeft', 'midCentre', 'midRight',
      'bottomLeft', 'bottomCentre', 'bottomRight',
    ] as const).map((z) => [z, pair(`damage.zone.${z}`)])) as Record<string, Bilingual>,
    payMethod: {
      cash: pair('admin.bookings.payMethodCash'),
      card: pair('admin.bookings.payMethodCard'),
      transfer: pair('admin.bookings.payMethodTransfer'),
    },
  }
}

export type ContractLabels = ReturnType<typeof contractLabels>
