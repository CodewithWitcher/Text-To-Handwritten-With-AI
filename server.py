#!/usr/bin/env python3
"""
Local server for Text to Handwriting AI.

- Serves the static app (index.html, js/, css/, ...).
- POST /api/proxy relays AI requests (DeepSeek, OpenAI, Gemini, OpenRouter,
  Groq, Ollama, custom OpenAI-compatible endpoints) so the browser does not
  run into CORS blocks. API keys travel from the browser to this process and
  straight on to the provider; nothing is written to disk or logged.
- GET /api/health lets the page detect that the proxy is available.

Standard library only. Usage:  python3 server.py [--port 8080] [--host 127.0.0.1]
"""

import argparse
import http.server
import json
import mimetypes
import os
import socketserver
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
MAX_BODY = 40 * 1024 * 1024  # 40 MB (PDFs / images are sent base64)
UPSTREAM_TIMEOUT = 600  # seconds; long answers can take a while

FORWARDED_HEADERS = {
    "authorization",
    "content-type",
    "x-api-key",
    "anthropic-version",
    "anthropic-beta",
    "http-referer",
    "x-title",
    "api-key",
}

mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("font/ttf", ".ttf")
mimetypes.add_type("font/otf", ".otf")


def is_allowed_target(url):
    """Only http(s). Plain http is limited to local model servers (Ollama etc.)."""
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return False
    if parsed.scheme == "https" and parsed.hostname:
        return True
    if parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1"):
        return True
    return False


class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "TextToHandwritingAI/2.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # --- helpers -----------------------------------------------------------
    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _same_origin(self):
        """Reject cross-site requests so other websites can't use this proxy."""
        origin = self.headers.get("Origin")
        if not origin:
            return True
        host = self.headers.get("Host", "")
        return urllib.parse.urlparse(origin).netloc == host

    def end_headers(self):
        # Avoid stale JS/CSS while developing locally.
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Keep the console quiet except for API calls and errors (never log bodies).
        if self.path.startswith("/api/") or (args and str(args[1]).startswith(("4", "5"))):
            sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    # --- routes ------------------------------------------------------------
    def do_GET(self):
        if self.path == "/api/health":
            return self._send_json(200, {"ok": True, "proxy": True})
        # Never serve hidden files or the server source.
        clean = urllib.parse.urlparse(self.path).path
        if any(part.startswith(".") for part in clean.split("/") if part):
            return self.send_error(404)
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/proxy":
            return self.send_error(404)
        if not self._same_origin():
            return self._send_json(403, {"error": "Cross-origin requests are not allowed."})
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            return self._send_json(415, {"error": "Expected application/json."})

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._send_json(413, {"error": "Request body missing or too large."})

        try:
            req = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            return self._send_json(400, {"error": "Invalid JSON."})

        url = req.get("url", "")
        method = (req.get("method") or "POST").upper()
        if method not in ("GET", "POST"):
            return self._send_json(400, {"error": "Only GET and POST are supported."})
        if not is_allowed_target(url):
            return self._send_json(400, {"error": "Target URL is not allowed: %s" % url})

        headers = {
            k: v
            for k, v in (req.get("headers") or {}).items()
            if isinstance(k, str) and k.lower() in FORWARDED_HEADERS and isinstance(v, str)
        }
        data = None
        if method == "POST":
            data = json.dumps(req.get("body") or {}).encode("utf-8")
            headers.setdefault("Content-Type", "application/json")

        upstream = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(upstream, timeout=UPSTREAM_TIMEOUT) as resp:
                status, body = resp.status, resp.read()
                ctype = resp.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as err:
            status, body = err.code, err.read()
            ctype = err.headers.get("Content-Type", "application/json")
        except urllib.error.URLError as err:
            return self._send_json(502, {"error": "Could not reach %s (%s)" % (url, err.reason)})
        except TimeoutError:
            return self._send_json(504, {"error": "The AI provider took too long to respond."})

        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    # The browser fetches ~15 modules/fonts at once; the default backlog of 5
    # can refuse some of them, which makes module imports fail.
    request_queue_size = 128


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8080)))
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    args = parser.parse_args()

    try:
        httpd = Server((args.host, args.port), Handler)
    except OSError as err:
        sys.exit(
            "Could not start on port %d (%s). Try: python3 server.py --port 8090"
            % (args.port, err.strerror)
        )
    print("Text to Handwriting AI running at http://%s:%d  (Ctrl+C to stop)" % (args.host, args.port))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
