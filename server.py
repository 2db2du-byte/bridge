#!/usr/bin/env python3
"""The Bridge: Rabbid's control center, styled like the bridge of the Enterprise. 127.0.0.1:1701 only.

Replaces Mission Control (shut down 2026-10-21). One page, no babysitters: stations show live readouts,
and Red Alert only lights up when something is actually wrong.

  GET  /                 the bridge (static/index.html)
  GET  /api/status       every station's readouts + alerts, as JSON
  POST /api/launch       {"app": "steam" | "mtga" | "heroic" | "discord" | "kiwix" | "obsidian"}
  POST /api/backup       start a backup now (backup-now)
  POST /api/log          {"text": "..."} Captain's log -> SecondBrain inbox (note)
  POST /api/speak        {"text": "...", "voice": "computer" | "butler"} -> say
  POST /api/term/start   start the Claude panel (bridge-claude.service: ttyd + tmux + Claude Code)
  GET  /term/...         the Claude panel itself, passed through to ttyd's private socket

POSTs need the header X-Bridge: engage (a web page elsewhere can't send it without a CORS preflight,
which this server never answers), and the Host must be this machine.

The Claude panel is a live terminal, so it has its own lock: ttyd listens on a socket file only Rabbid's user
can open (no network port at all), and /term/ only passes through with the secret cookie the Bridge page
gets (new key every restart, SameSite=Strict so other websites can't send it) and an Origin of this page.
"""
import json
import os
import re
import secrets
import selectors
import shutil
import socket
import subprocess
import threading
import time
from datetime import datetime
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote_plus, urlsplit
from urllib.request import Request, urlopen

PORT = 1701
HOME = Path.home()
STATIC = Path(__file__).resolve().parent / "static"
BRAIN = HOME / "SecondBrain"
TODO = BRAIN / "1 Projects" / "To-do - what's left.md"
INBOX = BRAIN / "0 Inbox" / "Inbox.md"
COURSES = [("Learn Linux", BRAIN / "1 Projects" / "Learn Linux.md"),
           ("Learn Cybersecurity", BRAIN / "1 Projects" / "Learn Cybersecurity.md")]
DRIVES = [("PRIMARY CORE", "NVMe", "/"),
          ("ARCHIVE HOLD", "Seagate 4TB", "/mnt/storage"),
          ("PERSONAL VAULT", "1TB", "/mnt/personal")]
LAUNCH = {
    "steam": ["steam"],
    "mtga": ["steam", "steam://rungameid/2141910"],
    "heroic": ["flatpak", "run", "com.heroicgameslauncher.hgl"],
    "discord": ["discord"],
    "kiwix": ["flatpak", "run", "org.kiwix.desktop"],
    "obsidian": ["obsidian"],
    # Claude Code (Commander Riker's real self) popped out into its own window: the SAME tmux session as the Bridge panel
    "claude": ["ptyxis", "--new-window", "--", "tmux", "-f", str(Path(__file__).resolve().parent / "claude-tmux.conf"),
               "new-session", "-A", "-s", "bridge-claude", str(HOME / ".local/bin/claude-desk")],
}
TERM_SOCK = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")) / "bridge-claude.sock"
CREW_SOCK = TERM_SOCK.with_name("bridge-crew.sock")  # the Promenade doors: crew agents (bridge-crew.service)
TERM_KEY = secrets.token_urlsafe(32)  # the Claude panel's key; only the Bridge page gets it (as a cookie)


def start_free_ais(firefox=True):
    """Open WebUI (the free cloud AIs through the brain switch) only runs when the Captain asks: start it, wait, and
    open it in Firefox (or not, when the Bridge's FREE AIs drawer shows it instead)."""
    run(["docker", "start", "app-open-webui"], timeout=60)
    run(["systemctl", "--user", "start", "free-ai-bridge.service"], timeout=20)  # voice + pictures + the Auto model
    for _ in range(60):
        if _up("http://127.0.0.1:3080/health"):
            break
        time.sleep(1)
    if firefox:
        spawn(["firefox", "--new-window", "http://127.0.0.1:3080/"])
# Each officer's own free Kokoro voice (Rabbid 2026-10-21). Never the actors' real voices: those aren't ours to copy.
VOICES = {
    "computer": ("bf_emma", 1.0), "butler": ("bm_george", 1.0),
    "riker": ("am_michael", 1.0), "data": ("am_echo", 0.97), "worf": ("am_onyx", 0.88),
    "yar": ("af_jessica", 1.02), "geordi": ("am_puck", 1.04), "obrien": ("bm_lewis", 1.0),
    "crusher": ("bf_isabella", 0.98), "troi": ("af_heart", 0.95), "guinan": ("af_nicole", 0.9),
    "wesley": ("am_liam", 1.06), "barclay": ("bm_fable", 1.05), "q": ("bm_daniel", 1.03),
}
ROLL_CALL = [
    ("computer", "Roll call. All officers, report."),
    ("riker", "Commander Riker. First officer, standing by, Captain."),
    ("data", "Lieutenant Commander Data. All library systems are functioning within normal parameters."),
    ("worf", "Lieutenant Worf. Shields are up. Today is a good day to stay secure."),
    ("yar", "Lieutenant Yar. The house is my watch, Captain. Nobody gets past me."),
    ("geordi", "La Forge here. The warp core is purring like a kitten, Captain."),
    ("obrien", "O'Brien, transporter room. Every backup accounted for, sir."),
    ("crusher", "Doctor Crusher. All my patients in sickbay are stable."),
    ("troi", "Counselor Troi. I sense a lot of pride in what you've built, Captain."),
    ("guinan", "Guinan, Ten Forward. Pull up a chair. I'm listening."),
    ("wesley", "Ensign Crusher, reporting! Ready for today's Linux lesson whenever you are."),
    ("barclay", "B, Barclay here. I, uh, I checked everything twice, Captain."),
    ("q", "Q. Mon capitaine. I've been expecting you."),
    ("computer", "All hands present."),
]
_speech = threading.Lock()  # one voice at a time, so the crew never talks over each other


def say(text, voice):
    v, speed = VOICES.get(voice, VOICES["computer"])
    with _speech:
        subprocess.run([str(HOME / ".local/bin/say"), text], env=dict(os.environ, SAY_VOICE=v, SAY_SPEED=str(speed)),
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)


def speak_async(lines):
    def run_all():
        for voice, text in lines:
            try:
                say(text, voice)
            except Exception:
                pass
    threading.Thread(target=run_all, daemon=True).start()
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
ALLOWED_ORIGINS = {"http://" + h for h in ALLOWED_HOSTS}

_cpu = {"pct": 0.0}


def _cpu_sampler():
    """CPU busy % from /proc/stat, sampled every 2 s in the background."""
    def read():
        f = [int(x) for x in open("/proc/stat").readline().split()[1:]]
        idle = f[3] + f[4]
        return idle, sum(f)
    last = read()
    while True:
        time.sleep(2)
        now = read()
        di, dt = now[0] - last[0], now[1] - last[1]
        _cpu["pct"] = round(100 * (1 - di / dt), 1) if dt else 0.0
        last = now


def run(cmd, timeout=5):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout.strip()
    except Exception:
        return ""


def hwmon_temp(name, label=None):
    for h in Path("/sys/class/hwmon").glob("hwmon*"):
        try:
            if (h / "name").read_text().strip() != name:
                continue
            for t in sorted(h.glob("temp*_input")):
                lab = t.with_name(t.name.replace("_input", "_label"))
                if label is None or (lab.exists() and lab.read_text().strip() == label):
                    return round(int(t.read_text()) / 1000, 1)
        except OSError:
            pass
    return None


def engineering():
    mem = {}
    for line in open("/proc/meminfo"):
        k, v = line.split(":")
        mem[k] = int(v.split()[0]) * 1024
    gpu = None
    q = run(["nvidia-smi", "--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw,fan.speed",
             "--format=csv,noheader,nounits"])
    if q:
        p = [x.strip() for x in q.split(",")]
        num = lambda s: float(s) if re.match(r"^[\d.]+$", s) else None
        gpu = {"name": p[0].replace("NVIDIA GeForce ", ""), "temp": num(p[1]), "util": num(p[2]),
               "mem_used": num(p[3]), "mem_total": num(p[4]), "power": num(p[5]), "fan": num(p[6])}
    up = float(open("/proc/uptime").read().split()[0])
    return {
        "cpu_pct": _cpu["pct"],
        "cpu_temp": hwmon_temp("k10temp", "Tctl") or hwmon_temp("k10temp"),
        "nvme_temp": hwmon_temp("nvme"),
        "ram_total": mem["MemTotal"], "ram_avail": mem["MemAvailable"],
        "load": [round(x, 2) for x in os.getloadavg()],
        "uptime_h": round(up / 3600, 1),
        "gpu": gpu,
    }


def drives():
    out = []
    for name, kind, mount in DRIVES:
        d = {"name": name, "kind": kind, "mount": mount, "mounted": os.path.ismount(mount)}
        if d["mounted"]:
            u = shutil.disk_usage(mount)
            d.update(size=u.total, used=u.used, pct=round(100 * u.used / u.total, 1))
        out.append(d)
    return out


def _systemd_time(prop, unit):
    v = run(["systemctl", "--user", "show", unit, "-p", prop, "--value"])
    if not v or v == "n/a":
        return None
    try:
        return datetime.strptime(" ".join(v.split()[1:3]), "%Y-%m-%d %H:%M:%S").timestamp()
    except ValueError:
        return None


def ops():
    result = run(["systemctl", "--user", "show", "kopia-backup.service", "-p", "Result", "--value"])
    active = run(["systemctl", "--user", "is-active", "kopia-backup.service"])
    last = _systemd_time("ExecMainExitTimestamp", "kopia-backup.service")
    nxt = _systemd_time("NextElapseUSecRealtime", "kopia-backup.timer")
    if nxt is None:  # NextElapseUSecRealtime prints without a weekday on some systemd versions
        v = run(["systemctl", "--user", "show", "kopia-backup.timer", "-p", "NextElapseUSecRealtime", "--value"])
        try:
            nxt = datetime.strptime(v.split(" E")[0].strip()[-19:], "%Y-%m-%d %H:%M:%S").timestamp()
        except ValueError:
            nxt = None
    return {"backup": {"result": result, "running": active == "activating", "last": last, "next": nxt,
                       "age_min": round((time.time() - last) / 60) if last else None}}


def youtube_search(q):
    """YouTube search for the viewscreen, through Rabbid's own SearXNG (private, free, no key): video ids + titles only."""
    try:
        with urlopen(f"http://127.0.0.1:8888/search?q={quote_plus(q)}&engines=youtube&format=json", timeout=12) as r:
            results = json.load(r).get("results", [])
    except Exception:
        return None
    out = []
    for x in results:
        m = re.search(r"[?&]v=([\w-]{11})", x.get("url", ""))
        if m and m.group(1) not in {v["id"] for v in out}:
            out.append({"id": m.group(1), "title": str(x.get("title", ""))[:200],
                        "author": str(x.get("author") or "")[:80], "length": str(x.get("length") or "")[:12]})
    return out[:24]


# Rabbid's own YouTube on the viewscreen (Rabbid 2026-10-22: "i want my youtube there"). yt-dlp signs in with the
# YouTube login Firefox already has, on this PC only; the Bridge sends the browser video ids + titles, never the login.
YT_FEEDS = {"subs": ":ytsubs", "home": ":ytrec", "later": ":ytwatchlater", "history": ":ythis"}
_yt_cache = {}


def _firefox_profile():
    root = HOME / "snap/firefox/common/.mozilla/firefox"
    for p in sorted(root.glob("*.default*")):
        if (p / "cookies.sqlite").exists():
            return f"firefox:{p}"
    return "firefox"


def _length(sec):
    if not isinstance(sec, (int, float)) or sec <= 0:
        return ""
    sec = int(sec)
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}" if sec >= 3600 else f"{sec // 60}:{sec % 60:02d}"


def youtube_feed(name):
    """Subscriptions / home / watch later / history from Rabbid's account, cached 5 minutes."""
    hit = _yt_cache.get(name)
    if hit and time.time() - hit[0] < 300:
        return hit[1]
    try:
        p = subprocess.run([str(HOME / ".local/bin/yt-dlp"), "--cookies-from-browser", _firefox_profile(), "--flat-playlist",
                            "--playlist-end", "36", "-J", "--no-warnings", YT_FEEDS[name]],
                           capture_output=True, text=True, timeout=90)
        entries = json.loads(p.stdout).get("entries") or [] if p.returncode == 0 and p.stdout else None
    except (subprocess.TimeoutExpired, ValueError, OSError):
        entries = None
    if entries is None:
        return {"ok": False, "error": "Couldn't load your YouTube. Is Firefox signed in to YouTube?"}
    out = []
    for e in entries:
        vid = str(e.get("id", ""))
        if re.fullmatch(r"[\w-]{11}", vid):
            out.append({"id": vid, "title": str(e.get("title") or "")[:200],
                        "author": str(e.get("channel") or e.get("uploader") or "")[:80], "length": _length(e.get("duration"))})
    res = {"ok": True, "videos": out}
    _yt_cache[name] = (time.time(), res)
    return res


def _up(url):
    try:
        urlopen(url, timeout=2)
        return True
    except Exception:
        return False


def _clean(md):
    md = re.sub(r"\[\[([^\]|]+)(\|[^\]]+)?\]\]", r"\1", md)
    md = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", md)
    return re.sub(r"[*_`]", "", md).strip()


def courses():
    out = []
    for name, path in COURSES:
        try:
            lines = path.read_text().splitlines()
        except OSError:
            continue
        boxes = [l for l in lines if re.match(r"^\s*- \[[ xX]\]", l)]
        done = sum(1 for l in boxes if re.match(r"^\s*- \[[xX]\]", l))
        nxt = next((_clean(l.split("]", 1)[1]) for l in boxes if re.match(r"^\s*- \[ \]", l)), None)
        out.append({"name": name, "done": done, "total": len(boxes), "next": nxt,
                    "link": "obsidian://open?vault=SecondBrain&file=" + "1%20Projects/" + path.stem.replace(" ", "%20")})
    return out


def science():
    return {"kiwix": _up("http://127.0.0.1:8090/"), "maps": _up("http://127.0.0.1:8091/"), "courses": courses()}


def orders():
    """Today's orders = the 'Tomorrow' section of the to-do note (it's written the night before)."""
    try:
        text = TODO.read_text()
    except OSError:
        return {"title": None, "items": [], "open": 0}
    m = re.search(r"^## [^\n]*Tomorrow([^\n]*)\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    items = []
    if m:
        for l in m.group(2).splitlines():
            mm = re.match(r"^- \[([ xX])\] (.*)", l)
            if mm:
                bold = re.search(r"\*\*(.+?)\*\*", mm.group(2))
                title = _clean(bold.group(1) if bold else mm.group(2)).rstrip(":")
                rest = _clean(mm.group(2)[bold.end():] if bold else "").lstrip(":( ").strip()
                items.append({"done": mm.group(1) != " ", "title": title, "detail": rest[:160]})
    open_count = len(re.findall(r"^- \[ \]", text, re.M))
    return {"title": m.group(1).strip(" ()") if m else None, "items": items, "open": open_count, "inbox": inbox_count()}


def inbox_count():
    """Notes waiting to be sorted: unsorted lines in Inbox.md + any other note files dropped in the Inbox folder."""
    folder = INBOX.parent
    try:
        lines = sum(1 for l in INBOX.read_text().splitlines() if l.startswith("- ") and "_(sorted" not in l)
    except OSError:
        lines = 0
    files = sum(1 for f in folder.glob("*.md") if f.name != INBOX.name)
    return lines + files


def tactical():
    ufw = run(["sudo", "-n", "/usr/sbin/ufw", "status"])
    return {"shields": "up" if "Status: active" in ufw else ("down" if "inactive" in ufw else "unknown")}


def alerts(st):
    a = []
    b = st["ops"]["backup"]
    if b["result"] and b["result"] != "success":
        a.append({"level": "red", "station": "ops", "msg": f"Last backup FAILED ({b['result']})"})
    elif b["age_min"] is not None and b["age_min"] > 180 and not b["running"]:
        a.append({"level": "yellow", "station": "ops", "msg": f"No backup for {b['age_min'] // 60} hours"})
    for d in st["drives"]:
        if not d["mounted"]:
            lvl = "red" if d["mount"] == "/mnt/storage" else "yellow"
            a.append({"level": lvl, "station": "ops", "msg": f"{d['kind']} drive not connected"})
        elif d["pct"] >= 90:
            a.append({"level": "red", "station": "ops", "msg": f"{d['kind']} drive {d['pct']:.0f}% full"})
        elif d["pct"] >= 80:
            a.append({"level": "yellow", "station": "ops", "msg": f"{d['kind']} drive {d['pct']:.0f}% full"})
    e = st["engineering"]
    if e["gpu"] and e["gpu"]["temp"] and e["gpu"]["temp"] >= 85:
        a.append({"level": "red", "station": "engineering", "msg": f"Graphics card at {e['gpu']['temp']:.0f}°C"})
    if e["cpu_temp"] and e["cpu_temp"] >= 90:
        a.append({"level": "red", "station": "engineering", "msg": f"CPU at {e['cpu_temp']:.0f}°C"})
    if e["ram_avail"] < 1024 ** 3:
        a.append({"level": "yellow", "station": "engineering", "msg": "Memory almost full"})
    if not st["science"]["kiwix"]:
        a.append({"level": "yellow", "station": "science", "msg": "Offline library is not answering"})
    return a


_usage = {"data": None}


def _usage_fetcher():
    """Rabbid's Claude plan meter (5-hour session + week) from his Claude Code login, refreshed every 2 minutes in the
    background. Only the two percentages and reset times are kept; the login token never leaves this function."""
    import urllib.error
    while True:
        try:
            tok = json.loads((HOME / ".claude/.credentials.json").read_text())["claudeAiOauth"]["accessToken"]
            req = Request("https://api.anthropic.com/api/oauth/usage", headers={
                "Authorization": f"Bearer {tok}", "anthropic-beta": "oauth-2025-04-20", "Content-Type": "application/json"})
            raw = json.load(urlopen(req, timeout=15))
            _usage["data"] = {k: {"pct": raw[k]["utilization"], "resets_at": raw[k]["resets_at"]} if raw.get(k) else None
                              for k in ("five_hour", "seven_day")}
        except urllib.error.HTTPError as e:
            _usage["data"] = {"error": "open Claude to refresh the login" if e.code == 401 else f"usage check failed ({e.code})"}
        except Exception:
            _usage["data"] = {"error": "can't reach Claude (offline?)"}
        time.sleep(120)


_cache = {"t": 0, "data": None}
_lock = threading.Lock()


def status():
    with _lock:
        if _cache["data"] and time.time() - _cache["t"] < 2:
            return _cache["data"]
        st = {"now": time.time(), "engineering": engineering(), "drives": drives(), "ops": ops(),
              "science": science(), "orders": orders(), "tactical": tactical(), "claude": _usage["data"]}
        st["alerts"] = alerts(st)
        _cache.update(t=time.time(), data=st)
        return st


def start_term(service="bridge-claude.service", sock=TERM_SOCK):
    """Start a panel's service (Claude, or the crew doors; on demand, never at boot) and wait for its socket."""
    run(["systemctl", "--user", "start", service], timeout=20)
    for _ in range(50):
        try:
            with socket.socket(socket.AF_UNIX) as s:
                s.connect(str(sock))
            return True
        except OSError:
            time.sleep(0.1)
    return False


def pipe(a, b):
    """Shovel bytes both ways between two sockets until either side hangs up."""
    sel = selectors.DefaultSelector()
    sel.register(a, selectors.EVENT_READ, b)
    sel.register(b, selectors.EVENT_READ, a)
    try:
        while True:
            for key, _ in sel.select():
                data = key.fileobj.recv(65536)
                if not data:
                    return
                key.data.sendall(data)
    except OSError:
        pass
    finally:
        sel.close()


def spawn(cmd, env=None):
    subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True, env=env)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json", headers=()):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        for k, v in headers:
            self.send_header(k, v)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.headers.get("Host") not in ALLOWED_HOSTS:
            return self.send(403, {"error": "bad host"})
        path = self.path.split("?")[0]
        if path == "/api/status":
            return self.send(200, status())
        if path == "/api/youtube/feed":
            name = parse_qs(urlsplit(self.path).query).get("name", [""])[0]
            if name not in YT_FEEDS:
                return self.send(400, {"ok": False, "error": "unknown feed"})
            return self.send(200, youtube_feed(name))
        if path == "/api/youtube":
            q = parse_qs(urlsplit(self.path).query).get("q", [""])[0].strip()[:200]
            found = youtube_search(q) if q else []
            return self.send(200, {"ok": True, "videos": found} if found is not None else {"ok": False})
        if path == "/api/freeai/status":
            return self.send(200, {"running": _up("http://127.0.0.1:3080/health")})
        if path.startswith(("/term/", "/crew/")):
            return self.term()
        f = (STATIC / ("index.html" if path == "/" else path.lstrip("/"))).resolve()
        if STATIC not in f.parents and f != STATIC / "index.html" or not f.is_file():
            return self.send(404, {"error": "not found"})
        types = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
                 ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2"}
        cookie = [("Set-Cookie", f"bridge_term={TERM_KEY}; Path={p}; HttpOnly; SameSite=Strict")
                  for p in ("/term/", "/crew/")] if f.suffix == ".html" else ()
        self.send(200, f.read_bytes(), types.get(f.suffix, "application/octet-stream"), cookie)

    def term(self):
        """The Claude panel: check the lock, then pass the request (and its live websocket) through to ttyd."""
        jar = SimpleCookie(self.headers.get("Cookie", ""))
        key = jar["bridge_term"].value if "bridge_term" in jar else ""
        origin = self.headers.get("Origin")
        if not secrets.compare_digest(key, TERM_KEY) or (origin is not None and origin not in ALLOWED_ORIGINS):
            return self.send(403, {"error": "the Claude panel only opens from the Bridge"})
        up = socket.socket(socket.AF_UNIX)
        try:
            up.connect(str(CREW_SOCK if self.path.startswith("/crew/") else TERM_SOCK))
        except OSError:
            up.close()
            return self.send(503, {"error": "the Claude panel is not running"})
        ws = self.headers.get("Upgrade", "").lower() == "websocket"
        lines = [f"{self.command} {self.path} HTTP/1.1"]
        lines += [f"{k}: {v}" for k, v in self.headers.items() if k.lower() not in ("connection", "cookie")]
        lines.append("Connection: Upgrade" if ws else "Connection: close")
        self.close_connection = True
        with up:
            up.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
            pipe(self.connection, up)

    def do_POST(self):
        if self.headers.get("Host") not in ALLOWED_HOSTS or self.headers.get("X-Bridge") != "engage":
            return self.send(403, {"error": "not from the bridge"})
        try:
            data = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 4096)) or b"{}")
        except ValueError:
            return self.send(400, {"error": "bad json"})
        if self.path == "/api/launch":
            cmd = LAUNCH.get(data.get("app"))
            if not cmd:
                return self.send(400, {"error": "unknown app"})
            spawn(cmd)
            return self.send(200, {"ok": True})
        if self.path == "/api/open":
            # Bridge links open in Firefox (Rabbid's main browser, his logins, Apple Music videos), not the Chrome app window
            url = str(data.get("url", ""))
            if not re.match(r"^(https://|http://127\.0\.0\.1:\d+/)[^\s\"'<>]*$", url) or len(url) > 500:
                return self.send(400, {"error": "bad url"})
            spawn(["firefox", "--new-tab", url])
            return self.send(200, {"ok": True})
        if self.path == "/api/freeai":
            threading.Thread(target=start_free_ais, args=(data.get("firefox", True) is not False,), daemon=True).start()
            return self.send(200, {"ok": True, "running": _up("http://127.0.0.1:3080/health")})
        if self.path == "/api/term/start":
            return self.send(200, {"ok": start_term()})
        if self.path == "/api/crew/start":
            return self.send(200, {"ok": start_term("bridge-crew.service", CREW_SOCK)})
        if self.path == "/api/backup":
            spawn([str(HOME / ".local/bin/backup-now")])
            return self.send(200, {"ok": True})
        if self.path == "/api/log":
            text = str(data.get("text", "")).strip().replace("\n", " ")[:500]
            if not text:
                return self.send(400, {"error": "empty"})
            out = run([str(HOME / ".local/bin/note"), "Captain's log: " + text])
            return self.send(200, {"ok": "Saved" in out})
        if self.path == "/api/speak":
            text = re.sub(r"[^\w\s.,!?'’:;%°-]", "", str(data.get("text", "")))[:240]
            if text:
                speak_async([(str(data.get("voice", "computer")), text)])
            return self.send(200, {"ok": True})
        if self.path == "/api/rollcall":
            speak_async(ROLL_CALL)
            return self.send(200, {"ok": True})
        self.send(404, {"error": "not found"})


if __name__ == "__main__":
    threading.Thread(target=_cpu_sampler, daemon=True).start()
    threading.Thread(target=_usage_fetcher, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
