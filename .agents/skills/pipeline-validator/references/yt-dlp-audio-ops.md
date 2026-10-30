# yt-dlp Audio Extraction Best Practices

These settings ensure high-quality audio extraction suitable for podcast feeds, including proper metadata and artwork.

## Recommended Command Structure

```bash
yt-dlp \
  -x \
  --audio-format mp3 \
  --audio-quality 0 \
  --embed-metadata \
  --embed-thumbnail \
  -o "% (title)s.%(ext)s" \
  <URL>
```

## Flag Breakdown

| Flag | Purpose |
| :--- | :--- |
| `-x` / `--extract-audio` | Extract audio track only (requires ffmpeg). |
| `--audio-format mp3` | Convert to MP3. Alternatives: `m4a`, `opus` (best quality/size), `flac` (lossless). |
| `--audio-quality 0` | Best possible variable bitrate (VBR). For MP3, this is ~320kbps. |
| `--embed-metadata` | Adds title, artist, date, and description tags to the file header. |
| `--embed-thumbnail` | Embeds the video thumbnail as the file's cover art (ID3v2). |
| `-o` | Output filename template. `%(title)s` handles special characters automatically. |

## Common Issues & Fixes

### 1. Missing Album Art
*   **Cause**: `ffmpeg` not installed or old version.
*   **Fix**: Ensure `ffmpeg` is present in the runner/environment path.

### 2. 16:9 Letterboxing
*   **Issue**: YouTube thumbnails are 16:9, but podcast players expect 1:1 (Square).
*   **Fix**: Use post-processing to crop (Advanced):
    ```bash
    --postprocessor-args "ffmpeg:-vf crop='ih:ih'"
    ```

### 3. Rate Limiting
*   **Issue**: YouTube blocks IP addresses (common in GitHub Actions).
*   **Fixes**:
    *   Use `--cookies-from-browser` (local only).
    *   Use a proxy service via `--proxy`.
    *   **GitHub Actions**: Be aware that generic runners are often blocked. Self-hosted runners or passing cookies via secrets is often required for reliability.

```