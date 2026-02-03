# Igra Bridge

Bridge TKAS from Kaspa Testnet-10 (L1) to iKAS on Igra Galleon Testnet (L2).

## How It Works

1. **Connect Wallet** - Connect your Kastle browser extension wallet
2. **Enter Details** - Specify amount (min 1 KAS) and your L2 address (0x...)
3. **TX ID Mining** - The bridge mines a nonce until the transaction ID matches the required `97b4` prefix
4. **Sign & Broadcast** - Kastle signs the pre-built transaction and broadcasts to Kaspa network
5. **Receive iKAS** - Igra L2 processes the transaction and mints iKAS to your L2 address

## Technical Details

### Entry Transaction (TxTypeId: 0x2)

The bridge constructs an Igra Entry transaction with the following payload format:

```
[0x92] [20-byte L2 address] [8-byte amount (LE)] [4-byte nonce (BE)]
```

- **0x92**: Version (0x9) + TxTypeId (0x2)
- **L2 Address**: 20 bytes - Ethereum-style address to receive iKAS
- **Amount**: 8 bytes little-endian - Amount in SOMPI (1 KAS = 100,000,000 SOMPI)
- **Nonce**: 4 bytes big-endian - Mined to achieve required TX ID prefix

### TX ID Mining

Igra requires L1 transaction IDs to start with `97b4`. The bridge:

1. Connects to Kaspa network via WASM SDK Resolver (auto-discovers public nodes)
2. Fetches UTXOs for the sender's address
3. Builds a transaction with the Entry payload
4. Iterates nonces until `Transaction.id` starts with `97b4`
5. Serializes to JSON and sends to Kastle for signing

Typical mining time: 1-3 seconds (~30,000-100,000 iterations)

### KAS Locking UTXO

The first output of the L1 transaction sends the bridged KAS to the Entry address:
```
kaspatest:qqmstl2znv9tsfgcmj9shme82my867tapz7pdu4ztwdn6sm9452jj5mm0sxzw
```

## Configuration

| Parameter | Value |
|-----------|-------|
| L1 Network | Kaspa testnet-10 |
| L2 Network | Igra Galleon Testnet |
| L2 RPC | https://galleon-testnet.igralabs.com:8545 |
| L2 Chain ID | 38836 |
| Entry Address | kaspatest:qqmstl2znv9tsfgcmj9shme82my867tapz7pdu4ztwdn6sm9452jj5mm0sxzw |
| TX ID Prefix | 97b4 |
| Min Amount | 1 KAS |

## Development

### Prerequisites

- Node.js 18+
- Kastle browser extension wallet
- Kaspa WASM SDK (in `public/kaspa/`)

### Setup

```bash
cd projects/igra-bridge
npm install
npm run dev
```

### Build

```bash
npm run build
```

### Project Structure

```
src/
├── config.ts      # Network and bridge configuration
├── kastle.ts      # Kastle wallet integration
├── kaspa-wasm.ts  # WASM SDK loader
├── tx-miner.ts    # TX ID mining logic
├── bridge.ts      # Entry transaction construction
└── main.ts        # UI and state management

public/
└── kaspa/         # Kaspa WASM SDK files
    ├── kaspa.js
    ├── kaspa.d.ts
    └── kaspa_bg.wasm
```

## Dependencies

- **Kaspa WASM SDK** - Transaction construction and TX ID computation
- **Kastle Wallet** - Signing and broadcasting transactions
- **Vite** - Development server and build tool
- **TypeScript** - Type safety

## References

- [Igra Transaction Protocol](https://igra-labs.gitbook.io/igralabs-docs/for-developers/architecture/specifications/igra-transaction-protocol)
- [Kastle Wallet API](https://github.com/forbole/kastle/blob/main/api/browser.ts)
- [Kaspa WASM SDK](https://github.com/kaspanet/rusty-kaspa)
