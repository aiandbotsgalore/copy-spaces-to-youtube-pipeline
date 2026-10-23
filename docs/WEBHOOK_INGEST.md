# Webhook Ingestion & Mobile Trigger Guide

SpacePipe supports instant external ingestion using GitHub's `repository_dispatch` API. You can trigger ingestion from iOS Shortcuts, Android, Discord, Telegram, or any HTTP webhook tool.

---

## 🔒 Automated Live Broadcast Policy
* **Live Streams Are Never Recorded Automatically**: The pipeline always waits for a Space to conclude and downloads the full, complete replay (which takes only 2–3 minutes).
* **Manual Live Option**: Live capture is strictly available as a manual option in the web app under the **Submit Space** panel. Webhooks cannot inadvertently activate live recording.

---

## 📡 Webhook Specification

* **Endpoint:**
  ```http
  POST https://api.github.com/repos/{owner}/{repo}/dispatches
  ```
* **Headers:**
  ```http
  Accept: application/vnd.github+json
  Authorization: Bearer <GITHUB_PAT_TOKEN>
  User-Agent: SpacePipe-Webhook
  ```
* **Payload (JSON):**
  ```json
  {
    "event_type": "ingest_space",
    "client_payload": {
      "space_url": "https://x.com/i/spaces/1yGBePgbBoyKN"
    }
  }
  ```

---

## 📱 One-Tap Mobile Ingest (iOS Shortcuts / Android Tasker)

### iOS Shortcut Setup
1. Open the **Shortcuts** app on your iPhone/iPad.
2. Create a new shortcut named **"Ingest Space"**.
3. Enable **"Show in Share Sheet"** with type **URLs**.
4. Add the **"Get Contents of URL"** action:
   * **URL:** `https://api.github.com/repos/aiandbotsgalore/copy-spaces-to-youtube-pipeline/dispatches`
   * **Method:** `POST`
   * **Headers:**
     * `Authorization`: `Bearer <YOUR_GITHUB_TOKEN>`
     * `Accept`: `application/vnd.github+json`
   * **Request Body (JSON):**
     * `event_type` (Text): `ingest_space`
     * `client_payload` (Dictionary):
       * `space_url` (Text): `Shortcut Input`
5. When listening to a completed Space on Twitter/X, tap **Share ➔ Ingest Space**. The pipeline starts downloading in ~3 seconds.

---

## 💻 cURL Example

```bash
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ghp_yourPersonalAccessToken" \
  https://api.github.com/repos/aiandbotsgalore/copy-spaces-to-youtube-pipeline/dispatches \
  -d '{"event_type":"ingest_space","client_payload":{"space_url":"https://x.com/i/spaces/1yGBePgbBoyKN"}}'
```
