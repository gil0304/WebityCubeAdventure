#!/usr/bin/env python3
"""Webity dev server — static files with caching disabled."""
import http.server
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_PUT(self):
        # dev helper: lets the in-browser Build save its output into ./Build/
        import os
        if not self.path.startswith("/Build/"):
            self.send_error(403)
            return
        rel = os.path.normpath(self.path.lstrip("/"))
        if not rel.startswith("Build"):
            self.send_error(403)
            return
        os.makedirs(os.path.dirname(rel) or ".", exist_ok=True)
        length = int(self.headers.get("Content-Length", 0))
        with open(rel, "wb") as f:
            f.write(self.rfile.read(length))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
