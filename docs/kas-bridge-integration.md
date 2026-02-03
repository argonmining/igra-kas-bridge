# tKAS → iKAS Bridge

The KAS Bridge enables users to transfer tKAS from Kaspa L1 (testnet-10) to iKAS on Igra L2. This document covers the technical implementation details for the web-based bridge interface.

## Overview

The bridge operates by constructing **Entry transactions** on Kaspa L1 that are recognized and processed by the Igra sequencer. Users lock KAS in the Entry address on L1, and equivalent iKAS is minted to their specified L2 address.

### Key Parameters

| Parameter | Value |
|-----------|-------|
| Network | Kaspa Testnet-10 |
| Entry Address | `kaspatest:qqmstl2znv9tsfgcmj9shme82my867tapz7pdu4ztwdn6sm9452jj5mm0sxzw` |
| Required TX ID Prefix | `97b4` |
| Minimum Amount | 1 KAS |
| L2 Chain ID | 38836 (Igra Galleon Testnet) |

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

For the Igra sequencer to recognize an Entry transaction, the **Kaspa transaction ID must begin with the prefix `97b4`**.

### Mining Process

1. Construct the Entry payload with an initial random nonce
2. Build the complete Kaspa transaction
3. Compute the transaction ID (hash)
4. If TX ID starts with `97b4`, the transaction is valid
5. Otherwise, increment the nonce and repeat

The 4-byte nonce field provides 2³² possible values, which is sufficient to find a matching TX ID prefix within a reasonable number of iterations (typically < 100,000).

### Why TX ID Mining?

The `97b4` prefix requirement serves as a filtering mechanism, allowing the Igra sequencer to efficiently identify Entry transactions among all Kaspa transactions without scanning every transaction's payload.

---

## Transaction Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                            │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. User inputs:                                                 │
│     • Amount (KAS)                                               │
│     • L2 destination address (0x...)                             │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Fetch UTXOs from Kaspa network via RPC                       │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. TX ID Mining Loop:                                           │
│     • Construct Entry payload with current nonce                 │
│     • Build transaction (inputs, outputs, payload)               │
│     • Compute TX ID                                              │
│     • Check if TX ID starts with "97b4"                          │
│     • If not, increment nonce and repeat                         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Transaction signing via Kastle wallet                        │
│     • User approves transaction in wallet extension              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Broadcast to Kaspa network                                   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. Igra sequencer detects TX (97b4 prefix)                      │
│     • Parses Entry payload                                       │
│     • Mints iKAS to L2 address                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Transaction Structure

The Kaspa transaction is structured as follows:

### Inputs
- User's UTXOs sufficient to cover `amount + fee`

### Outputs

| Index | Recipient | Value | Purpose |
|-------|-----------|-------|---------|
| 0 | Entry Address | Bridge amount | KAS locking UTXO (must be first output) |
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

---

## Security Considerations

1. **TX ID Verification**: Always verify the broadcast TX ID matches the expected `97b4` prefix before confirming success to the user.

2. **UTXO Freshness**: UTXOs can become stale between mining and broadcast. Implement retry logic for failed broadcasts.

3. **Amount Validation**: Enforce minimum bridge amount (1 KAS) to prevent dust attacks.

4. **Address Validation**: Validate L2 addresses match the Ethereum address format (`0x` + 40 hex characters).
