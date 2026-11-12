/**
 * SpacePipe Cloudflare Edge Slicer Worker
 * 
 * Bleeding-edge on-the-fly byte-range audio slicing & R2 auto-caching.
 * Transforms multi-gigabyte monolithic episode MP3s into instant 500KB edge-cached clips.
 *
 * Route: GET /slice?url=<upstream_url>&start=<startSec>&end=<endSec>&dur=<durationSec>
 */

export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');
    const startStr = url.searchParams.get('start');
    const endStr = url.searchParams.get('end');
    const durStr = url.searchParams.get('dur');

    if (!targetUrl) {
      return new Response('Missing target audio URL', { status: 400 });
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, X-R2-Cache',
    };

    // If no start/end timestamps are provided, pass through as a CORS proxy
    if (startStr === null || endStr === null) {
      const upstreamResp = await fetch(targetUrl, {
        method: request.method,
        headers: {
          'User-Agent': 'SpacePipe-Edge-Slicer/1.0',
          ...(request.headers.get('Range') ? { Range: request.headers.get('Range') } : {}),
        },
      });
      const headers = new Headers(upstreamResp.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
      return new Response(upstreamResp.body, { status: upstreamResp.status, headers });
    }

    const startSec = Math.max(0, parseFloat(startStr));
    const endSec = parseFloat(endStr);
    const durSec = parseFloat(durStr || '0');

    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
      return new Response('Invalid start/end slice range', { status: 400 });
    }

    // 2. Generate deterministic R2 Cache Key
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${targetUrl}_${startSec.toFixed(2)}_${endSec.toFixed(2)}`)
    );
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
    const r2Key = `slices/slice_${hashHex}.mp3`;

    // 3. Fast Path: Check Cloudflare R2 bucket for pre-cached slice
    if (env.CLIPS_BUCKET) {
      try {
        const cachedObject = await env.CLIPS_BUCKET.get(r2Key);
        if (cachedObject) {
          const headers = new Headers();
          headers.set('Content-Type', 'audio/mpeg');
          headers.set('Cache-Control', 'public, max-age=31536000, immutable');
          headers.set('X-R2-Cache', 'HIT');
          headers.set('Accept-Ranges', 'bytes');
          cachedObject.writeHttpMetadata(headers);
          Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
          return new Response(cachedObject.body, { headers });
        }
      } catch (err) {
        console.warn('R2 read error, falling back to on-the-fly slice:', err);
      }
    }

    // 4. Resolve Upstream Total Content-Length
    let totalBytes = 0;
    try {
      const headResp = await fetch(targetUrl, {
        method: 'HEAD',
        headers: { 'User-Agent': 'SpacePipe-Edge-Slicer/1.0' },
      });
      const cl = headResp.headers.get('content-length');
      if (cl) totalBytes = parseInt(cl, 10);
    } catch {}

    // Fallback if HEAD didn't yield content-length
    if (!totalBytes || totalBytes <= 0) {
      totalBytes = (durSec > 0 ? durSec : 3600) * (128000 / 8);
    }

    const effectiveDur = durSec > 0 ? durSec : totalBytes / (128000 / 8);
    const bytesPerSec = totalBytes / effectiveDur;

    // 0.8s pre-roll and 0.8s post-roll safety cushion for clean frame headers
    const preRoll = Math.max(0, startSec - 0.8);
    const postRoll = endSec + 0.8;
    const startByte = Math.max(0, Math.floor(preRoll * bytesPerSec));
    const endByte = Math.min(totalBytes - 1, Math.ceil(postRoll * bytesPerSec));

    // 5. Fetch ONLY the calculated byte range from upstream CDN
    const rangeHeader = `bytes=${startByte}-${endByte}`;
    const sliceResp = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'SpacePipe-Edge-Slicer/1.0',
        Range: rangeHeader,
      },
    });

    if (!sliceResp.ok && sliceResp.status !== 206) {
      return new Response(`Upstream fetch failed (${sliceResp.status})`, { status: sliceResp.status });
    }

    const sliceArrayBuffer = await sliceResp.arrayBuffer();

    // 6. Asynchronously save slice into Cloudflare R2 bucket for instant sub-20ms subsequent requests
    if (env.CLIPS_BUCKET && ctx && ctx.waitUntil) {
      ctx.waitUntil(
        env.CLIPS_BUCKET.put(r2Key, sliceArrayBuffer, {
          httpMetadata: {
            contentType: 'audio/mpeg',
            cacheControl: 'public, max-age=31536000, immutable',
          },
          customMetadata: {
            sourceUrl: targetUrl,
            startSec: String(startSec),
            endSec: String(endSec),
          },
        }).catch(e => console.warn('R2 write error:', e))
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', 'audio/mpeg');
    headers.set('Content-Length', String(sliceArrayBuffer.byteLength));
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('X-R2-Cache', 'MISS');
    headers.set('Accept-Ranges', 'bytes');
    Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));

    return new Response(sliceArrayBuffer, {
      status: 200,
      headers,
    });
  },
};
