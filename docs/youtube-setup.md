# YouTube Setup

Set the following repository secrets:

- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`

Optional repository variable:

- `YOUTUBE_MOCK_UPLOAD=true`

If `YOUTUBE_MOCK_UPLOAD` is true, uploads are simulated and item status still transitions to `youtube_uploaded` with a mock URL.

## OAuth Scope

The uploader uses:

- `https://www.googleapis.com/auth/youtube.upload`

## Defaults

- Visibility: `private`
- Category: `Podcasts & Blogs`
