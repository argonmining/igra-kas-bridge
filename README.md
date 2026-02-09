# Igra KAS Bridge

A web-based bridge for wrapping KAS from Kaspa L1 into iKAS on Igra L2. Supports both testnet and mainnet configurations.

## Features

- **Dual Network Support**: Switch between Galleon Testnet and Galleon Test Mainnet
- **Browser-Based**: No backend required—runs entirely in the browser
- **Kastle Integration**: Seamless wallet connection for transaction signing
- **TX ID Mining**: Automated nonce mining to achieve required transaction ID prefixes

## Network Modes

| Mode | L1 Network | L2 Network | TX ID Prefix | Mechanism |
|------|------------|------------|--------------|-----------|
| **Galleon Testnet** | Kaspa Testnet-10 | Igra Galleon Testnet | `97b4` | KAS sent to Entry address |
| **Galleon Test Mainnet** | Kaspa Mainnet | Igra Galleon Test Mainnet | `97b5` | KAS sent to self (never leaves wallet) |

### Galleon Testnet

Wrap TKAS from Kaspa Testnet-10 to receive iKAS on Igra Galleon Testnet. KAS is sent to a designated Entry address where it is locked.

### Galleon Test Mainnet

Wrap KAS from Kaspa Mainnet to receive iKAS on Igra Galleon Test Mainnet. In this mode, **KAS never leaves your wallet**—the transaction sends KAS back to your own address with an Entry payload. The Igra network detects this tagged transaction and mints iKAS accordingly.

## How It Works

1. **Connect Wallet** — Connect your Kastle browser extension
2. **Select Network** — Choose between Testnet or Test Mainnet
3. **Enter Details** — Specify amount (min 1 KAS) and your L2 address (0x...)
4. **TX ID Mining** — The bridge mines a nonce until the TX ID matches the required prefix
5. **Sign & Broadcast** — Kastle signs the transaction and broadcasts to Kaspa
6. **Receive iKAS** — Igra L2 processes the transaction and credits iKAS to your L2 address

## Configuration

### Galleon Testnet

| Parameter | Value |
|-----------|-------|
| L1 Network | Kaspa Testnet-10 |
| L2 Network | Igra Galleon Testnet |
| L2 RPC | `https://galleon-testnet.igralabs.com:8545` |
| L2 Chain ID | 38836 |
| Entry Address | `kaspatest:qqmstl2znv9tsfgcmj9shme82my867tapz7pdu4ztwdn6sm9452jj5mm0sxzw` |
| TX ID Prefix | `97b4` |
| Min Amount | 1 KAS |

### Galleon Test Mainnet

| Parameter | Value |
|-----------|-------|
| L1 Network | Kaspa Mainnet |
| L2 Network | Igra Galleon Test Mainnet |
| L2 RPC | `https://galleon.igralabs.com:8545` |
| L2 Chain ID | 38837 |
| Entry Address | Self (sender's own address) |
| TX ID Prefix | `97b5` |
| Min Amount | 1 KAS |

## Development

### Prerequisites

- Node.js 18+
- [Kastle](https://chromewebstore.google.com/detail/kastle/oambclflhjfppdmkghokjmpppmaebego) browser extension wallet
- Kaspa WASM SDK (included in `public/kaspa/`)

### Setup

```bash
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

### Build

```bash
npm run build
```

Production files are output to `dist/`.

### Production Server

```bash
npm run build
npm start
```

Uses [serve](https://github.com/vercel/serve) for static file hosting with proper WASM MIME types.

## Project Structure

```
src/
├── config.ts       # Network configuration and utilities
├── kastle.ts       # Kastle wallet integration
├── kaspa-wasm.ts   # WASM SDK loader
├── tx-miner.ts     # TX ID mining and transaction building
├── bridge.ts       # Entry transaction construction
└── main.ts         # UI and state management

public/
├── kaspa/          # Kaspa WASM SDK files
│   ├── kaspa.js
│   ├── kaspa.d.ts
│   └── kaspa_bg.wasm
└── serve.json      # Static server MIME type configuration

docs/
├── kas-bridge-integration.md   # Technical integration docs
└── node-requirements.md        # Igra node hardware requirements
```

## Technical Documentation

For detailed technical documentation on the Entry transaction format, TX ID mining, and integration details, see [docs/kas-bridge-integration.md](docs/kas-bridge-integration.md).

## Dependencies

- **[Kaspa WASM SDK](https://github.com/aspect-rs/kaspa-wasm)** — Transaction construction and TX ID computation
- **[Kastle Wallet](https://github.com/aspect-rs/kastle)** — Transaction signing and broadcasting
- **[Vite](https://vitejs.dev/)** — Development server and build tool
- **[TypeScript](https://www.typescriptlang.org/)** — Type safety

## References

- [Igra Transaction Protocol](https://igra-labs.gitbook.io/igralabs-docs/for-developers/architecture/specifications/igra-transaction-protocol)
- [Kastle Wallet API](https://github.com/forbole/kastle/blob/main/api/browser.ts)
- [Kaspa WASM SDK](https://github.com/kaspanet/rusty-kaspa)

## License

MIT
