#!/usr/bin/env python3
"""Bridge reminders (replace the n8n Morty + Birdperson jobs that went through Mission Control).

  reminders.py lesson        weekdays 6 PM: "time for today's lesson" + the next unchecked step
  reminders.py backup-check  nightly: speaks up ONLY if the backup failed or is stale (no news = good news)
"""
import json
import os
import subprocess
import sys
from urllib.request import Request, urlopen

HOME = os.path.expanduser("~")


def status():
    req = Request("http://127.0.0.1:1701/api/status", headers={"Host": "127.0.0.1:1701"})
    return json.load(urlopen(req, timeout=20))


def tell(title, body, voice_text):
    subprocess.run(["notify-send", "-a", "Bridge", "-i", f"{HOME}/Projects/bridge/static/icon.svg", title, body])
    subprocess.run([f"{HOME}/.local/bin/say", voice_text], env=dict(os.environ, SAY_VOICE="bf_emma"))


def lesson():
    st = status()
    linux = next((c for c in st["science"]["courses"] if c["name"] == "Learn Linux"), None)
    nxt = linux["next"] if linux and linux["next"] else "pick up where you left off"
    tell("🖖 Time for today's lesson", f"Learn Linux: {nxt}",
         "Captain, it's eighteen hundred hours. Time for today's lesson. Next up: " + nxt.split("(")[0])


def backup_check():
    b = status()["ops"]["backup"]
    if b["result"] != "success":
        tell("🚨 Backup failed", "The last hourly backup did not finish. Open the Bridge, Ops station.",
             "Red alert. Captain, the last backup failed.")
    elif b["age_min"] is not None and b["age_min"] > 180:
        tell("⚠️ Backups are behind", f"No backup for {b['age_min'] // 60} hours.",
             f"Yellow alert. Captain, there has been no backup for {b['age_min'] // 60} hours.")


if __name__ == "__main__":
    {"lesson": lesson, "backup-check": backup_check}[sys.argv[1]]()
