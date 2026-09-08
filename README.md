# For her: Shaqeelah 💗

A private, shared memory album — a photo gallery where each photo can carry
its own caption/quote and a looping 20-second clip from a shared song
library — built as a static site for free hosting on GitHub Pages.

## Stack

- Vanilla HTML/CSS/JS (ES modules, no build step)
- [Cloudinary](https://cloudinary.com) unsigned uploads for photo *and*
  audio hosting
- [Firebase Firestore](https://firebase.google.com/docs/firestore) for photo
  metadata and the shared song library

## Project structure

```
index.html              Single-page app: cover/gate + gallery + composer + lightbox
css/style.css            All styling
js/firebase-init.js      Firebase app + Firestore init
js/cloudinary-config.js  Cloudinary cloud name / upload preset
js/gate.js               Client-side PIN gate
js/gallery.js            Upload/edit composer + live gallery + lightbox (Firestore + Cloudinary)
js/utils.js              Shared helpers
js/app.js                Bootstraps the gate + gallery
firestore.rules          Security rules to paste into the Firebase console
```

## How it works

- Tap **+ Add Photo** to open the composer: pick a photo, optionally add a
  title/quote, and optionally attach a song. The photo uploads to Cloudinary
  and its metadata is saved to the `photos` collection in Firestore —
  everyone viewing the site sees it appear live.
- **Songs** are their own shared library, stored in a `songs` collection.
  In the composer's song picker, either choose an existing song or tap
  **+ New** to upload an audio file (mp3, etc.) — it uploads to Cloudinary
  (as a "video" resource, which is how Cloudinary handles audio) and gets
  added to the library for both of you to reuse on any photo. Once a song
  is picked, drag the slider to choose which 20 seconds of it play — there's
  a preview button to listen before saving.
- Tap any photo to open it full-screen. If it has a caption, it's shown
  below the photo; if it has a song, that 20-second clip attempts to play
  on loop automatically (tap the play/pause pill if your browser blocked
  autoplay — common on strict mobile browsers).
- Inside the full-screen view, **Edit title, quote & song** lets either of
  you change those fields on an existing photo later, including swapping to
  a different song or re-picking the clip — the photo itself and who
  uploaded it can't be changed.

## Running locally

Because the app uses ES modules and `crypto.subtle` (for the PIN gate),
open it through a local server rather than double-clicking `index.html`:

```bash
# any static file server works, e.g.:
npx serve .
# or
python -m http.server 8000
```

Then visit `http://localhost:8000` (or whatever port it prints).

## The PIN gate

The passcode is currently **4ShaKever**. Only its SHA-256 hash is stored in
[js/gate.js](js/gate.js) — to change the PIN, compute a new hash and replace
`PIN_HASH`:

```bash
printf '%s' 'your-new-pin' | openssl dgst -sha256
```

Once someone enters the right PIN on a device, that device remembers it
(`localStorage`) and won't be asked again. This is a casual deterrent, not
real security — see below.

## Deploying to GitHub Pages

```bash
git init
git add .
git commit -m "Initial scaffold"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

Then in the GitHub repo: **Settings → Pages → Source → Deploy from branch →
main / (root)**. The site will be live at
`https://<your-username>.github.io/<repo-name>/` within a minute or two.

## ⚠️ Before you make the URL public: lock down Firestore

Your Firestore database is currently in **test mode**, which means anyone
with your `projectId` (visible in this repo's source) can read *and write*
every document — and test-mode rules also auto-expire after 30 days, which
would silently break the app.

**Do this before sharing the link:**

1. Open [firestore.rules](firestore.rules) in this repo.
2. Go to Firebase Console → **Firestore Database → Rules**.
3. Replace the existing rules with the contents of that file, then **Publish**.

What those rules do:
- Allow public **read** of the `photos` and `songs` collections (needed for
  the gallery to load with no login system).
- On `photos`, allow **create** only when the new document has just the
  expected fields, a Cloudinary-hosted `url`, a reasonable-length
  `uploadedBy`, and — if present — a `caption` under 120 characters, a
  `subcaption` under 300, and a `songId` that actually points at a real
  document in `songs`.
- Allow **update** on `photos` only when it touches `caption`,
  `subcaption`, `songId`, `songStart`, and/or `favorite` (same validation
  as above) — the image, uploader, and timestamp can never be changed
  after creation.
- Allow **delete** on `photos` unconditionally, so either of you can remove
  a photo from the app (note: this also means anyone with the site URL
  could delete photos — see the limitation below).
- On `songs`, allow **create** only with the expected fields and a
  Cloudinary-hosted `url`; deny update/delete entirely (songs are
  write-once — no in-app way to rename or remove one yet).
- Deny everything else by default.

**Important limitation:** there is no Firebase Auth in this app, so these
rules can't distinguish "you and her" from a stranger who found the URL —
they only constrain the *shape* of writes. If you want stronger protection,
two options, roughly in order of effort:

- **Firebase App Check** (recommended, low effort): register the site with
  reCAPTCHA v3 or App Check's Enterprise/Play Integrity providers, then
  require App Check tokens in your rules. This blocks traffic that isn't
  coming from your actual deployed site (bots, curl, other origins) even
  without a login system.
- **Firebase Anonymous Auth**: sign every visitor in anonymously on load and
  require `request.auth != null` in the rules. Combined with the PIN gate,
  this means only people who got past the PIN (and thus loaded the app and
  got signed in) can write — still not identity-based, but raises the bar.

## Cloudinary: reduce upload abuse

The unsigned upload preset name is public by design (it's in the client
JS), so anyone who finds it could technically POST to your Cloudinary
account. In the Cloudinary console, open **Settings → Upload → Upload
presets → memory_album_for_her** and consider:

- Restricting **allowed formats** to the image and audio types you
  actually use (e.g. jpg, png, heic, webp, mp3, m4a, wav) — the app
  uploads photos to the `image` endpoint and songs to the `video`
  endpoint (Cloudinary's audio handling), so don't lock formats down to
  images only or song uploads will start failing.
- Setting a **max file size** for each.
- Turning on **eager transformations** or a moderation add-on if you're
  worried about abuse.
- Watching your Cloudinary usage/credits occasionally, since the free tier
  has monthly limits.

## Customizing

- **Colors**: all in the `:root` block at the top of
  [css/style.css](css/style.css).
- **Title/copy**: in [index.html](index.html) (`<title>`, header text, gate
  text).
- **Gallery columns**: `column-count` rules in `.gallery-grid` in
  [css/style.css](css/style.css).
