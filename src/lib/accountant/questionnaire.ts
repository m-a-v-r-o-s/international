/**
 * The seventeen questions the company's accountant has to answer before any
 * myDATA work can start, plus the three assumptions the design rests on.
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
 * NO EM DASHES, in either language. Consistent with the sweep that took them out of the
 * rest of the front-end strings.
 *
 * WHAT THE FIVE QUESTIONS IN SECTION B ARE. They are the ones where an answer
 * decides WHAT gets built rather than how, so nothing can start without them.
 * They carried a "ΜΠΛΟΚΑΡΕΙ" chip in the first draft and it was dropped on the
 * owner's call: to an accountant it reads as an accusation. The section
 * heading now carries the meaning on its own, which is where it belongs.
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
  el: 'Η επιχείρηση αναπτύσσει εσωτερική εφαρμογή διαχείρισης ενοικιάσεων, η οποία καταγράφει κρατήσεις, παραδόσεις οχημάτων, επιστροφές και εισπράξεις. Ο ιδιοκτήτης ζήτησε να διασυνδεθεί η εφαρμογή με την ΑΑΔΕ. Πέντε από τις παρακάτω ερωτήσεις αλλάζουν ριζικά τον σχεδιασμό ανάλογα με την απάντηση, γι’ αυτό και μπαίνουν πρώτες. Δεν ξεκινά καμία υλοποίηση πριν απαντηθούν.',
  en: 'The business is building an internal rental operations app that records bookings, vehicle handovers, returns and payments. The owner has asked for it to be connected to AADE. Five of the questions below change the design outright depending on the answer, which is why they come first. No implementation starts until they are answered.',
}

export const ASSUMPTIONS: Assumption[] = [
  {
    id: 'a1',
    heading: {
      el: 'Παραδοχή 1 · Διαβίβαση στο τέλος της ημέρας',
      en: 'Assumption 1 · End-of-day transmission',
    },
    body: {
      el: 'Το κανάλι ERP επιτρέπει διαβίβαση μέχρι την επόμενη ημέρα από την ημερομηνία έκδοσης (Α.1138/2020, όπως ισχύει μετά την Α.1090/2022). Σχεδιάζω λοιπόν να μην εκδίδεται παραστατικό τη στιγμή της παράδοσης του οχήματος. Η εφαρμογή θα κρατά τη χρέωση ως προσχέδιο, ο υπάλληλος θα μπορεί να τη διορθώσει χωρίς κανένα ίχνος προς την ΑΑΔΕ, και μια αυτόματη εργασία στο τέλος της ημέρας θα εκδίδει, θα αριθμεί και θα διαβιβάζει.',
      en: 'The ERP channel allows transmission up to the day after the issue date (A.1138/2020, as amended by A.1090/2022). So the design does not issue a document at the moment the vehicle is handed over. The app holds the charge as a draft, the rep can correct it with no trace reaching AADE, and a nightly job issues, numbers and transmits.',
    },
    ask: {
      el: 'Είναι αποδεκτό; Υπάρχει λόγος να εκδίδεται το παραστατικό νωρίτερα;',
      en: 'Is this acceptable? Is there a reason to issue the document earlier?',
    },
  },
  {
    id: 'a2',
    heading: {
      el: 'Παραδοχή 2 · Το Ψηφιακό Πελατολόγιο δεν μαζεύεται',
      en: 'Assumption 2 · The Digital Customer Registry cannot be batched',
    },
    body: {
      el: 'Η επιχείρηση εμπίπτει στον ΚΑΔ 77.11 και άρα υποχρεούται σε τήρηση Ψηφιακού Πελατολογίου Οχημάτων από την 1η Ιουλίου 2025 (Α.1057/2025, ΦΕΚ Β’ 1828/14.4.2025). Εδώ η καταχώρηση γίνεται σε πραγματικό χρόνο και δεν επιτρέπει συγκέντρωση στο τέλος της ημέρας: μία εγγραφή κατά την παράδοση του οχήματος και μία ολοκλήρωση κατά την επιστροφή.',
      en: 'The business falls under KAD 77.11 and is therefore obliged to keep the Digital Vehicle Customer Registry from 1 July 2025 (A.1057/2025, Gazette B 1828/14.4.2025). Entry here is real time and cannot be gathered up at end of day: one record when the vehicle is handed over, one completion when it comes back.',
    },
    ask: {
      el: 'Επιβεβαιώνετε ότι η επιχείρηση εμπίπτει, και ότι δεν υπάρχει εξαίρεση που μου διαφεύγει;',
      en: 'Do you confirm the business is in scope, and that there is no exemption I have missed?',
    },
  },
  {
    id: 'a3',
    heading: {
      el: 'Παραδοχή 3 · Ελληνικός ΦΠΑ σε όλους τους πελάτες',
      en: 'Assumption 3 · Greek VAT for every customer',
    },
    body: {
      el: 'Η βραχυχρόνια μίσθωση μεταφορικού μέσου φορολογείται στον τόπο όπου το όχημα τίθεται στη διάθεση του πελάτη. Άρα εφαρμόζεται ελληνικός ΦΠΑ 24% ακόμη και όταν ο πελάτης είναι επιχείρηση άλλου κράτους μέλους, χωρίς αντιστροφή της υποχρέωσης.',
      en: 'Short-term hire of a means of transport is taxed where the vehicle is placed at the customer’s disposal. Greek VAT at 24% therefore applies even when the customer is a business in another member state, with no reverse charge.',
    },
    ask: {
      el: 'Επιβεβαιώνετε; Θέλω να μην χτίσω διαδρομή απαλλαγής με βάση ευρωπαϊκό ΑΦΜ.',
      en: 'Do you confirm? I want to avoid building a zero-rating path keyed on an EU VAT number.',
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
      el: 'Χωρίς αυτές τις πέντε απαντήσεις δεν μπορεί να ξεκινήσει ο σχεδιασμός των παραστατικών.',
      en: 'Without these five answers the document design cannot begin.',
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
          el: 'Γιατί ρωτώ: αν διαβιβάζετε ήδη εσείς και αρχίσει να διαβιβάζει και η εφαρμογή, τα ίδια έσοδα θα καταχωρηθούν δύο φορές και η προσυμπληρωμένη δήλωση ΦΠΑ θα βγει λανθασμένη. Πρέπει να οριστεί ένας και μόνο πομπός, και να συμφωνηθεί ποιος είναι.',
          en: 'Why I ask: if you already transmit and the app starts too, the same income is recorded twice and the pre-filled VAT return comes out wrong. One transmitter has to be named, and agreed.',
        },
      },
      {
        id: 'q2',
        number: 2,
        text: {
          el: 'Πώς εκδίδονται σήμερα οι αποδείξεις λιανικής; Από ΦΗΜ (ταμειακή ή ΑΔΗΜΕ), χειρόγραφα, ή από πρόγραμμα;',
          en: 'How are retail receipts issued today? From a tax mechanism (cash register or ADIME), by hand, or from software?',
        },
        why: {
          el: 'Γιατί ρωτώ: καθορίζει αν η εφαρμογή μπορεί να εκδίδει ΑΠΥ μόνη της ή αν η έκδοση πρέπει να περνά από ΦΗΜ. Σημειώνω ότι το ίδιο το σχήμα του Ψηφιακού Πελατολογίου προβλέπει ξεχωριστές τιμές για ΑΛΠ/ΑΠΥ και για ΑΛΠ/ΑΠΥ μέσω ΦΗΜ, άρα και οι δύο περιπτώσεις προβλέπονται. Η επιλογή όμως είναι δική σας.',
          en: 'Why I ask: it decides whether the app can issue a service receipt on its own or whether issuance must go through a tax mechanism. The Digital Customer Registry schema itself carries separate values for a receipt and for a receipt via tax mechanism, so both are contemplated. The choice is yours.',
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
          el: 'Υπάρχουν πελάτες επιχειρήσεις, όπως τουριστικά γραφεία, ξενοδοχεία ή εταιρείες, στους οποίους εκδίδεται τιμολόγιο; Τι ποσοστό του τζίρου αντιπροσωπεύουν;',
          en: 'Are there business customers, such as travel agencies, hotels or companies, who are invoiced? What share of turnover do they represent?',
        },
        why: {
          el: 'Γιατί ρωτώ: από την 1η Οκτωβρίου 2026 η ηλεκτρονική τιμολόγηση B2B γίνεται υποχρεωτική για όλες τις επιχειρήσεις, με περίοδο προσαρμογής έως 31.12.2026. Η έκδοση πρέπει τότε να γίνεται μέσω πιστοποιημένου Παρόχου ή μέσω των δωρεάν εφαρμογών της ΑΑΔΕ, όχι μέσω ιδιοκατασκευής. Αν υπάρχει σημαντική κίνηση B2B, το κομμάτι αυτό δεν μπορώ να το καλύψω απευθείας και χρειάζεται Πάροχος.',
          en: 'Why I ask: from 1 October 2026 B2B e-invoicing becomes mandatory for all businesses, with an adjustment period to 31.12.2026. Issuance must then go through a certified provider or AADE’s free applications, not through a self-built integration. If there is meaningful B2B volume, I cannot cover that part directly and a provider is needed.',
        },
      },
      {
        id: 'q5',
        number: 5,
        text: {
          el: 'Ξεπέρασαν τα ακαθάριστα έσοδα της χρήσης 2023 το 1.000.000 ευρώ;',
          en: 'Did gross revenue for financial year 2023 exceed 1,000,000 euro?',
        },
        why: {
          el: 'Γιατί ρωτώ: προσδιορίζει σε ποια φάση της υποχρεωτικής ηλεκτρονικής τιμολόγησης εντάσσεται η επιχείρηση, και άρα αν η προθεσμία έχει ήδη παρέλθει ή αν λήγει μέσα στο 2026.',
          en: 'Why I ask: it determines which phase of the mandatory e-invoicing rollout the business falls into, and therefore whether the deadline has already passed or falls within 2026.',
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
      el: 'Καθορίζουν τι ακριβώς παράγει και στέλνει η εφαρμογή για κάθε ενοικίαση.',
      en: 'These decide exactly what the app produces and sends for each rental.',
    },
    questions: [
      {
        id: 'q6',
        number: 6,
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
        id: 'q7',
        number: 7,
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
        id: 'q8',
        number: 8,
        text: {
          el: 'Ποια σειρά παραστατικών χρησιμοποιείται και από ποιον αύξοντα αριθμό ξεκινά η εφαρμογή;',
          en: 'Which document series is in use, and from which sequence number does the app start?',
        },
        why: {
          el: 'Η αρίθμηση πρέπει να είναι συνεχής και χωρίς κενά. Αν η εφαρμογή θα εκδίδει παράλληλα με κάποιο άλλο σύστημα, χρειάζεται ξεχωριστή σειρά για να μην συγκρουστούν.',
          en: 'Numbering has to be continuous and gapless. If the app will issue alongside another system, it needs its own series so the two cannot collide.',
        },
      },
      {
        id: 'q9',
        number: 9,
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
        id: 'q10',
        number: 10,
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
        id: 'q11',
        number: 11,
        text: {
          el: 'Καύσιμα. Όταν το όχημα επιστρέφεται με λιγότερο καύσιμο, ο υπάλληλος εισπράττει σταθερό ποσό ανά όγδοο ρεζερβουάρ, με μετρητά, τη στιγμή της επιστροφής. Εκδίδεται ξεχωριστό παραστατικό ή προστίθεται ως γραμμή στο παραστατικό της μίσθωσης;',
          en: 'Fuel. When a vehicle comes back with less fuel, the rep collects a flat amount per missing eighth of a tank, in cash, at the moment of return. Is a separate document issued, or is it added as a line on the rental document?',
        },
        why: {
          el: 'Η είσπραξη γίνεται συχνά διαφορετική ημέρα από την παράδοση του οχήματος, και συχνά από άλλον υπάλληλο. Αν πρέπει να μπει στο ίδιο παραστατικό, τότε το παραστατικό δεν μπορεί να εκδοθεί στην παράδοση.',
          en: 'The money is often taken on a different day from the handover, and often by a different rep. If it has to go on the same document, then the document cannot be issued at handover.',
        },
      },
      {
        id: 'q12',
        number: 12,
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
        id: 'q13',
        number: 13,
        text: {
          el: 'Ακυρώσεις και μη εμφάνιση πελάτη. Εκδίδεται παραστατικό ή όχι; Αν έχει προηγηθεί είσπραξη, τι εκδίδεται;',
          en: 'Cancellations and no-shows. Is a document issued or not? If money was already taken, what is issued?',
        },
      },
      {
        id: 'q14',
        number: 14,
        text: {
          el: 'Διορθώσεις μετά τη διαβίβαση. Προτιμάτε ακύρωση παραστατικού ή έκδοση πιστωτικού; Υπάρχει προθεσμία που πρέπει να τηρεί η εφαρμογή;',
          en: 'Corrections after transmission. Do you prefer cancelling the document or issuing a credit note? Is there a deadline the app has to respect?',
        },
        why: {
          el: 'Ο σχεδιασμός της παραδοχής 1 μειώνει δραστικά τις περιπτώσεις αυτές, αλλά δεν τις μηδενίζει. Χρειάζομαι καθαρό κανόνα για όσες απομείνουν.',
          en: 'The design in assumption 1 cuts these cases down sharply but does not eliminate them. I need a clear rule for the ones that remain.',
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
        id: 'q15',
        number: 15,
        text: {
          el: 'Ποιος είναι ο ΚΑΔ της επιχείρησης και ποιος ο Αριθμός Εγκατάστασης ανά σημείο εξυπηρέτησης;',
          en: 'What is the business activity code, and the establishment number for each service point?',
        },
        why: {
          el: 'Η επιχείρηση λειτουργεί με υπαλλήλους σε πολλά ξενοδοχεία. Χρειάζομαι να ξέρω αν το καθένα μετράει ως ξεχωριστή εγκατάσταση ή αν όλα δηλώνονται στην έδρα. Το πεδίο branch είναι υποχρεωτικό σε κάθε εγγραφή Ψηφιακού Πελατολογίου.',
          en: 'The business operates with reps at several hotels. I need to know whether each counts as a separate establishment or whether all are declared at the registered seat. The branch field is mandatory on every Digital Customer Registry entry.',
        },
      },
      {
        id: 'q16',
        number: 16,
        text: {
          el: 'Χρησιμοποιείται ήδη Πάροχος Ηλεκτρονικής Έκδοσης Στοιχείων; Αν ναι, ποιος;',
          en: 'Is a certified e-invoicing provider already in use? If so, which one?',
        },
        why: {
          el: 'Αν υπάρχει ήδη Πάροχος, ενδέχεται να είναι προτιμότερο να συνδεθεί η εφαρμογή μαζί του αντί απευθείας με την ΑΑΔΕ.',
          en: 'If a provider is already in place, connecting the app to it may be preferable to connecting directly to AADE.',
        },
      },
      {
        id: 'q17',
        number: 17,
        text: {
          el: 'Ποιος αναλαμβάνει τη δημιουργία των διαπιστευτηρίων myDATA REST API, δηλαδή του Ονόματος Χρήστη και του Subscription Key;',
          en: 'Who will create the myDATA REST API credentials, that is the user name and subscription key?',
        },
        why: {
          el: 'Δημιουργούνται από τον λογαριασμό myDATA της επιχείρησης και ισχύουν και για το Ψηφιακό Πελατολόγιο. Χρειάζομαι πρώτα δοκιμαστικά και, μετά την επιτυχή δοκιμή, παραγωγικά. Μην τα γράψετε σε αυτή τη φόρμα: θα συμφωνήσουμε ασφαλή τρόπο παράδοσης.',
          en: 'They are created from the business’s own myDATA account and cover the Digital Customer Registry too. I need sandbox credentials first and production ones after a successful test. Do not type them into this form: we will agree a secure way to hand them over.',
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
