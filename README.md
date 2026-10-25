# Inkleaf — offline notebook PWA

Notebooks with fully customizable covers, handwriting that turns into typed text on the ruled lines, photos and tap-to-play video links on pages, whole-notebook search, and a lock screen with Face ID / fingerprint + PIN. Everything is stored on the device; no account, no server.

## What is in this folder

| File / folder | What it is |
|---|---|
| `index.html` | The app (installable PWA). Open this. |
| `manifest.webmanifest` | Tells phones the app's name, icon and colors for "Add to Home Screen". |
| `sw.js` | Service worker: keeps the app working offline after the first visit. |
| `css/`, `js/`, `icons/` | Styles, code and icons. |
| `artifact.html` | A single-file copy of the app for the claude.ai preview (no service worker). You don't need it for hosting. |
| `src/`, `tools/` | Source shell and build/test scripts (optional). |

## Put it online in 5 minutes (so phones can install it)

A PWA has to be served from an `https://` address. Two free ways:

### Option A — Netlify Drop (no account needed to try)
1. **On your computer (web browser):** go to `https://app.netlify.com/drop`.
2. **Finder / File Explorer:** drag the whole `inkleaf` folder onto the drop area in the browser.
3. **Web browser:** Netlify shows a link like `https://random-name.netlify.app`. That link is your app. (Create a free account if you want to keep the link permanently or rename it.)

### Option B — GitHub Pages
1. **Web browser:** sign in at `https://github.com`, click **New repository**, name it `inkleaf`, keep it public, click **Create**.
2. **Web browser:** on the empty repository page click **uploading an existing file**, drag in everything inside the `inkleaf` folder (`index.html`, `manifest.webmanifest`, `sw.js`, the `css`, `js`, `icons` folders), then click **Commit changes**.
3. **Web browser:** open **Settings → Pages**, under *Branch* choose `main` and `/ (root)`, click **Save**.
4. After a minute the page shows your address: `https://<your-name>.github.io/inkleaf/`.

## Install it on a phone or tablet

- **iPhone / iPad (Safari):** open the link → tap the **Share** button (square with an arrow) → **Add to Home Screen** → **Add**. Open Inkleaf from the home screen; it runs full screen and offline. Face ID / Touch ID unlock works there.
- **Android (Chrome):** open the link → Chrome shows **Install** (or use the ⋮ menu → **Add to Home screen**). Fingerprint / face unlock works there.
- **Windows / Mac (Chrome or Edge):** open the link → click the install icon at the right end of the address bar. Windows Hello works for unlock.

The first time you open the app it asks you to set a PIN and offers Face ID / fingerprint. You can skip it and turn it on later under **Settings → App lock**.

## Using it

- **Covers:** long-press a notebook (or ⋯ → Edit cover). Choose a color theme or custom color, pattern, binding, **material** (standard or grained leather with a stitched border) and **closure** (a magnetic strap with a steel stud, or a diary-style key lock with a hasp and keyhole); add photos from the gallery and stickers from eight categories (sea animals, insects, land animals, plants & flowers, galaxies, planets & heavenly bodies, fantasy animals, hearts). Drag to move, corner handle to resize, top handle to rotate, or pinch with two fingers. A selected photo can be placed freely, used as the whole cover background, or fill the top/bottom/left/right half, with filters (black & white, sepia, vivid, warm, cool, negative, mosaic, soft blur, tint, faded), a frame shape and opacity.
- **Pens:** next to the tools pick a pen style: ballpoint, fine liner, marker (Sharpie), brush pen (width follows pressure and speed), fountain pen, calligraphy nib (thick and thin by direction) or pencil (soft, grainy). Colors and thickness apply to all of them; every style is still read by the recognizer.
- **Writing:** with the pen tool, write **anywhere on the page, at any size** (only the tinted strips at the edges are reserved for turning pages). The words flow into the notebook like typing: on a new page the first line fills first, and the blinking caret shows where the next word will go. **Live** mode (on by default) shows a small preview of each word as you write and turns a word into typed text the moment you start the next one; the last word follows after a short pause (adjustable). The floating **Enter** button starts a new line (it hides while the pen is down). **Convert** turns a whole page of older ink into text. Text uses the notebook's chosen font, size and color on the ruled lines; set those, the paper and the line spacing under **Settings**. Recognition runs in a background thread on the device, offline.
- **Pen gestures on typed text:** draw an **X** over a word (two crossing strokes), scribble over it, or strike a line through it to delete that word. Undo brings it back.
- **Engine:** the **Neural / Classic / Scribble** button in the toolbar (or Settings → Handwriting → Engine; the gear on the home screen opens the same settings). *Inkleaf Neural* is a CRNN — a convolutional + recurrent neural network with CTC decoding — that reads a whole word at once, so joined-up writing works; it was trained on handwriting rendered from 229 handwriting fonts plus the app's own pen-stroke letter shapes, with slant, pressure, wobble and spacing variations, and it runs on the device (WebAssembly SIMD kernels, about 5–15 ms per word) with a dictionary check for English, German and Spanish. *Inkleaf Classic* matches letter shapes one by one and is the engine that uses the letters you teach it. *Apple Scribble* (iPad) or *Gboard handwriting* (Android) hands the pen to the system recognizer: you write straight into the lines and the OS converts.
- **Highlighter:** the marker tool draws translucent color over text or ink; highlights are never converted and the eraser removes them.
- **Eraser:** rubs out ink, highlights **and typed words**. A rub over a word deletes just that word (a toast offers Undo); over ink it removes only the ink.
- **Lasso:** the dashed-loop tool picks things up — handwriting, **typed words** and photos. Draw a loop around them (or just tap a word or a photo) and they get a dashed frame: drag the frame to move them (typed words move to the row you drop them on), pull the corner handle to make ink and photos bigger or smaller, tap an ink or highlighter colour to recolour ink, and use the bar above it to **convert only that ink** to text, **copy**, **cut** or **delete** the selection. Copied ink and words can be pasted on any page: with the lasso tool, tap an empty spot and press *Paste here*. Keyboard: Delete, Esc, Ctrl/Cmd-C, -X, -V. Everything is undoable.
- **Turning pages:** tap or drag the tinted strip at the left or right edge of the page (the color follows the notebook cover). The strip is a safe swipe area: nothing is written there. The turn is rendered in 3D with WebGL on a 128×32 mesh: the sheet peels off its corner over a cone, follows your finger, droops a little under gravity, and is lit with a paper-fibre micro-texture and sheen; light comes through the paper so the writing on the other side shows faintly; the page below gets a contact-hardening shadow (sharp at the fold, soft where the sheet is high) and the paper edge shows its thickness. A fling lands faster; landing plays a soft paper sound (Settings → Pages) and a tiny vibration on phones that support it. Arrow keys and the page buttons turn pages too. Devices without WebGL get a plain crossfade.
- **Two pages at once:** on a tablet held in landscape (or any screen wider than 900 px) the notebook opens like a real book with two facing pages. Write on either page; converted text goes to the page you are writing on, and Enter at the bottom of the left page continues on the right one. A turn flips a whole sheet: the right page comes over with the next page printed on its back. Switch it off under Settings → Pages.
- **Opening a notebook:** tapping a cover lifts the book off the shelf, swings the cover open in 3D (heavy board: it overshoots a touch and settles) and zooms the open page toward you; closing plays it in reverse. A magnetic strap lets go and flips over the edge first; a key lock gets its key: it arrives on an arc, slides in with a small bump, turns the tumblers (the tongue slides clear and a gleam runs over the plate while the rest of the cover softly drops out of focus) and the hasp springs open — with matching clink, click, snap and thud sounds (Settings → Pages → paper sound).
- **Teach it your handwriting:** Settings → *Teach it my handwriting* (or the pen icon on the home screen). Two tabs:
  - **Words · Neural engine** — the app shows a word, you write it the way you normally write, Save, next word. After 8 words (30+ is better) press **Adapt the Neural engine to my handwriting**: the network's output layer is fine-tuned to your samples right on the device (10–40 s, nothing is uploaded) and the result sticks until you delete it. The status line tells you how many of your words it read correctly before and after. *Export my samples* saves them as a JSON file — send that file to whoever trains the model and the whole network can be fine-tuned on your hand.
  - **Letters · Classic engine** — write each letter two or three times; these shapes are used by the *Classic* engine.
  On an iPad, the **Keyboard** tool also accepts Apple Pencil Scribble directly on a line.
- **Search:** the magnifier searches every page of the open notebook; use the up/down arrows to jump between results, which are highlighted on the page.
- **Photos and videos:** **Insert** → photo from gallery, video from gallery, or a video link. Videos appear as a small link chip on the page; tapping it plays the video in the phone's player. Tap any photo or chip (with the pen, a finger or the Select tool) to select it: drag to move, corner handle to resize, top handle to rotate, trash to remove. A pen stroke on empty paper goes straight back to writing.
- **Backups:** Settings → *Export backup* saves a file with the notebook, its pages, cover and photos. Import it on another device from the home screen (upload icon).

## Good to know

- Notes are stored in the browser's own database on the device (IndexedDB). The lock screen keeps casual eyes out; it does not encrypt the files on disk.
- Clearing the browser's site data deletes the notebooks. Export a backup first.
- Videos are stored on the device as well; very large videos may exceed what the browser allows, in which case add them as a link instead.
- The app is light by default, whatever the device's setting. Settings → **Appearance** switches to Dark or to following the device.
- On tablets, the first touch of a stylus switches the app to "pen draws, fingers scroll and zoom" (palm rejection); the hand button in the toolbar changes it back.
- Updates arrive by themselves: whenever a new version is pushed to the site, an open or installed copy downloads it in the background and restarts at the first quiet moment (never mid-stroke), reopening the same notebook and page, and says so in a toast. It also looks for updates every time it comes to the foreground. To ship one, change `VERSION` in `sw.js`. (The home-screen *icon* is the one exception — iOS copies it when the app is added, so a new icon needs the app re-added once.)

## Developing

```
node tools/build.mjs        # rebuilds index.html and artifact.html from src/shell.html + css + js
node tools/test-hwr.mjs     # recognizer test on synthetic handwriting
node tools/e2e.mjs          # end-to-end test in headless Chromium (needs Playwright)
python3 tools/icons.py      # regenerates the icons
```

## How the neural engine was trained (for the curious)

`tools/crnn/` holds the whole pipeline, written in plain Python + numpy (no deep-learning framework needed):

- `hwsynth.py` + `tfckpt.py` run a pretrained handwriting *synthesis* network (the Graves-style LSTM from sjvasquez/handwriting-synthesis, trained on the IAM online handwriting database) in plain numpy, straight from its TensorFlow checkpoint: it writes any text as pen strokes in the style of real writers (13 priming styles plus random writers, neat to scrawly). 40,000 words written this way (`out/hw-synth-*.npz`) are the backbone of the training set; a separate 1,500-word set is kept for evaluation.
- `gen.py` turns strokes and fonts into training strips: 45% generated real-writer handwriting (half of it rasterized exactly the way the app does it, half rendered large and distorted), the rest words (English, German and Spanish frequency lists, numbers, dates, prices, codes) set in 229 handwriting fonts from Google Fonts letter by letter with uneven spacing and baseline, and words drawn with the app's own pen-stroke letter shapes. Each word is slanted, warped elastically, thickened or thinned, blurred, given pressure variation and noise, and scaled to a 32-pixel strip.
- `train.py` is the CRNN (4 conv layers with (2,2)/(2,1)/(2,1)/(2,1) pooling, so the sequence keeps half the image width → 2 × 64 features per column → two stacked bidirectional LSTM(128) layers with sequence dropout → CTC) with hand-written back-propagation, AdamW, gradient clipping and a warm-up + cosine (one-cycle) schedule; `python3 train.py gradcheck` verifies the gradients numerically. It was trained in two cycles (the second warm-started from the first); `evalapp.py` measures the whole app pipeline (beam search + dictionary + look-alike fixes): about 64% exact words (66% ignoring case, CER 13%) on a deliberately hard synthetic mix of 229 fonts, numbers and codes, and 77% (84% ignoring case, CER 7%) on printed pen-stroke words — in the app, letter heights on the line settle most of the remaining capitalisation errors. `lm.py` builds a character trigram model that was measured and not shipped (it did not help).
- `export.py` quantizes the weights to int8 (one scale per output column) into `js/crnn-weights.js`; `kernels.c` + `build-wasm.sh` compile the SIMD inference kernels to WebAssembly; `test-js.mjs` checks the JavaScript port against numpy and `../test-hwr.mjs neural` scores it on pen-drawn test words.
- `adapt.py` measures writer adaptation (fine-tuning a small part of the network on 40 words of one writer, testing on that writer's other words) and `test-adapt.mjs` checks the on-device version in `js/crnn.js`: the app re-trains only the output layer (CTC gradient in JavaScript, Adam, pulled back toward the trained weights) on the words you write under *Teach it my handwriting → Words*, which is what makes the engine follow your hand.
