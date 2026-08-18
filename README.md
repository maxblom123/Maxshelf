# Maxshelf

A small storefront for browsing and "buying" books, built on the free OpenLibrary API. You can browse by genre, look up a book's details, drop it in a bag, check out, and go through a mock payment step. It runs on Nuxt 4, and a good chunk of the server code exists just to keep this app from hammering a free, rate-limited public API.

## What's here

- Browse curated genres (fiction, fantasy, sci-fi, mystery, romance, history, biography, science), paginated 24 books at a time
- Book detail pages with SEO-friendly URLs, like `/books/pride-and-prejudice-OL66554W`
- A bag with quantity steppers, a checkout form for shipping details, and a mock payment step
- Order history on `/account`

## Tech stack

- Nuxt 4, Vue 3, Vue Router 5
- Nitro server routes and plugins for the whole API layer
- sharp for resizing and re-encoding cover images
- `@maxblom/headlessmax` for headless Dialog, Select, and Tabs primitives
- `@maxblom/headlessmax-appshell` for an unstyled AppHeader and AppFooter, plus a small feature-flag helper
- No database. The bag and order history just live in localStorage, per browser.

## Architecture

Every book, cover, and description in this app comes from OpenLibrary's public API. It's generous, but it's rate-limited and free, so it deserves to be treated carefully. Most of the more interesting code under `server/` is there to make sure Maxshelf behaves itself instead of hammering that API.

Every outgoing request identifies itself. OpenLibrary gives a higher rate allowance to traffic that sends a real User-Agent than to anonymous requests. That header lives in one file (`server/utils/openlibrary.ts`) and gets reused everywhere else, so there's no way for a new call site to accidentally skip it.

On top of that sit two limiters that do genuinely different jobs. A concurrency semaphore caps how many requests can be in flight at once. A token-bucket limiter caps how many can complete per second. Capping one doesn't automatically cap the other, so every OpenLibrary call has to clear a rate-limit token before it's even allowed to take a concurrency slot:

```
request -> rate limiter (token bucket, shared, about 2.5/sec)
        -> concurrency limiter (a separate budget per resource type)
        -> fetch -> cache
```

Listing and detail metadata draw from one concurrency budget, cover images from another, so a burst of image warming can't starve out the metadata call a page is actually waiting on. Each limiter slot also carries a watchdog timeout, so a single hung upstream request can't quietly wedge a slot, and eventually the whole queue, for every user on the server.

Caching follows a stale-while-revalidate pattern in `server/buffering.ts`. Once a cached value goes stale, it's still served immediately while exactly one background request refreshes it. Anyone else asking for that same key in the meantime shares that one refresh instead of kicking off their own. This covers both JSON responses (listings, book detail) and binary data (cover images), which need slightly different handling under the hood.

There's also a startup warming plugin, `server/plugins/warm-genres.ts`, which preloads the first 10 pages of every curated genre when the server boots, along with detail metadata for the first 8 books on each of those pages. In practice, a normal browsing session rarely hits a fully cold cache.

Cover images get fetched once, resized with sharp, and re-encoded as WebP (`server/utils/cover.ts`), then cached for a week, since a book's cover essentially never changes once it's published.

## Project structure

```
app/
├── pages/
│   ├── index.vue              landing page
│   ├── books/[slug].vue       book detail (slug plus OpenLibrary work ID)
│   ├── bag.vue                shopping bag (localStorage)
│   ├── checkout.vue           shipping details form
│   ├── pay.vue                mock payment, validates card shape only
│   └── account.vue            order history (localStorage)
├── layouts/
│   ├── default.vue            app shell (header/footer)
│   └── blank.vue              no chrome
└── assets/css/main.css        global reset plus iOS scroll-bounce fix

server/
├── api/
│   ├── books.get.ts           GET /api/books?q=<genre>&page=<n>
│   ├── book/[id].get.ts       GET /api/book/:id
│   └── cover/[id].get.ts      GET /api/cover/:id?size=thumb|large
├── plugins/
│   └── warm-genres.ts         startup cache warming
├── utils/
│   ├── books.ts                listing fetch and response shaping
│   ├── bookDetail.ts           detail fetch (work plus authors)
│   ├── cover.ts                cover fetch, resize, WebP encode
│   ├── openlibrary.ts          shared User-Agent
│   ├── limiter.ts              concurrency and rate limiting
│   └── slug.ts                 slug to OpenLibrary work ID and back
└── buffering.ts                 stale-while-revalidate cache plus single-flight dedupe
```

## Getting started

**Prerequisites:** Node.js 18+ and npm (or pnpm, yarn, or bun).

```bash
git clone https://github.com/maxblom123/maxshelf.git
cd maxshelf
npm install
npm run dev
```

The dev server binds to `0.0.0.0`, so it's reachable at `http://localhost:3000`. It also prints a `Network:` URL on startup, which is handy if you want to test it on a phone on the same network.

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run generate` | Static site generation |
| `npm run preview` | Preview a production build locally |

## Notes for anyone picking this up

- **This is a demo, not a real store.** Checkout and payment are entirely client-side mock flows. `pay.vue` only checks that a card number and CVC look plausible (digit count, spacing). Nothing is sent to a payment processor, and nothing is charged.
- **There's no backend database.** The bag and order history are localStorage only, per browser. Clearing site data clears them, and nothing syncs across devices.
- **The curated genre list is duplicated by hand** in a few places: the books listing page, the `/api/books` route's `VALID_SUBJECTS`, and the warming plugin's `CURATED_GENRES`. All three need to stay in sync if genres are ever added or removed.

## License

There's no license file yet. Adding one (MIT is a common choice for a project like this) before making the repo public would make it clear how others are allowed to use the code.