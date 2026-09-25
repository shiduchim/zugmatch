# From 75 PeerMatch scripts to about 15 clean files

PeerMatch v131 (`shiduchim/match`, `sw.js` → `SCRIPTS`) loads 75 scripts in order. Each later
script wraps or overrides what earlier ones did. **Only the final, effective behavior counts.**
`REBUILD_INVENTORY.md` records that behavior, and the tables below say where it goes.

When a PeerMatch script is unclear, read it together with **every later script in the table that
touches the same thing**. The last one wins.

## Target files (plain JavaScript modules, no framework, no build step)

| File | Owns |
|---|---|
| `index.html` | The shell: header, three tabs, sheet container. Loads `styles.css` and `js/app.js`. |
| `styles.css` | **All** styles, in one place. The final effective values from every script's injected CSS, merged, with no `!important` wars. |
| `js/app.js` | Start-up, header (Backup · ב״ה · Make match · Request an app feature · version badge), tabs, opening and closing sheets (Back closes the sheet), selection state (`getSelected(kind)`), and the shared-item banner. |
| `js/db.js` | Storage: its own IndexedDB `ZugMatchDB` (same data shape as PeerMatch), load and save, `zm`-prefixed localStorage, and the **read-only** "Copy my data from PeerMatch". |
| `js/util.js` | `esc`, `stamp`, dates, ids, **phones** (normalize, display, landline/VoIP, WhatsApp digits, matching key), age from text, language-line filter, WhatsApp `*bold*` rendering, safe file names. |
| `js/lists.js` | The three lists: cards, search, share bar (Email · SMS · WhatsApp · Select all · Delete · Clear), Waiting-for-reply pill and list, Calls pill and "Calls to make", yellow rows, referral grouping for shadchanim. |
| `js/person.js` | Guy/Girl detail and Shadchan detail, every section in order: header, last call banner, contact row, Translate, profile, looking for, attachment, talked by phone / in person, Contacts card, quick details, Linked Shadchan / linked profiles, call reminders, added date. |
| `js/forms.js` | Add/Edit Guy, Girl and Shadchan: Paste profile + autofill, contacts, looking for, attachment box, tags and religious fields, referred-by picker, validation. |
| `js/history.js` | History rendering (every activity type), Delete (with share pairs), the Note/mic composer, and the after-call popup. |
| `js/send.js` | **Everything outgoing, in one place.** The contact buttons and compose sheets, inline phone picker, the **one** WhatsApp send queue (text → photo Yes/No, PDF-first, several shadchanim, recipient picker), SMS and Email sharing with the language dialog, the shadchan contact card, and **one** WhatsApp opener. |
| `js/match.js` | Make match. |
| `js/backup.js` | Backup screen, ZIP backup (format `PeerMatchBackup` v2), email TXT (Base64), restore (ZIP or TXT). |
| `js/import-whatsapp.js` | WhatsApp chat ZIP import and its review screen. |
| `js/attach.js` | Attachments (open, download, viewer), PDF.js/OCR parsing, Translate. |
| `sw.js` | Service worker: best-effort precache, network-first, share target → queue. |

If a file grows past about 1,000 lines, split it by screen, not by patch.

## Where each PeerMatch script goes

| PeerMatch script(s) | Goes to |
|---|---|
| `index.html` (inline script), `ui-v18`, `edit-buttons-v77`, `girl-photo-v83`, `feature-request-v46`, `v131-version-badge` | `index.html`, `app.js`, `styles.css`, `person.js` (header) |
| `peermatch-v11` (selection), `selection-layout-v54`, `selection-sms-fix-v87` | `app.js` (selection), `lists.js` (share bar) |
| `whatsapp-enhance` (list lines, incoming share), `profile-display-v48`, `profile-waiting-list-v89`, `waiting-v65`, `shadchan-referral-v95`, `referred-group-style-v98/v99/v101`, `ux-v65` (referral tree), `ux-v65-fix` | `lists.js`, `app.js` (incoming) |
| `peermatch-v19` (media, detail, forms), `audio-v24`, `ux-v65`, `attachment-v66`, `phone-ui-v69`, `link-context-v71`, `ui-fixes-v73` (contact heading), `profile-contact-v74`, `linked-shadchan-v75`, `shadchan-layout-v76`, `contact-inline-v79`, `reverse-links-v80`, `profile-under-layout-v85`, `detail-controls-v91`, `stable-details-v93`, `profile-contacts-v96` (detail), `link-recovery-v65`, `added-date-v109` | `person.js` |
| `sender-fields-v39`, `profile-required-v44`, `forms-v65`, `form-order-v86`, `tags-v68`, `profile-tools-v62` (autofill, tags), `profile-contacts-v96` (form), `workflow-v103` (Paste profile, placeholders), `contact-phone-fix-v105`, `profile-looking-for-v123` | `forms.js` |
| `history-delete-v30`, `history-composer-v36`, `history-recipient-v96`, `dual-share-history-v100`, `v129-call-followup`, `audio-v24` (`acts()`) | `history.js` |
| `profile-contact-v40`, `contact-actions-v56`, `inline-phone-actions-v92`, `final-fixes-v107`, `profile-share-v52`, `email-photo-v51`, `shadchan-share-v55`, `v119-multi-shadchan`, `v120-general-whatsapp`, `v121-shadchan-whatsapp`, `v124-pdf-share-fix`, `v117-ui-fix`, `v128-runtime-hardening`, `workflow-v103` (call reminders) | `send.js` (reminders → `person.js`) |
| `send-match-v27`, `make-match-v32`, `match-text-required-v33`, `make-match-v60-ui`, `make-match-v65-fix` | `match.js` |
| `backup-v28`, `v124-backup-pdf-share`, `v125-email-backup-direct` | `backup.js` |
| `whatsapp-import-v61` | `import-whatsapp.js` |
| `profile-pdf-ocr-v63`, `attachment-choice-v84`, `translate-v65`, `ui-fixes-v73` (translate) | `attach.js` |
| `phone-links-v64`, `contact-phone-fix-v105`, `profile-tools-v62` (language filter) | `util.js` |
| `sw.js` | `sw.js` |

Scripts that only hid or undid something an earlier script did (`ux-v65-fix`, `link-context-v71`,
`v117-ui-fix`, `v128-runtime-hardening`, most `*-fix` files) produce **no code**. Build the final
result directly.
