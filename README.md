# Ritual Agent Deploy

Static wallet dapp for deploying and managing Ritual sovereign agents on Ritual testnet.

- **Deploy:** create a sovereign agent, fund it, and arm it from the connected wallet.
- **Manage:** refresh, top up, restart, or stop an existing agent.
- **Agents:** scan deterministic agent slots for the connected wallet.
- **Faucet:** open the official Ritual faucet for test RITUAL.

## Security Model

This app is intentionally small and wallet-confirmed.

- No private key input
- No seed phrase input
- No backend
- No database
- No analytics
- No runtime CDN scripts
- No token approvals
- No `personal_sign`, `eth_sign`, or typed-data signature requests
- Only Ritual testnet transaction requests are built
- Read calls use the public Ritual RPC
- App settings are stored only in local browser storage

The wallet confirmation screen is the final source of truth. Before confirming, users should check:

- Harness deploy transactions target `SovereignAgentFactory`.
- Funding transactions target the predicted agent harness.
- Top-up transactions target `RitualWallet`.
- Restart and stop transactions target the selected agent address.
- Native value matches the amount shown in the app.

Use a burner testnet wallet. Agent deposits are spent by scheduled runs over time.

## Run Locally

Run the included static server:

```bash
npm start
```

Then open:

```text
http://127.0.0.1:5173
```

For source development, use Node.js `20.19+` or `22.12+`, then run:

```bash
npm install
npm run dev
```

## Build

Building requires Node.js `20.19+` or `22.12+`.

```bash
npm install
npm run build
```

The static build is written to `docs/` and is committed for simple Codespaces usage.

## Publish

This repository can be published as a static site on GitHub Pages, Cloudflare Pages, Netlify, Vercel, or any regular web server.

For GitHub Pages, use branch publishing:

1. Go to **Settings -> Pages**.
2. Set source to **Deploy from a branch**.
3. Select branch `main` and folder `/docs`.
4. Save.

## How To Use

1. Connect a wallet.
2. Switch to Ritual testnet when the wallet asks.
3. Use **Faucet** if the wallet needs test RITUAL.
4. Fill in the prompt, model, salt, deposit, and lock blocks.
5. Click **Preview** to calculate the deterministic agent address.
6. Click **Deploy + Arm** and confirm the wallet transactions.
7. Use **Agents -> Scan by Salt** with the same salt to find deployed agents later.
8. If you already have the agent address, paste it into **Agent address** and click **Check Address**.

To deploy a second agent, change `Salt` first. A different salt produces a different deterministic agent address.

`Scan by Salt` does not search every historical wallet transaction. It predicts deterministic agent addresses from the connected wallet and the salt value. If the original salt is unknown, use the direct address check.

## Check Your Agent

Use these places to verify that everything is live:

| Check | Link |
| --- | --- |
| Ritual explorer | `https://explorer.ritualfoundation.org` |
| Agent search | Paste the agent address into the explorer search bar |
| Transaction search | Paste the deploy or fund transaction hash into the explorer search bar |
| Official faucet | `https://faucet.ritualfoundation.org` |
| Ritual map | `https://www.ritualmap.net/?chain=693550770041389137` |
| Genesis claim | Run `/genesis_claim` in the Ritual Discord server |

Healthy app state:

- `Agent state` is `Armed`
- `Configured` is `true`
- `Wake mode` is `1`
- `Agent balance` is greater than `0`
- Explorer shows the agent as `Sovereign` / `Monitored`

## Genesis 1000 Notes

Genesis eligibility is matched from on-chain deploy data. The sync can take about a week. If the Discord bot does not recognize the wallet immediately, wait for the next sync and run `/genesis_claim` again.

Keep these values saved:

- wallet address
- agent address
- deploy transaction hash
- fund and arm transaction hash

If a code was gifted or multiple access codes were used, open a ticket in the Ritual Discord server so the role can be assigned correctly.

## Ritual Network

| Network | Chain ID | RPC |
| --- | --- | --- |
| Ritual testnet | `1979` | `https://rpc.ritualfoundation.org` |

## Contracts

| Contract | Address |
| --- | --- |
| SovereignAgentFactory | `0x9dC4C054e53bCc4Ce0A0Ff09E890A7a8e817f304` |
| RitualWallet | `0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948` |
| TEEServiceRegistry | `0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F` |

## Troubleshooting

If a wallet shows `transaction type not supported`, hard refresh the page and try again. The app sends Ritual transactions with explicit `gasPrice` for wallet compatibility. If the issue persists, try another injected wallet.

If the faucet asks for an access code, get it from the official Ritual campaign, Discord, or partner flow. The app does not generate faucet codes.
