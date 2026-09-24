# Bompa

A workout tracker that plans your training, then rewrites the plan when you're more tired than it expected.

Most training apps are logbooks: they record what you did and leave the thinking to you. Bompa models the fatigue your training builds up and adjusts next week in response. It runs in the browser, installs on your phone like an app, and works with no signal. Your training data never leaves the device.

## Install it on your phone

Bompa is a web app you install from the browser. There is no app store.

**Android (Chrome)**
1. Open the app's address in Chrome.
2. Tap the **⋮** menu, then **Install app** (older versions say **Add to Home screen**). Chrome may also offer to install it on its own.
3. Open it once while you have signal. After that it starts with no connection at all.

**iPhone (Safari)**
1. Open the app's address in Safari.
2. Tap **Share**, then **Add to Home Screen**.
3. Open it once while you have signal.

On iPhone, install it rather than using it in a Safari tab. Safari can clear a website's stored data after about a week without a visit, and an installed app is protected from that.

## Your data

- Everything is stored on your phone, in the browser's own database. There is no account, no server and no sign-in.
- The running app makes no network requests: no analytics, no tracking, no font downloads. The one exception is a content service you choose to connect (see below): lookups go only to that service and send only exercise names, never your training.
- **Back up now and then.** Tools → Export JSON downloads everything, and Import JSON brings it back. If you clear your browser data or lose the phone, the export is the only copy.

## How it works

**Fatigue.** Every session adds both fitness and fatigue. Both fade over time, but fatigue fades roughly six times faster. What you can lift on a given day is fitness minus fatigue, which is why resting before a competition makes you stronger. Bompa turns this into a readiness score on the home screen. The maths is in `lib/calc.ts`.

**Adapting the plan.** Each week Bompa compares how hard your sets felt (RPE, a 6–10 effort scale) with what was planned. A lift that keeps feeling easier than planned gets more weight. A lift that feels harder than planned all week gets 10% less volume next week. Every change comes with a sentence saying why, and can be undone.

**Weeks, not weekdays.** A planned session belongs to a week, not a day. You commit to four sessions this week, and which days you train them is up to you. Training a planned workout early fills its slot instead of counting as extra. You can move, swap or drop a session; dropping one lowers what the week expects and isn't treated as a miss.

**Set types.** Every set is a warm-up, working or back-off set. Warm-ups count toward fatigue at a heavy discount and never count toward records, so a long warm-up doesn't distort your numbers.

**Training methods.** Each lift in a workout can carry a method: tempo (such as 3110), drop sets, clusters and rest-pause, 1½ reps, 21s, partials, lowering-only and holds, AMRAP sets, and per-set schemes like wave loading, pyramids and descending rest. The workout builder has presets for the common ones, and every method has a short explainer in the app. The fatigue model counts each honestly: a drop set is one set, sets taken to failure on purpose don't count against your effort targets, and a set of 21s never claims a rep record.

## Exercise instructions

Every movement ships with short step-by-step cues **written for Bompa** (`public/howtos.json`), shown as "Written by Bompa" on each How-to sheet. They were written from each movement's facts (name, muscles, equipment, movement pattern), not adapted from any existing instruction text, and checked for overlap against the freely available datasets. They are general guidance: if a cue reads wrong for a movement you know, please open an issue.

For more detail, pictures or video, **connect a content service** in Tools → Exercise content. wger works with no account. ExerciseDB (via RapidAPI) works with your own key. Content is saved on your phone for offline use where the service's terms allow it, and each entry shows its credit and licence.

## What's here

| Tab | File | Contains |
|---|---|---|
| Today | `components/screens/Today.tsx` | Readiness score and its trend since your last session, the fitness and fatigue curve, this week's sessions, insights, next session |
| Train | `components/screens/Log.tsx` | Each set's target, tempo and method, set entry, drop and cluster pieces, full-screen rest, swipe between lifts, finish summary |
| Plan | `components/screens/Plan.tsx` | Training block timeline, this week's sessions, taper to a competition |
| History | `components/screens/History.tsx` | Past sessions, estimated one-rep max over time, personal records |
| Tools | `components/screens/Tools.tsx` | Starting maxes, one-rep max calculator, interval timers, exercise content services, settings, export and import |

Underneath: `lib/calc.ts` is the pure maths (units, one-rep max estimates, the fatigue model). `lib/adapt.ts` is the weekly review that rewrites next week. `lib/methods.ts` reads training methods and decides what each kind of set counts toward. `lib/plan.ts` builds training blocks and works a taper backwards from a competition date. `lib/content/` connects exercise content services. `lib/db.ts` is the database schema. `state/BompaContext.tsx` holds everything the screens read.

## Run it yourself

Requires Node.js 18.18 or later.

```bash
npm install
npm run dev        # http://localhost:3000
```

```bash
npm test           # unit tests
npm run test:e2e   # builds, then drives the real app in a browser
npm run build      # static site in out/
npm run lint
npm run measure    # checks the JavaScript bundle stays under budget
```

The service worker, which makes the app work offline, only registers in a production build. In `npm run dev` it would serve old code between edits. Always build with `npm run build` rather than `next build` directly: the build script also gives the service worker its list of files to save.

## Deploy your own copy

The build is a plain static site, so any static host works (Vercel, Netlify, Cloudflare Pages, GitHub Pages). The only requirement is HTTPS, because browsers only allow installing and offline support on secure sites. On Vercel: import the repository and deploy; no configuration is needed.

## Not medical advice

Bompa's readiness and fatigue numbers are training guidance worked out from what you log. They are not medical advice. Listen to your body, and to a professional if something hurts.

## Credits

- Movement library (names, muscles, equipment): [Free Exercise DB](https://github.com/yuhonas/free-exercise-db). Every movement records its source.
- Instructions from a connected service carry that service's own credit and licence, shown with each entry.
- Font: [Geist](https://vercel.com/font), under the SIL Open Font License.
- Named for Tudor Bompa, who formalised periodization. This project is not affiliated with him.

## Licence

Code is released under the [MIT licence](./LICENSE). The exercise cues — the 14 starter movements in `lib/data.ts` and every entry in `public/howtos.json` — are released under CC0 (public domain).
