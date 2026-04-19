/**
 * Igra Exit Bridge — iKAS (Igra L2) → KAS (Kaspa L1)
 *
 * Calls KasExitBridge.requestExit on Igra Mainnet. The contract burns the
 * user's iKAS and emits an event (ExitRequested) that a multi-signature
 * committee uses to release KAS on Kaspa L1 out-of-band. This is NOT an
 * automatic flow — the UI must communicate the manual nature clearly.
 *
 * Contract reference: /Users/ashton/Github/igra-kas-bridge/kasExitBridge/KasExitBridge.sol
 * Deployed proxy (mainnet): 0x4bb88C213d3eD9dc4bae694f1bc1bF745903b2d0
 *
 * This module has ZERO coupling to the deposit path (src/kastle.ts,
 * src/kasware.ts, src/bridge.ts, src/tx-miner.ts). It only touches
 * src/kaspa-wasm.ts for bech32-checksum validation of the payout address.
 */

import {
  BaseError,
  ContractFunctionRevertedError,
  decodeEventLog,
  type Address,
  type Hash,
  type Log,
  type PublicClient,
  type WalletClient,
} from 'viem';

import {
  IGRA_MAINNET_CHAIN,
  SOMPI_SCALE_WEI,
  getExitContractAddress,
} from './config';
import { EXIT_RECEIPT_TIMEOUT_MS } from './exit-config';
import { getKaspaWasm, isWasmInitialized } from './kaspa-wasm';

// ── ABI (bound to the DEPLOYED interface, not the repo-root draft) ─

export const KAS_EXIT_BRIDGE_ABI = [
  // Views
  {
    type: 'function',
    name: 'getConfig',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'kaspaBridgeEndpoint', type: 'bytes32' },
      { name: 'feePolicy', type: 'address' },
      { name: 'feeClaimer', type: 'address' },
      { name: 'throttleWindowBlocks', type: 'uint32' },
      { name: 'throttleMaxExitsPerWindow', type: 'uint32' },
      { name: 'throttleMaxUnlockAmountPerWindowSompi', type: 'uint64' },
      { name: 'minExitSompi', type: 'uint64' },
      { name: 'maxExitSompi', type: 'uint64' },
    ],
  },
  {
    type: 'function',
    name: 'throttleStatus',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'windowIndex', type: 'uint32' },
      { name: 'windowEndsAtBlock', type: 'uint32' },
      { name: 'remainingExits', type: 'uint32' },
      { name: 'remainingUnlockAmountSompi', type: 'uint64' },
    ],
  },
  {
    type: 'function',
    name: 'quoteFee',
    stateMutability: 'view',
    inputs: [
      { name: 'originBurner', type: 'address' },
      { name: 'unlockAmountSompi', type: 'uint64' },
    ],
    outputs: [{ name: 'feeAmountSompi', type: 'uint64' }],
  },
  {
    type: 'function',
    name: 'totalBurned',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nextExitRequestId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint32' }],
  },
  {
    type: 'function',
    name: 'getExitRequest',
    stateMutability: 'view',
    inputs: [{ name: 'requestId', type: 'uint32' }],
    outputs: [
      { name: 'exists', type: 'bool' },
      { name: 'recordedAtBlock', type: 'uint32' },
      { name: 'feeAmountSompi', type: 'uint64' },
      { name: 'unlockAmountSompi', type: 'uint64' },
      { name: 'messageId', type: 'bytes32' },
    ],
  },

  // Write
  {
    type: 'function',
    name: 'requestExit',
    stateMutability: 'payable',
    inputs: [
      { name: 'kasPayoutAddress', type: 'string' },
      { name: 'unlockAmountSompi', type: 'uint64' },
    ],
    outputs: [
      { name: 'requestId', type: 'uint32' },
      { name: 'messageId', type: 'bytes32' },
    ],
  },

  // Events
  {
    type: 'event',
    name: 'ExitRequested',
    inputs: [
      { name: 'requestId', type: 'uint32', indexed: false },
      { name: 'messageId', type: 'bytes32', indexed: false },
      { name: 'feeAmountSompi', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BurnIKas',
    inputs: [{ name: 'amount', type: 'uint256', indexed: false }],
  },
  {
    type: 'event',
    name: 'ExitAmountPolicyUpdated',
    inputs: [
      { name: 'minExitAmountSompi', type: 'uint64', indexed: false },
      { name: 'maxExitAmountSompi', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ThrottleParamsUpdated',
    inputs: [
      { name: 'throttleWindowBlocks', type: 'uint32', indexed: false },
      { name: 'throttleMaxExitsPerWindow', type: 'uint32', indexed: false },
      { name: 'throttleMaxUnlockAmountPerWindow', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'FeePolicyUpdated',
    inputs: [{ name: 'feePolicyAddress', type: 'address', indexed: false }],
  },

  // User-path errors (custom — viem uses these for typed revert decoding)
  { type: 'error', name: 'InvalidKasPayoutAddress', inputs: [] },
  { type: 'error', name: 'InvalidExitAmount', inputs: [] },
  {
    type: 'error',
    name: 'ExitAmountBelowMinimum',
    inputs: [
      { name: 'unlockAmountSompi', type: 'uint64' },
      { name: 'minExitAmountSompi', type: 'uint64' },
    ],
  },
  {
    type: 'error',
    name: 'ExitAmountAboveMaximum',
    inputs: [
      { name: 'unlockAmountSompi', type: 'uint64' },
      { name: 'maxExitAmountSompi', type: 'uint64' },
    ],
  },
  {
    type: 'error',
    name: 'ThrottleExitCountExceeded',
    inputs: [
      { name: 'windowIndex', type: 'uint32' },
      { name: 'throttleMaxExitsPerWindow', type: 'uint32' },
    ],
  },
  {
    type: 'error',
    name: 'ThrottleUnlockAmountExceeded',
    inputs: [
      { name: 'windowIndex', type: 'uint32' },
      { name: 'attemptedUnlockAmountSompi', type: 'uint64' },
      { name: 'remainingUnlockAmountSompi', type: 'uint64' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidMsgValue',
    inputs: [
      { name: 'expectedWei', type: 'uint256' },
      { name: 'actualWei', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'ExitRequestCounterExhausted', inputs: [] },
  {
    type: 'error',
    name: 'CurrentBlockNumberOverflow',
    inputs: [{ name: 'blockNumber', type: 'uint256' }],
  },
] as const;

// ── Decimal-safe iKAS ↔ sompi conversions ──────────────────────

export const SOMPI_MAX_UINT64 = (1n << 64n) - 1n;

/**
 * Parses a user-entered iKAS amount string into sompi (uint64 bigint).
 * Deliberately zero-tolerance — no parseFloat, no locale guessing,
 * no silent rounding. The bridge can permanently burn iKAS, so every
 * rejection path is explicit.
 *
 * Accepts: "1", "1.5", "0.00000001", ".5".
 * Rejects: empty, "0", "1,5" (comma), scientific notation, leading
 * sign, whitespace, > 8 decimal places, values that overflow uint64,
 * and sub-sompi dust (anything < 1 sompi).
 */
export function parseIKasToSompi(input: string): bigint {
  if (typeof input !== 'string') {
    throw new Error('Amount is required.');
  }
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new Error('Amount is required.');
  }

  // Strict decimal pattern: optional integer part, optional fractional.
  // No +/- sign, no 'e' notation, no commas.
  const match = /^(\d*)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new Error('Enter a plain decimal number (use a period, not a comma).');
  }

  const intPart = match[1] ?? '';
  const fracPart = match[2] ?? '';

  if (intPart === '' && fracPart === '') {
    throw new Error('Amount is required.');
  }

  if (fracPart.length > 8) {
    throw new Error('Maximum precision is 8 decimal places.');
  }

  const paddedFrac = fracPart.padEnd(8, '0');
  const combined = (intPart === '' ? '0' : intPart) + paddedFrac;
  const normalised = combined.replace(/^0+/, '') || '0';

  let sompi: bigint;
  try {
    sompi = BigInt(normalised);
  } catch {
    throw new Error('Amount is not a valid number.');
  }

  if (sompi <= 0n) {
    throw new Error('Amount must be at least 0.00000001 iKAS.');
  }
  if (sompi > SOMPI_MAX_UINT64) {
    throw new Error('Amount is too large.');
  }

  return sompi;
}

/**
 * Formats a sompi bigint as an iKAS decimal string with up to 8 decimals.
 * Trailing zeros are trimmed. Used for display only (never round-tripped).
 */
export function formatSompiAsIKas(sompi: bigint): string {
  if (sompi < 0n) return `-${formatSompiAsIKas(-sompi)}`;
  const intPart = sompi / 100_000_000n;
  const frac = sompi % 100_000_000n;
  if (frac === 0n) return intPart.toString();
  const fracStr = frac.toString().padStart(8, '0').replace(/0+$/, '');
  return `${intPart.toString()}.${fracStr}`;
}

/**
 * Computes the exact msg.value required for a given unlock + fee amount.
 * Matches the contract's invariant `msg.value == (unlock + fee) * 1e10`.
 */
export function computeMsgValueWei(unlockSompi: bigint, feeSompi: bigint): bigint {
  return (unlockSompi + feeSompi) * SOMPI_SCALE_WEI;
}

// ── Kaspa payout address validation (safety-critical) ─────────

/**
 * Validates a Kaspa mainnet payout address against the Kaspa WASM SDK,
 * which performs a full bech32 decode + checksum verification. Throws
 * if WASM isn't initialised (the UI gates the whole Withdraw tab on
 * isWasmInitialized() so this should never fire in practice).
 *
 * The on-chain `KaspaAddressLib.verifyKaspaAddress` only checks prefix
 * + charset, NOT checksum, so this client-side gate is load-bearing:
 * without it a typo could pass the contract check and burn iKAS with a
 * malformed payout address.
 */
export function validateKasPayoutAddress(addr: string): void {
  const trimmed = addr.trim();
  if (trimmed === '') {
    throw new Error('Payout address is required.');
  }

  if (!trimmed.startsWith('kaspa:')) {
    if (trimmed.startsWith('kaspatest:')) {
      throw new Error('Testnet addresses are not supported for withdrawals.');
    }
    throw new Error('Address must start with "kaspa:".');
  }

  if (trimmed.length > 67) {
    throw new Error('Address is too long.');
  }

  if (!isWasmInitialized()) {
    throw new Error('Secure address validation is not ready yet. Please wait a moment and try again.');
  }

  const kaspa = getKaspaWasm();
  try {
    // The Address constructor in the Kaspa WASM SDK performs full bech32
    // decode + checksum verification and throws on any failure.
    const address = new kaspa.Address(trimmed);
    // Defensive: also assert mainnet prefix on the reconstructed address.
    if (address.prefix && address.prefix !== 'kaspa') {
      throw new Error('Only Kaspa mainnet addresses are supported.');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Surface a short, user-readable message rather than raw WASM text.
    if (/prefix/i.test(msg)) {
      throw new Error('Only Kaspa mainnet addresses are supported.');
    }
    if (/checksum/i.test(msg)) {
      throw new Error('Invalid address checksum — please double-check and try again.');
    }
    throw new Error('Invalid Kaspa address. Please double-check and try again.');
  }
}

// ── Live bridge config ────────────────────────────────────────

export interface ExitContractConfig {
  kaspaBridgeEndpoint: `0x${string}`;
  feePolicy: Address;
  feeClaimer: Address;
  throttleWindowBlocks: number;
  throttleMaxExitsPerWindow: number;
  throttleMaxUnlockAmountPerWindowSompi: bigint;
  minExitSompi: bigint;
  maxExitSompi: bigint;
  /** True when the protocol has effectively paused withdrawals. */
  paused: boolean;
  /** True when the fee policy contract is zero → fee is always 0. */
  feeIsZero: boolean;
}

export interface ThrottleSnapshot {
  windowIndex: number;
  windowEndsAtBlock: number;
  remainingExits: number;
  remainingUnlockAmountSompi: bigint;
}

function requireExitAddress(): `0x${string}` {
  const addr = getExitContractAddress();
  if (!addr) {
    throw new Error('Exit contract address is not configured.');
  }
  return addr;
}

/**
 * Reads the live on-chain bridge configuration in a single call.
 */
export async function loadExitContractConfig(
  publicClient: PublicClient
): Promise<ExitContractConfig> {
  const address = requireExitAddress();
  const result = (await publicClient.readContract({
    address,
    abi: KAS_EXIT_BRIDGE_ABI,
    functionName: 'getConfig',
  })) as readonly [
    `0x${string}`,
    Address,
    Address,
    number,
    number,
    bigint,
    bigint,
    bigint
  ];

  const [
    kaspaBridgeEndpoint,
    feePolicy,
    feeClaimer,
    throttleWindowBlocks,
    throttleMaxExitsPerWindow,
    throttleMaxUnlockAmountPerWindowSompi,
    minExitSompi,
    maxExitSompi,
  ] = result;

  const ZERO: Address = '0x0000000000000000000000000000000000000000';

  return {
    kaspaBridgeEndpoint,
    feePolicy,
    feeClaimer,
    throttleWindowBlocks,
    throttleMaxExitsPerWindow,
    throttleMaxUnlockAmountPerWindowSompi,
    minExitSompi,
    maxExitSompi,
    paused: throttleMaxExitsPerWindow === 0,
    feeIsZero: feePolicy === ZERO,
  };
}

/**
 * Reads the current throttle window status.
 */
export async function loadThrottleStatus(
  publicClient: PublicClient
): Promise<ThrottleSnapshot> {
  const address = requireExitAddress();
  const [windowIndex, windowEndsAtBlock, remainingExits, remainingUnlockAmountSompi] =
    (await publicClient.readContract({
      address,
      abi: KAS_EXIT_BRIDGE_ABI,
      functionName: 'throttleStatus',
    })) as readonly [number, number, number, bigint];

  return { windowIndex, windowEndsAtBlock, remainingExits, remainingUnlockAmountSompi };
}

/**
 * Reads the fee the caller would be charged for a given unlock amount.
 * Skipped when the fee policy is zero (feeIsZero === true in the config).
 */
export async function loadQuoteFee(
  publicClient: PublicClient,
  account: Address,
  unlockSompi: bigint
): Promise<bigint> {
  const address = requireExitAddress();
  const fee = (await publicClient.readContract({
    address,
    abi: KAS_EXIT_BRIDGE_ABI,
    functionName: 'quoteFee',
    args: [account, unlockSompi],
  })) as bigint;
  return fee;
}

// ── Preflight ─────────────────────────────────────────────────

export interface PreflightInput {
  publicClient: PublicClient;
  account: Address;
  unlockSompi: bigint;
  config: ExitContractConfig;
}

export interface PreflightResult {
  feeSompi: bigint;
  totalValueWei: bigint;
  remainingExits: number;
  remainingUnlockSompi: bigint;
  windowEndsAtBlock: number;
  balanceWei: bigint;
  /** balanceWei - totalValueWei, clamped at 0. */
  headroomWei: bigint;
}

/**
 * Checks that the requested exit satisfies all on-chain policy and
 * throttle constraints BEFORE we prompt the wallet. Surfaces friendly
 * errors for each failure mode so users don't pay for a guaranteed-
 * revert transaction.
 */
export async function preflightExit(input: PreflightInput): Promise<PreflightResult> {
  const { publicClient, account, unlockSompi, config } = input;

  if (config.paused) {
    throw new Error('Withdrawals are temporarily paused by the protocol. Please try again later.');
  }

  if (unlockSompi === 0n) {
    throw new Error('Amount must be greater than zero.');
  }
  if (config.minExitSompi > 0n && unlockSompi < config.minExitSompi) {
    throw new Error(
      `Amount is below the minimum of ${formatSompiAsIKas(config.minExitSompi)} iKAS.`
    );
  }
  if (config.maxExitSompi > 0n && unlockSompi > config.maxExitSompi) {
    throw new Error(
      `Amount is above the maximum of ${formatSompiAsIKas(config.maxExitSompi)} iKAS per withdrawal.`
    );
  }

  const [throttle, feeSompi, balanceWei] = await Promise.all([
    loadThrottleStatus(publicClient),
    config.feeIsZero ? Promise.resolve(0n) : loadQuoteFee(publicClient, account, unlockSompi),
    publicClient.getBalance({ address: account }),
  ]);

  if (throttle.remainingExits === 0) {
    throw new Error(
      'This withdrawal window is full. Please try again once the next window opens.'
    );
  }
  if (
    config.throttleMaxUnlockAmountPerWindowSompi > 0n &&
    unlockSompi > throttle.remainingUnlockAmountSompi
  ) {
    throw new Error(
      `Only ${formatSompiAsIKas(throttle.remainingUnlockAmountSompi)} iKAS remaining in this withdrawal window.`
    );
  }

  const totalValueWei = computeMsgValueWei(unlockSompi, feeSompi);

  return {
    feeSompi,
    totalValueWei,
    remainingExits: throttle.remainingExits,
    remainingUnlockSompi: throttle.remainingUnlockAmountSompi,
    windowEndsAtBlock: throttle.windowEndsAtBlock,
    balanceWei,
    headroomWei: balanceWei > totalValueWei ? balanceWei - totalValueWei : 0n,
  };
}

// ── Submit (simulate + writeContract) ─────────────────────────

export interface SubmitInput {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Address;
  kasPayoutAddress: string;
  unlockSompi: bigint;
  feePolicyIsZero: boolean;
}

/**
 * Re-quotes fee, re-simulates the call, asserts chain id, and sends.
 * Returns the transaction hash immediately; the caller is expected to
 * call `awaitExitReceipt` next.
 */
export async function simulateAndRequestExit(input: SubmitInput): Promise<Hash> {
  const { publicClient, walletClient, account, kasPayoutAddress, unlockSompi, feePolicyIsZero } =
    input;
  const address = requireExitAddress();

  // Chain-id re-assert at send time (wallets can swap chains silently).
  const currentChainId = await walletClient.getChainId();
  if (currentChainId !== IGRA_MAINNET_CHAIN.id) {
    throw new Error('Wallet is no longer on Igra Mainnet. Please switch and try again.');
  }

  // Re-quote fee immediately before send (TOCTOU guard on policy changes).
  const feeSompi = feePolicyIsZero
    ? 0n
    : await loadQuoteFee(publicClient, account, unlockSompi);
  const value = computeMsgValueWei(unlockSompi, feeSompi);

  try {
    const { request } = await publicClient.simulateContract({
      account,
      address,
      abi: KAS_EXIT_BRIDGE_ABI,
      functionName: 'requestExit',
      args: [kasPayoutAddress, unlockSompi],
      value,
    });
    return await walletClient.writeContract(request);
  } catch (err) {
    throw mapExitError(err);
  }
}

// ── Receipt parsing ───────────────────────────────────────────

export interface ExitReceipt {
  txHash: Hash;
  requestId: number;
  burnedSompi: bigint;
  feeSompi: bigint;
}

/**
 * Waits for the exit transaction to be mined, decodes our two events,
 * and returns the user-facing receipt. messageId is deliberately
 * omitted — Hyperlane is internal.
 */
export async function awaitExitReceipt(
  publicClient: PublicClient,
  txHash: Hash
): Promise<ExitReceipt> {
  const address = requireExitAddress();

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: EXIT_RECEIPT_TIMEOUT_MS,
    confirmations: 1,
  });

  if (receipt.status !== 'success') {
    throw new Error('The withdrawal transaction reverted on chain.');
  }

  let requestId: number | null = null;
  let feeSompi: bigint = 0n;
  let burnedWei: bigint | null = null;

  for (const log of receipt.logs as Log[]) {
    if (log.address.toLowerCase() !== address.toLowerCase()) continue;

    try {
      const decoded = decodeEventLog({
        abi: KAS_EXIT_BRIDGE_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === 'ExitRequested') {
        const args = decoded.args as {
          requestId: number;
          messageId: `0x${string}`;
          feeAmountSompi: bigint;
        };
        requestId = Number(args.requestId);
        feeSompi = args.feeAmountSompi;
      } else if (decoded.eventName === 'BurnIKas') {
        const args = decoded.args as { amount: bigint };
        burnedWei = args.amount;
      }
    } catch {
      // Non-matching log; skip.
    }
  }

  if (requestId === null || burnedWei === null) {
    throw new Error('Withdrawal confirmed but event logs were incomplete.');
  }

  return {
    txHash,
    requestId,
    burnedSompi: burnedWei / SOMPI_SCALE_WEI,
    feeSompi,
  };
}

// ── Typed revert decoding ─────────────────────────────────────

interface RevertErrorArgs {
  errorName: string;
  args: readonly unknown[];
}

/**
 * Maps any error thrown during simulate/writeContract/waitForReceipt into
 * a user-friendly `Error` with a copy that matches each specific contract
 * revert or provider code. Never exposes raw JSON-RPC noise.
 */
export function mapExitError(err: unknown): Error {
  // User rejection (EIP-1193 error code 4001)
  const providerErr = err as { code?: number; shortMessage?: string; message?: string };
  if (providerErr?.code === 4001 || /user rejected/i.test(providerErr?.message ?? '')) {
    return new Error('You cancelled the withdrawal.');
  }

  if (err instanceof BaseError) {
    const reverted = err.walk(
      (e) => e instanceof ContractFunctionRevertedError
    ) as ContractFunctionRevertedError | undefined;

    if (reverted?.data) {
      const data = reverted.data as unknown as RevertErrorArgs;
      const friendly = mapCustomError(data.errorName, data.args);
      if (friendly) return new Error(friendly);
    }

    if (err.shortMessage?.toLowerCase().includes('insufficient funds')) {
      return new Error('Your wallet does not have enough iKAS to cover this withdrawal plus gas.');
    }
  }

  if (providerErr?.shortMessage) {
    return new Error(providerErr.shortMessage);
  }
  if (err instanceof Error) return err;
  return new Error('Withdrawal failed. Please try again.');
}

function mapCustomError(name: string, args: readonly unknown[]): string | null {
  switch (name) {
    case 'InvalidKasPayoutAddress':
      return 'The payout address was rejected by the contract. Please double-check and try again.';
    case 'InvalidExitAmount':
      return 'Amount must be greater than zero.';
    case 'ExitAmountBelowMinimum': {
      const min = args[1] as bigint;
      return `Amount is below the current minimum of ${formatSompiAsIKas(min)} iKAS.`;
    }
    case 'ExitAmountAboveMaximum': {
      const max = args[1] as bigint;
      return `Amount is above the current maximum of ${formatSompiAsIKas(max)} iKAS per withdrawal.`;
    }
    case 'ThrottleExitCountExceeded':
      return 'This withdrawal window is full. Please try again once the next window opens.';
    case 'ThrottleUnlockAmountExceeded': {
      const remaining = args[2] as bigint;
      return `Only ${formatSompiAsIKas(remaining)} iKAS remaining in this withdrawal window.`;
    }
    case 'InvalidMsgValue':
      return 'The fee changed right before sending. Please re-open the withdrawal form and try again.';
    case 'ExitRequestCounterExhausted':
      return 'The exit bridge has reached its lifetime request limit.';
    case 'CurrentBlockNumberOverflow':
      return 'Chain state is in an unexpected range. Please try again later.';
    default:
      return null;
  }
}
