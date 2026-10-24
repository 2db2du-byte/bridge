# The Bridge 🖖

A Star Trek control center for a home PC: one full-screen page that looks like the bridge of the Enterprise
(LCARS for Picard's era, flip to Kirk's era with one button) and actually runs the house.

- **Main viewscreen:** a WebGL star field / nebula drawn on the GPU, a greeting, and an ON SCREEN button that puts
  your webcam on it. YouTube can play on the right half (search goes through your own SearXNG).
- **Stations:** Engineering (CPU/GPU/RAM/temps, a warp core that pulses with load), Ops (Kopia backup status +
  "back up now", drives, Claude plan usage), Science (offline library + maps, course progress), Tactical
  (firewall "shields"), Helm (launch games/apps from a whitelist), Comms (your public accounts).
- **Red alert only when something is actually wrong:** a failed or stale backup, a full drive, a hot GPU.
- **Deep Space Nine:** a Cardassian Promenade where every shop door opens one of your Claude Code agents in a
  side drawer (each in its own tmux session, so conversations stick around).
- **Claude drawer:** Claude Code in a live terminal (ttyd on a private socket, locked with a cookie).
- Sounds are synthesized with WebAudio; the "computer" voice is a local TTS command (`say`).

Runs as a tiny Python stdlib server on `127.0.0.1:1701` (POSTs need a custom header + Host check). Built for a
1920×1080 screen with no scrolling. Paths and service names are from the author's machine; adjust to yours.

## License

MIT. Built by Rabbid Raccoon with Claude. Use it, change it, share it.
