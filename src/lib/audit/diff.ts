/**
 * What changed in one audit entry.
 *
 * Pure and free of any server import, so the rule is unit-testable without a
 * database — the same reasoning as src/lib/storage/paths.ts.
 *
 * The log stores whole rows in `before` and `after`, minus whatever
 * app.audit_redact() stripped. A9 shows the DIFFERENCE, because a screen that
 * prints two forty-column rows side by side is a screen nobody reads, and the
 * question the boss brings to an audit log is always "what changed".
 */
export type AuditRow = {
  id: number
  at: string
  actor_id: string | null
  actor_name: string | null
  entity: string
  entity_id: string | null
  action: 'insert' | 'update' | 'delete'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

export type FieldChange = {
  field: string
  from: string | null
  to: string | null
}

/**
 * Long values are truncated rather than shown in full. `app_settings.company`
 * holds the entire bilingual contract terms, so one edit to it would otherwise
 * print twenty thousand characters twice and bury every other entry on the
 * page.
 */
export const MAX_VALUE_LENGTH = 160

export function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text === undefined) return null
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text
}

/**
 * `updated_at` moves on every write by definition and says nothing about what
 * the actor did, so it is not a change worth a row on screen. `id` never
 * changes. Everything else is reported, including nulls in either direction.
 */
const NOT_A_CHANGE = new Set(['updated_at', 'id'])

export function changedFields(row: AuditRow): FieldChange[] {
  const before = row.before ?? {}
  const after = row.after ?? {}

  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => !NOT_A_CHANGE.has(field))
    .sort()

  const changes: FieldChange[] = []
  for (const field of fields) {
    const from = formatValue(before[field])
    const to = formatValue(after[field])

    // An insert has no `before` and a delete has no `after`, so every field is
    // reported for those. For an update, only what actually moved: the trigger
    // already refuses to log an update that changed nothing, but a single
    // changed column in a forty-column row still arrives with all forty.
    if (row.action === 'update' && from === to) continue
    if (from === null && to === null) continue

    changes.push({ field, from, to })
  }
  return changes
}
