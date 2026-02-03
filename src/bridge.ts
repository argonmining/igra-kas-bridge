/**
 * Igra Bridge Transaction Construction
 * 
 * Constructs Entry transactions for bridging KAS (L1) to iKAS (L2)
 * 
 * Entry Transaction Format (L1 Payload):
 * [0x92] [L2Data: 20-byte address + 8-byte amount] [4-byte nonce]
 * 
 * Reference: https://igra-labs.gitbook.io/igralabs-docs/for-developers/architecture/specifications/igra-transaction-protocol#id-4.3-entry
 */

import { CONFIG, kasToSompi, isValidL2Address } from './config';
import { sendKaspaWithPayload, signAndBroadcastTransaction } from './kastle';
import { isWasmInitialized } from './kaspa-wasm';
import { mineTxId, serializeForKastle, initRpcConnection } from './tx-miner';

export interface BridgeParams {
  /** Amount in KAS to bridge */
  amountKas: number;
  /** L2 (Igra) address to receive iKAS (0x prefixed) */
  l2Address: string;
}

export interface BridgeResult {
  /** L1 transaction ID */
  txId: string;
  /** Amount bridged in SOMPI */
  amountSompi: bigint;
  /** L2 address that will receive iKAS */
  l2Address: string;
  /** Nonce used for tx ID mining */
  nonce: number;
  /** Number of mining iterations */
  iterations: number;
}

/**
 * Constructs the Entry payload for bridging KAS to iKAS
 * 
 * Format: [0x92] [20-byte L2 address] [8-byte amount BE] [4-byte nonce]
 * Total: 33 bytes
 */
export function constructEntryPayload(l2Address: string, amountSompi: bigint, nonce: number): Uint8Array {
  // Validate L2 address
  if (!isValidL2Address(l2Address)) {
    throw new Error(`Invalid L2 address: ${l2Address}`);
  }
  
  // Remove 0x prefix and convert to bytes
  const addressHex = l2Address.slice(2);
  const addressBytes = hexToBytes(addressHex);
  
  if (addressBytes.length !== 20) {
    throw new Error('L2 address must be 20 bytes');
  }
  
  // Create payload buffer: 1 (prefix) + 20 (address) + 8 (amount) + 4 (nonce) = 33 bytes
  const payload = new Uint8Array(33);
  
  // Byte 0: Version + TxTypeId (0x92)
  payload[0] = CONFIG.ENTRY_TX.PAYLOAD_PREFIX;
  
  // Bytes 1-20: L2 recipient address
  payload.set(addressBytes, 1);
  
  // Bytes 21-28: Amount in SOMPI (unsigned 64-bit little endian)
  // Verified from actual tx: 20 KAS stored as 00 94 35 77 00 00 00 00
  const amountBytes = bigintToBytes8LE(amountSompi);
  payload.set(amountBytes, 21);
  
  // Bytes 29-32: Nonce (unsigned 32-bit big endian)
  const nonceBytes = uint32ToBytes4BE(nonce);
  payload.set(nonceBytes, 29);
  
  return payload;
}

/**
 * Converts the payload to hex string for Kastle wallet
 */
export function payloadToHex(payload: Uint8Array): string {
  return Array.from(payload)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to bytes
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert bigint to 8-byte little-endian representation
 * 
 * Based on actual Igra transaction analysis:
 * 20 KAS = 2,000,000,000 SOMPI = 0x77359400
 * Stored as: 00 94 35 77 00 00 00 00 (little-endian)
 */
function bigintToBytes8LE(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

/**
 * Convert uint32 to 4-byte big-endian representation
 * Note: Nonce appears to be big-endian based on tx analysis
 */
function uint32ToBytes4BE(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  bytes[0] = (value >> 24) & 0xff;
  bytes[1] = (value >> 16) & 0xff;
  bytes[2] = (value >> 8) & 0xff;
  bytes[3] = value & 0xff;
  return bytes;
}

/**
 * Validates bridge parameters
 */
export function validateBridgeParams(params: BridgeParams): void {
  const { amountKas, l2Address } = params;
  
  // Validate amount
  if (amountKas < CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS) {
    throw new Error(`Minimum bridge amount is ${CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS} KAS`);
  }
  
  if (!Number.isFinite(amountKas) || amountKas <= 0) {
    throw new Error('Invalid amount');
  }
  
  // Validate L2 address
  if (!isValidL2Address(l2Address)) {
    throw new Error('Invalid L2 address. Must be a valid Ethereum-style address (0x...)');
  }
}

/**
 * Execute bridge transaction
 * 
 * This sends KAS to the Igra Entry address with the proper payload.
 * The transaction ID must match the required prefix for Igra to recognize it.
 * 
 * Payload format (verified from actual tx 97b6b3bbd741a56ddccaae8211724e3b2a1b305cb5929f0c3b884e3ae0bc3a61):
 * - Byte 0: 0x92 (Version 0x9 + TxTypeId 0x2)
 * - Bytes 1-20: L2 recipient address (20 bytes)
 * - Bytes 21-28: Amount in SOMPI (8 bytes, little-endian)
 * - Bytes 29-32: Nonce for TX ID mining (4 bytes, big-endian)
 * 
 * @param params Bridge parameters
 * @param onProgress Optional callback for progress updates
 */
export async function executeBridge(
  params: BridgeParams,
  onProgress?: (message: string) => void
): Promise<BridgeResult> {
  validateBridgeParams(params);
  
  const { amountKas, l2Address } = params;
  const amountSompi = kasToSompi(amountKas);
  
  onProgress?.(`Preparing bridge transaction...`);
  onProgress?.(`Amount: ${amountKas} KAS (${amountSompi} SOMPI)`);
  onProgress?.(`L2 Address: ${l2Address}`);
  onProgress?.(`Entry Address: ${CONFIG.L1.ENTRY_ADDRESS}`);
  
  // Generate a random nonce for this attempt
  // TX ID must start with the required prefix for Igra to recognize it
  const nonce = generateRandomNonce();
  onProgress?.(`Generated nonce: 0x${nonce.toString(16).padStart(8, '0')} (${nonce})`);
  
  // Construct payload
  const payload = constructEntryPayload(l2Address, amountSompi, nonce);
  const payloadHex = payloadToHex(payload);
  
  // Verify payload construction
  const decoded = decodeEntryPayload(payloadHex);
  onProgress?.(`Payload constructed: ${payloadHex}`);
  onProgress?.(`  - Prefix: 0x${decoded.prefix}`);
  onProgress?.(`  - L2 Addr: ${decoded.l2Address}`);
  onProgress?.(`  - Amount: ${decoded.amountKas} KAS (${decoded.amountSompi} SOMPI)`);
  onProgress?.(`  - Nonce: 0x${decoded.nonce.toString(16).padStart(8, '0')}`);
  
  onProgress?.(`Sending transaction via Kastle wallet...`);
  onProgress?.(`Required TX ID prefix: ${CONFIG.L1.TX_ID_PREFIX}`);
  
  // Send transaction via Kastle
  const txId = await sendKaspaWithPayload(
    CONFIG.L1.ENTRY_ADDRESS,
    amountSompi,
    payloadHex
  );
  
  onProgress?.(`Transaction submitted: ${txId}`);
  
  // Check if TX ID matches required prefix
  const expectedPrefix = CONFIG.L1.TX_ID_PREFIX.toLowerCase();
  const actualPrefix = txId.slice(0, expectedPrefix.length).toLowerCase();
  
  if (actualPrefix !== expectedPrefix) {
    onProgress?.(`⚠️ TX ID prefix mismatch!`);
    onProgress?.(`Expected: ${expectedPrefix}, Got: ${actualPrefix}`);
    onProgress?.(`The bridge may not recognize this transaction.`);
    onProgress?.(`Consider retrying - each attempt uses a different nonce.`);
  } else {
    onProgress?.(`✓ TX ID prefix matches! Bridge should process this transaction.`);
  }
  
  return {
    txId,
    amountSompi,
    l2Address,
    nonce,
    iterations: 1,
  };
}

/**
 * Get explorer URL for a transaction
 */
export function getExplorerUrl(txId: string): string {
  return `https://explorer-tn10.kaspa.org/txs/${txId}`;
}

/**
 * Get L2 explorer URL for an address
 */
export function getL2ExplorerUrl(address: string): string {
  return `${CONFIG.L2.BLOCK_EXPLORER}/address/${address}`;
}

/**
 * Decode and verify an Entry payload
 * Useful for debugging and verification
 */
export function decodeEntryPayload(payloadHex: string): {
  prefix: string;
  l2Address: string;
  amountSompi: bigint;
  amountKas: number;
  nonce: number;
} {
  const bytes = hexToBytes(payloadHex);
  
  if (bytes.length !== 33) {
    throw new Error(`Invalid payload length: expected 33 bytes, got ${bytes.length}`);
  }
  
  const prefix = bytes[0].toString(16).padStart(2, '0');
  
  // Extract L2 address (bytes 1-20)
  const addressBytes = bytes.slice(1, 21);
  const l2Address = '0x' + Array.from(addressBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Extract amount (bytes 21-28, little-endian)
  let amountSompi = 0n;
  for (let i = 0; i < 8; i++) {
    amountSompi |= BigInt(bytes[21 + i]) << BigInt(i * 8);
  }
  
  // Extract nonce (bytes 29-32, big-endian)
  const nonce = (bytes[29] << 24) | (bytes[30] << 16) | (bytes[31] << 8) | bytes[32];
  
  return {
    prefix,
    l2Address,
    amountSompi,
    amountKas: Number(amountSompi) / Number(CONFIG.L1.SOMPI_PER_KAS),
    nonce,
  };
}

/**
 * Generate a random nonce for TX ID mining attempts
 */
export function generateRandomNonce(): number {
  return Math.floor(Math.random() * 0xFFFFFFFF);
}

/**
 * Execute bridge transaction with proper TX ID mining
 * 
 * This uses the Kaspa WASM SDK to:
 * 1. Fetch UTXOs for the sender
 * 2. Build a transaction with the Entry payload
 * 3. Mine the nonce until TX ID matches required prefix (97b4)
 * 4. Sign and broadcast via Kastle wallet
 * 
 * @param params Bridge parameters
 * @param senderAddress Kaspa address of the sender
 * @param onProgress Optional callback for progress updates
 */
export async function executeBridgeWithMining(
  params: BridgeParams,
  senderAddress: string,
  onProgress?: (message: string) => void
): Promise<BridgeResult> {
  validateBridgeParams(params);
  
  if (!isWasmInitialized()) {
    throw new Error('Kaspa WASM not initialized. Cannot mine TX ID.');
  }
  
  const { amountKas, l2Address } = params;
  const amountSompi = kasToSompi(amountKas);
  
  onProgress?.(`Preparing bridge transaction with TX ID mining...`);
  onProgress?.(`Amount: ${amountKas} KAS (${amountSompi} SOMPI)`);
  onProgress?.(`L2 Address: ${l2Address}`);
  onProgress?.(`Entry Address: ${CONFIG.L1.ENTRY_ADDRESS}`);
  onProgress?.(`Required TX ID prefix: ${CONFIG.L1.TX_ID_PREFIX}`);
  
  // Connect to Kaspa network
  onProgress?.(`Connecting to Kaspa network...`);
  await initRpcConnection();
  onProgress?.(`✓ Connected to Kaspa network`);
  
  // Mine TX ID
  onProgress?.(`Mining TX ID (this may take a moment)...`);
  
  const miningResult = await mineTxId(
    senderAddress,
    l2Address,
    amountSompi,
    (iteration, currentTxId) => {
      onProgress?.(`Mining: iteration ${iteration}, current prefix: ${currentTxId.slice(0, 4)}`);
    }
  );
  
  onProgress?.(`✓ Found matching TX ID after ${miningResult.iterations} iterations`);
  onProgress?.(`TX ID: ${miningResult.txId}`);
  onProgress?.(`Nonce: 0x${miningResult.nonce.toString(16).padStart(8, '0')}`);
  
  // Serialize transaction for Kastle signing
  const txJson = serializeForKastle(miningResult.tx);
  onProgress?.(`Transaction built, requesting signature from Kastle...`);
  
  // Sign and broadcast via Kastle
  const txId = await signAndBroadcastTransaction(txJson);
  
  onProgress?.(`✓ Transaction submitted: ${txId}`);
  
  // Verify the TX ID matches (should match since we mined it)
  const expectedPrefix = CONFIG.L1.TX_ID_PREFIX.toLowerCase();
  const actualPrefix = txId.slice(0, expectedPrefix.length).toLowerCase();
  
  if (actualPrefix !== expectedPrefix) {
    onProgress?.(`⚠️ Warning: Broadcast TX ID differs from mined TX ID`);
    onProgress?.(`This can happen if UTXOs changed during signing.`);
  } else {
    onProgress?.(`✓ TX ID prefix verified: ${actualPrefix}`);
  }
  
  return {
    txId,
    amountSompi,
    l2Address,
    nonce: miningResult.nonce,
    iterations: miningResult.iterations,
  };
}

/**
 * Check if TX ID mining is available (WASM initialized)
 */
export function isMiningAvailable(): boolean {
  return isWasmInitialized();
}
