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
| Lane ID (subnetwork namespace) | `97b10000` |
| TX Version | 1 (Toccata) |
| Input compute budget | 10 per input |
| L2 Chain ID | 38836 |
| L2 RPC | `https://galleon-testnet.igralabs.com:8545` |
| Minimum Amount | 1 KAS |

In testnet mode, KAS is sent to a designated Entry address where it is locked.

Since the Kaspa Testnet-10 Toccata hardfork, Galleon entry transactions must be
posted on Igra's KIP-21 lane. The 4-byte lane namespace `97b10000` is zero-padded
to the full 20-byte on-chain `subnetworkId`
(`97b1000000000000000000000000000000000000`), and the transaction must use
version 1 with each input carrying a `computeBudget` of 10 (replacing the v0
`sigOpCount`). Gas stays 0.

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
| Lane ID (subnetwork namespace) | `97b10000` |
| TX Version | 1 (Toccata) |
| Input compute budget | 10 per input |
| L2 Chain ID | 38833 |
| L2 RPC | `https://rpc.igralabs.com:8545` |
| Minimum Amount | 10 KAS |

In mainnet mode, KAS is sent to the Entry address where it is locked — the same mechanism as Galleon Testnet, but on Kaspa Mainnet. The 10 KAS minimum serves as DDoS protection.

Since the Kaspa Mainnet Toccata hardfork (KIP-21) activated at DAA score
`474,165,565` (~2026-06-30 16:15 UTC), mainnet entry transactions must be posted
on Igra's dedicated KIP-21 lane. The 4-byte lane namespace `97b10000` is
zero-padded to the full 20-byte on-chain `subnetworkId`
(`97b1000000000000000000000000000000000000`), and the transaction must use
version 1 with each input carrying a `computeBudget` of 10 (replacing the v0
`sigOpCount`). Gas stays 0. This is the same lane namespace Galleon Testnet uses
— per IgraLabs Orchestra, `IGRA_LANE_ID` is shared across all networks. Native
(v0) entries submitted after activation are locked on L1 but never credited on
L2.

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

---

## Withdrawal Flow (iKAS → KAS)

The withdrawal flow is handled on Igra L2 by the deployed `KasExitBridge` contract. It is only available on Igra Mainnet.

### Contract reference

| Parameter | Value |
|-----------|-------|
| Proxy address (Igra Mainnet) | `0x4bb88C213d3eD9dc4bae694f1bc1bF745903b2d0` (ERC-1967 UUPS) |
| Verified Solidity source | [`kasExitBridge/`](../kasExitBridge/) in the repo root |
| Chain ID | `38833` (`0x97b1`) |
| Owner | Ownable2Step, controlled off-chain by Igra Labs |

### Flow

1. User selects the **Igra Mainnet · Withdraw** tab.
2. The UI waits for the Kaspa WASM SDK to initialise (required for bech32 checksum validation).
3. The UI calls `getConfig()` on the contract to read the live policy (min/max exit in sompi, throttle window parameters, fee policy address) and renders the input hint + placeholder directly from those values. The protocol owner can retune these via `setThrottleParams` / `setExitAmountPolicy` at any time and the UI picks up the new values the next time the Withdraw tab is opened — no code change or redeploy required. Production launch values are 1,000 – 50,000 iKAS per withdrawal, up to 20 withdrawals or 200,000 iKAS per ~24-hour (86,400-block) window, with `feePolicy = address(0)` (no fee) at launch.
4. User connects an EVM wallet (Kasware EVM, Kastle EVM, MetaMask, or WalletConnect). The UI uses `wallet_switchEthereumChain` with EIP-3085 fallback to ensure the wallet is on chain `0x97b1`.
5. User enters an iKAS amount (≤ 8 decimal places) and a `kaspa:`-prefixed payout address. The address is validated client-side via `new Address(...)` from the Kaspa WASM SDK, which performs full bech32 decode + checksum verification.
6. The UI runs a preflight: `quoteFee` (skipped when `feePolicy == address(0)`) + `throttleStatus` + balance check. Any failure surfaces as a specific, friendly error before the user signs.
7. The user confirms in a dedicated modal with itemized breakdown + acknowledgment of the manual multi-sig timing.
8. The UI re-quotes the fee immediately before sending (TOCTOU guard), re-asserts the chain id, and calls `publicClient.simulateContract` before `walletClient.writeContract`. Any typed contract revert (`ExitAmountBelowMinimum`, `InvalidMsgValue`, `ThrottleExitCountExceeded`, etc.) is decoded and displayed as dedicated copy.
9. Once the receipt is mined, the UI decodes `ExitRequested(requestId, messageId, feeAmountSompi)` and `BurnIKas(amount)` events from the logs. The burn amount is shown, along with the request id and a link to the payout address on the Kaspa explorer. **`messageId` (Hyperlane internal) is never surfaced to the user.**

### Scaling (critical)

The contract uses `SOMPI_SCALE = 10^10`:

```
msg.value (wei, 18 dec) == (unlockAmountSompi + feeAmountSompi) * 10^10
```

The equality is **exact** — no slack. The UI reconstructs the value from a fresh fee quote on every send.

### Safety finding — contract does NOT verify bech32 checksum

`KaspaAddressLib.verifyKaspaAddress` validates only the `kaspa:` prefix, total length (≤ 67), and that every character after the prefix is in the Kaspa bech32 alphabet (`qpzry9x8gf2tvdw0s3jn54khce6mua7l`). It does **not** verify the bech32 checksum.

A typo that still matches the charset can therefore pass the contract's check, burn iKAS, and leave the committee needing to resolve the mistake out-of-band. The UI therefore refuses to enable the submit button until the Kaspa WASM SDK has confirmed the checksum, and never falls back to charset-only validation for withdrawals.

### Errors surfaced to users

| Contract error | UI message |
|----------------|------------|
| `InvalidKasPayoutAddress` | "The payout address was rejected by the contract. Please double-check and try again." |
| `InvalidExitAmount` | "Amount must be greater than zero." |
| `ExitAmountBelowMinimum(amount, min)` | "Amount is below the current minimum of X iKAS." |
| `ExitAmountAboveMaximum(amount, max)` | "Amount is above the current maximum of X iKAS per withdrawal." |
| `ThrottleExitCountExceeded` | "This withdrawal window is full. Please try again once the next window opens." |
| `ThrottleUnlockAmountExceeded(_, _, remaining)` | "Only X iKAS remaining in this withdrawal window." |
| `InvalidMsgValue(expected, actual)` | "The fee changed right before sending. Please re-open the withdrawal form and try again." |
| `ExitRequestCounterExhausted` | "The exit bridge has reached its lifetime request limit." |
| `CurrentBlockNumberOverflow(_)` | "Chain state is in an unexpected range. Please try again later." |
| Wallet rejection (code 4001) | "You cancelled the withdrawal." |

### Hyperlane

Internally, `requestExit` dispatches a Hyperlane message that a multi-signature committee uses to release KAS on Kaspa L1. **This is an implementation detail and is never surfaced in the UI.** The user only sees the L2 transaction hash, the request id, the burned amount, and a link to their Kaspa payout address so they can watch for the eventual incoming KAS.
