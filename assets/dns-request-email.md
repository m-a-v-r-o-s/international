# DNS request to the internationalrentals.gr web company

Drafted 26 Sep 2026, **not sent yet**. Plain text, send as is. The DNS for
internationalrentals.gr is run by the third party that built the client's website
(nameservers `ns1/ns2.wpsupporter.com`), so these records can only be added by them.

The records are fixed: Railway's target and Resend's keys do not change for as long as
the custom domain on the `international` service and the `mail.internationalrentals.gr`
domain in Resend exist. If either one is deleted and added again, the values change, so
re-read them before sending (Railway: service `international` → Networking; Resend:
Domains → mail.internationalrentals.gr).

After they add them: check all five with `dig` (don't ask them to confirm), then set
`NEXT_PUBLIC_SITE_URL=https://app.internationalrentals.gr` and the four `SMTP_*`
variables in Railway, and point Supabase Auth's custom SMTP at Resend.

---

**Θέμα:** internationalrentals.gr: προσθήκη εγγραφών DNS για subdomains

Καλησπέρα σας,

Είμαι ο Άκος από την Akos Digital Services. Φτιάχνουμε για την International Rentals μια εσωτερική εφαρμογή για το προσωπικό. Χρειαζόμαστε τις παρακάτω εγγραφές στο DNS του internationalrentals.gr:

Εφαρμογή (app.internationalrentals.gr)

1) CNAME
Host: app
Τιμή: mzi8aos0.up.railway.app

2) TXT
Host: _railway-verify.app
Τιμή: railway-verify=3503afd2e90b3232f66c43cfc3fe422525458a9263e8ef753994b5f2e9915e24

Αποστολή email από την εφαρμογή (mail.internationalrentals.gr)

3) TXT
Host: resend._domainkey.mail
Τιμή: p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDE3rsLfES6cQlOcKmoFMOfEbuERXpbqyxgjUPbbON97FC8hhAXi8tYDRC2KWwiNBun2TEINbcGlnsKBcr6v+Lk/fiEZTuBy+eavPSW1q4Iz7l30Cl+g9NIrONg8Vt0C3yx2R7oyGgD28nnRqrA/PEhpGC6zB30/eOpn1jTrHr/KQIDAQAB

4) CNAME
Host: send.mail
Τιμή: send.forge.rmta.net

5) CNAME
Host: rsend.mail
Τιμή: rsend-euw1.forge.rmta.net

Αν το DNS περνάει από Cloudflare, όλες οι εγγραφές CNAME να είναι «DNS only» (γκρι σύννεφο) και όχι proxied.

Όλες αφορούν μόνο τα app. και mail. subdomains. Το site, το www και τα υπάρχοντα email σας δεν επηρεάζονται.

Ευχαριστώ πολύ,
Άκος
Akos Digital Services
akosds.com · info@akosds.com
