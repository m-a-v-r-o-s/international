'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { CarWithSpecs } from '@/lib/availability/types'

/**
 * The car choice on R3 and R3b, in three steps: group, model, plate. The group
 * is optional and only narrows the model list; the plate list stays locked
 * until a model is chosen. Only the plate is the answer: the caller owns
 * `carId` and posts it.
 */
export function CarPicker({
  cars, carId, onChange,
}: {
  cars: CarWithSpecs[]
  carId: string
  onChange: (carId: string) => void
}) {
  const t = useTranslations('newBooking')
  const initial = cars.find((c) => c.id === carId)
  const [groupId, setGroupId] = useState('')
  const [modelId, setModelId] = useState(initial?.model_id ?? '')

  const groups = [...new Map(cars.map((c) => [c.category_id, c.category_code])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
  const models = [...new Map(
    cars.filter((c) => !groupId || c.category_id === groupId)
      .map((c) => [c.model_id, `${c.make} ${c.model} (${c.category_code})`]),
  ).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const plates = cars.filter((c) => c.model_id === modelId)

  const pickModel = (id: string) => {
    setModelId(id)
    onChange('')
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="ir-label" htmlFor="car_group">{t('carGroup')}</label>
        <select
          id="car_group" className="ir-field" value={groupId}
          onChange={(e) => {
            setGroupId(e.target.value)
            if (e.target.value && !cars.some((c) => c.model_id === modelId && c.category_id === e.target.value)) {
              pickModel('')
            }
          }}
        >
          <option value="">{t('anyGroup')}</option>
          {groups.map(([id, code]) => <option key={id} value={id}>{code}</option>)}
        </select>
      </div>
      <div>
        <label className="ir-label" htmlFor="car_model">{t('carModel')} *</label>
        <select
          id="car_model" className="ir-field" value={modelId} required
          onChange={(e) => pickModel(e.target.value)}
        >
          <option value="" disabled>{t('chooseModel')}</option>
          {models.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <div>
        <label className="ir-label" htmlFor="car_id">{t('carPlate')} *</label>
        <select
          id="car_id" className="ir-field" value={carId} required disabled={!modelId}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="" disabled>{t('choosePlate')}</option>
          {plates.map((c) => <option key={c.id} value={c.id}>{c.plate}</option>)}
        </select>
      </div>
    </div>
  )
}
