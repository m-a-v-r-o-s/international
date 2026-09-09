# Part C drafts

`docs/08-PLAY-STORE.md` Part C is the half of the Play Store plan that only Akos
can do, because every item on it happens in a browser, signed in as him. Nothing
here has been done on his behalf: no developer account has been registered, no
D-U-N-S number has been applied for or looked up, and no message has been sent
to anybody.

What is here is the material that turns each of those into a five minute job:
the account decision argued out, two messages ready to send, and the list of
Play Console fields with a pointer to whatever is already drafted for each.

---

## 1. Personal or organization account

**Recommendation: organization account, internal testing track.** This is the
same recommendation `docs/08-PLAY-STORE.md` section 0 makes, and the reasons are
worth having in one paragraph before paying the $25.

**Both cost the same $25, once.** The price is not the variable.

**The organization account needs a D-U-N-S number for Akos Digital Services.**
That is the only real cost of choosing it, and it is a cost in time, not money.
See the next section.

**It sidesteps the 12 tester rule entirely.** A personal developer account
created after 13 November 2023 cannot apply for production access until it has
run a closed test with 12 testers opted in for 14 *continuous* days. One tester
dropping out on day 7 resets the counter. This business has one boss and 6 to 10
seasonal reps, so satisfying that rule would mean recruiting strangers to install
an internal staff tool. An organization account is not subject to it. Production
is not the target today, but choosing personal now is choosing to be stuck later.

**It puts the company on the listing instead of Akos's home address.** A personal
developer account publishes the developer's own name and physical address on the
public store listing. An organization account publishes the company's. This one
is not reversible in any comfortable way, so it is worth getting right the first
time.

**Nothing about the app changes either way.** The AAB is identical, the internal
testing track is identical, and production stays available later without a
rebuild. Only the account under it differs.

### Checking whether Akos Digital Services already has a D-U-N-S number

**This has not been checked.** It needs Akos, and it is the first thing to do,
because it is the longest pole in the whole plan.

1. Open the D&B lookup: **https://www.dnb.com/duns-number/lookup.html**
2. Set the country to **Greece**, and search for the company under its
   **registered legal name**, not its trading name. Google matches the Play
   Console entry against the D-U-N-S record, so the name, address and phone have
   to agree with what is on the ΑΦΜ registration. If "Akos Digital Services" is a
   trading name over a differently registered entity, search the registered one.
3. If a record comes back, note the number. That is the whole task, and the
   organization account can be registered the same day.
4. If nothing comes back, request one from the same page. It is **free**.

**Worst case if there is no existing number: up to 30 business days.** That is
roughly six weeks of calendar time, and it runs entirely in parallel with
everything else, which is exactly why it goes first. Requesting one costs nothing
and cannot be a wasted move, so if step 3 is at all ambiguous, request.

Google's own page on the requirement, for the exact wording Play Console will
use: **https://support.google.com/googleplay/android-developer/answer/13628312**

---

## 2. To the client: the domain (client item 8)

Ready to send. The framing is deliberate and follows `docs/08-PLAY-STORE.md`
Part C item 3: the Play Store is the smaller half of what this blocks. The same
missing domain blocks custom SMTP, and custom SMTP is what blocks the boss being
able to sign in at all (`docs/06-IMPLEMENTATION-NOTES.md`, the `{{ .Token }}`
item). Said as a Play Store request it sounds like paperwork. Said as "you
cannot log in" it is the truth.

Replace `[όνομα]` / `[name]` before sending.

### Ελληνικά

> **Θέμα: Το domain της εταιρείας**
>
> Γεια σας [όνομα],
>
> Μας λείπει ακόμη ένα πράγμα από εσάς για να προχωρήσουμε: το domain της
> εταιρείας. Είναι το νούμερο 8 στη λίστα που είχαμε συμφωνήσει.
>
> Δεν αφορά μόνο το Play Store. Η εφαρμογή σάς στέλνει τον κωδικό σύνδεσης με
> email, και αυτό το email μπορεί να σταλεί μόνο από δικό σας domain. Όσο δεν
> υπάρχει domain, εσείς δεν μπορείτε να συνδεθείτε καθόλου στην εφαρμογή. Οι
> συνεργάτες μπορούν, γιατί μπαίνουν με PIN. Εσείς όχι.
>
> Όλα τα υπόλοιπα από τη δική μας πλευρά είναι έτοιμα και το περιμένουν.
>
> Αν έχετε ήδη domain, στείλτε μας το και το συνδέουμε. Αν όχι, πείτε μας ποιο
> όνομα θέλετε και το κατοχυρώνουμε εμείς.
>
> Ευχαριστώ.

### English

> **Subject: The company domain**
>
> Hello [name],
>
> There is still one thing we need from you to move forward: the company domain.
> It is number 8 on the list we agreed.
>
> This is not only about the Play Store. The app sends your sign-in code by
> email, and that email can only be sent from a domain of your own. Until the
> domain exists, you cannot sign in to the app at all. The reps can, because they
> sign in with a PIN. You cannot.
>
> Everything else on our side is ready and waiting on it.
>
> If you already own a domain, send it to us and we will connect it. If not, tell
> us the name you want and we will register it.
>
> Thank you.

---

## 3. To the reps: Google account emails

Ready to send. Internal testing adds testers by Google account, so an address
that is not a Google account cannot be invited at all. Better to find that out
now than on install day with a rep standing at a hotel desk.

The one line worth keeping is the reassurance that this does not change how they
sign in. They still use their PIN. The Google account is only how Google delivers
the app.

### Ελληνικά

> Γεια σας,
>
> Ετοιμάζουμε την εφαρμογή για εγκατάσταση στα κινητά σας μέσω Play Store.
>
> Στείλτε μου το **email του λογαριασμού σας Google**, δηλαδή αυτό με το οποίο
> μπαίνετε στο Play Store στο κινητό σας. Συνήθως τελειώνει σε `@gmail.com`.
>
> Πρέπει να είναι λογαριασμός Google. Διεύθυνση Apple (`@icloud.com`) ή Outlook
> (`@hotmail.com`, `@outlook.com`) δεν δουλεύει, γιατί η πρόσκληση δίνεται μέσα
> από το Play Store και το Play Store αναγνωρίζει μόνο λογαριασμούς Google.
>
> Δεν αλλάζει τίποτα στον τρόπο που μπαίνετε στην εφαρμογή. Θα συνεχίσετε με το
> PIN σας. Το email χρειάζεται μόνο για να σας φτάσει η εφαρμογή.
>
> Ευχαριστώ.

### English

> Hello,
>
> We are getting the app ready to install on your phones through the Play Store.
>
> Please send me the **email address of your Google account**, that is, the one
> you use to sign in to the Play Store on your phone. It usually ends in
> `@gmail.com`.
>
> It has to be a Google account. An Apple address (`@icloud.com`) or an Outlook
> one (`@hotmail.com`, `@outlook.com`) will not work, because the invitation is
> delivered inside the Play Store and the Play Store only recognises Google
> accounts.
>
> Nothing changes about how you sign in to the app. You will still use your PIN.
> The email is only how the app reaches you.
>
> Thank you.

---

## 4. Play Console fields, and what is already drafted for each

Everything below is filled in by Akos, in the browser, once the account is
verified and the AAB from Part B exists. The point of this list is that almost
none of it needs to be thought about at the keyboard: the answers are already
written down.

| Play Console field | Where the answer already is | Note |
|---|---|---|
| **App access** | Nothing drafted. Needs a live demo account | See below. Do not skip |
| **Data safety** | `assets/play/data-safety.md` | Transcribe it. Do not re-derive it |
| **Content rating** | Questionnaire, answered live | No violence, no user content, no gambling |
| **Target audience** | Adults only, 18+ | Not designed for or appealing to children |
| **Ads** | None | The app contains no ads and no ad SDK |
| **Financial features** | None | See below |
| **Privacy policy URL** | `https://<domain>/privacy` | Page exists at `src/app/(public)/privacy` |
| **App name, short and full description** | `assets/play/listing.md` (A8) | Both languages, counts already measured |
| **Phone screenshots** | `assets/play/screenshots/` (A6) | 4 English, 4 Greek, 824x1830 |
| **Feature graphic** | `assets/play/feature-graphic.png` (A7) | 1024x500 |
| **App icon** | `public/icon-512.png` | Generated by `scripts/gen-app-icons.mjs` |

### App access, in more detail

**This is the one that gets an otherwise finished submission rejected.** Every
screen in this app is behind a login. A reviewer who opens it without credentials
sees a login wall, cannot see the app at all, and rejects it.

So: provide a **working demo rep account** against seed data, with its PIN, and
write in the instructions field that the app is an internal staff tool for one
rent-a-car company with no public sign-up. The account has to still work when the
review happens, which can be days later, so it is not something to create and
then tidy away.

### Financial features, in more detail

Answer **none**, and the reason is worth knowing in case it is queried: the app
**records** cash that a rep collected, it never **processes** a payment. There is
no payment SDK, no card entry, no wallet. The Wrapp POS the business uses for
card payments is out of band and is not part of this app at all.

### Track

**Internal testing**, per section 1 above. 100 testers, added by Google account
email, review in minutes, permanent, and it installs and auto-updates from a Play
link like any other app. It is not a lesser version of shipping.

---

## What is still genuinely blocked

Ordered by what unblocks what.

1. **The D-U-N-S check.** Needs Akos, five minutes, and it either ends today or
   starts a 30 business day clock. Nothing else waits on it, so it goes first.
2. **The Play developer account.** $25, plus identity and address verification
   that takes days on its own. Independent of the app and of the domain.
3. **The domain.** Client item 8. Blocks Part B entirely, and blocks the boss
   signing in, which matters more.
4. **The reps' Google addresses.** Cheap to collect, and the answer is only
   needed on the day the testers are added, but a rep with no Google account is
   a problem that wants finding early.
