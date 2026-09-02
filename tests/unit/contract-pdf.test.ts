import { describe, expect, test } from 'vitest'
import { renderContractPdf } from '../../src/lib/contract/render'
import {
  EMPTY_COMPANY, companySchema, contractReadiness, parseCompany, REQUIRED_FOR_CONTRACT,
} from '../../src/lib/contract/company'
import { both, contractLabels, pair } from '../../src/lib/contract/labels'
import { athensTime, calendarDate, euros, type ContractData } from '../../src/lib/contract/data'

// The bilingual agreement (docs/01-DECISIONS.md §16). What is worth asserting
// about a PDF in a test is narrow but load-bearing: that it renders at all
// with Greek in it, that the DRAFT guard cannot be bypassed by an empty
// settings row, and that money and dates cross the render boundary correctly.
//
// The base-14 PDF fonts have NO Greek coverage, so "it rendered" and "the
// Greek is really in there" are different claims. The second one is checked by
// pulling the embedded font's name out of the file: if Noto Sans were not
// embedded, the Greek would be missing glyphs on the page the guest signs and
// nothing else here would notice.

const signaturePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64')

const filled = companySchema.parse({
  legal_name: 'PLACEHOLDER — company legal name not yet supplied',
  address: 'PLACEHOLDER — registered address not yet supplied',
  vat_number: 'PLACEHOLDER',
  phone: 'PLACEHOLDER',
  insurer: 'PLACEHOLDER',
  terms_el: 'Όροι ενοικίασης στα ελληνικά. ',
  terms_en: 'Rental terms in English. ',
})

function contract(over: Partial<ContractData> = {}): ContractData {
  return {
    company: filled,
    draft: false,
    ref: '2026-0417',
    startDate: '2026-07-06',
    endDate: '2026-07-08',
    days: 3,
    pickupAt: '2026-07-06T06:00:00Z',
    dropoffAt: '2026-07-08T17:30:00Z',
    hotelName: 'Hotel Alpha',
    roomNumber: '214',
    plate: 'ABC-1001',
    make: 'Fiat',
    model: 'Panda',
    categoryEl: 'Κατηγορία A',
    categoryEn: 'Category A',
    year: 2024,
    colour: 'white',
    drivers: [
      {
        isMain: true, firstName: 'Άννα', lastName: 'Επισκέπτης', dob: '1985-04-02',
        licenceNumber: 'GR1234567', licenceCountry: 'GR',
        licenceIssuedOn: '2010-06-01', licenceExpiresOn: '2032-06-01',
      },
      {
        isMain: false, firstName: 'Second', lastName: 'Driver', dob: '1990-01-01',
        licenceNumber: 'DE998877', licenceCountry: 'DE',
        licenceIssuedOn: '2012-01-01', licenceExpiresOn: '2030-01-01',
      },
    ],
    fuelOutEighths: 8,
    marks: [
      { view: 'front', x: 0.25, y: 0.5, zone: 'midLeft', markType: 'scratch', note: 'bumper', index: 1 },
      { view: 'left', x: 0.7, y: 0.3, zone: 'topRight', markType: 'dent', note: null, index: 2 },
    ],
    total: 90,
    collected: 90,
    payMethod: 'cash',
    paid: true,
    signature: new Uint8Array(signaturePng),
    signerName: 'Άννα Επισκέπτης',
    signedAt: '2026-07-06T06:12:00Z',
    ...over,
  }
}

describe('the agreement renders', () => {
  test('to a real PDF, with a Greek-capable font embedded in it', async () => {
    const bytes = await renderContractPdf(contract())
    const text = Buffer.from(bytes).toString('latin1')

    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-')
    expect(bytes.byteLength).toBeGreaterThan(5_000)

    // The subset the renderer embedded. Without it there is no Greek on the
    // page, and `font-src 'self'` in src/proxy.ts means it can never be
    // fetched at display time either — it has to be in the file.
    expect(text).toMatch(/NotoSans/)
  }, 30_000)

  test('with no signature, and with no damage at all', async () => {
    const unsigned = await renderContractPdf(
      contract({ signature: null, signerName: null, signedAt: null, marks: [] }))
    expect(Buffer.from(unsigned.subarray(0, 5)).toString()).toBe('%PDF-')
  }, 30_000)

  test('when the settings row is completely empty — as a stamped draft', async () => {
    // The state the app is actually in today: client items 5 and 7 have not
    // arrived, so this is the document the machinery produces until they do.
    const draft = await renderContractPdf(contract({ company: EMPTY_COMPANY, draft: true }))
    expect(Buffer.from(draft.subarray(0, 5)).toString()).toBe('%PDF-')
  }, 30_000)
})

describe('an unfilled settings row cannot become a signable agreement', () => {
  test('an empty company is not ready, and says exactly what is missing', () => {
    const readiness = contractReadiness(EMPTY_COMPANY)
    expect(readiness.ready).toBe(false)
    if (readiness.ready) return
    expect(readiness.missing).toEqual([...REQUIRED_FOR_CONTRACT])
  })

  test('every required field is required on its own', () => {
    for (const field of REQUIRED_FOR_CONTRACT) {
      const readiness = contractReadiness({ ...filled, [field]: '' })
      expect(readiness.ready, field).toBe(false)
      if (readiness.ready) continue
      expect(readiness.missing, field).toEqual([field])
    }
  })

  test('the optional fields really are optional', () => {
    expect(contractReadiness({ ...filled, email: '', insurance_policy: '' }).ready).toBe(true)
  })

  test('whitespace is not a value — a spacebar does not fill a legal field', () => {
    expect(contractReadiness(companySchema.parse({ ...filled, vat_number: '   ' })).ready).toBe(false)
  })

  test('a column holding anything unexpected reads as empty, not as a crash', () => {
    expect(parseCompany(null)).toEqual(EMPTY_COMPANY)
    expect(parseCompany('nonsense')).toEqual(EMPTY_COMPANY)
    expect(parseCompany({ legal_name: 42 })).toEqual(EMPTY_COMPANY)
    expect(parseCompany({ legal_name: 'Real Co' }).legal_name).toBe('Real Co')
  })
})

describe('both languages are on the same document', () => {
  test('every label resolves in Greek and in English', () => {
    const labels = contractLabels()
    const flat = JSON.stringify(labels)
    // lookup() renders a missing key as [path], so this catches a label that
    // exists in one catalogue and not the other before it reaches a contract.
    expect(flat).not.toMatch(/\[[a-z]+\./i)
  })

  test('a label prints as "Greek / English", and collapses when they match', () => {
    expect(both({ el: 'Όχημα', en: 'Vehicle' })).toBe('Όχημα / Vehicle')
    expect(both({ el: 'Email', en: 'Email' })).toBe('Email')
  })

  test('the title really is Greek in one catalogue and English in the other', () => {
    const title = pair('contract.title')
    expect(title.el).toMatch(/[Ͱ-Ͽ]/)   // Greek block
    expect(title.en).not.toMatch(/[Ͱ-Ͽ]/)
  })
})

describe('the render boundary', () => {
  test('money is a whole euro integer until exactly here', () => {
    expect(euros(90)).toBe('€90')
    expect(euros(5)).toBe('€5')
    expect(euros(0)).toBe('€0')
    expect(euros(null)).toBe('—')
  })

  test('a calendar date stays a calendar date — no timezone shift', () => {
    // `start_date` is a `date`, not an instant. Parsing it into a Date would
    // move it by the machine's UTC offset, which is the one class of bug the
    // inclusive-day rule cannot afford (HANDOFF.md).
    expect(calendarDate('2026-07-06')).toBe('06/07/2026')
    expect(calendarDate(null)).toBe('—')
  })

  test('pick-up and drop-off times print in Athens time', () => {
    // 06:00 UTC in July is 09:00 in Athens — inside the 08:30–11:30 window.
    expect(athensTime('2026-07-06T06:00:00Z')).toBe('09:00')
    expect(athensTime(null)).toBe('—')
  })
})
