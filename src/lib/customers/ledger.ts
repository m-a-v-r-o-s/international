/**
 * The phrase the boss types to empty the customer ledger
 * (docs/01-DECISIONS.md §25a).
 *
 * It lives in a plain module rather than beside the action that checks it,
 * because a `'use server'` file may only export async functions — a bare
 * `const` there is a build error. It also has to be reachable from the client
 * component that renders the input, and from the action, and it must equal
 * what public.admin_clear_customer_ledger() compares against. One definition,
 * three readers.
 *
 * NOT TRANSLATED, deliberately. The screen around it is bilingual; this is
 * not. A confirmation phrase that changed with the interface language would
 * work in Greek and fail in English, and a language switch would silently
 * redefine what the boss has to type to delete every customer record in the
 * business.
 */
export const CLEAR_LEDGER_PHRASE = 'ERASE-ALL'
