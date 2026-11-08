"""Vercel entry point: every /api/* request is rewritten here and handled by server.Handler."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402

INIT_ERROR = None
if not server.DATABASE_URL:
    INIT_ERROR = "No database connected. In Vercel, add a Neon database under Storage, then redeploy."
else:
    try:
        server.init_db()
    except Exception as e:  # surface the reason instead of crashing the function
        INIT_ERROR = f"Database error: {type(e).__name__}: {e}"


class handler(server.Handler):
    def _unavailable(self):
        body = json.dumps({"error": INIT_ERROR}).encode()
        self.send_response(503)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        return self._unavailable() if INIT_ERROR else super().do_GET()

    def do_PUT(self):
        return self._unavailable() if INIT_ERROR else super().do_PUT()

    def do_POST(self):
        return self._unavailable() if INIT_ERROR else super().do_POST()
