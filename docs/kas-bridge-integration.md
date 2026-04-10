# KAS → iKAS Bridge Integration

The KAS Bridge enables users to wrap KAS from Kaspa L1 into iKAS on Igra L2. This document covers the technical implementation details for the web-based wrapping interface.

## Overview

The wrapping process constructs **Entry transactions** on Kaspa L1 that are detected by the Viaduct and processed by IgReth, Igra's EVM engine. The bridge supports three modes:

| Mode | L1 Network | Mechanism | TX ID Prefix | Min Amount |
|------|------------|-----------|--------------|------------|
| Galleon Testnet | Kaspa Testnet-10 | KAS locked in Entry address | `97b4` | 1 KAS |
| Galleon Test Mainnet | Kaspa Mainnet | Self-send (KAS stays in wallet) | `97b5` | 1 KAS |
| Igra Mainnet | Kaspa Mainnet | KAS locked in Entry address | `97b1` | 10 KAS |

---

## Network Configuration

### Galleon Testnet

| Parameter | Value |
|-----------|-------|
| L1 Network | Kaspa Testnet-10 |
| Entry Address | `kaspatest:qqmstl2znv9tsfgcmj9shme82my867tapz7pdu4ztwdn6sm9452jj5mm0sxzw` |
| TX ID Prefix | `97b4` |
| L2 Chain ID | 38836 |
| L2 RPC | `https://galleon-testnet.igralabs.com:8545` |
| Minimum Amount | 1 KAS |

In testnet mode, KAS is sent to a designated Entry address where it is locked.

### Galleon Test Mainnet

| Parameter | Value |
|-----------|-------|
| L1 Network | Kaspa Mainnet |
| Entry Address | Self (sender's own address) |
| TX ID Prefix | `97b5` |
| L2 Chain ID | 38837 |
| L2 RPC | `https://galleon.igralabs.com:8545` |
| Minimum Amount | 1 KAS |

In test mainnet mode, KAS is sent back to the user's own address with an Entry payload. **KAS never leaves the user's wallet**—the transaction simply tags the KAS with the Entry payload, which the Igra network detects and uses to mint iKAS.

### Igra Mainnet

| Parameter | Value |
|-----------|-------|
| L1 Network | Kaspa Mainnet |
| Entry Address | `kaspa:ppvnxxzm0rr37zpnwux2f2ntvfpr4uqdpm7zsvsztg3en92r7gs0wkmr72q9n` |
| TX ID Prefix | `97b1` |
| L2 Chain ID | 38833 |
| L2 RPC | `https://rpc.igralabs.com:8545` |
| Minimum Amount | 10 KAS |

In mainnet mode, KAS is sent to the Entry address where it is locked — the same mechanism as Galleon Testnet, but on Kaspa Mainnet. The 10 KAS minimum serves as DDoS protection.

---

## Entry Transaction Format

Entry transactions use a specific payload format embedded in the Kaspa transaction's payload field.

### Payload Structure (33 bytes)

```
[Prefix: 1 byte] [L2 Address: 20 bytes] [Amount: 8 bytes] [Nonce: 4 bytes]
```

| Offset | Length | Field | Description |
|--------|--------|-------|-------------|
| 0 | 1 | Prefix | `0x92` — Version (0x9) + TxTypeId (0x2) |
| 1 | 20 | L2 Address | Recipient's Ethereum-style address (without 0x prefix) |
| 21 | 8 | Amount | Amount in SOMPI, unsigned 64-bit **little-endian** |
| 29 | 4 | Nonce | Mining nonce, unsigned 32-bit **big-endian** |

### Prefix Byte (0x92)

The prefix byte encodes:
- **Upper nibble (0x9)**: Protocol version
- **Lower nibble (0x2)**: Transaction type identifier for Entry

### Amount Encoding

The amount is stored in SOMPI (1 KAS = 100,000,000 SOMPI) as an unsigned 64-bit little-endian integer.

**Example**: 20 KAS = 2,000,000,000 SOMPI = `0x77359400`
- Stored as: `00 94 35 77 00 00 00 00` (little-endian)

---

## TX ID Mining

For the Igra Network to recognize an Entry transaction, the **Kaspa transaction ID must begin with the required prefix**:

| Network | Required Prefix |
|---------|-----------------|
| Testnet-10 (Galleon Testnet) | `97b4` |
| Mainnet (Galleon Test Mainnet) | `97b5` |
| Mainnet (Igra Mainnet) | `97b1` |

### Mining Process

1. Construct the Entry payload with an initial random nonce
2. Build the complete Kaspa transaction
3. Compute the transaction ID (hash)
4. If TX ID starts with the required prefix, the transaction is valid
5. Otherwise, increment the nonce and repeat

The 4-byte nonce field provides 2³² possible values, which is sufficient to find a matching TX ID prefix within a reasonable number of iterations (typically < 100,000).

### Why TX ID Mining?

The prefix requirement serves as a filtering mechanism, allowing the Igra Network to efficiently identify Entry transactions among all Kaspa transactions without scanning every transaction's payload.

---

## Transaction Flow

### Testnet Mode (Entry Address)

```
┌─────────────────────────────────────────────────────────────────┐
│  1. User inputs amount and L2 address                           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Fetch UTXOs from Kaspa Testnet-10                           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Mine TX ID with prefix "97b4"                               │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Build transaction:                                          │
│     • Output 0: Entry Address (wrap amount)                     │
│     • Output 1: Sender Address (change)                         │
│     • Payload: Entry payload with L2 address                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Sign via Kastle wallet and broadcast                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. Viaduct detects TX (97b4 prefix)                            │
│     • IgReth credits iKAS to L2 address                         │
└─────────────────────────────────────────────────────────────────┘
```

### Test Mainnet Mode (Self-Send)

```
┌─────────────────────────────────────────────────────────────────┐
│  1. User inputs amount and L2 address                           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Fetch UTXOs from Kaspa Mainnet                              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Mine TX ID with prefix "97b5"                               │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Build transaction:                                          │
│     • Output 0: Sender Address (wrap amount - SELF SEND)        │
│     • Output 1: Sender Address (change)                         │
│     • Payload: Entry payload with L2 address                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Sign via Kastle wallet and broadcast                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. Viaduct detects TX (97b5 prefix)                            │
│     • IgReth credits iKAS to L2 address                         │
│     • User's KAS remains in their wallet                        │
└─────────────────────────────────────────────────────────────────┘
```

**Key Difference**: In self-send mode, the wrap amount output goes back to the sender's own address instead of an Entry address. The KAS is effectively "tagged" with the Entry payload but never leaves the user's control.

---

## Transaction Structure

### Inputs
- User's UTXOs sufficient to cover `amount + fee`

### Outputs

#### Testnet Mode
| Index | Recipient | Value | Purpose |
|-------|-----------|-------|---------|
| 0 | Entry Address | Wrap amount | KAS locking UTXO (must be first output) |
| 1 | Sender Address | Remaining balance - fee | Change output |

#### Test Mainnet Mode (Self-Send)
| Index | Recipient | Value | Purpose |
|-------|-----------|-------|---------|
| 0 | Sender Address | Wrap amount | Self-send UTXO (must be first output) |
| 1 | Sender Address | Remaining balance - fee | Change output |

### Payload
- 33-byte Entry payload as described above

### Fee
- Minimum ~10,000 SOMPI (0.0001 KAS) for typical Entry transactions
- Actual fee depends on transaction mass (inputs, outputs, payload size)

---

## Payload Construction Example

**Inputs:**
- L2 Address: `0x5f102e8aFf08F647681de13009AB313fDC55fBA8`
- Amount: 1 KAS (100,000,000 SOMPI)
- Nonce: `0x00000001`

**Payload (hex):**
```
92                                       # Prefix (Version 9, Type 2)
5f102e8aff08f647681de13009ab313fdc55fba8 # L2 Address (20 bytes)
00e1f50500000000                         # Amount: 100000000 in LE (8 bytes)
00000001                                 # Nonce in BE (4 bytes)
```

**Complete payload (33 bytes):**
```
925f102e8aff08f647681de13009ab313fdc55fba800e1f5050000000000000001
```

---

## Implementation Notes

### Kaspa WASM SDK

The bridge uses the [Kaspa WASM SDK](https://github.com/aspect-rs/kaspa-wasm) for:
- RPC connection to Kaspa nodes via Resolver
- UTXO fetching
- Transaction construction
- TX ID computation

### Wallet Integration

The bridge integrates with the [Kastle wallet](https://chromewebstore.google.com/detail/kastle/oambclflhjfppdmkghokjmpppmaebego) browser extension for:
- Account connection
- Transaction signing
- Network verification
- Broadcasting

### Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| Insufficient fee | Transaction mass exceeds fee | Increase fee allocation |
| Orphan transaction | UTXOs spent before broadcast | Retry with fresh UTXOs |
| TX ID mining timeout | Failed to find matching prefix | Increase max iterations or retry |
| Wrong network | Wallet network doesn't match bridge mode | Switch Kastle to correct network |

---

## Security Considerations

1. **TX ID Verification**: Always verify the broadcast TX ID matches the expected prefix before confirming success to the user.

2. **UTXO Freshness**: UTXOs can become stale between mining and broadcast. Implement retry logic for failed broadcasts.

3. **Amount Validation**: Enforce minimum wrap amount (1 KAS) to prevent dust attacks.

4. **Address Validation**: Validate L2 addresses match the Ethereum address format (`0x` + 40 hex characters).

5. **Network Mismatch**: Verify the connected wallet network matches the selected bridge mode (testnet vs mainnet).
