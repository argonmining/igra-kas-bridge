<p align="center">
  <strong>Igra KAS Bridge</strong><br>
  <em>Wrap KAS from Kaspa L1 into iKAS on Igra L2 — entirely in the browser.</em>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#network-modes">Network Modes</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

## Features

- **Multi-Network** — Galleon Testnet and Igra Mainnet
- **Zero Backend** — Runs entirely in the browser using the Kaspa WASM SDK
- **Wallet Support** — Kastle and KasWare browser extension wallets
- **TX ID Mining** — Automated nonce mining to match required transaction ID prefixes
- **Configurable Fees** — Optional per-transaction bridge fee (mainnet only)

## Quick Start

```bash
# 1. Clone
git clone https://github.com/argonmining/igra-kas-bridge.git
cd igra-kas-bridge

# 2. Install
npm install

# 3. Configure
cp .env.example .env          # edit values as needed

# 4. Run
npm run dev                    # → http://localhost:3000
```

### Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js 18+** | LTS recommended |
| **Browser wallet** | [Kastle](https://chromewebstore.google.com/detail/kastle/oambclflhjfppdmkghokjmpppmaebego) or [KasWare](https://kasware.xyz/) |
| **Kaspa WASM SDK** | Bundled in `public/kaspa/` — no extra install |

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌────────────┐
│ Connect      │ ──▸ │ Enter amount │ ──▸ │ Mine TX ID   │ ──▸ │ Sign &     │
│ Wallet       │     │ & L2 address │     │ (nonce loop) │     │ Broadcast  │
└─────────────┘     └──────────────┘     └──────────────┘     └─────┬──────┘
                                                                     │
                                                                     ▼
                                                              ┌────────────┐
                                                              │ Receive    │
                                                              │ iKAS on L2 │
                                                              └────────────┘
```

1. **Connect Wallet** — Link your Kastle or KasWare browser extension
2. **Select Network** — Choose Galleon Testnet or Igra Mainnet
3. **Enter Details** — Specify the KAS amount and your L2 address (`0x…`)
4. **TX ID Mining** — The bridge iterates nonces until the transaction ID matches the required prefix
5. **Sign & Broadcast** — Your wallet signs the transaction and submits it to Kaspa L1
6. **Receive iKAS** — Igra L2 detects the tagged transaction and credits iKAS to your L2 address

## Network Modes

| Mode | L1 Network | L2 Network | TX ID Prefix | Min KAS | Mechanism |
|------|------------|------------|:------------:|--------:|-----------|
| **Galleon Testnet** | Kaspa Testnet-10 | Igra Galleon Testnet | `97b4` | 1 | KAS → Entry address |
| **Igra Mainnet** | Kaspa Mainnet | Igra Mainnet | `97b1` | 10 | KAS → Entry address |

### Galleon Testnet

Wrap TKAS from Kaspa Testnet-10 to receive iKAS on Igra Galleon Testnet. KAS is sent to a designated Entry address where it is locked. Uses a dedicated wRPC node configured via `VITE_TESTNET_NODE_URL`.

### Igra Mainnet

Wrap KAS from Kaspa Mainnet to receive iKAS on Igra Mainnet. KAS is sent to the Entry address where it is locked. Minimum 10 KAS as DDoS protection.

## Configuration

### Environment Variables

All variables are optional and have sensible defaults. See [`.env.example`](.env.example) for full documentation.

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_MAINNET_MIN_KAS` | `10` | Minimum KAS per mainnet bridge tx. Must be a positive integer; invalid values fall back to `10`. Testnet minimums are hardcoded to `1`. |
| `VITE_MAINNET_FEE_KAS` | *(none)* | Bridge fee in whole KAS. **Both** `FEE_KAS` and `FEE_ADDRESS` must be set or no fee is charged. |
| `VITE_MAINNET_FEE_ADDRESS` | *(none)* | Kaspa address that receives the bridge fee. |
| `VITE_TESTNET_NODE_URL` | *(none)* | Direct `wss://` URL to a Kaspa Testnet-10 wRPC node. Leave empty to use the default Resolver. |

> **Note:** There is no enforced maximum bridge amount — the bridge accepts any amount above the minimum. `VITE_MAINNET_MAX_KAS` is reserved in `.env.example` but not yet wired into the config.

### Testnet Node Setup

The public Kaspa Resolver may not reliably discover Testnet-10 nodes. To use a dedicated node:

1. Run a Kaspa Testnet-10 node (wRPC Borsh listens on port **17210** by default)
2. Place a TLS-terminating reverse proxy (nginx + Let's Encrypt or Cloudflare) in front of it — browsers require `wss://` when the page is served over HTTPS
3. Set `VITE_TESTNET_NODE_URL` to the public `wss://` endpoint

### Network Details

<details>
<summary><strong>Galleon Testnet</strong></summary>

| Parameter | Value |
|-----------|-------|
| L1 Network | Kaspa Testnet-10 |
| L2 Network | Igra Galleon Testnet |
| L2 RPC | `https://galleon-testnet.igralabs.com:8545` |
| L2 Chain ID | `38836` |
| Entry Address | `kaspatest:qqmstl2znv9tsfgcmj9shme82my867tapz7pdu4ztwdn6sm9452jj5mm0sxzw` |
| TX ID Prefix | `97b4` |
| Explorer | [explorer-tn10.kaspa.org](https://explorer-tn10.kaspa.org) |

</details>

<details>
<summary><strong>Igra Mainnet</strong></summary>

| Parameter | Value |
|-----------|-------|
| L1 Network | Kaspa Mainnet |
| L2 Network | Igra Mainnet |
| L2 RPC | `https://rpc.igralabs.com:8545` |
| L2 Chain ID | `38833` |
| Entry Address | `kaspa:ppvnxxzm0rr37zpnwux2f2ntvfpr4uqdpm7zsvsztg3en92r7gs0wkmr72q9n` |
| TX ID Prefix | `97b1` |
| Explorer | [explorer.kaspa.org](https://explorer.kaspa.org) |

</details>

## Architecture

```
src/
├── main.ts          UI, state management, network switching
├── config.ts        Per-network constants and utilities
├── bridge.ts        Entry payload construction, mining orchestration
├── tx-miner.ts      RPC connection, UTXO fetching, nonce mining loop
├── kaspa-wasm.ts    WASM SDK loader
├── kastle.ts        Kastle wallet adapter
├── kasware.ts       KasWare wallet adapter
├── wallet.ts        Shared wallet types
└── vite-env.d.ts    Vite environment variable types

public/
└── kaspa/           Kaspa WASM SDK (kaspa.js, kaspa_bg.wasm, kaspa.d.ts)

docs/
└── kas-bridge-integration.md   Entry TX format, mining protocol, integration notes
```

### Key Modules

| Module | Responsibility |
|--------|---------------|
| **tx-miner** | Connects to a Kaspa node (direct URL or Resolver), fetches UTXOs, builds transactions, and iterates nonces until the TX ID matches the required prefix |
| **bridge** | Constructs the 33-byte Entry payload (`0x92` prefix + L2 address + amount + nonce) and orchestrates the mine → sign → broadcast flow |
| **config** | Defines network parameters per mode and exposes a reactive `CONFIG` object that switches with `setNetworkMode()` |

## Development

```bash
npm run dev        # Vite dev server → http://localhost:3000
npm run build      # Type-check + production build → dist/
npm run preview    # Preview the production build locally
npm start          # Serve dist/ with correct WASM MIME types (uses `serve`)
```

### Production Deployment

The project is configured for [Railway](https://railway.app):

```bash
npm run build && npm start
```

Set environment variables in the Railway dashboard. The `serve` package handles static file hosting with proper `application/wasm` MIME types.

## Technical Documentation

For the full Entry transaction format, TX ID mining protocol, and integration details, see [docs/kas-bridge-integration.md](docs/kas-bridge-integration.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Please open an issue to discuss significant changes before submitting a PR.

## References

- [Igra Transaction Protocol](https://igra-labs.gitbook.io/igralabs-docs/for-developers/architecture/specifications/igra-transaction-protocol)
- [Kaspa WASM SDK](https://github.com/kaspanet/rusty-kaspa)
- [Kastle Wallet API](https://github.com/forbole/kastle/blob/main/api/browser.ts)
- [Kaspa wRPC Port Reference](https://kaspa.aspectron.org/rpc/ports.html)

## Security

If you discover a vulnerability, **do not open a public issue**. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

[MIT](LICENSE)
