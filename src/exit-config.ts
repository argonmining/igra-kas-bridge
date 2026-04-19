/**
 * Igra Exit Bridge — UI-side configuration
 *
 * Static constants and explorer URL helpers for the iKAS → KAS exit flow.
 * The actual contract address comes from `getExitContractAddress()` in
 * src/config.ts so the Withdraw tab can be hidden when the env var is unset.
 */

/**
 * Kaspa L1 explorer base for mainnet. Used to link the payout address
 * on the exit success panel so users can watch for incoming KAS.
 */
export const KASPA_MAINNET_EXPLORER = 'https://explorer.kaspa.org';

/**
 * Igra Mainnet block explorer base (L2). Used to link the exit tx.
 */
export const IGRA_MAINNET_EXPLORER = 'https://explorer.igralabs.com';

/**
 * How long (ms) we wait for an exit transaction to be mined before the
 * wait aborts with an error. Igra blocks are ~1s so the typical receipt
 * lands in 1–3s; the generous timeout here is purely to tolerate a
 * wallet being slow to broadcast or a transient RPC hiccup.
 */
export const EXIT_RECEIPT_TIMEOUT_MS = 120_000;

/**
 * Kaspa L1 address explorer URL builder (mainnet).
 */
export function kaspaAddressUrl(address: string): string {
  const encoded = encodeURIComponent(address);
  return `${KASPA_MAINNET_EXPLORER}/addresses/${encoded}`;
}

/**
 * Igra Mainnet L2 transaction explorer URL builder.
 */
export function igraTxUrl(txHash: string): string {
  return `${IGRA_MAINNET_EXPLORER}/tx/${txHash}`;
}
