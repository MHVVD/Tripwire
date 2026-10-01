# Demo script (2:45)

Record at 1440×900 with the browser zoomed to 100%. Run Tripwire for at least 6 minutes before you start, so the radar is full and the +5-minute outcome tile has numbers. Keep the terminal and the browser side by side, or cut between them.

Before recording:

```bash
npm run doctor                       # all five rows should be ✔
npm start                            # leave it running 6+ minutes
```

---

### 0:00–0:15 · The problem
**Screen:** the dashboard, alerts streaming on the right.
**Say:** "Most pump.fun buyers lose money to a handful of wallets: the dev, the wallets that bought in the launch slot, and the snipers. They move first, and they move on-chain, seconds before the chart dies. Tripwire watches them for you, live, on Solami."

### 0:15–0:35 · It runs on Solami
**Screen:** the terminal with `npm run doctor` output (gRPC, Blur, RPC, Beam, leader tracking all ✔), then the top bar of the dashboard.
**Say:** "One Solami key. Yellowstone gRPC carries every pump.fun and PumpSwap transaction, about 500 a second, zero slots behind the tip. Blur adds token intel, RPC and Beam land the exits."
**Point at:** the gRPC tx/s pill, the slot pill, Blur and Beam pills.

### 0:35–1:05 · Launch Radar
**Screen:** the left column; new launches sliding in. Click a high-risk (red) row.
**Say:** "Every launch is scored the second it exists. We rebuild its cohorts from the raw stream: who bought in the creation slot, who sniped, where the dev's tokens went. Blur adds the dev's history; this creator has launched hundreds of tokens."
**Point at:** the risk gauge and its flags, then the holders table with dev / same-slot / sniper / linked roles. Click a dev wallet or a signature through to Solscan to show it is real.

### 1:05–1:25 · Arm a tripwire
**Screen:** close the drawer; paste a mint into the arm box (or use Arm on a radar row), tick auto-exit, click Arm.
**Say:** "Arming a token rewrites the gRPC filter live: we now also follow the dev's wallet and every wallet the dev sends tokens to, so a quiet split into fresh wallets is caught too, not just DEX trades."

### 1:25–2:00 · An alert fires
**Screen:** the Alerts column; wait for or scroll to a red critical alert (Dev sold / Insiders dumped). Click its signature to Solscan.
**Say:** "Here the dev sold half their bag. Tripwire raised a critical alert within milliseconds of the transaction reaching us. Repeat triggers fold into one alert, so you are not spammed. And here is the honest part: five minutes after critical alerts, these tokens moved X%, against Y% for the same tokens at random times."
**Point at:** the "5-min after critical alert" tile with its baseline, and a "5m: −NN%" chip on an alert.

### 2:00–2:25 · The exit, through Beam
**Screen:** the Exits table (paper exits quoted by Jupiter), then the terminal running:

```bash
npm run beam-test -- 6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx 0.003
```

**Say:** "On a critical alert Tripwire can sell for you: Jupiter builds the swap, we add a Beam tip, sign, and land it through Solami's Beam. This is the real exit code on mainnet: trigger to send in 380 milliseconds, landed in about half a second, and Beam's own record shows the region and tip."
**Point at:** `status: landed`, `landMs`, the Beam region, then open the Solscan link.

### 2:25–2:45 · Close
**Screen:** the README's Quick start.
**Say:** "Clone, add your Solami key, `npm run doctor`, `npm start`. Open source, paper mode by default, live mode capped and opt-in. Tripwire: read the chain through Solami, act through Beam, before the rug."

---

**Tips**
- If no critical alert happens during the take, open a token in the Tripwires column with alerts and walk through its alert history in the drawer.
- Mute the dashboard sound unless you want the alert beep in the recording.
- Running live exits on camera needs `EXIT_MODE=live`, `WALLET_SECRET_KEY` (a burner) and a small `EXIT_MAX_SOL`. The `beam-test` command is the safer way to show a real landing.
