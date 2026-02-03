#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse


DEFAULT_PORT = 8765


def run_gh(args):
    result = subprocess.run(
        ["gh"] + args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "gh command failed")
    return result.stdout.strip()


def get_repo_name():
    output = run_gh(["repo", "view", "--json", "nameWithOwner"])
    return json.loads(output)["nameWithOwner"]


def get_rss_url():
    name_with_owner = get_repo_name()
    owner, repo = name_with_owner.split("/", 1)
    return f"https://{owner}.github.io/{repo}/podcast.xml"


def get_latest_run():
    output = run_gh(
        [
            "run",
            "list",
            "--workflow",
            "ingest.yml",
            "--limit",
            "1",
            "--json",
            "databaseId,status,conclusion,htmlUrl,createdAt,displayTitle",
        ]
    )
    runs = json.loads(output)
    if not runs:
        return None
    return runs[0]


def trigger_workflow(space_url=None, force_rss=False):
    args = ["workflow", "run", "ingest.yml"]
    if space_url:
        args += ["-f", f"space_url={space_url}"]
    if force_rss:
        args += ["-f", "force_rss=true"]
    run_gh(args)


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, content, content_type="text/html; charset=utf-8"):
        data = content.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        try:
            if self.path == "/" or self.path.startswith("/?"):
                rss_url = get_rss_url()
                latest = get_latest_run()
                latest_html = "No runs found."
                if latest:
                    latest_html = (
                        f"{latest.get('displayTitle', 'Ingest Space')} — "
                        f"{latest.get('status', 'unknown')}/"
                        f"{latest.get('conclusion', 'unknown')} "
                        f"({latest.get('createdAt', 'unknown')}) "
                        f"<a href=\"{latest.get('htmlUrl', '#')}\">details</a>"
                    )
                html = f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Twitter Space Ingest</title>
    <style>
      body {{ font-family: sans-serif; margin: 32px; }}
      button {{ padding: 8px 12px; margin-right: 8px; }}
      input[type="text"] {{ width: 520px; padding: 6px; }}
      .row {{ margin: 12px 0; }}
      code {{ background: #f2f2f2; padding: 2px 4px; }}
    </style>
  </head>
  <body>
    <h1>Twitter Space Ingest</h1>
    <div class="row">
      <strong>RSS URL:</strong> <a href="{rss_url}">{rss_url}</a>
    </div>
    <div class="row">
      <strong>Latest Run:</strong> {latest_html}
    </div>
    <form method="POST" action="/run">
      <div class="row">
        <button type="submit">Run Ingest</button>
        <button type="submit" formaction="/force-rss">Force RSS Rebuild</button>
      </div>
    </form>
    <form method="POST" action="/run-with-url">
      <div class="row">
        <input type="text" name="space_url" placeholder="Paste Twitter Space URL here">
        <button type="submit">Run Ingest with URL</button>
      </div>
    </form>
  </body>
</html>"""
                self._send(200, html)
                return

            if self.path == "/status":
                latest = get_latest_run()
                self._send(200, json.dumps(latest or {}), "application/json")
                return

            self._send(404, "Not Found")
        except Exception as exc:
            self._send(500, f"Error: {exc}")

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length).decode("utf-8")
            params = parse_qs(body)

            if self.path == "/run":
                trigger_workflow()
                self._send(200, "Triggered ingest. <a href=\"/\">Back</a>")
                return

            if self.path == "/force-rss":
                trigger_workflow(force_rss=True)
                self._send(200, "Triggered RSS rebuild. <a href=\"/\">Back</a>")
                return

            if self.path == "/run-with-url":
                space_url = (params.get("space_url") or [""])[0].strip()
                if not space_url:
                    self._send(400, "Missing space_url. <a href=\"/\">Back</a>")
                    return
                trigger_workflow(space_url=space_url)
                self._send(200, "Triggered ingest with URL. <a href=\"/\">Back</a>")
                return

            self._send(404, "Not Found")
        except Exception as exc:
            self._send(500, f"Error: {exc}")


def main():
    port = int(os.environ.get("LOCAL_UI_PORT", DEFAULT_PORT))
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"Local UI running at http://127.0.0.1:{port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        # Prevent Windows from popping up a firewall dialog for 0.0.0.0 binding.
        pass
    main()
