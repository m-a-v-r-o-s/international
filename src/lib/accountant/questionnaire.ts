/**
 * The seventeen questions the company's accountant has to answer before any
 * myDATA work can start, plus the four assumptions the design rests on.
 *
 * WHY THE CONTENT IS HERE AND NOT IN `messages/*.json`.
 * HANDOFF.md's rule is that no user-facing string is hard-coded, and this
 * file honours it: every line below exists in both languages. It does not live
 * in the message catalogues because those hold UI chrome — labels, buttons,
 * errors — that many screens reuse, and this is a single long-form document
 * whose text will be edited as the conversation with the accountant moves.
 * The precedent is `app_settings.company.terms_el / terms_en / terms_de`
 * (src/lib/contract/company.ts): document bodies in this codebase are already
 * bilingual content pairs, not catalogue keys.
 *
 * THE GREEK IS THE ORIGINAL. It is written in the first person singular
 * throughout, because Akos Digital Services is one person and a document that
 * says "we" to a client's accountant invents a team that does not exist. The
 * English is a translation for the record, not for an audience: the reader of
 * this page is a Greek accountant.
 *
 * NO EM DASHES, in either language. Consistent with the sweep that took them
 * out of the rest of the front-end strings.
 *
 * ── THE REVISION THAT MATTERS ───────────────────────────────────────────────
 * The first version of this document asked about ΔΙΑΒΙΒΑΣΗ: issue the document
 * yourself, then report its data to myDATA. The owner then established that
 * what is actually needed is ΗΛΕΚΤΡΟΝΙΚΗ ΤΙΜΟΛΟΓΗΣΗ, which is a different
 * thing, and it inverts the architecture.
 *
 * Under the mandatory B2B regime every invoice is ISSUED through a certified
 * Πάροχος Υπηρεσιών Ηλεκτρονικής Έκδοσης or through ΑΑΔΕ's own free
 * applications. A self-built issuer is an accepted channel only during the
 * transition, which ends 31.12.2026; this app goes live in March 2027. So the
 * app is not the issuer and never will be. It is a source system that hands
 * data to a provider and takes back the ΜΑΡΚ, the seal, the QR and the
 * finished document.
 *
 * That is why question 4 exists and why it is where it is. WHICH PROVIDER is
 * now the largest open item on the project: every provider's API is its own,
 * so the invoicing work cannot be designed or estimated until one is named.
 * The Ψηφιακό Πελατολόγιο is untouched by any of this and stays a direct
 * integration of ours (assumption 3).
 *
 * ── ON THE IDS ──────────────────────────────────────────────────────────────
 * `id` deliberately tracks the printed `number`, because the id is what keys
 * the stored jsonb and a reply that says `q4` should be findable at question 4.
 * That is safe to renumber only while no reply exists. `accountant_replies` is
 * empty at the time of this revision. THE MOMENT IT IS NOT, THESE IDS FREEZE
 * and a new question gets an id past the end rather than a renumbering, or
 * every stored answer silently changes meaning.
 */

export type Bilingual = { el: string; en: string }

export type Assumption = {
  id: string
  heading: Bilingual
  body: Bilingual
  ask: Bilingual
}

export type Question = {
  id: string
  /** Numbering is real: the reply refers back to these numbers. */
  number: number
  text: Bilingual
  why?: Bilingual
}

export type Section = {
  id: string
  mark: string
  title: Bilingual
  lede: Bilingual
  questions: Question[]
}

export type ChecklistItem = {
  id: string
  label: Bilingual
  hint?: Bilingual
}

export const INTRO: Bilingual = {
  el: 'Η επιχείρηση αναπτύσσει εσωτερική εφαρμογή διαχείρισης ενοικιάσεων, η οποία καταγράφει κρατήσεις, παραδόσεις οχημάτων, επιστροφές και εισπράξεις. Ο ιδιοκτήτης ζήτησε να συνδεθεί η εφαρμογή με την ΑΑΔΕ, και όχι μόνο να διαβιβάζει δεδομένα αλλά να καλύπτει και την ηλεκτρονική τιμολόγηση. Έξι από τις παρακάτω ερωτήσεις αλλάζουν ριζικά τον σχεδιασμό ανάλογα με την απάντηση, γι’ αυτό και μπαίνουν πρώτες. Δεν ξεκινά καμία υλοποίηση πριν απαντηθούν.',
  en: 'The business is building an internal rental operations app that records bookings, vehicle handovers, returns and payments. The owner has asked for it to be connected to AADE, and not only to transmit data but to cover electronic invoicing as well. Six of the questions below change the design outright depending on the answer, which is why they come first. No implementation starts until they are answered.',
}

export const ASSUMPTIONS: Assumption[] = [
  {
    id: 'a1',
    heading: {
      el: 'Παραδοχή 1 · Η εφαρμογή δεν εκδίδει, στέλνει σε Πάροχο',
      en: 'Assumption 1 · The app does not issue, it sends to a provider',
    },
    body: {
      el: 'Από την 1η Οκτωβρίου 2026 κάθε τιμολόγιο B2B εκδίδεται μέσω πιστοποιημένου Παρόχου Υπηρεσιών Ηλεκτρονικής Έκδοσης ή μέσω των δωρεάν εφαρμογών της ΑΑΔΕ. Η έκδοση από ιδιοκατασκευή επιτρέπεται μόνο κατά τη μεταβατική περίοδο, που λήγει στις 31.12.2026, και η εφαρμογή μπαίνει σε παραγωγή τον Μάρτιο του 2027. Άρα η εφαρμογή δεν θα εκδίδει η ίδια παραστατικά. Θα στέλνει τα δεδομένα στον Πάροχο, και ο Πάροχος θα αποδίδει ΜΑΡΚ, ψηφιακή σήμανση και QR, θα διαβιβάζει στο myDATA και θα επιστρέφει το τελικό παραστατικό.',
      en: 'From 1 October 2026 every B2B invoice is issued through a certified electronic issuance provider or through AADE’s free applications. Issuance from a self-built system is permitted only during the transition period, which ends on 31.12.2026, and this app goes into production in March 2027. So the app will not issue documents itself. It will send the data to the provider, and the provider will assign the MARK, the digital seal and the QR, transmit to myDATA and return the finished document.',
    },
    ask: {
      el: 'Επιβεβαιώνετε ότι αυτό είναι το σωστό μοντέλο για την επιχείρηση;',
      en: 'Do you confirm this is the right model for the business?',
    },
  },
  {
    id: 'a2',
    heading: {
      el: 'Παραδοχή 2 · Η αποστολή γίνεται στο τέλος της ημέρας',
      en: 'Assumption 2 · The send happens at end of day',
    },
    body: {
      el: 'Η εφαρμογή θα κρατά τη χρέωση ως προσχέδιο τη στιγμή της παράδοσης του οχήματος. Ο υπάλληλος θα μπορεί να τη διορθώσει χωρίς κανένα ίχνος προς τον Πάροχο ή την ΑΑΔΕ, και μια αυτόματη εργασία στο τέλος της ημέρας θα στέλνει ό,τι έχει μείνει ανοιχτό. Μετά την αποστολή δεν υπάρχει διόρθωση, μόνο ακύρωση ή πιστωτικό.',
      en: 'The app will hold the charge as a draft at the moment the vehicle is handed over. The rep will be able to correct it with no trace reaching the provider or AADE, and a nightly job will send whatever is still open. After sending there is no correction, only a cancellation or a credit note.',
    },
    ask: {
      el: 'Είναι αποδεκτό, ή πρέπει το παραστατικό να εκδίδεται τη στιγμή της παράδοσης;',
      en: 'Is this acceptable, or does the document have to be issued at the moment of handover?',
    },
  },
  {
    id: 'a3',
    heading: {
      el: 'Παραδοχή 3 · Το Ψηφιακό Πελατολόγιο μένει δική μου δουλειά',
      en: 'Assumption 3 · The Digital Customer Registry stays mine',
    },
    body: {
      el: 'Η επιχείρηση εμπίπτει στον ΚΑΔ 77.11 και άρα υποχρεούται σε τήρηση Ψηφιακού Πελατολογίου Οχημάτων από την 1η Ιουλίου 2025 (Α.1057/2025, ΦΕΚ Β’ 1828/14.4.2025). Αυτό είναι ξεχωριστή υποχρέωση από την τιμολόγηση, δεν απαιτεί Πάροχο, και η καταχώρηση γίνεται σε πραγματικό χρόνο: μία εγγραφή κατά την παράδοση του οχήματος και μία ολοκλήρωση κατά την επιστροφή. Άρα το αναλαμβάνει η ίδια η εφαρμογή, απευθείας.',
      en: 'The business falls under KAD 77.11 and is therefore obliged to keep the Digital Vehicle Customer Registry from 1 July 2025 (A.1057/2025, Gazette B 1828/14.4.2025). This is a separate obligation from invoicing, needs no provider, and entry is real time: one record when the vehicle is handed over, one completion when it comes back. So the app takes it on directly.',
    },
    ask: {
      el: 'Επιβεβαιώνετε ότι η επιχείρηση εμπίπτει, και ότι δεν υπάρχει εξαίρεση που μου διαφεύγει;',
      en: 'Do you confirm the business is in scope, and that there is no exemption I have missed?',
    },
  },
  {
    id: 'a4',
    heading: {
      el: 'Παραδοχή 4 · ΦΠΑ Κω 17% σε όλους τους πελάτες',
      en: 'Assumption 4 · Kos VAT at 17% for every customer',
    },
    body: {
      el: 'Η βραχυχρόνια μίσθωση μεταφορικού μέσου φορολογείται στον τόπο όπου το όχημα τίθεται στη διάθεση του πελάτη. Άρα εφαρμόζεται ελληνικός ΦΠΑ ακόμη και όταν ο πελάτης είναι επιχείρηση άλλου κράτους μέλους, χωρίς αντιστροφή της υποχρέωσης. Ο συντελεστής είναι 17%, ο μειωμένος κατά 30% συντελεστής της Κω, όχι 24%: το επιβεβαιώνει απόδειξη της επιχείρησης της 3.9.2026 με «ΕΝΟΙΚΙΑΣΕΙΣ ΑΥΤΟΚΙΝΗΤΩΝ 170,00 17,00%».',
      en: 'Short-term hire of a means of transport is taxed where the vehicle is placed at the customer’s disposal. Greek VAT therefore applies even when the customer is a business in another member state, with no reverse charge. The rate is 17%, the Kos rate reduced by 30%, not 24%: a receipt of the business dated 3.9.2026 shows «ΕΝΟΙΚΙΑΣΕΙΣ ΑΥΤΟΚΙΝΗΤΩΝ 170,00 17,00%».',
    },
    ask: {
      el: 'Επιβεβαιώνετε το 17% ως τον συντελεστή που κωδικοποιώ; Ρωτώ γιατί από τη μείωση εξαιρούνται τα «μεταφορικά μέσα», και θέλω να είναι ρητό ότι η εξαίρεση αφορά την πώληση οχήματος και όχι τη μίσθωση. Επίσης, θέλω να μην χτίσω διαδρομή απαλλαγής με βάση ευρωπαϊκό ΑΦΜ.',
      en: 'Do you confirm 17% as the rate I encode? I ask because "means of transport" are excluded from the reduction, and I want it stated explicitly that the exclusion covers the sale of a vehicle and not its hire. Also, I want to avoid building a zero-rating path keyed on an EU VAT number.',
    },
  },
]

export const SECTIONS: Section[] = [
  {
    id: 'first',
    mark: 'Β',
    title: {
      el: 'Ερωτήσεις που χρειάζομαι πρώτες',
      en: 'The questions I need first',
    },
    lede: {
      el: 'Χωρίς αυτές τις έξι απαντήσεις δεν μπορεί να ξεκινήσει ο σχεδιασμός.',
      en: 'Without these six answers the design cannot begin.',
    },
    questions: [
      {
        id: 'q1',
        number: 1,
        text: {
          el: 'Διαβιβάζει σήμερα το λογιστήριο τα έσοδα της επιχείρησης στο myDATA; Με ποιο λογισμικό ή ποιο κανάλι;',
          en: 'Does the accounting office currently transmit the business’s income to myDATA? Through which software or channel?',
        },
        why: {
          el: 'Γιατί ρωτώ: αν διαβιβάζετε ήδη εσείς και αρχίσει να στέλνει και η εφαρμογή, τα ίδια έσοδα θα καταχωρηθούν δύο φορές και η προσυμπληρωμένη δήλωση ΦΠΑ θα βγει λανθασμένη. Πρέπει να οριστεί ένας και μόνο πομπός, και να συμφωνηθεί ποιος είναι.',
          en: 'Why I ask: if you already transmit and the app starts sending too, the same income is recorded twice and the pre-filled VAT return comes out wrong. One transmitter has to be named, and agreed.',
        },
      },
      {
        id: 'q2',
        number: 2,
        text: {
          el: 'Πώς θα εκδίδονται οι αποδείξεις λιανικής; Από ΦΗΜ, ή και αυτές μέσω του Παρόχου;',
          en: 'How will retail receipts be issued? From a tax mechanism, or through the provider as well?',
        },
        why: {
          el: 'Γιατί ρωτώ: η υποχρεωτική ηλεκτρονική τιμολόγηση αφορά τις συναλλαγές B2B, ενώ η συντριπτική πλειονότητα των ενοικιάσεων εδώ είναι λιανική προς τουρίστες. Αν η λιανική μείνει στον ΦΗΜ, έχουμε δύο διαφορετικές διαδρομές έκδοσης μέσα στην ίδια εφαρμογή. Αν περάσει και αυτή από τον Πάροχο, έχουμε μία. Η δεύτερη είναι πολύ απλούστερη για εμένα, αλλά η επιλογή είναι νομική και δική σας.',
          en: 'Why I ask: mandatory e-invoicing covers B2B, while the overwhelming majority of rentals here are retail to tourists. If retail stays on a tax mechanism, there are two different issuance paths inside one app. If it goes through the provider too, there is one. The second is far simpler for me, but the choice is a legal one and yours.',
        },
      },
      {
        id: 'q3',
        number: 3,
        text: {
          el: 'Τηρείται ήδη Ψηφιακό Πελατολόγιο από την 1η Ιουλίου 2025; Αν ναι, χειροκίνητα μέσω myaade.gov.gr ή μέσω λογισμικού;',
          en: 'Is a Digital Customer Registry already being kept since 1 July 2025? If so, by hand on myaade.gov.gr or through software?',
        },
        why: {
          el: 'Γιατί ρωτώ: το πρόστιμο ορίζεται σε 100 ευρώ ανά μη καταχωρημένο όχημα. Αν δεν τηρείται σήμερα, αυτό προηγείται της τιμολόγησης στη σειρά προτεραιότητας. Αν τηρείται χειροκίνητα, η εφαρμογή μπορεί να το αναλάβει, αλλά πρέπει να σταματήσει η χειροκίνητη καταχώρηση την ίδια στιγμή.',
          en: 'Why I ask: the penalty is 100 euro per unrecorded vehicle. If it is not being kept today, this comes before invoicing in priority order. If it is being kept by hand, the app can take it over, but the manual entry has to stop at the same moment.',
        },
      },
      {
        id: 'q4',
        number: 4,
        text: {
          el: 'Ποιον Πάροχο Υπηρεσιών Ηλεκτρονικής Έκδοσης θα χρησιμοποιήσει η επιχείρηση;',
          en: 'Which certified electronic issuance provider will the business use?',
        },
        why: {
          el: 'Γιατί ρωτώ: αυτή είναι πλέον η μεγαλύτερη εκκρεμότητα ολόκληρου του έργου. Κάθε Πάροχος έχει δικό του API, οπότε δεν μπορώ ούτε να σχεδιάσω ούτε να εκτιμήσω τη δουλειά της τιμολόγησης πριν επιλεγεί. Μαζί με το όνομα χρειάζομαι τρία πράγματα: αν διαθέτει API για σύνδεση από τρίτο σύστημα και πού είναι η τεκμηρίωσή του, αν καλύπτει και τις αποδείξεις λιανικής ή μόνο τα τιμολόγια, και ποιο είναι το κόστος ανά παραστατικό.',
          en: 'Why I ask: this is now the single largest open item on the project. Every provider has its own API, so I can neither design nor estimate the invoicing work until one is chosen. Along with the name I need three things: whether it offers an API a third-party system can connect to and where the documentation is, whether it covers retail receipts or only invoices, and what it costs per document.',
        },
      },
      {
        id: 'q5',
        number: 5,
        text: {
          el: 'Υπάρχουν πελάτες επιχειρήσεις, όπως τουριστικά γραφεία, ξενοδοχεία ή εταιρείες, στους οποίους εκδίδεται τιμολόγιο; Τι ποσοστό του τζίρου αντιπροσωπεύουν;',
          en: 'Are there business customers, such as travel agencies, hotels or companies, who are invoiced? What share of turnover do they represent?',
        },
        why: {
          el: 'Γιατί ρωτώ: καθορίζει πόσο βαραίνει η διαδρομή B2B σε σχέση με τη λιανική, και άρα τι πρέπει να δουλεύει τέλεια από την πρώτη μέρα και τι μπορεί να έρθει σε δεύτερη φάση.',
          en: 'Why I ask: it determines how much weight the B2B path carries against retail, and therefore what has to work perfectly from day one and what can come in a second phase.',
        },
      },
      {
        id: 'q6',
        number: 6,
        text: {
          el: 'Ξεπέρασαν τα ακαθάριστα έσοδα της χρήσης 2023 το 1.000.000 ευρώ;',
          en: 'Did gross revenue for financial year 2023 exceed 1,000,000 euro?',
        },
        why: {
          el: 'Γιατί ρωτώ: προσδιορίζει σε ποια φάση της υποχρεωτικής ηλεκτρονικής τιμολόγησης εντάσσεται η επιχείρηση, και άρα αν η προθεσμία έχει ήδη παρέλθει ή αν λήγει μέσα στο 2026. Αν έχει ήδη παρέλθει, η επιχείρηση χρειάζεται Πάροχο ΤΩΡΑ, ανεξάρτητα από την εφαρμογή.',
          en: 'Why I ask: it determines which phase of the mandatory rollout the business falls into, and therefore whether the deadline has already passed or falls within 2026. If it has already passed, the business needs a provider NOW, regardless of this app.',
        },
      },
    ],
  },
  {
    id: 'documents',
    mark: 'Γ',
    title: {
      el: 'Παραστατικά, χαρακτηρισμοί και αρίθμηση',
      en: 'Documents, classifications and numbering',
    },
    lede: {
      el: 'Καθορίζουν τι ακριβώς στέλνει η εφαρμογή στον Πάροχο για κάθε ενοικίαση.',
      en: 'These decide exactly what the app sends the provider for each rental.',
    },
    questions: [
      {
        id: 'q7',
        number: 7,
        text: {
          el: 'Ποιος τύπος παραστατικού εκδίδεται για τη συνήθη ενοικίαση σε ιδιώτη τουρίστα, και ποιος για πελάτη επιχείρηση;',
          en: 'Which document type is issued for an ordinary rental to a private tourist, and which for a business customer?',
        },
        why: {
          el: 'Παρακαλώ δώστε τον κωδικό τύπου παραστατικού myDATA για κάθε περίπτωση, ώστε να μην τον επιλέξω εγώ.',
          en: 'Please give the myDATA document type code for each case, so that I am not the one choosing it.',
        },
      },
      {
        id: 'q8',
        number: 8,
        text: {
          el: 'Ποιοι χαρακτηρισμοί εσόδων ισχύουν; Κατηγορία χαρακτηρισμού, τύπος Ε3 και συντελεστής ΦΠΑ.',
          en: 'Which income classifications apply? Classification category, E3 type and VAT rate.',
        },
        why: {
          el: 'Οι τιμές θα καταχωρηθούν ως ρύθμιση στην εφαρμογή, όχι μέσα στον κώδικα, ώστε να μπορείτε να τις αλλάξετε χωρίς νέα έκδοση.',
          en: 'The values will be stored as settings, not in code, so you can change them without a new release.',
        },
      },
      {
        id: 'q9',
        number: 9,
        text: {
          el: 'Ποιος αποδίδει τη σειρά και την αρίθμηση, ο Πάροχος ή εμείς; Αν είναι δική μας, από ποιον αριθμό ξεκινά;',
          en: 'Who assigns the series and numbering, the provider or us? If it is ours, from which number does it start?',
        },
        why: {
          el: 'Οι περισσότεροι Πάροχοι αναλαμβάνουν την αρίθμηση, και αυτό είναι το ασφαλέστερο γιατί η σειρά πρέπει να είναι συνεχής και χωρίς κενά. Θέλω όμως να το ξέρω και όχι να το υποθέσω, γιατί αν την κρατήσουμε εμείς χρειάζεται μετρητής στη βάση με τη δική του εγγύηση.',
          en: 'Most providers take on the numbering, and that is the safer arrangement because the series has to be continuous and gapless. But I want it stated rather than assumed, because if we keep it there has to be a counter in the database with its own guarantee.',
        },
      },
      {
        id: 'q10',
        number: 10,
        text: {
          el: 'Ποια είναι η ημερομηνία έκδοσης: η ημέρα παράδοσης του οχήματος ή η ημέρα επιστροφής; Αν η μίσθωση ξεκινά στο τέλος ενός μήνα και τελειώνει στην αρχή του επόμενου, σε ποια φορολογική περίοδο ανήκει;',
          en: 'Which is the issue date: the day the vehicle is handed over, or the day it is returned? If a rental starts at the end of one month and ends at the start of the next, which tax period does it belong to?',
        },
        why: {
          el: 'Η αυτόματη εργασία τρέχει κάθε βράδυ. Χρειάζομαι κανόνα που δεν μετακινεί ποτέ παραστατικό σε λάθος περίοδο ΦΠΑ, ιδίως στις 31 του μήνα.',
          en: 'The nightly job runs every evening. I need a rule that never moves a document into the wrong VAT period, especially on the last day of a month.',
        },
      },
      {
        id: 'q11',
        number: 11,
        text: {
          el: 'Πώς αντιστοιχίζονται οι τρόποι πληρωμής; Η εφαρμογή γνωρίζει μετρητά, κάρτα και τραπεζική μεταφορά.',
          en: 'How do the payment methods map? The app knows cash, card and bank transfer.',
        },
        why: {
          el: 'Χρειάζομαι τον κωδικό myDATA για καθέναν από τους τρεις. Επίσης, αν μια ενοικίαση εξοφλείται μερικώς, πώς δηλώνεται.',
          en: 'I need the myDATA code for each of the three. Also, how a partially settled rental is declared.',
        },
      },
    ],
  },
  {
    id: 'cases',
    mark: 'Δ',
    title: {
      el: 'Ειδικές περιπτώσεις της δραστηριότητας',
      en: 'Situations specific to this business',
    },
    lede: {
      el: 'Τέσσερις καταστάσεις που προκύπτουν καθημερινά και δεν έχουν προφανή αντιμετώπιση.',
      en: 'Four situations that come up daily and have no obvious treatment.',
    },
    questions: [
      {
        id: 'q12',
        number: 12,
        text: {
          el: 'Καύσιμα. Όταν το όχημα επιστρέφεται με λιγότερο καύσιμο, ο υπάλληλος εισπράττει σταθερό ποσό ανά όγδοο ρεζερβουάρ, με μετρητά, τη στιγμή της επιστροφής. Εκδίδεται ξεχωριστό παραστατικό ή προστίθεται ως γραμμή στο παραστατικό της μίσθωσης;',
          en: 'Fuel. When a vehicle comes back with less fuel, the rep collects a flat amount per missing eighth of a tank, in cash, at the moment of return. Is a separate document issued, or is it added as a line on the rental document?',
        },
        why: {
          el: 'Η είσπραξη γίνεται συχνά διαφορετική ημέρα από την παράδοση του οχήματος, και συχνά από άλλον υπάλληλο. Αν πρέπει να μπει στο ίδιο παραστατικό, τότε το παραστατικό δεν μπορεί να σταλεί στον Πάροχο την ημέρα της παράδοσης.',
          en: 'The money is often taken on a different day from the handover, and often by a different rep. If it has to go on the same document, then the document cannot be sent to the provider on the day of handover.',
        },
      },
      {
        id: 'q13',
        number: 13,
        text: {
          el: 'Ζημιές. Σήμερα η εφαρμογή καταγράφει το κόστος της ζημιάς αλλά δεν το εισπράττει, καθώς δεν κρατείται εγγύηση ούτε στοιχεία κάρτας. Αν αυτό αλλάξει, τι παραστατικό απαιτείται;',
          en: 'Damage. Today the app records the cost of damage but does not collect it, since no deposit and no card details are held. If that changes, what document is required?',
        },
        why: {
          el: 'Θέλω να ξέρω αν πρέπει να προβλέψω τη δυνατότητα από τώρα ή αν μένει εκτός.',
          en: 'I want to know whether to provide for it now or leave it out.',
        },
      },
      {
        id: 'q14',
        number: 14,
        text: {
          el: 'Ακυρώσεις και μη εμφάνιση πελάτη. Εκδίδεται παραστατικό ή όχι; Αν έχει προηγηθεί είσπραξη, τι εκδίδεται;',
          en: 'Cancellations and no-shows. Is a document issued or not? If money was already taken, what is issued?',
        },
      },
      {
        id: 'q15',
        number: 15,
        text: {
          el: 'Διορθώσεις μετά την αποστολή. Προτιμάτε ακύρωση παραστατικού ή έκδοση πιστωτικού; Υπάρχει προθεσμία που πρέπει να τηρεί η εφαρμογή;',
          en: 'Corrections after sending. Do you prefer cancelling the document or issuing a credit note? Is there a deadline the app has to respect?',
        },
        why: {
          el: 'Ο σχεδιασμός της παραδοχής 2 μειώνει δραστικά τις περιπτώσεις αυτές, αλλά δεν τις μηδενίζει. Χρειάζομαι καθαρό κανόνα για όσες απομείνουν, και να ξέρω αν ο Πάροχος τον υποστηρίζει.',
          en: 'The design in assumption 2 cuts these cases down sharply but does not eliminate them. I need a clear rule for the ones that remain, and to know the provider supports it.',
        },
      },
    ],
  },
  {
    id: 'credentials',
    mark: 'Ε',
    title: {
      el: 'Στοιχεία και διαπιστευτήρια',
      en: 'Details and credentials',
    },
    lede: {
      el: 'Χωρίς αυτά δεν μπορεί να γίνει ούτε δοκιμαστική σύνδεση.',
      en: 'Without these not even a sandbox connection can be made.',
    },
    questions: [
      {
        id: 'q16',
        number: 16,
        text: {
          el: 'Ποιος είναι ο ΚΑΔ της επιχείρησης και ποιος ο Αριθμός Εγκατάστασης ανά σημείο εξυπηρέτησης;',
          en: 'What is the business activity code, and the establishment number for each service point?',
        },
        why: {
          el: 'Η επιχείρηση λειτουργεί με υπαλλήλους σε πολλά ξενοδοχεία. Χρειάζομαι να ξέρω αν το καθένα μετράει ως ξεχωριστή εγκατάσταση ή αν όλα δηλώνονται στην έδρα. Το πεδίο branch είναι υποχρεωτικό σε κάθε εγγραφή Ψηφιακού Πελατολογίου και το ζητούν και οι Πάροχοι.',
          en: 'The business operates with reps at several hotels. I need to know whether each counts as a separate establishment or whether all are declared at the registered seat. The branch field is mandatory on every Digital Customer Registry entry and providers ask for it too.',
        },
      },
      {
        id: 'q17',
        number: 17,
        text: {
          el: 'Ποιος αναλαμβάνει τα διαπιστευτήρια: του myDATA REST API για το Ψηφιακό Πελατολόγιο, και του Παρόχου για την τιμολόγηση;',
          en: 'Who will handle the credentials: the myDATA REST API for the Digital Customer Registry, and the provider’s for invoicing?',
        },
        why: {
          el: 'Είναι δύο ξεχωριστά σετ. Τα πρώτα δημιουργούνται από τον λογαριασμό myDATA της επιχείρησης και χρειάζονται μόνο για το Πελατολόγιο. Τα δεύτερα τα δίνει ο Πάροχος. Και για τα δύο χρειάζομαι πρώτα δοκιμαστικά και, μετά την επιτυχή δοκιμή, παραγωγικά. Μην τα γράψετε σε αυτή τη φόρμα: θα συμφωνήσουμε ασφαλή τρόπο παράδοσης.',
          en: 'They are two separate sets. The first are created from the business’s own myDATA account and are needed only for the registry. The second come from the provider. For both I need sandbox credentials first and production ones after a successful test. Do not type them into this form: we will agree a secure way to hand them over.',
        },
      },
    ],
  },
]

export const CHECKLIST: ChecklistItem[] = [
  {
    id: 'apy',
    label: {
      el: 'Δείγμα απόδειξης παροχής υπηρεσιών που εκδίδεται σήμερα',
      en: 'Sample service receipt as issued today',
    },
    hint: {
      el: 'Φωτογραφία ή σάρωση αρκεί. Θέλω να δω τη μορφή και τα στοιχεία που τυπώνονται.',
      en: 'A photo or scan is enough. I want to see the layout and the fields that print.',
    },
  },
  {
    id: 'invoice',
    label: {
      el: 'Δείγμα τιμολογίου προς επιχείρηση, εφόσον εκδίδεται',
      en: 'Sample invoice to a business, if any are issued',
    },
  },
  {
    id: 'provider',
    label: {
      el: 'Προσφορά ή σύμβαση Παρόχου, αν έχει ήδη γίνει συζήτηση με κάποιον',
      en: 'Provider quote or contract, if a conversation has already started with one',
    },
    hint: {
      el: 'Ακόμη και μια προσφορά χωρίς υπογραφή με βοηθά: δείχνει τι καλύπτει το πακέτο και αν περιλαμβάνει API.',
      en: 'Even an unsigned quote helps: it shows what the package covers and whether an API is included.',
    },
  },
  {
    id: 'company',
    label: {
      el: 'Πλήρη στοιχεία επιχείρησης',
      en: 'Full company details',
    },
    hint: {
      el: 'Επωνυμία, ΑΦΜ, ΔΟΥ, διεύθυνση έδρας, τηλέφωνο. Χρειάζονται και για το συμφωνητικό μίσθωσης, το οποίο σήμερα δεν μπορεί να υπογραφεί χωρίς αυτά.',
      en: 'Registered name, VAT number, tax office, seat address, phone. These are needed for the rental agreement too, which cannot be signed without them today.',
    },
  },
  {
    id: 'branches',
    label: {
      el: 'Κατάσταση σημείων εξυπηρέτησης με τον Αριθμό Εγκατάστασης του καθενός',
      en: 'List of service points with the establishment number of each',
    },
  },
]

export const REFERENCES: Bilingual[] = [
  {
    el: 'Υποχρεωτική ηλεκτρονική τιμολόγηση B2B: 2.3.2026 για έσοδα άνω του 1.000.000 ευρώ, 1.10.2026 για όλες τις υπόλοιπες επιχειρήσεις, με μεταβατική περίοδο έως 31.12.2026.',
    en: 'Mandatory B2B e-invoicing: 2.3.2026 for revenue over 1,000,000 euro, 1.10.2026 for all remaining businesses, with a transition period to 31.12.2026.',
  },
  {
    el: 'Α.1138/2020 όπως ισχύει μετά την Α.1090/2022, χρόνοι διαβίβασης δεδομένων στο myDATA.',
    en: 'A.1138/2020 as amended by A.1090/2022, myDATA transmission deadlines.',
  },
  {
    el: 'Α.1057/2025, ΦΕΚ Β’ 1828/14.4.2025, Ψηφιακό Πελατολόγιο Οχημάτων, υποχρεωτικό από 1.7.2025.',
    en: 'A.1057/2025, Gazette B 1828/14.4.2025, Digital Vehicle Customer Registry, mandatory from 1.7.2025.',
  },
]

/** Every question id, in document order. The action validates against this. */
export const QUESTION_IDS: readonly string[] = [
  ...ASSUMPTIONS.map((a) => a.id),
  ...SECTIONS.flatMap((s) => s.questions.map((q) => q.id)),
]

/** How many answers a submission may carry. Guards the jsonb size cap. */
export const MAX_ANSWER_LENGTH = 4000

export function pick(value: Bilingual, locale: string): string {
  return locale === 'en' ? value.en : value.el
}
