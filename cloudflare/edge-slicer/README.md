# SpacePipe Edge Slicer (Cloudflare Worker + R2)

Bleeding-edge on-the-fly byte-range audio slicing and edge auto-caching.

### What it does
* Intercepts requests for quotes/clips: `GET /slice?url=<url>&start=<startSec>&end=<endSec>`
* Computes exact byte range boundaries from duration/content-length
* Performs an internal sub-millisecond HTTP `Range` request upstream to GitHub Releases
* Streams the exact ~500KB slice to the client in **~50–100ms**
* Automatically writes the slice into your **Cloudflare R2 bucket (`documentary-audio-clips`)** via `ctx.waitUntil()`
* Subsequent plays of the same quote are served directly from Cloudflare R2 cache in **< 20ms**

### Deploying to Cloudflare
```bash
cd cloudflare/edge-slicer
npx wrangler deploy
```
