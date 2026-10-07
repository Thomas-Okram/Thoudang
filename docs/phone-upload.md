# Phone upload on the LAN (and on a phone hotspot)

The Intake page shows a QR code for `http://<laptop-LAN-IP>:5173/m/upload/<session>`.
A phone that opens it can photograph documents straight into the packet on the desk.
The phone talks to the laptop directly, so **both must be on the same network** and that network
must allow device-to-device traffic.

## Normal run

```bash
npm run dev
```

Look for these two lines in the terminal:

```
[web]   ➜  Network: http://192.168.x.y:5173/
[api] Phone upload base: http://192.168.x.y:5173
```

The QR code uses the same address (detected automatically from the laptop's Wi-Fi/Ethernet
interface; `GET /api/network` shows what was picked). Vite listens on `0.0.0.0:5173` and proxies
`/api` to the API on the laptop, so the phone only needs port 5173.

## Venue Wi-Fi blocks device-to-device? Use a phone hotspot

Conference / government Wi-Fi often has _client isolation_: the phone can reach the internet but
not the laptop. Symptom: the phone shows a spinner or "can't connect" on the QR link.

1. Turn on **Personal Hotspot** on phone A (the one with mobile data).
2. Connect the **laptop** to phone A's hotspot.
3. Restart `npm run dev` (the LAN IP changes — the QR code updates on page reload).
   Typical addresses: iPhone hotspot `172.20.10.x`, Android hotspot `192.168.43.x` or `10.x.x.x`.
4. Scan the QR with **phone B connected to the same hotspot**. (Phone A itself can usually open
   the link too, but test it first — some Android builds block the hotspot host from reaching its
   clients.)
5. The hotspot also carries the Claude API calls, so phone A needs mobile data — or run with
   `DEMO_MODE=cache_first` (see below) so pre-run packets need no network at all.

## macOS checklist

- **Firewall**: the first time, macOS may ask "Allow node to accept incoming connections?" → Allow.
  (System Settings → Network → Firewall → Options shows the rule.)
- If the QR shows `localhost`, the laptop has no private IPv4 address: it is not on Wi-Fi/hotspot.
- Test before the demo: from the phone browser open `http://<ip>:5173/api/health` — you should see
  `{"status":"ok", …}`.

## Demo safety

- `DEMO_MODE=cache_first` in `apps/api/.env`: any image already processed once is served from the
  local cache instantly; new photos still call Claude.
- `DEMO_MODE=cache_only`: never touches the network; uncached images go to _Officer attention_
  with "extraction failed — manual review" instead of hanging.
- Warm the cache the night before: with `DEMO_MODE=live` and a working key, upload each demo packet
  once through the Intake page (or batch mode). Then switch to `cache_first`. Note: `npm run eval`
  uses its own database (`data/eval.db`), so it does not warm the demo cache.

## Behind Docker, a reverse proxy or a tunnel

The QR code normally points at `http://<first LAN IP>:<WEB_PORT>`. If phones must use another
address (Docker host, nginx, a tunnel), set `PUBLIC_BASE_URL` in `apps/api/.env`, e.g.
`PUBLIC_BASE_URL=https://thoudang.dswo.local`. The phone-upload QR and the citizen-status QR on
printed notices then use it.
