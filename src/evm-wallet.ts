/**
 * EVM Wallet Adapter for the Igra Mainnet Exit flow
 *
 * - Discovers installed wallets via EIP-6963 (with legacy window.ethereum
 *   fallback and dedicated window.kasware.ethereum recognition).
 * - Optionally connects via WalletConnect v2 when a project id is present.
 * - Ensures the connected wallet is on Igra Mainnet (chain id 38833),
 *   adding the chain via EIP-3085 if the wallet doesn't know it.
 * - Exposes viem PublicClient and WalletClient factories for use by
 *   src/exit.ts.
 *
 * This module has zero coupling to the deposit path (src/kastle.ts,
 * src/kasware.ts, src/kaspa-wasm.ts). Namespace isolation is deliberate.
 */

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type EIP1193Provider,
  type PublicClient,
  type WalletClient,
} from 'viem';

import {
  IGRA_MAINNET_CHAIN,
  IGRA_MAINNET_CHAIN_ID_HEX,
  buildIgraAddChainParams,
  getWalletConnectProjectId,
} from './config';

// ── Types ──────────────────────────────────────────────────────

export interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: EIP1193Provider;
}

/**
 * Shape used by the wallet-picker UI. "source" is how we'll reconnect
 * on chainChanged / accountsChanged events.
 */
export interface WalletOption {
  source: 'eip6963' | 'legacy' | 'walletconnect';
  id: string;
  name: string;
  icon?: string;
  rdns?: string;
}

export interface ConnectedEvmWallet {
  option: WalletOption;
  provider: EIP1193Provider;
  address: Address;
  chainIdHex: string;
}

/** Fired when the active account changes mid-session. */
export type EvmWalletEventListener = (
  event:
    | { type: 'accountsChanged'; address: Address | null }
    | { type: 'chainChanged'; chainIdHex: string }
    | { type: 'disconnected' }
) => void;

// ── EIP-6963 discovery ─────────────────────────────────────────

const discoveredProviders = new Map<string, Eip6963ProviderDetail>();

type AnnounceProviderEvent = CustomEvent<Eip6963ProviderDetail>;

function handleAnnounce(ev: Event): void {
  const detail = (ev as AnnounceProviderEvent).detail;
  if (!detail || !detail.info || !detail.provider) return;
  discoveredProviders.set(detail.info.uuid, detail);
}

let discoveryStarted = false;

/**
 * Starts the EIP-6963 discovery listener. Safe to call multiple times.
 * Fires a "eip6963:requestProvider" event so already-loaded wallets
 * re-announce themselves; wallets injected after call time will also
 * be picked up because the listener remains attached.
 */
export function startWalletDiscovery(): void {
  if (discoveryStarted || typeof window === 'undefined') return;
  discoveryStarted = true;

  window.addEventListener('eip6963:announceProvider', handleAnnounce as EventListener);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

function humaniseLegacyLabel(win: Window): string {
  const eth = (win as unknown as { ethereum?: Record<string, unknown> }).ethereum;
  if (!eth) return 'Browser Wallet';
  if (eth.isMetaMask) return 'MetaMask';
  if (eth.isRabby) return 'Rabby';
  if (eth.isBraveWallet) return 'Brave Wallet';
  return 'Browser Wallet';
}

/**
 * Returns the currently-known wallet options, combining EIP-6963
 * announcements, a legacy window.ethereum fallback, and an explicit
 * WalletConnect option when configured.
 */
export function listWalletOptions(): WalletOption[] {
  if (!discoveryStarted) startWalletDiscovery();

  const options: WalletOption[] = [];
  const seenRdns = new Set<string>();

  for (const { info } of discoveredProviders.values()) {
    options.push({
      source: 'eip6963',
      id: info.uuid,
      name: info.name,
      icon: info.icon,
      rdns: info.rdns,
    });
    if (info.rdns) seenRdns.add(info.rdns.toLowerCase());
  }

  if (typeof window !== 'undefined') {
    // Explicit Kasware EVM fallback. Kasware docs guarantee this path
    // regardless of EIP-6963 support, so we surface it independently.
    const kasware = (window as unknown as {
      kasware?: { ethereum?: EIP1193Provider & { isKasWare?: boolean } };
    }).kasware;
    const kaswareEth = kasware?.ethereum;
    const hasKaswareByRdns = Array.from(discoveredProviders.values()).some(
      (d) => d.info.rdns?.toLowerCase().includes('kasware')
    );
    if (kaswareEth && !hasKaswareByRdns) {
      options.push({
        source: 'legacy',
        id: 'legacy-kasware-ethereum',
        name: 'Kasware',
      });
    }

    // Generic window.ethereum fallback — only if no 6963 providers AND we
    // haven't already covered the same wallet through the Kasware fallback.
    if (options.length === 0) {
      const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (eth) {
        options.push({
          source: 'legacy',
          id: 'legacy-window-ethereum',
          name: humaniseLegacyLabel(window),
        });
      }
    }
  }

  if (getWalletConnectProjectId()) {
    options.push({
      source: 'walletconnect',
      id: 'walletconnect',
      name: 'WalletConnect',
    });
  }

  return options;
}

function getEip6963Provider(uuid: string): EIP1193Provider | null {
  return discoveredProviders.get(uuid)?.provider ?? null;
}

function getLegacyProvider(id: string): EIP1193Provider | null {
  if (typeof window === 'undefined') return null;
  if (id === 'legacy-kasware-ethereum') {
    const kw = (window as unknown as {
      kasware?: { ethereum?: EIP1193Provider };
    }).kasware;
    return kw?.ethereum ?? null;
  }
  const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  return eth ?? null;
}

// ── WalletConnect v2 (lazy) ───────────────────────────────────

let walletConnectProvider: EIP1193Provider | null = null;

async function getWalletConnectProvider(): Promise<EIP1193Provider> {
  if (walletConnectProvider) return walletConnectProvider;

  const projectId = getWalletConnectProjectId();
  if (!projectId) {
    throw new Error('WalletConnect is not configured. Set VITE_WALLETCONNECT_PROJECT_ID to enable it.');
  }

  // Dynamic import to keep WalletConnect out of the first-paint bundle.
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');

  const provider = await EthereumProvider.init({
    projectId,
    chains: [IGRA_MAINNET_CHAIN.id],
    showQrModal: true,
    metadata: {
      name: 'Igra KAS Bridge',
      description: 'Bridge KAS between Kaspa L1 and Igra L2',
      url: typeof window !== 'undefined' ? window.location.origin : 'https://bridge.igralabs.com',
      icons:
        typeof window !== 'undefined'
          ? [`${window.location.origin}/igra-logomark.svg`]
          : [],
    },
    rpcMap: {
      [IGRA_MAINNET_CHAIN.id]: IGRA_MAINNET_CHAIN.rpcUrls.default.http[0],
    },
  });

  walletConnectProvider = provider as unknown as EIP1193Provider;
  return walletConnectProvider;
}

// ── Chain ensure (EIP-3326 with EIP-3085 fallback) ─────────────

interface ProviderError {
  code?: number;
  data?: { originalError?: { code?: number } };
}

/**
 * Ensures the EVM wallet is on Igra Mainnet. Follows the proven
 * MetaMask pattern: try wallet_switchEthereumChain first; if the wallet
 * returns code 4902 ("chain unrecognised"), fall back to
 * wallet_addEthereumChain and retry the switch.
 */
export async function ensureIgraMainnet(provider: EIP1193Provider): Promise<void> {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: IGRA_MAINNET_CHAIN_ID_HEX }],
    });
    return;
  } catch (err) {
    const e = err as ProviderError;
    const unrecognised = e?.code === 4902 || e?.data?.originalError?.code === 4902;
    if (!unrecognised) {
      throw err;
    }
  }

  await provider.request({
    method: 'wallet_addEthereumChain',
    params: [buildIgraAddChainParams()],
  });

  // Verify we actually ended up on the right chain; some wallets leave
  // the user on the previously-selected chain after adding.
  const current = (await provider.request({ method: 'eth_chainId' })) as string;
  if (current.toLowerCase() !== IGRA_MAINNET_CHAIN_ID_HEX) {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: IGRA_MAINNET_CHAIN_ID_HEX }],
    });
  }
}

// ── Connect / disconnect ──────────────────────────────────────

async function providerRequestAccounts(provider: EIP1193Provider): Promise<Address> {
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as Address[];
  if (!accounts || accounts.length === 0) {
    throw new Error('No EVM accounts returned by the wallet.');
  }
  return accounts[0];
}

/**
 * Resolve the underlying EIP-1193 provider for a given wallet option.
 */
async function resolveProvider(option: WalletOption): Promise<EIP1193Provider> {
  switch (option.source) {
    case 'eip6963': {
      const p = getEip6963Provider(option.id);
      if (!p) throw new Error(`Wallet "${option.name}" is no longer available. Reload the page.`);
      return p;
    }
    case 'legacy': {
      const p = getLegacyProvider(option.id);
      if (!p) throw new Error('No injected EVM wallet detected.');
      return p;
    }
    case 'walletconnect':
      return getWalletConnectProvider();
  }
}

/**
 * Connects to the selected wallet, ensures Igra Mainnet, and returns
 * the connected wallet descriptor. Safe to call repeatedly; it simply
 * re-requests accounts and re-ensures the chain.
 */
export async function connectEvmWallet(option: WalletOption): Promise<ConnectedEvmWallet> {
  const provider = await resolveProvider(option);

  if (option.source === 'walletconnect') {
    // Triggers the QR / deep-link modal if not already paired.
    const wcProvider = provider as unknown as { connect?: () => Promise<void> };
    if (typeof wcProvider.connect === 'function') {
      await wcProvider.connect();
    }
  }

  const address = await providerRequestAccounts(provider);
  await ensureIgraMainnet(provider);

  const chainIdHex = (await provider.request({ method: 'eth_chainId' })) as string;

  return { option, provider, address, chainIdHex };
}

/**
 * Best-effort disconnect. Injected wallets don't support programmatic
 * disconnect so we simply clear our local reference; WalletConnect does
 * have an explicit disconnect and we honour it.
 */
export async function disconnectEvmWallet(wallet: ConnectedEvmWallet): Promise<void> {
  if (wallet.option.source === 'walletconnect') {
    const wc = wallet.provider as unknown as { disconnect?: () => Promise<void> };
    if (typeof wc.disconnect === 'function') {
      try {
        await wc.disconnect();
      } catch {
        // Ignore — we'll drop the local reference regardless.
      }
    }
  }
}

// ── Event wiring ──────────────────────────────────────────────

type InternalListener = (...args: unknown[]) => void;

/**
 * Attaches accountsChanged / chainChanged / disconnect listeners on the
 * provider. Returns a cleanup function.
 */
export function attachEvmWalletListeners(
  provider: EIP1193Provider,
  listener: EvmWalletEventListener
): () => void {
  const providerWithEvents = provider as unknown as {
    on: (event: string, cb: InternalListener) => void;
    removeListener?: (event: string, cb: InternalListener) => void;
  };

  const onAccounts: InternalListener = (...args) => {
    const raw = args[0] as unknown;
    const accounts = Array.isArray(raw) ? (raw as Address[]) : [];
    listener({ type: 'accountsChanged', address: accounts[0] ?? null });
  };
  const onChain: InternalListener = (...args) => {
    const id = args[0] as string | undefined;
    if (typeof id === 'string') listener({ type: 'chainChanged', chainIdHex: id });
  };
  const onDisconnect: InternalListener = () => {
    listener({ type: 'disconnected' });
  };

  providerWithEvents.on('accountsChanged', onAccounts);
  providerWithEvents.on('chainChanged', onChain);
  providerWithEvents.on('disconnect', onDisconnect);

  return () => {
    providerWithEvents.removeListener?.('accountsChanged', onAccounts);
    providerWithEvents.removeListener?.('chainChanged', onChain);
    providerWithEvents.removeListener?.('disconnect', onDisconnect);
  };
}

// ── viem client factories ─────────────────────────────────────

/**
 * A read-only PublicClient that goes directly over HTTP to the Igra
 * Mainnet RPC. Used for preflight (getConfig, throttleStatus, quoteFee,
 * getBalance, block sampling) and doesn't require a wallet.
 */
export function createIgraPublicClient(): PublicClient {
  return createPublicClient({
    chain: IGRA_MAINNET_CHAIN,
    transport: http(),
  }) as PublicClient;
}

/**
 * A WalletClient bound to the connected EVM wallet. Uses the wallet's
 * own EIP-1193 provider so the user signs in their familiar UI.
 */
export function createIgraWalletClient(
  provider: EIP1193Provider,
  account: Address
): WalletClient {
  return createWalletClient({
    account,
    chain: IGRA_MAINNET_CHAIN,
    transport: custom(provider),
  });
}
