import 'server-only'

import { hash, verify } from '@node-rs/argon2'

/**
 * The device PIN, hashed with argon2id — the same treatment as a password, not
 * a fast hash. A four-digit PIN has a small keyspace, so the slow hash matters
 * and so does the rate limit on the unlock attempt that calls this.
 */
// @node-rs/argon2 defaults to argon2id; these are the OWASP-recommended
// parameters for it. Both hashing and verification must pass the same values.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 }

export const PIN_MIN = 4
export const PIN_MAX = 8

export function isWellFormedPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin)
}

/**
 * What a rep may CHOOSE, which is narrower than what the login field will
 * accept (docs/01-DECISIONS.md §38).
 *
 * isWellFormedPin() above is the reader: it takes four to eight digits, because
 * accounts exist that were issued a PIN under the old rules and a login screen
 * that stopped accepting them would lock those reps out. This is the writer, and
 * it is exactly six — the length generatePin() has always minted, and the length
 * §32's arithmetic is about. That arithmetic is the reason the rule exists: the
 * rate limit caps an address at ~768 guesses a day, which is years against a
 * keyspace of a million and under a fortnight against the ten thousand a
 * four-digit PIN would leave. Letting a rep shorten their own PIN would hand
 * them a way to undo the one number that makes the whole scheme hold.
 */
export const CHOSEN_PIN_LENGTH = 6

export function isChosenPinLength(pin: string): boolean {
  return new RegExp(`^\\d{${CHOSEN_PIN_LENGTH}}$`).test(pin)
}

/**
 * The other half of that arithmetic, and the half that is genuinely new.
 *
 * Every PIN in this system until now came from crypto.randomInt (accounts.ts),
 * so "a million possibilities" was a fact about the PIN rather than a hope. A
 * PIN a person chooses is not uniform over that million and never will be —
 * people pick runs, repeats, and their birthday. An attacker with 768 guesses a
 * day does not walk the keyspace in order; they try the few hundred strings that
 * real people actually pick, and against those the rate limit buys days, not
 * years.
 *
 * So the shapes that concentrate the most guesses are refused. This is not a
 * strength meter and does not pretend to be: it cannot know that a rep picked
 * their own year of birth, and it does not try. It removes the handful of
 * strings that would otherwise be the first ones tried, which is the part that
 * is worth doing and the only part that can be done without asking a rep at a
 * hotel desk to memorise something they will write on a sticky note instead.
 */
export function isPredictablePin(pin: string): boolean {
  if (!isChosenPinLength(pin)) return false  // a length problem, reported as one

  // 000000, 111111 … and 121212, 123123: any PIN built by repeating a shorter
  // block. Covers all-one-digit as the block-of-1 case.
  for (const size of [1, 2, 3]) {
    const block = pin.slice(0, size)
    if (block.repeat(CHOSEN_PIN_LENGTH / size) === pin) return true
  }

  // 123456 and 654321, and every run in between — built and compared rather
  // than walked, so there is no digit-by-digit arithmetic to get wrong. Steps
  // of ±1 only, and no wrap at 9: 135791 is regular too and 890123 does contain
  // a run, but neither is a string somebody reaches for first.
  const start = Number(pin[0])
  for (const step of [1, -1]) {
    const run = Array.from({ length: CHOSEN_PIN_LENGTH }, (_, i) => start + i * step)
    if (run.every((d) => d >= 0 && d <= 9) && run.join('') === pin) return true
  }

  // The rest of the short list of PINs that turn up at the top of every leaked
  // set, and that none of the rules above catch.
  return ['112233', '123321', '696969', '159753', '147258', '102030'].includes(pin)
}

export async function hashPin(pin: string): Promise<string> {
  return hash(pin, OPTIONS)
}

export async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  try {
    return await verify(stored, pin, OPTIONS)
  } catch {
    return false
  }
}
