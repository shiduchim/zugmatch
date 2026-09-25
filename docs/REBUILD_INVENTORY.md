# PeerMatch Rebuild Inventory

> **For zugmatch.** Copied from `shiduchim/match`. Sections 1–11 are the spec: what PeerMatch does
> and how it looks. **Sections 12 and 13 are superseded** by `CLAUDE.md` in this repo: plain JS
> modules, own database, the approved bug fixes and the build order. For §11, "Things seen in the
> live app", the owner approved the fixes listed in `CLAUDE.md`.

Written against live runtime **v131**, from `sw.js -> SCRIPTS`: 75 scripts read in load order.
Checked against the owner's phone screenshots taken the same week.

Goal of the rebuild:

- **Same layout and behavior the user already knows.** This document is the spec for that.
- **Clean code underneath**, so the app is easy to change afterwards (see §12).

Nothing in this document is a new feature. Where the live app has a bug or an inconsistency, it
is listed in §11 and left for the user to decide on. It is not silently "fixed" in the spec.

No real names, phones or emails appear here on purpose.

---

## 1. App shell

**Header** (sticky, background `#f6f5f2`):
- Top-left: link **Backup**.
- Center: brand **PeerMatch** (29px, weight 800).
  - Under it, the subtitle "Private shidduch contact & profile tracker".
  - Then a small version pill, `v131` (soft background, accent text).
- Top-right: **ב״ה** (small), and under it the dark pill button **Make match**.
- Under the header: the underlined link **Request an app feature**, which opens a `mailto:` to the owner.
- Green banner "A shared profile is ready to import." It shows while a share-target item is
  pending in `inbox/pending`.

**Bottom nav:** three equal tabs, **Shadchanim · Guys · Girls**.
- 68px tall, white.
- The active tab has a light tint (`#f7fafc`) and accent-colored text.

**Everything else is a bottom sheet** (`#modal/#sheet`), not a page or route:
- details, forms, Make Match, Backup, pickers.
- Sheet: max 93vh, top corners 24px.
- Tapping the backdrop closes it.
- Detail sheets open nearly full height.

**Design tokens**

| Token | Value |
|---|---|
| bg | `#f6f5f2` |
| card | `#fff` |
| text | `#19324a` |
| muted | `#73818b` |
| line | `#e0dfdc` |
| accent | `#315b78` |
| soft | `#eaf1f6` |
| light-blue buttons | `#dfeef9` with text `#19324a` |
| green (banner/call status) | `#eaf5ec`, border `#cfe5d5`, text `#245f37` |
| waiting / reminder yellow | `#fff7dd` / `#fff1cf`, border `#ead79d`, text `#76551c` |
| danger soft | pink background, dark-red text (Delete) |

**Shapes and type**
- Cards: radius 18, 14px padding, 1px line border.
- Inputs: radius 14.
- Font: system-ui.

## 2. List screens

The three lists share one layout:

- **Title row:** big h1 (27px) followed by pills.
  - **Guys/Girls:** "Waiting for reply N".
  - **Shadchanim:** "Waiting for reply N" and "Calls N".
  - A pill is yellow when N>0 and gray at 0. Tapping it opens a bottom-sheet list.
- **Toolbar:** search input, then **Add** (dark, primary).
  - Shadchanim also has **Import** (light), which takes a WhatsApp chat ZIP.
- **Card row:**
  - checkbox (22px) at the left
  - Shadchanim only: a 52px rounded initials avatar
  - name (bold)
  - small lines:
    - Guys/Girls: pills **Age N**, **From <contact>**, **Screenshot** (when an image is attached); then the contact phone; then the last activity, or a snippet of the profile text
    - Shadchanim: the last activity snippet, then "WhatsApp • Waiting / • Reply received"
  - chevron `›` at the right
  - Photos are **hidden in the lists** (Guys and Girls).
  - Rows waiting for a reply are tinted yellow.
  - A selected card gets an accent border and a light background.
- **Search** is a plain lowercase substring match:
  - Shadchanim: name, phone, email, tags, activity texts.
  - Guys/Girls: name, profile text, contact, activity texts.
  - `lookingFor` is **not** searched (a deliberate product decision).
- **Shadchan referral tree.** A shadchan whose `referredById` points to another shadchan is listed
  under the one who referred them.
  - Under that referrer's card sits an attached toggle strip "▲/▼ N referred shadchanim". It is
    80% wide, colored `#edf4f8` / `#315b78`, and touches the card above it.
  - The child cards are indented and slightly smaller, with a left border.

**Selection bar.** It appears under the toolbar once anything is selected, as a white card:

```
Share this profile            (or "Share this shadchan")
[ Email ] [ SMS ] [ WhatsApp ]              ← 3 equal light-blue buttons
───────────────────────────────
N selected | Select all | Delete (pink) | Clear
```

Selection is kept per list, and read only through `pmGetSelected(kind)`. It is never rebuilt from
the DOM.

## 3. Guy / Girl detail (top to bottom)

1. **Sticky header:**
   - round back button (≈50px circle, chevron) at left
   - name (large, wraps to 2 lines)
   - media tile: the face-cropped photo (scale 1.42, top). Tapping it opens a full-screen viewer.
     - **Girl:** no tile. Instead a small **Photo** button sits immediately left of Edit.
   - at right: **ב״ה** stacked above a compact **Edit** button (58px)
2. **Last call status** banner (green). Shown only if a `call-note` activity exists.
   - Top line: "Last call status • phone", with the timestamp at right.
   - Then "Answered / Not answered • ~Ns away", the note text, and audio if recorded.
   - It is computed from the latest call note and is not stored as its own field.
3. **Meta pills:** Age N, plus Landline or VoIP badges.
4. **Contact row:** 5 equal buttons.
   - **Call · Email · WhatsApp · SMS** (light blue).
   - **Waiting for reply** toggle (outlined; yellow when on).
   - Order is fixed: Call → Email → WhatsApp → SMS.
   - The row targets the contact person (contact 1).
5. **Translate** button.
   - Opens a bar with English, Hebrew and Russian.
   - Uses Chrome's on-device Translator when available. Otherwise it falls back to Google
     Translate (network).
   - The translation is shown in a box. The original text is never changed.
6. **Profile text** card:
   - `pre-wrap` text
   - WhatsApp `*bold*` rendered bold
   - phone numbers turned into underlined links, which open a picker "Open phone number": Call | WhatsApp | Cancel
7. **Looking for / To what age** box, when present.
8. **Profile attachment** box, when present: file name plus **Open PDF** / **Open attachment**.
   - Images open in the viewer, with [Share / save][Close].
   - PDFs download directly.
9. **Quick details (1):** "Talked by phone" and "Talked in person" checkboxes.
   - Each one reveals a "Conversation info" textarea. It autosaves.
10. **Contacts** card, with 3 rows. Each row shows "Kind: name", then the phone, then
    [Call][SMS][WhatsApp], or "No phone number" in italics.
    - Profile (the person's own `profilePhone`; the row label is hidden)
    - Contact 1
    - Contact 2
11. **Quick details (2)** box:
    - flag checkboxes: Divorced, With kids, Kosher for Kohen, Kohen, Baal teshuvah,
      Watches movies, Prays 3x daily, Smokes
    - **Speaks languages:** English / Hebrew / Russian
    - **Body type:** Regular / Overweight (a single choice)
    - text rows: **Tags**, **Religious level**, **Religious details**
    - Autosaves 250ms after typing stops.
12. **Linked Shadchan** box.
    - Dropdown button: "Add linked Shadchan… ▾", or the linked name.
    - Its menu has "No linked Shadchan", then all shadchanim A–Z as "name • phone".
    - Plus an **Open** button.
13. **History:**
    - A blue band titled "History".
    - Entries are light cards, newest first. Each shows:
      - title at left, timestamp at right, then a red **Delete** link (asks to confirm)
      - an optional "To: name • phone • email" line (accent, bold)
      - the body
    - Outgoing WhatsApp entries are indented to the right, like chat bubbles.
14. "Added to PeerMatch: <date time>" (small, muted). Shown only when a real date is known.
15. **Fixed composer** at the bottom:
    - a pill input "Note…"
    - a round dark button: mic when the input is empty (records an audio note), send when there
      is text, red and pulsing while recording

## 4. Shadchan detail

1. Sticky header: back button, name, a "PDF / screenshot" attachment tile, and a compact Edit.
2. Last call status banner (the same as for a profile).
3. Contact row, labeled "Contact shadchan": Call · Email · WhatsApp · SMS · Waiting for reply.
4. **Call reminder row:** [Call today] [Call tomorrow] [Clear] (shows "No reminder" when none is set).
   - The active button is yellow.
   - Stored in `callReminderDate`.
5. **Linked profiles (N):** chips "Guy: name" / "Girl: name". Each opens that profile.
6. "Referred by: X".
7. Quick details: the Tags / Religious level / Religious details rows, and Talked by phone /
   Talked in person.
8. The "Shadchan profile / notes" card, then the attachment box.
9. History, the added date, and the fixed composer (all the same as §3).

WhatsApp, SMS and Email from the Shadchan detail open a compose sheet (message textarea →
Continue). Continue logs the outgoing message and then opens the app.

## 5. Forms

**Add / Edit Guy or Girl:**
- **Header tools:**
  - Photo tile ("Photo / screenshot", tap to pick, Remove)
  - **PDF / screenshot** button
  - **Audio profile** record button
- **Fields:**
  - **Name** (optional) and **Age**, side by side.
  - **Paste profile** small button → **Profile** textarea.
    - On paste or typing, **empty** fields are autofilled from the text: name (from a
      `Name: / שם: / Имя:` line, or the first line), age (EN/HE/RU patterns) and contact
      name/phone/email (from the bottom of the text).
    - A phone that matches a shadchan fills in that contact's name.
  - **Looking for** textarea | **To what age** (18–99).
  - **Contacts** block:
    - Profile phone
    - Contact 1 name | phone
    - Contact 2 name | phone
  - **Attachment** box:
    - **Attach only**, **Attach + parse text**, **Remove**
    - Parsing is optional (PDF.js text, then Tesseract OCR for eng/heb/rus). It may be blocked
      under NetSpark.
    - A failure never blocks attaching.
  - Tags · Religious level · Religious details.
- **Save rule:** needs text **or** audio **or** image **or** attachment. The name defaults to
  the first line.
- **Buttons:** fixed bar [Save Guy/Girl] [Cancel].

**Add / Edit Shadchan:**
- Fields:
  - Name (required)
  - Phone
  - Email
  - Tags
  - **Referred by**: free text ("Type a name or phone number, or choose below") plus a select
    "Choose an existing Shadchan (optional)"
    - Status line under it: "Linked to X" or "New/manual referrer".
  - Religious level
  - Religious details
  - Profile / notes
  - PDF / screenshot attachment
- **Phone inputs** (all forms):
  - Israeli numbers are normalized to the local `05X-XXX-XXXX` form on blur or paste.
  - Hints: "Matches Shadchan: X", "Israeli landline — SMS unavailable", "Israeli nationwide /
    VoIP number".

## 6. Flows

### Sharing from the selection bar

A. **Guys/Girls → WhatsApp.** One router decides the case, in this order:
1. **Any selected profile has a PDF:**
   - The actual PDF is shared through the phone's share sheet, one task at a time.
   - Without a shadchan, the "Who are you sending this to?" picker comes first.
2. **One profile + two or more shadchanim:**
   - Sent recipient by recipient.
   - The bar reads "Send NAME to SHAD (i of n)".
3. **Profiles + exactly one shadchan:**
   - Each profile goes as its own message.
   - The bar reads "Send profile i of n to SHAD".
4. **No shadchan:**
   - A picker sheet opens, "Who are you sending this to?":
     - Existing Shadchan (optional)
     - Name
     - Phone (optional)
     - [Continue to WhatsApp] [Cancel]
   - With no phone, WhatsApp opens and the user picks the chat there.

All four cases share the same **black bottom queue bar**:
- label + [Send] [Cancel]
- then, for profiles that have a photo, "Send NAME's photo?" [Yes] [No]. The photo goes through the share sheet.
- Android opens `whatsapp://send?phone=&text=` directly, so closing WhatsApp returns to PeerMatch.
- Mixing Guys and Girls in one selection shows an alert.

B. **Share text** (every WhatsApp/SMS/Email text path):

```
Name
Age: N
<profile text, keeping only lines in the included languages>
Sent by: <contact 1>
Sender phone: <phone>
```

C. **SMS / Email:**
- A language dialog comes first: "What language should be included?" (EN/HE/RU).
- With several profiles, they are sent one at a time ("… profiles separately").
- Email: if a profile has a photo or PDF, the share sheet sends files and text. Otherwise it
  opens `mailto:`.
- SMS: `sms:?body=`, with asterisks removed.

D. **Shadchanim → WhatsApp with no profiles selected:**
- Sends the shadchan's contact card: name, Phone, Email, Tags.
- If several are selected, a sheet sends them one by one: "Send NAME (i of n)".

### Make match

Needs exactly 1 guy + 1 girl selected, and at most 1 shadchan. It opens as a full sheet:

- **SUGGESTED MATCH** card:
  - GUY | GIRL boxes, side by side
  - SHADCHAN, or "Not selected"
- **Send to** select: the Shadchan, Girl contact person • phone, or Guy contact person • phone.
- **Message** textarea, with this template:

  ```
  Shidduch suggestion
  Guy: X
  Girl: Y

  Hi <recipient>,

  --------------------
  GUY — name (age N)
  <text>
  CONTACT
  <name / phone>
  --------------------
  GIRL — …
  ```
- **Include in this match message:** English / Hebrew / Russian checkboxes.
- Checkbox **Include profile photos with WhatsApp / Email**.
- 4 light-blue buttons: **Contact** (calls the selection) · SMS · WhatsApp · Email.
- Hint text.
- SMS, WhatsApp and Email require profile text.
- History is written on the guy, the girl and the shadchan with a shared `matchId`:
  "Match sent • Channel" or "Match contact • who".

### Call follow-up

- Tapping any **Call** button, then returning to the app 0.6s–3h later, opens the popup
  "Call ended — add a status update?".
- The popup contains, in order:
  - the name and phone
  - for a shadchan with a reminder: "Follow-up: Call Today" plus [Cancel follow-up]
  - a note field
  - **Record audio note**
  - **Was the call answered?** [Yes] [No]. The default is a guess: Yes if away at least 15s. The popup says it is a guess.
  - [Save status update] [Skip]
- It is saved as a `call-note` activity.

### Waiting for reply

- The toggle in the contact row sets `waitingForReply` and `waitingForReplySince`.
- It logs "Waiting for reply" or "Reply received".
- The title-row pill lists everything that is waiting.

### Calls to make

- The Shadchanim pill "Calls N" opens a sheet "Calls to make (N)".
- It lists names with Overdue / Today / Tomorrow / a date; Today and Overdue rows are yellow.
- Tapping a row opens that shadchan.
- Reminders are for shadchanim only.

### WhatsApp chat ZIP import (Shadchanim → Import, or a ZIP shared into the app)

- **What it reads** from the ZIP:
  - `_chat.txt`
  - `.vcf` contact cards
  - attachments
- **Review sheet** "Import WhatsApp ZIP":
  - **Chat source:** an existing shadchan, or a name, plus:
    - "Add this chat person as a shadchan"
    - "Import this conversation into History (N messages)"
  - **Shadchanim found:** checkbox, name, phone, email, and "already in PeerMatch".
  - **Possible profiles:** checkbox, preview, name, age, Guy/Girl, attachment, contact person.
    - Detection is scored EN/HE/RU.
  - Sticky bar: [Import selected] [Cancel].
- **Results:**
  - New shadchanim get `referredBy` set to the chat source.
  - Profiles get "Imported from WhatsApp".
  - Messages become `wa-in` / `wa-out` entries, deduplicated by `importKey`.
  - Duplicates are matched by phone or name for shadchanim, and by name+age or a text hash for
    profiles.

### Share target

- The manifest `share_target` POSTs to `./share-target`: title, text, url, and files (image, text, PDF, ZIP).
- The service worker stores it as `inbox/pending` and redirects with `?shared=1`.
- The app then shows "Import Shared Profile":
  - the text preview
  - [Guy] [Girl] [Later]
  - or, as a WhatsApp reply, pick which shadchan it came from
- A ZIP goes to the import flow.

### Backup

- **Backup** opens a sheet with:
  - [Save backup to phone / computer]
  - [Email backup]
  - [Restore Backup]
  - "Last backup" date (`localStorage.pmLastBackupAt`) and a progress line
- **ZIP:** `PeerMatch_Backup_YYYY-MM-DD.zip`, stored uncompressed.
  - `data.json` = `{format:'PeerMatchBackup', version:2, createdAt, appVersion, database,
    databaseVersion, counts, stores:{name:[{key,value}]}}`.
  - Blobs are saved as files under `photos/ audio/ attachments/ files/`, and replaced in the JSON
    by `{__peerMatchFile:1, path, type, name, lastModified}`.
  - Dates are saved as `{__peerMatchDate}`.
- **Email backup:** `PeerMatch_Backup_YYYY-MM-DD.txt` = `PEERMATCH-BACKUP-TEXT-V1\n` + Base64 of
  the exact ZIP bytes, sent through the share sheet. It is **not encrypted**.
  - The Base64 is chunked in multiples of 3 when encoding and 4 when decoding.
- **Restore:**
  - Accepts the .zip or the .txt, and checks CRCs.
  - Shows a preview of the counts and the warning "will replace".
  - Then clears the stores, writes the data and reloads.

**The rebuild must read and write this exact format**, so today's backups restore into the new
app and the new app's backups restore into the old one.

## 7. Data model

The IndexedDB database `PeerMatchDB` (version 2) has two stores:

- `kv`: key `state` = `{shadchanim:[], guys:[], girls:[]}`.
- `inbox`: key `pending` = the shared item.

Keep every unknown field when loading and saving.

**Guy / Girl record**

| Field | Notes |
|---|---|
| `id` | number, usually `Date.now()` at creation |
| `name`, `age`, `text` | profile text |
| `createdAt` | ms. Only set when the real date is known. **Never invented.** |
| `photo`, `profileImage`, `profileMedia`, `profileMediaFull`, `profileMediaThumb` | Blobs. Full image ≤1600px; thumb 320px webp |
| `profileAudio` (+ `profileAudioText`, transcription status fields from older versions) | audio profile Blob |
| `profileAttachment`, `profileAttachmentName`, `profileAttachmentType` | PDF or other file |
| `profilePhone`, `contact1Name`, `contact1Phone`, `contact2Name`, `contact2Phone` | current contact fields |
| `source`, `sourceName`, `sourcePhone`, `sourcePhone2`, `sourceEmail`, `sourceName2` | legacy mirrors, kept in sync |
| `sourceShadchanId(2)`, `sourceShadchanName`, `linkedShadchanId`, `linkedShadchanManual`, `importedFromShadchan(Id)` | shadchan links |
| `lookingFor`, `lookingForMaxAge` | |
| `tags`, `religiousLevel`, `religiousDetails` | |
| `divorced`, `withKids`, `kosherForKohen`, `kohen`, `baalTeshuvah`, `watchesMovies`, `prays3Daily`, `smokes` | boolean flags |
| `langEnglish`, `langHebrew`, `langRussian` | speaks |
| `shareEnglish`, `shareHebrew`, `shareRussian` | languages to include when sharing |
| `bodyType` | `'regular'`, `'overweight'` or `''` |
| `talkedPhone`, `talkedInPerson`, `phoneConversationNote`, `inPersonConversationNote` | |
| `waitingForReply`, `waitingForReplySince` | |
| `activities[]` | see below |

**Shadchan record**

| Field | Notes |
|---|---|
| `id`, `name`, `phone`, `email`, `tags` | |
| `referredBy`, `referredById` | free text, plus the id it resolves to by unique phone or name |
| `profileText` | "Profile / notes" |
| attachment fields | same as a profile |
| `religiousLevel`, `religiousDetails`, talked fields, waiting fields | same as a profile |
| `callReminderDate` | `YYYY-MM-DD` |
| `createdAt`, `activities[]` | |

**Activity** `{id, type, ts (locale string), text, …}`. The types are:

| Type | Extra fields / meaning |
|---|---|
| `text` | a note |
| `audio` | `audio` Blob |
| `call-note` | `text`, `audio?`, `phone`, `answered`, `durationApproxSec?` |
| `wa-out` / `wa-in` / `sms-out` / `email-out` | `recipient`, `recipientPhone`, `recipientEmail`, `recipientSide`; imports add `importKey`, `importedFrom`, `whatsappSender` |
| `action` | `action` label (examples below) |

Examples of `action` labels:
- `Call • Contact 1`
- `Profile sent • WhatsApp` / `Profile received • WhatsApp`
- `Profile shared • WhatsApp|SMS|Email`
- `Profile PDF shared • WhatsApp`
- `Match sent • Channel`
- `Waiting for reply` / `Reply received`
- `Call reminder set` / `Call reminder cleared`
- `Imported from WhatsApp`
- `Profile phone • Call`

Fields on share `action`s:
- `channel`
- `recipientShadchanId`, `shadchanId`
- `sharedProfileId`, `sharedProfileName`, `sharedProfileKind`
- `profileId`, `profileName`
- **`shareLinkId`**: the same value on both sides of a share pair
- `mirroredFrom*ActivityId`

Match actions also carry `matchId`, `guyId`, `girlId`, `shadchanId`.

**History rules that must be kept:**
- A profile→shadchan share is written on **both** records, with one `shareLinkId`.
- Deleting one side deletes its pair.
- Deletions leave tombstones (`localStorage.pmDeletedShareHistoryV127`, at most 500), so a
  legacy repair can never bring them back.
- Sending the same profile twice gives two separate pairs.

**Other localStorage keys:**
- `pmLastBackupAt`
- `pmCallFollowupV129`
- the queue keys `pmWaSendQueue`, `pmMultiShadWaQueue`, `pmGeneralWaQueueV120`,
  `pmV124PdfSendQueue`. The rebuild uses **one** queue key and clears these.
- sessionStorage: the open/closed state of referral groups

## 8. Phones

- **Israeli numbers:**
  - `+972`, `00972` and `972` become the local `0…` form.
  - Display: `05X-XXX-XXXX` or `0X-XXX-XXXX`.
  - Landlines (02, 03, 04, 08, 09) have no SMS.
  - VoIP / nationwide numbers are 072–078.
  - WhatsApp uses the international form `972…`.
- **Other international numbers** (+1 and so on) are kept as typed.
- **Matching** uses a phone key: digits without the country code or the trunk 0.

## 9. Service worker and PWA

- Network-first. Precaching is best-effort, one file at a time (never `addAll`).
- `VERSION` is used in the cache name `peermatch-vNNN`, and old caches are removed.
- The share-target POST handler is described in §6.
- The theme color is `#315b78`.
- Runs under NetSpark, so the core app must not depend on any CDN. PDF.js and Tesseract are
  optional extras.

## 10. Stable user preferences

These are not up for change in the rebuild:

- Choices are shown as **Yes / No**, never as ✕ symbols.
- Contact order is **Call → Email → WhatsApp → SMS**.
- Waiting is yellow when active and gray when not.
- ב״ה sits above Edit.
- The girl's Photo button sits immediately left of Edit.
- Reminders are for shadchanim only.
- Basic (kosher) phones may only have Call and SMS.
- Free options only. Nothing goes to the cloud.
- Dates are never invented.

## 11. Things seen in the live app

The user decides what to do about these. Each item says what the rebuild will do by default.

1. **"A shared profile is ready to import."** stays up after the shared item was dealt with.
   - The banner can get stuck.
   - Rebuild: clear it once the item is filed or dismissed.
2. **The Shadchanim list snippet shows raw `*asterisks*`** from WhatsApp bold.
3. **"WhatsApp • Waiting"** in the Shadchanim list comes from the last `wa-out`/`wa-in`, not
   from the Waiting-for-reply toggle.
   - So a row can show "Cleared waiting for reply" and "• Waiting" at the same time.
   - Rebuild: ask the user which meaning to keep.
4. **The subtitle is cut off** ("…tracke…") on a phone.
5. **Some WhatsApp paths still go through `wa.me`** (the browser intermediary):
   - shadchan-detail compose
   - contact-person compose
   - the Contacts card
   - inline phone links
   - Rebuild: one WhatsApp opener used everywhere.
6. **Four WhatsApp send queues** kept apart by a `setItem` hook. Rebuild: one queue.
7. **The Contacts card buttons are in the order Call | SMS | WhatsApp.** This differs from the
   stated order (Call → Email → WhatsApp → SMS).
8. **Make Match "Contact"** doesn't trigger the call follow-up (its label isn't "Call").
9. **The Translate fallback** calls Google over the network. Keep it optional.
10. **`religiousLevel` was a number 0–10 in older versions**, and is free text now. Show old
    numbers as text.

## 12. How the rebuild is organized (so it is easy to change afterwards)

> **Update, same day.** The owner chose to build the new app on the **ZivugBase engine** instead
> of plain files, keeping this document as the look-and-behavior spec. That engine is Preact,
> IndexedDB through Dexie, tests and CI, and it lives in `shiduchim/zivugbase`.
>
> PeerMatch backups are imported into it, and the import can be repeated safely. The old app is
> not changed.
>
> The plan and the features added from ZivugBase (folders, Intake folder, Calls due for anyone,
> Memos, and more) are in `docs/REBUILD_PLAN.md` in that repo. The principles below still apply:
> one owner per thing, no patch layers.

The current app is 75 scripts that patch each other. Adding anything means finding which of them
really owns the behavior.

The rebuild has **one owner for each thing**:

```
index.html          shell only
styles.css          all tokens and components (§1)
src/
  db.js             load/save PeerMatchDB, keeps unknown fields
  model.js          record defaults, legacy-field sync, phone helpers (§8)
  history.js        addActivity, delete with share-pair + tombstones
  ui/sheet.js       bottom sheet, back handling
  ui/list.js        lists, search, selection bar, referral tree
  ui/profile.js     Guy/Girl detail (sections in §3, in one ordered array)
  ui/shadchan.js    Shadchan detail
  ui/forms.js       Add/Edit forms
  ui/fields.js      the field lists (flags, languages, body type, contacts)
  share/router.js   the one WhatsApp/SMS/Email router + one queue bar
  share/text.js     share text + language filter
  match.js          Make Match
  calls.js          call follow-up, reminders, waiting
  import-wa.js      WhatsApp ZIP import
  backup.js         ZIP/TXT backup + restore (same format)
tests/              unit tests for the pure parts, e2e for key flows
```

How changes are made after the rebuild:

- **A new yes/no flag** is one line in `ui/fields.js`.
- **The detail section order** is one array in `ui/profile.js`. Moving a section means moving one line.
- **Colors and sizes** live only in `styles.css` tokens.
- **Every message, or any other place that opens WhatsApp,** goes through `share/router.js`.
- **No MutationObservers, no global function overrides, no capture-phase listeners.**
- It stays plain JS, loaded without a build step, so GitHub Pages serves it as is. The app keeps
  working offline and under NetSpark.

## 13. Rollout plan

1. Build the new app in a separate folder (`/v2/`) of this repo. The current app stays live and untouched.
2. Restore a real backup into it. Compare the two screen by screen, on the phone, against this
   document and the screenshots.
3. Fix the differences. The user decides on the §11 items.
4. Switch the main address to the new app. Keep the old one reachable at `/legacy/` for a while.
5. Only then, start making changes: the Inbox, a Home summary, and whatever else the user asks for.
