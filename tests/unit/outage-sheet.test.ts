import { describe, expect, test } from 'vitest'
import { buildOutageSheet, type OutageSheetData } from '../../src/lib/outage-sheet'

const base: OutageSheetData = {
  today: '2027-06-10',
  bookings: [],
  blocks: [],
  cars: [
    { id: 'c1', plate: 'HKA 1001', model_id: 'm1' },
    { id: 'c2', plate: 'HKA 1002', model_id: 'm1' },
    { id: 'c3', plate: 'HKA 1003', model_id: 'm1' },
    { id: 'c4', plate: 'HKA 1004', model_id: 'm1' },
  ],
  models: [{ id: 'm1', make: 'Fiat', model: 'Panda', category_id: 'g1' }],
  categories: [{ id: 'g1', code: 'A' }],
  hotels: [{ id: 'h1', name: 'Hotel Kos' }],
  reps: [{ id: 'r1', full_name: 'Maria', phone: '6900000000' }],
  hotelReps: [{ hotel_id: 'h1', profile_id: 'r1' }],
}

const booking = (over: Partial<OutageSheetData['bookings'][number]>) => ({
  ref: '2027-0001', status: 'booked', car_id: 'c1', hotel_id: 'h1', adhoc_hotel_name: null,
  room_number: '12', start_date: '2027-06-11', end_date: '2027-06-15', pickup_at: null, dropoff_at: null,
  cust_first: 'Anna', cust_last: '<Smith>', cust_phone: '+44 7700', total: 200, collected: 50,
  paid: false, created_by: 'r1', ...over,
})

describe('the outage sheet', () => {
  test('is not built when nothing happens in the window', () => {
    // A pickup a week out is not the next 48 hours' business.
    expect(buildOutageSheet({ ...base, bookings: [booking({ start_date: '2027-06-20', end_date: '2027-06-25' })] })).toBeNull()
    expect(buildOutageSheet(base)).toBeNull()
  })

  test('lists pickups, returns and cars out, and only whole-window free cars', () => {
    const sheet = buildOutageSheet({
      ...base,
      bookings: [
        booking({}),
        booking({ ref: '2027-0002', status: 'out', car_id: 'c2', start_date: '2027-06-01', end_date: '2027-06-12' }),
        booking({ ref: '2027-0003', status: 'out', car_id: 'c3', start_date: '2027-06-01', end_date: '2027-06-30' }),
      ],
      blocks: [],
    })!
    expect(sheet).not.toBeNull()
    expect(sheet.html).toContain('&lt;Smith&gt;')
    expect(sheet.html).not.toContain('<Smith>')
    expect(sheet.html).toContain('Παραλαβές (1)')
    expect(sheet.html).toContain('Επιστροφές (1)')
    expect(sheet.html).toContain('Έξω, επιστρέφουν αργότερα (1)')
    expect(sheet.html).toContain('€150')
    expect(sheet.csv).toContain('Ελεύθερο;A;;;;;;;HKA 1004;Fiat Panda;;')
    expect(sheet.csv).not.toContain('Ελεύθερο;A;;;;;;;HKA 1001')
    expect(sheet.text).toContain('Maria 6900000000')
  })

  test('a block in the window takes a car off the free list', () => {
    const sheet = buildOutageSheet({
      ...base,
      bookings: [booking({})],
      blocks: [{ car_id: 'c4', start_date: '2027-06-12', end_date: '2027-06-12' }],
    })!
    expect(sheet.csv).not.toContain('HKA 1004')
    expect(sheet.csv).toContain('HKA 1003')
  })
})
