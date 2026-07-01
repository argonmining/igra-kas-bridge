<p align="center">
  <strong>Igra KAS Bridge</strong><br>
  <em>Bridge between Kaspa L1 (KAS) and Igra L2 (iKAS) — entirely in the browser.</em>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#tabs">Tabs</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

## Features

- **Two-way bridging** — Deposit (KAS → iKAS) on Galleon Testnet or Igra Mainnet, and Withdraw (iKAS → KAS) on Igra Mainnet
- **Zero Backend** — Runs entirely in the browser using the Kaspa WASM SDK and viem
- **Kaspa wallet support** — Kastle and Kasware browser extension wallets for the deposit flow
- **EVM wallet support** — Kasware EVM, Kastle EVM, MetaMask, and any other EIP-6963 injected wallet, plus optional WalletConnect v2 for the withdraw flow
- **TX ID Mining** — Deposits automatically mine the required Kaspa transaction ID prefix
- **Client-side bech32 checksum validation** — Withdrawals are gated on a full Kaspa WASM SDK address check because the on-chain `KaspaAddressLib` only validates prefix + charset
- **Configurable deposit fees** — Optional per-transaction bridge fee (mainnet only)

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

## Tabs

The UI presents three tabs at the top of the page:

| Tab | Direction | L1 Network | L2 Network | Mechanism |
|-----|-----------|------------|------------|-----------|
| **Galleon Testnet · Deposit** | KAS → iKAS | Kaspa Testnet-10 | Igra Galleon Testnet | KAS → Entry address + TX ID mining (prefix `97b4`) |
| **Igra Mainnet · Deposit** | KAS → iKAS | Kaspa Mainnet | Igra Mainnet | KAS → Entry address + TX ID mining (prefix `97b1`) |
| **Igra Mainnet · Withdraw** | iKAS → KAS | Igra Mainnet | Kaspa Mainnet | `KasExitBridge.requestExit` (burn iKAS, manual multi-sig unlocks KAS) |

Switching between Mainnet Deposit ↔ Mainnet Withdraw preserves both the Kaspa wallet (deposits) and the EVM wallet (withdrawals) state. Switching between Testnet and Mainnet disconnects the Kaspa wallet (L1 network changed); the EVM wallet is independent.

### Deposits (KAS → iKAS)

Wraps KAS into iKAS on Igra via a Kaspa Entry transaction. KAS is sent to the Entry address where it is locked. Minimum 10 KAS (Igra Mainnet) or 1 KAS (Galleon Testnet).

### Withdrawals (iKAS → KAS)

Calls `requestExit(kasPayoutAddress, unlockAmountSompi)` on the deployed `KasExitBridge` proxy. The call burns the user's iKAS immediately and irreversibly, then emits an `ExitRequested` event that a multi-signature committee uses to release KAS on Kaspa L1 **out-of-band**.

**This withdrawal flow is not immediate.** Timing varies by the committee's cadence. The UI surfaces this prominently in a permanent warning banner, a pre-submit confirmation modal with an explicit acknowledgment checkbox, and a "pending multi-signature release" success panel after the burn tx is mined.

**Decimals/scaling:**
- iKAS is the native 18-decimal gas token on Igra (1 iKAS = 10¹⁸ wei).
- Sompi is the 8-decimal unit on Kaspa L1 (1 KAS = 10⁸ sompi).
- The contract's `SOMPI_SCALE = 10¹⁰`. `msg.value` must equal `(unlockAmountSompi + feeAmountSompi) * 10¹⁰` **exactly** — no slack.
- User input is capped at 8 decimal places; sub-sompi dust is rejected before submission.

**Payout address validation** is done client-side via the Kaspa WASM SDK (`new Address(...)`), which performs a full bech32 decode and checksum check. This is load-bearing — `KaspaAddressLib.verifyKaspaAddress` on chain only checks prefix + charset, not the checksum, so a typo that slipped past client-side validation would burn iKAS with no automatic recourse.

## Configuration

### Environment Variables

All variables are optional and have sensible defaults. See [`.env.example`](.env.example) for full documentation.

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_MAINNET_MIN_KAS` | `10` | Minimum KAS per mainnet bridge tx. Must be a positive integer; invalid values fall back to `10`. Testnet minimums are hardcoded to `1`. |
| `VITE_MAINNET_FEE_KAS` | *(none)* | Deposit bridge fee in whole KAS. **Both** `FEE_KAS` and `FEE_ADDRESS` must be set or no fee is charged. |
| `VITE_MAINNET_FEE_ADDRESS` | *(none)* | Kaspa address that receives the deposit bridge fee. |
| `VITE_TESTNET_NODE_URL` | *(none)* | Direct `wss://` URL to a Kaspa Testnet-10 wRPC node. Leave empty to use the default Resolver. |
| `VITE_IGRA_EXIT_CONTRACT_ADDRESS` | `0x4bb88C213d3eD9dc4bae694f1bc1bF745903b2d0` | Deployed `KasExitBridge` proxy on Igra Mainnet. When unset or malformed, the "Igra Mainnet · Withdraw" tab is hidden. Withdrawal policy (min, max, throttle, fee) is read live from the contract's `getConfig()` view. |
| `VITE_WALLETCONNECT_PROJECT_ID` | *(none)* | WalletConnect Cloud project id. When set, the withdraw wallet picker includes a WalletConnect option (lazy-loaded). Injected wallets (Kasware EVM, Kastle EVM, MetaMask) work without it. |

> Vite bakes `VITE_*` variables into the bundle at build time. Changing them in Railway requires a rebuild before the new value takes effect.

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
| Lane ID (subnetwork namespace) | `97b10000` (Toccata v1, `computeBudget` 10/input) |
| Explorer | [explorer.kaspa.org](https://explorer.kaspa.org) |

</details>

## Architecture

```
src/
├── main.ts          UI, tab state, deposit + withdraw orchestration
├── config.ts        Per-network constants, Igra EVM chain descriptor, helpers
├── bridge.ts        Entry payload construction, deposit orchestration
├── tx-miner.ts      RPC connection, UTXO fetching, nonce mining loop (deposit)
├── kaspa-wasm.ts    WASM SDK loader
├── kastle.ts        Kastle Kaspa wallet adapter (deposit)
├── kasware.ts       Kasware Kaspa wallet adapter (deposit)
├── wallet.ts        Shared Kaspa wallet types
├── evm-wallet.ts    EIP-6963 + WalletConnect discovery, chain-switch (withdraw)
├── exit.ts          KasExitBridge ABI, preflight, simulate+send, receipt decoding
├── exit-config.ts   Withdraw UI constants and explorer URL helpers
└── vite-env.d.ts    Vite environment variable types

public/
└── kaspa/           Kaspa WASM SDK (kaspa.js, kaspa_bg.wasm, kaspa.d.ts)

kasExitBridge/       Verified Solidity source of the deployed KasExitBridge contract
                     (reference only — matches the on-chain implementation)

docs/
└── kas-bridge-integration.md   Entry TX format, mining protocol, integration notes
```

### Key Modules

| Module | Responsibility |
|--------|---------------|
| **tx-miner** | Connects to a Kaspa node (direct URL or Resolver), fetches UTXOs, builds transactions, and iterates nonces until the TX ID matches the required prefix |
| **bridge** | Constructs the 33-byte Entry payload (`0x92` prefix + L2 address + amount + nonce) and orchestrates the mine → sign → broadcast flow |
| **config** | Defines network parameters per mode, the Igra Mainnet viem `Chain` descriptor, and helpers like `getExitContractAddress()` and `estimateIgraBlockTimeSeconds()` |
| **evm-wallet** | Discovers EVM wallets via EIP-6963 with legacy fallbacks, lazy-loads WalletConnect v2, ensures the wallet is on Igra Mainnet using `wallet_switchEthereumChain` → `wallet_addEthereumChain` |
| **exit** | Binds to the deployed `KasExitBridge` ABI (`getConfig`, `throttleStatus`, `quoteFee`, `requestExit`, etc.), parses iKAS amounts decimally-safe, runs preflight, simulates+writes the contract call, decodes the receipt's `ExitRequested` + `BurnIKas` events, and maps every custom revert to friendly copy |

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
