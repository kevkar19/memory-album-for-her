# For her: Shaqeelah 💗

A private, shared memory album — photo gallery, quotes, and favourite songs —
built as a static site for free hosting on GitHub Pages.

## Stack

- Vanilla HTML/CSS/JS (ES modules, no build step)
- [Cloudinary](https://cloudinary.com) unsigned uploads for photo hosting
- [Firebase Firestore](https://firebase.google.com/docs/firestore) for photo
  metadata, quotes, and song links

## Project structure

```
index.html            Single-page app: gate + gallery/quotes/songs views
css/style.css          All styling
js/firebase-init.js    Firebase app + Firestore init
js/cloudinary-config.js Cloudinary cloud name / upload preset
js/gate.js              Client-side PIN gate
js/gallery.js           Photo upload (Cloudinary) + live gallery (Firestore)
js/quotes.js            Quotes list + add-quote form (Firestore)
js/songs.js             Songs list + add-song form (Firestore)
js/utils.js             Shared helpers
js/app.js               Bootstraps everything + bottom-nav tab switching
firestore.rules         Security rules to paste into the Firebase console
```

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
- Allow public **read** of photos/quotes/songs (needed for the gallery/pages
  to load with no login system).
- Allow **create** only, never update/delete, and only when the new
  document has just the expected fields, reasonable string lengths, and (for
  photos/songs) a URL from Cloudinary/Spotify/YouTube. This stops a bot from
  overwriting or wiping your data, and makes it harder to use your database
  to store arbitrary junk.
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

- Restricting **allowed formats** to image types only (jpg, png, heic, webp).
- Setting a **max file size** and **max image dimensions**.
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
