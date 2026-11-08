#!/usr/bin/env python3
"""Pocket Isle server: serves public/, accounts, and object sync (tasks, lists, habits...) with shared lists.

SQLite locally. When DATABASE_URL (or POSTGRES_URL) is set, e.g. on Vercel with Neon, it uses Postgres."""
import hashlib
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
import time
import urllib.request
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
DB_PATH = os.environ.get("DB_PATH", os.path.join(ROOT, "data", "cloverhaven.db"))
COOKIE = "ch_session"
SESSION_DAYS = 60
MAX_BODY = 8_000_000
MAX_OBJECT = 3_000_000
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ID_RE = re.compile(r"^[A-Za-z0-9_\-:.]{1,80}$")
KINDS = {"folder", "list", "tag", "task", "comment", "filter", "habit", "focus", "countdown", "template", "settings", "village", "calendar"}
SHARED_KINDS = {"task", "comment"}

DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL") or os.environ.get("STORAGE_URL")
INTEGRITY_ERRORS = (sqlite3.IntegrityError,)
if DATABASE_URL:
    import psycopg
    from psycopg.rows import dict_row

    INTEGRITY_ERRORS += (psycopg.IntegrityError,)

db_lock = threading.Lock()
login_attempts = {}


class PgConn:
    """Wraps a psycopg connection so the SQLite-style '?' queries below work unchanged."""

    def __init__(self):
        self.conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)

    def execute(self, sql, params=()):
        return self.conn.execute(sql.replace("?", "%s"), params)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        with self.conn:
            if exc[0]:
                self.conn.rollback()
        return False


def db():
    if DATABASE_URL:
        return PgConn()
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS objects (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL,
  list_id TEXT,
  data TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rev BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS objects_owner_rev ON objects(owner, rev);
CREATE INDEX IF NOT EXISTS objects_list_rev ON objects(list_id, rev);
CREATE TABLE IF NOT EXISTS members (
  list_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  added DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (list_id, user_id)
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value BIGINT NOT NULL
);
"""


def init_db():
    if not DATABASE_URL:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with db() as c:
        for stmt in SCHEMA.split(";"):
            if stmt.strip():
                c.execute(stmt)


def next_rev(c):
    """A strictly increasing revision number, so clients can ask for 'everything since N'."""
    now = int(time.time() * 1000)
    row = c.execute("SELECT value FROM meta WHERE key = 'rev'" + (" FOR UPDATE" if DATABASE_URL else "")).fetchone()
    rev = max(now, (row["value"] if row else 0) + 1)
    if row:
        c.execute("UPDATE meta SET value = ? WHERE key = 'rev'", (rev,))
    else:
        c.execute("INSERT INTO meta (key, value) VALUES ('rev', ?)", (rev,))
    return rev


def hash_pw(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000).hex()


def token_key(token):
    return hashlib.sha256(token.encode()).hexdigest()


def public_user(row):
    return {"id": row["id"], "email": row["email"], "name": row["name"]}


def member_lists(c, uid):
    """Ids of lists shared with this user (not owned by them)."""
    return [r["list_id"] for r in c.execute("SELECT list_id FROM members WHERE user_id = ?", (uid,)).fetchall()]


def can_use_list(c, uid, list_id):
    if not list_id:
        return True
    row = c.execute("SELECT owner FROM objects WHERE id = ? AND kind = 'list'", (list_id,)).fetchone()
    if not row or row["owner"] == uid:
        return True
    return c.execute("SELECT 1 FROM members WHERE list_id = ? AND user_id = ?", (list_id, uid)).fetchone() is not None


def list_members(c, list_id):
    owner = c.execute(
        "SELECT u.id, u.email, u.name FROM objects o JOIN users u ON u.id = o.owner WHERE o.id = ? AND o.kind = 'list'", (list_id,)
    ).fetchone()
    rows = c.execute(
        "SELECT u.id, u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.list_id = ? ORDER BY m.added", (list_id,)
    ).fetchall()
    out = [{"id": owner["id"], "email": owner["email"], "name": owner["name"], "role": "owner"}] if owner else []
    return out + [{"id": r["id"], "email": r["email"], "name": r["name"], "role": r["role"]} for r in rows]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC, **kwargs)

    def log_message(self, *args):
        pass

    def end_headers(self):
        path = urlparse(self.path).path
        if path.startswith("/assets/") or path.startswith("/audio/"):
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def send_json(self, data, status=200, cookie=None):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(payload)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return None
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            return body if isinstance(body, dict) else {}
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    def session_cookie(self, token, max_age):
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
        return f"{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}"

    def current_user(self):
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        morsel = SimpleCookie(raw).get(COOKIE)
        if not morsel or not morsel.value:
            return None
        with db() as c:
            row = c.execute(
                "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?",
                (token_key(morsel.value), time.time()),
            ).fetchone()
        return public_user(row) if row else None

    def start_session(self, user_id):
        token = secrets.token_urlsafe(32)
        with db() as c:
            c.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
            c.execute("INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)", (token_key(token), user_id, time.time() + SESSION_DAYS * 86400))
        return self.session_cookie(token, SESSION_DAYS * 86400)

    def client_ip(self):
        fwd = self.headers.get("X-Forwarded-For")
        return fwd.split(",")[0].strip() if fwd else self.client_address[0]

    # ---------- routing ----------
    def do_GET(self):
        url = urlparse(self.path)
        path = url.path
        if path == "/api/auth/me":
            return self.send_json({"user": self.current_user()})
        if path == "/api/sync":
            return self.sync_get(parse_qs(url.query))
        if path == "/api/members":
            return self.members_get(parse_qs(url.query))
        if path == "/api/ics":
            return self.ics_proxy(parse_qs(url.query))
        if path.startswith("/api/"):
            return self.send_json({"error": "Not found"}, 404)
        if "/." in path:
            return self.send_json({"error": "Not found"}, 404)
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        body = self.read_body()
        if body is None:
            return self.send_json({"error": "That's too big to save (max 8 MB at once)."}, 413)
        if path.startswith("/api/auth/"):
            return self.auth(path, body)
        if path == "/api/sync":
            return self.sync_push(body)
        if path == "/api/share":
            return self.share(body)
        if path == "/api/unshare":
            return self.unshare(body)
        return self.send_json({"error": "Not found"}, 404)

    # ---------- accounts ----------
    def auth(self, path, body):
        if path == "/api/auth/logout":
            raw = self.headers.get("Cookie")
            morsel = SimpleCookie(raw).get(COOKIE) if raw else None
            if morsel and morsel.value:
                with db() as c:
                    c.execute("DELETE FROM sessions WHERE token = ?", (token_key(morsel.value),))
            return self.send_json({"ok": True}, cookie=self.session_cookie("", 0))

        email = str(body.get("email") or "").strip().lower()
        password = str(body.get("password") or "")

        if path == "/api/auth/signup":
            name = str(body.get("name") or "").strip()[:40] or email.split("@")[0]
            if not EMAIL_RE.match(email):
                return self.send_json({"error": "That email doesn't look right."}, 400)
            if len(password) < 8:
                return self.send_json({"error": "Use at least 8 characters for your password."}, 400)
            salt = secrets.token_hex(16)
            uid = "u_" + secrets.token_hex(8)
            try:
                with db() as c:
                    c.execute(
                        "INSERT INTO users (id, email, name, pw_hash, salt, created) VALUES (?, ?, ?, ?, ?, ?)",
                        (uid, email, name, hash_pw(password, salt), salt, time.time()),
                    )
            except INTEGRITY_ERRORS:
                return self.send_json({"error": "There's already an account with that email. Try logging in."}, 409)
            return self.send_json({"user": {"id": uid, "email": email, "name": name}}, cookie=self.start_session(uid))

        if path == "/api/auth/login":
            key = self.client_ip()
            now = time.time()
            attempts = [t for t in login_attempts.get(key, []) if now - t < 600]
            if len(attempts) >= 20:
                return self.send_json({"error": "Too many tries. Wait a few minutes and try again."}, 429)
            with db() as c:
                row = c.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if not row or hash_pw(password, row["salt"]) != row["pw_hash"]:
                attempts.append(now)
                login_attempts[key] = attempts
                return self.send_json({"error": "Wrong email or password."}, 401)
            return self.send_json({"user": public_user(row)}, cookie=self.start_session(row["id"]))

        user = self.current_user()
        if not user:
            return self.send_json({"error": "Please log in"}, 401)
        if path == "/api/auth/update":
            with db() as c:
                row = c.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
                if body.get("newPassword") is not None:
                    if hash_pw(password, row["salt"]) != row["pw_hash"]:
                        return self.send_json({"error": "Your current password is wrong."}, 401)
                    if len(str(body["newPassword"])) < 8:
                        return self.send_json({"error": "Use at least 8 characters for your password."}, 400)
                    salt = secrets.token_hex(16)
                    c.execute("UPDATE users SET pw_hash = ?, salt = ? WHERE id = ?", (hash_pw(str(body["newPassword"]), salt), salt, user["id"]))
                if body.get("name"):
                    c.execute("UPDATE users SET name = ? WHERE id = ?", (str(body["name"]).strip()[:40], user["id"]))
                row = c.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
            return self.send_json({"user": public_user(row)})
        if path == "/api/auth/delete":
            with db() as c:
                row = c.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
                if hash_pw(password, row["salt"]) != row["pw_hash"]:
                    return self.send_json({"error": "Your password is wrong."}, 401)
                owned = [r["id"] for r in c.execute("SELECT id FROM objects WHERE owner = ? AND kind = 'list'", (user["id"],)).fetchall()]
                for lid in owned:
                    c.execute("DELETE FROM members WHERE list_id = ?", (lid,))
                c.execute("DELETE FROM members WHERE user_id = ?", (user["id"],))
                c.execute("DELETE FROM objects WHERE owner = ?", (user["id"],))
                c.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
                c.execute("DELETE FROM users WHERE id = ?", (user["id"],))
            return self.send_json({"ok": True}, cookie=self.session_cookie("", 0))
        return self.send_json({"error": "Not found"}, 404)

    # ---------- sync ----------
    def sync_get(self, query):
        user = self.current_user()
        if not user:
            return self.send_json({"error": "Please log in"}, 401)
        try:
            since = int((query.get("since") or ["0"])[0])
        except ValueError:
            since = 0
        uid = user["id"]
        with db() as c:
            shared = member_lists(c, uid)
            rows = c.execute("SELECT * FROM objects WHERE owner = ? AND rev > ?", (uid, since)).fetchall()
            seen = {r["id"] for r in rows}
            rows = list(rows)
            for lid in shared:
                extra = c.execute(
                    "SELECT * FROM objects WHERE ((list_id = ? AND kind IN ('task', 'comment')) OR (id = ? AND kind = 'list')) AND rev > ?",
                    (lid, lid, since),
                ).fetchall()
                rows += [r for r in extra if r["id"] not in seen]
            # lists of mine that others share with me, plus members of my shared lists
            mine_shared = [r["list_id"] for r in c.execute(
                "SELECT DISTINCT m.list_id FROM members m JOIN objects o ON o.id = m.list_id WHERE o.owner = ?", (uid,)
            ).fetchall()]
            # tasks other members put in my own shared lists
            for lid in mine_shared:
                extra = c.execute(
                    "SELECT * FROM objects WHERE list_id = ? AND owner != ? AND kind IN ('task', 'comment') AND rev > ?", (lid, uid, since)
                ).fetchall()
                rows += [r for r in extra if r["id"] not in seen]
            members = {lid: list_members(c, lid) for lid in set(shared) | set(mine_shared)}
            row = c.execute("SELECT value FROM meta WHERE key = 'rev'").fetchone()
            rev = row["value"] if row else 0
        rows = list({r["id"]: r for r in rows}.values())
        objects = [
            {"id": r["id"], "kind": r["kind"], "owner": r["owner"], "list_id": r["list_id"], "deleted": bool(r["deleted"]), "rev": r["rev"], "data": json.loads(r["data"])}
            for r in rows
        ]
        return self.send_json({"objects": objects, "rev": rev, "members": members, "shared": shared, "user": user})

    def sync_push(self, body):
        user = self.current_user()
        if not user:
            return self.send_json({"error": "Please log in"}, 401)
        uid = user["id"]
        items = body.get("objects")
        if not isinstance(items, list):
            return self.send_json({"error": "Bad data"}, 400)
        saved, rejected = [], []
        with db_lock, db() as c:
            rev = next_rev(c)
            for o in items[:2000]:
                oid = str(o.get("id") or "")
                kind = o.get("kind")
                data = o.get("data")
                if not ID_RE.match(oid) or kind not in KINDS or not isinstance(data, dict):
                    rejected.append(oid)
                    continue
                text = json.dumps(data)
                if len(text) > MAX_OBJECT:
                    rejected.append(oid)
                    continue
                list_id = o.get("list_id") or None
                if list_id is not None and not ID_RE.match(str(list_id)):
                    list_id = None
                # per-user singletons are namespaced so two accounts never collide
                if kind in ("settings", "village") and not oid.endswith(uid):
                    rejected.append(oid)
                    continue
                existing = c.execute("SELECT owner, kind, list_id FROM objects WHERE id = ?", (oid,)).fetchone()
                if existing:
                    allowed = existing["owner"] == uid or (
                        existing["kind"] in SHARED_KINDS and existing["list_id"] and can_use_list(c, uid, existing["list_id"])
                    )
                    if not allowed or (kind in SHARED_KINDS and not can_use_list(c, uid, list_id)):
                        rejected.append(oid)
                        continue
                    c.execute(
                        "UPDATE objects SET kind = ?, list_id = ?, data = ?, deleted = ?, rev = ? WHERE id = ?",
                        (kind, list_id, text, 1 if o.get("deleted") else 0, rev, oid),
                    )
                else:
                    if kind in SHARED_KINDS and not can_use_list(c, uid, list_id):
                        rejected.append(oid)
                        continue
                    c.execute(
                        "INSERT INTO objects (id, owner, kind, list_id, data, deleted, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (oid, uid, kind, list_id, text, 1 if o.get("deleted") else 0, rev),
                    )
                saved.append(oid)
        return self.send_json({"rev": rev, "saved": saved, "rejected": rejected})

    # ---------- sharing ----------
    def members_get(self, query):
        user = self.current_user()
        if not user:
            return self.send_json({"error": "Please log in"}, 401)
        lid = (query.get("list") or [""])[0]
        with db() as c:
            if not can_use_list(c, user["id"], lid):
                return self.send_json({"error": "Not allowed"}, 403)
            return self.send_json({"members": list_members(c, lid)})

    def share(self, body):
        user = self.current_user()
        if not user:
            return self.send_json({"error": "Please log in"}, 401)
        lid = str(body.get("list") or "")
        email = str(body.get("email") or "").strip().lower()
        with db() as c:
            row = c.execute("SELECT owner FROM objects WHERE id = ? AND kind = 'list'", (lid,)).fetchone()
            if not row:
                return self.send_json({"error": "Wait a second for this list to sync, then try again."}, 404)
            if row["owner"] != user["id"]:
                return self.send_json({"error": "Only the list's owner can invite people."}, 403)
            friend = c.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if not friend:
                return self.send_json({"error": "Nobody has a Pocket Isle account with that email yet. Ask them to sign up first."}, 404)
            if friend["id"] == user["id"]:
                return self.send_json({"error": "That's you!"}, 400)
            if not c.execute("SELECT 1 FROM members WHERE list_id = ? AND user_id = ?", (lid, friend["id"])).fetchone():
                c.execute("INSERT INTO members (list_id, user_id, role, added) VALUES (?, ?, 'editor', ?)", (lid, friend["id"], time.time()))
            with db_lock:
                rev = next_rev(c)
                # bump the list and its tasks so the new member's next sync picks them up
                c.execute("UPDATE objects SET rev = ? WHERE id = ? OR (list_id = ? AND kind IN ('task', 'comment'))", (rev, lid, lid))
            return self.send_json({"members": list_members(c, lid)})

    def unshare(self, body):
        user = self.current_user()
        if not user:
            return self.send_json({"error": "Please log in"}, 401)
        lid = str(body.get("list") or "")
        target = str(body.get("user") or user["id"])
        with db() as c:
            row = c.execute("SELECT owner FROM objects WHERE id = ? AND kind = 'list'", (lid,)).fetchone()
            if not row:
                return self.send_json({"error": "Not found"}, 404)
            if row["owner"] != user["id"] and target != user["id"]:
                return self.send_json({"error": "Only the list's owner can remove people."}, 403)
            c.execute("DELETE FROM members WHERE list_id = ? AND user_id = ?", (lid, target))
            return self.send_json({"members": list_members(c, lid)})

    # ---------- calendar subscriptions ----------
    def ics_proxy(self, query):
        if not self.current_user():
            return self.send_json({"error": "Please log in to subscribe to calendars."}, 401)
        url = (query.get("url") or [""])[0].strip()
        if url.startswith("webcal://"):
            url = "https://" + url[len("webcal://"):]
        if not url.startswith(("https://", "http://")):
            return self.send_json({"error": "Paste a link that starts with https:// or webcal://"}, 400)
        host = (urlparse(url).hostname or "").lower()
        if host in ("localhost", "127.0.0.1", "0.0.0.0", "::1") or host.endswith(".local") or host.startswith(("10.", "192.168.", "169.254.", "172.")):
            return self.send_json({"error": "That address isn't allowed."}, 400)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Pocket Isle/1.0"})
            with urllib.request.urlopen(req, timeout=12) as r:
                text = r.read(3_000_000).decode("utf-8", "replace")
        except Exception as e:
            return self.send_json({"error": f"Couldn't load that calendar ({type(e).__name__})."}, 502)
        if "BEGIN:VCALENDAR" not in text:
            return self.send_json({"error": "That link isn't a calendar (.ics) feed."}, 400)
        return self.send_json({"ics": text})


def main():
    init_db()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Pocket Isle running on http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
