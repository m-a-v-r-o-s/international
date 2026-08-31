/**
 * Passing a deliberate SQL NULL through the generated RPC argument types.
 *
 * `supabase gen types` models a function parameter as NON-NULLABLE when it has
 * no DEFAULT, and as optional-but-still-not-nullable when it has one. Neither
 * shape can express "this parameter takes a null, and the null means
 * something" — which several RPCs here rely on, by design:
 *
 *   · admin_set_home_hotel(id, null)      — "no home hotel" is a legitimate
 *                                            state, said so in 0018.
 *   · admin_resolve_exception(id, null, …) — the boss closes an item with no
 *                                            charge (docs/01-DECISIONS.md §14).
 *   · admin_create_block(…, null)          — a block with no reason typed.
 *   · admin_set_car_notes(id, null)        — clearing the note.
 *   · check_eligibility(…, null, …)        — the missing-licence-date failure
 *                                            §11 exists to catch.
 *
 * For a parameter WITH a default, `?? undefined` is the right answer: omitting
 * the key lets PostgREST apply the default, which is null anyway. For one
 * WITHOUT a default that is not an option — PostgREST resolves an RPC by the
 * set of keys it is given, so omitting the key finds no function at all
 * (PGRST202). The null has to go on the wire, and this is the cast that lets
 * it, named so every site that needs it is greppable and the reason is written
 * down once instead of eight times.
 *
 * If the generator ever learns to model nullable parameters, deleting this
 * function is how you find every site that was working around it.
 */
export function sqlNull<T>(value: T | null | undefined): T {
  return value as T
}
