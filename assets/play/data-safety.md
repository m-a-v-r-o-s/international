# Play Console: Data safety answers

Transcribe these into Play Console, App content, Data safety. They are derived
from `db/schema.sql`, the migrations that have moved past it, and
`docs/01-DECISIONS.md` §25 and §25a, not from what would be convenient to
answer.

**Getting this form wrong is a takedown, not a warning.** Nothing below is
softened, and nothing is answered "no" because "yes" invites a follow-up
question. Two of the answers (photographs of a government ID, and a
handwritten signature) are in Play's sensitive categories and are declared as
such on purpose.

## The one thing to understand before answering

The people who install this app are 11 staff. Most of the data it handles is
about somebody else: the guest renting the car, who never installs anything.
Play's definition of collection is transmission off the device, and a guest's
licence photograph is transmitted off the device, so it is collected and it is
declared. Answering only for the staff would be the wrong reading of the form
and the expensive one.

---

## Section 1: Data collection and security

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes.** HTTPS everywhere, HTTP redirected, HSTS set, and the security headers in `src/proxy.ts` include `upgrade-insecure-requests` in production. |
| Do you provide a way for users to request that their data be deleted? | **Yes.** See "Deletion" at the bottom of this file. |
| Has your app committed to following the Play Families Policy? | **No.** Target audience is adults; this is a workplace tool. |
| Has your app's data collection been independently reviewed against a global security standard? | **No.** Do not tick this. There has been no third-party audit. |

---

## Section 2: Data types

For every type below the answers to the four repeated sub-questions are:

- **Collected:** yes
- **Shared:** **no**, for all of them, without exception. Nothing leaves the
  company's own Supabase project and its transactional mail sender. There is no
  analytics SDK, no advertising SDK and no crash-reporting SDK in this app;
  `package.json` has no such dependency and nothing is sent to a third party for
  their own purposes.
- **Processed ephemerally:** no. It is stored.
- **Purpose:** App functionality (and Account management where noted).

### Personal info

| Data type | Collected | Required or optional | What it actually is | Where it lives |
|---|---|---|---|---|
| Name | Yes | Required | The renting guest and every additional driver; the staff member's own name | `bookings.cust_first/cust_last`, `booking_drivers.first_name/last_name`, `contracts.signer_name`, `customers`, `profiles.full_name` |
| Email address | Yes | Optional | Where the signed rental agreement is sent, if the guest wants it; the staff sign-in address | `bookings.cust_email`, `contracts.emailed_to`, `customers.email`, `auth.users.email` |
| Phone number | Yes | Required | The guest's number, and the key the customer ledger is built on | `bookings.cust_phone`, `bookings.cust_phone_e164`, `customers.phone_e164`, `profiles.phone` |
| Address | Yes | Optional | The hotel and room number the guest is staying at for the rental. Not a home address, but it is where a person is, so it is declared. | `bookings.hotel_id`, `bookings.room_number`, `bookings.adhoc_hotel_name` |
| User IDs | Yes | Required | Account identifiers for the 11 staff accounts | `auth.users.id`, `profiles.id` |
| Other info | Yes | Required | **Date of birth, and driving licence details: number, issuing country, issue date, expiry date.** A driving licence is a government ID. Say so in the free-text description on this row rather than leaving it to be discovered. | `bookings.cust_dob`, `booking_drivers.dob/licence_number/licence_country/licence_issued_on/licence_expires_on`, `customers` |

### Financial info

| Data type | Collected | Required or optional | What it actually is |
|---|---|---|---|
| Purchase history | Yes | Required | The rental total, what was collected, and whether it was cash, card or transfer. `bookings.total`, `bookings.collected`, `bookings.pay_method`, `bookings.paid`, `bookings.fuel_charge` |
| Payment info | **No** | | No card number, no bank detail and no payment credential ever reaches this app. Card payments are taken on a separate Wrapp POS terminal that is out of band; the app records only that the money was taken. Answer "no" here and be able to say why. |
| Credit score | No | | |
| Other financial info | No | | |

### Photos and videos

| Data type | Collected | Required or optional | What it actually is |
|---|---|---|---|
| Photos | Yes | Required | **Photographs of a driving licence, front and back** (`booking_drivers.front_image_path/back_image_path`, `customers.licence_front_path/licence_back_path`); **the guest's handwritten signature**, captured on screen and stored as an image (`contracts.signature_path`); photographs of damage to a car (`damage_marks.photo_path`, `incident_photos`). The first two are the sensitive ones. |
| Videos | No | | |

### Files and docs

| Data type | Collected | Required or optional | What it actually is |
|---|---|---|---|
| Files and docs | Yes | Required | The generated rental agreement PDF, which contains the guest's name, licence details and signature (`contracts.pdf_path`) |

### App activity

| Data type | Collected | Required or optional | What it actually is |
|---|---|---|---|
| App interactions | Yes | Required | Every write is audit-logged: who did it, to what, before and after, and when (`audit_log`). It exists so the owner can see what his staff changed, and it is stated rather than hidden. |
| Other user-generated content | Yes | Optional | Free text staff type about a rental: damage notes, exception detail, incident description |
| In-app search history | No | | |
| Installed apps | No | | |
| Other actions | No | | |

### Device or other IDs

| Data type | Collected | Required or optional | What it actually is |
|---|---|---|---|
| Device or other IDs | Yes | Required | A rep's device is bound to their account so a stolen PIN on a new phone does not walk straight in: an app-generated device identifier plus the browser user-agent string (`rep_devices.device_id`, `rep_devices.user_agent`). A hash of the request IP is also written to the security log on failed sign-ins. |

### Everything else: answer No

Location, Health and fitness, Messages, Audio files, Calendar, Contacts, Web
browsing history, App info and performance (no crash logs, no diagnostics, no
performance SDK).

Location deserves a sentence, because it is the one somebody will second-guess:
the app records which **hotel** a rental was arranged at, which is a business
location and is declared above under Address. It does not read the device's
location, has no location permission, and never will as long as that stays true.

---

## Deletion, and why this answer is a fact rather than a promise

Play asks whether users can request deletion. Yes, and there are three separate
mechanisms, all of which exist in code today:

1. **Licence photographs auto-delete.** An admin-set retention window, defaulting
   to **24 months after the rental ends** (`app_settings.licence_retention_months`,
   `docs/01-DECISIONS.md` §25), swept by `src/lib/retention/purge.ts`. The sweep
   deletes the object through the Storage API rather than only its metadata row,
   so the file itself goes. Every purge is logged and each driver row is stamped
   `images_purged_at`.
2. **The customer ledger is consent-based and withdrawal really deletes.** A guest
   is only in it if they ticked a separate, unticked-by-default box beside their
   signature (§25a). Un-ticking on a later signature calls
   `withdraw_customer_consent`, and when their last consenting booking goes the
   customer row is dropped by trigger. The owner can also clear the whole ledger.
3. **On request, by the company.** This is an 11-person staff tool with no public
   signup, so a deletion request arrives by email or in person, not through an
   in-app button. Give the company's contact address in the deletion-request URL
   field, the same one the privacy policy at `https://<domain>/privacy` carries.

Do not claim an in-app self-service deletion flow. There is not one, and there
does not need to be for this app, but claiming it would be the kind of small
inaccuracy this form treats as a large one.

---

## Two things to check again before submitting

- **The retention window is admin-editable.** If the owner has changed it from 24
  months, the number in the listing and the privacy policy has to change with it.
- **§25a records that ledger retention is manual, with no automatic expiry**, and
  that this was the owner's decision against advice. The privacy policy has to
  say in writing that consented customer records are kept until manually cleared.
  Do not let this form and that page disagree.
