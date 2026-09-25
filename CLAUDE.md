# zugmatch — PeerMatch, cleaned up

**Goal: a perfect working copy of PeerMatch with clean code.**

- **Same look, same features, same backups.**
- The code goes from 75 scripts that patch each other to about 15 clean files, where each feature
  lives in one place.
- **No design changes and no new features.** The only changes are the approved bug fixes below.

The owner uses PeerMatch every day on an Android phone and wants this cleaner version to replace
it.

## Sources — read these first

1. **`docs/REBUILD_INVENTORY.md`** — PeerMatch v131 screen by screen: every field, button, flow,
   storage key and history type, and the sizes and colors. This is the spec.
2. **`docs/FILE_MAP.md`** — which of the 75 PeerMatch scripts go into which new file.
3. **The PeerMatch code itself**, `shiduchim/match` on branch `main`.
   - Attach it **read-only**: never push to it, and never change its live site
     `shiduchim.github.io/match/`.
   - `sw.js` → `SCRIPTS` is the load order. When scripts disagree, **the later one wins**.
   - `CLAUDE.md` and `docs/` in that repo explain its history and rules.

## Build rules

- **Plain JavaScript modules** (`<script type="module">`). No framework, no build step, no
  TypeScript, no npm packages in the app itself. Dev-only tools for tests are fine.
- **One owner per feature.** No wrapping or overriding another file's functions, no
  MutationObservers, no capture-phase listeners, no `setInterval` polling, no `!important`. If
  something needs to change, change its owner.
- **Keep it small.** No dead code, no layers of old versions, no duplicated helpers. Remove
  anything that exists only to undo something else.
- **Keep external libraries exactly as PeerMatch loads them.** PDF.js 3.11.174 from cdnjs,
  Tesseract 5.1.1 from jsDelivr, and translate fallback to Google, all loaded only when needed.
  An attachment must still save when these are blocked, which happens under NetSpark.

## Data safety — most important

zugmatch will be served from the **same website address** as PeerMatch
(`shiduchim.github.io/zugmatch/` next to `/match/`). Both apps can therefore reach the same
browser storage. **zugmatch must never write to PeerMatch's data.**

- **Storage names:**
  - IndexedDB: **`ZugMatchDB`** (never `PeerMatchDB`)
  - localStorage keys: prefix **`zm`** (never PeerMatch's `pm…` keys)
  - service-worker cache names: prefix **`zugmatch-`**
  - service-worker scope: `/zugmatch/` only
- **Copy my data from PeerMatch.** A button on the Backup screen reads `PeerMatchDB` **read-only**.
  - Check it exists with `indexedDB.databases()` first.
  - Open it **without a version number**, so it is never upgraded or created.
  - Read only; copy into `ZugMatchDB`; close.
  - Photos, PDFs and audio are blobs and copy as they are.
- **Same data shape as PeerMatch.** `kv/state = {shadchanim, guys, girls}`, with the same record
  fields and the same activity types. Keep every unknown field.
- **Same backup format**: `PeerMatch_Backup_YYYY-MM-DD.zip` (`PeerMatchBackup` v2). Backups must
  move **both ways**, from PeerMatch to zugmatch and back.
  - The email backup is the TXT with the `PEERMATCH-BACKUP-TEXT-V1` header and the ZIP in Base64.
  - Encode Base64 in chunks whose size is a multiple of 3; decode in chunks that are a multiple
    of 4.
  - Restore accepts both the ZIP and the TXT.
- **Never invent a date or history.**

## Approved bug fixes (the owner said yes)

| # | Fix |
|---|---|
| 1 | **One WhatsApp send queue** (one localStorage key, one bottom bar) instead of PeerMatch's four. No `Storage.prototype.setItem` hook. Behavior as the owner sees it stays the same: Send N of M, then photo Yes/No, PDF-first, several shadchanim, recipient picker. |
| 2 | **History pairs written once, correctly.** A profile shared with a shadchan still gets one entry on each side, linked by a `shareLinkId` (so backups stay PeerMatch-compatible), but **both are written at send time**. There is no background reconciliation loop. Delete removes the pair. Old PeerMatch history is repaired once, on copy or import, respecting its deletion tombstones. |
| 3 | **The green "A shared profile is ready to import" banner** disappears once the shared item is saved or dismissed. |
| 4 | **No raw `*asterisks*`** from WhatsApp bold in list cards and names. Show the text plain (bold where PeerMatch renders bold). |
| 5 | **Every WhatsApp button opens WhatsApp directly** (`whatsapp://send?…` on Android, as PeerMatch's main flows already do). That includes the Contacts card, contact-person compose, Shadchan compose and phone numbers in profile text. There is one opener function. |
| 6 | **Contacts card buttons in the owner's order:** Call · WhatsApp · SMS. |

**Not approved; ask first:** "WhatsApp • Waiting" in the Shadchanim list comes from the last
message, not from the Waiting-for-reply button. Keep it as in PeerMatch unless the owner decides
otherwise. Any other behavior change also needs the owner's yes.

## How to work

1. **First**, read the sources and send the owner a **short** plan: the file list, the build
   order, and anything unclear. Then build.
2. **One area at a time**, in this order: shell + lists → person pages → forms → history +
   composer → sending → Make match → backup / copy from PeerMatch → WhatsApp import →
   attachments / translate → after-call popup.
3. **After each area, compare it with the real PeerMatch.**
   - `tools/peermatch-shots.spec.ts` screenshots PeerMatch with made-up data.
   - Take the same screens of zugmatch at 412 px wide, 2×.
   - Compare them **side by side**. They must match: order, sizes, colors, words.
4. **Tests.**
   - A Playwright test for each main flow, using made-up data.
   - A **backup round trip**: back up in zugmatch, restore, compare. Include the email TXT and a
     backup made by real PeerMatch code.
   - Run them in GitHub Actions before deploying.
5. **This repository is public.** Only made-up data: phone numbers containing `000`, emails at
   `example.com`. Run `node scripts/privacy-check.mjs` in CI; it can't catch names, so check those
   yourself.
6. **Deploy.** GitHub Pages via Actions; the owner turns on Pages in the repo settings
   (Source: GitHub Actions) after the first working push. Tell the owner the link, and to fully
   close and reopen the app after each update.
7. The owner reads on a phone: keep messages short and plain.
8. **Nothing is "device-verified" until the owner has tested it on the phone.**

## The owner's fixed preferences (already in PeerMatch; keep them)

- Yes / No buttons, never ✕.
- Call → Email → WhatsApp → SMS.
- Waiting yellow when on, gray when off.
- ב״ה above Edit; the girl's Photo button left of Edit, and girls' photos shown only when tapped.
- Israeli numbers shown local, sent to WhatsApp as international (972…); landlines have no SMS.
- Kosher phones: Call and SMS only.
- Free only.
