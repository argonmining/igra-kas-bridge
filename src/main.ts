/**
 * Igra Bridge — Main Entry Point
 *
 * Routes three UI tabs:
 *   - Galleon Testnet · Deposit   (existing TX-ID-mining deposit flow, testnet)
 *   - Igra Mainnet   · Deposit    (existing TX-ID-mining deposit flow, mainnet)
 *   - Igra Mainnet   · Withdraw   (iKAS → KAS exit via KasExitBridge)
 *
 * The deposit flow is strictly untouched logically; we only rewire the
 * selector, section visibility, and subtitle copy. All exit-flow logic
 * lives in src/exit.ts and src/evm-wallet.ts and never imports any of
 * the deposit modules.
 */

import {
  CONFIG,
  IGRA_MAINNET_CHAIN_ID_HEX,
  SOMPI_SCALE_WEI,
  estimateIgraBlockTimeSeconds,
  getExitContractAddress,
  getMainnetFee,
  getNetworkMode,
  isValidL2Address,
  setBridgeMode,
  setNetworkMode,
  sompiToKas,
  type NetworkMode,
} from './config';
import {
  isKastleInstalled,
  connectWallet as kastleConnect,
  verifyNetworkByAddress,
  ensureNetwork as kastleEnsureNetwork,
  disconnectWallet as kastleDisconnect,
} from './kastle';
import {
  isKaswareInstalled,
  connectWallet as kaswareConnect,
  ensureNetwork as kaswareEnsureNetwork,
  disconnectWallet as kaswareDisconnect,
} from './kasware';
import {
  executeBridgeWithMining,
  isMiningAvailable,
  getExplorerUrl,
  getL2ExplorerUrl,
  type BridgeResult,
} from './bridge';
import { initKaspaWasm, isWasmInitialized } from './kaspa-wasm';
import { disconnectRpc } from './tx-miner';
import type { WalletType, ConnectedWallet } from './wallet';
import {
  attachEvmWalletListeners,
  connectEvmWallet,
  createIgraPublicClient,
  createIgraWalletClient,
  disconnectEvmWallet,
  listWalletOptions,
  startWalletDiscovery,
  type ConnectedEvmWallet,
  type WalletOption,
} from './evm-wallet';
import {
  awaitExitReceipt,
  formatSompiAsIKas,
  loadExitContractConfig,
  mapExitError,
  parseIKasToSompi,
  preflightExit,
  simulateAndRequestExit,
  validateKasPayoutAddress,
  type ExitContractConfig,
  type ExitReceipt,
  type PreflightResult,
} from './exit';
import { igraTxUrl, kaspaAddressUrl } from './exit-config';
import type { Address, PublicClient } from 'viem';

// ── Deposit UI State (unchanged) ──────────────────────────────

let connectedWallet: ConnectedWallet | null = null;
let selectedWalletType: WalletType | null = null;

let termsAcceptedForTx = false;
function hasAcceptedTerms(): boolean { return termsAcceptedForTx; }
function setTermsAccepted(): void { termsAcceptedForTx = true; }

function showTermsModal(): void {
  const modal = document.getElementById('terms-modal')!;
  const checkbox = document.getElementById('terms-checkbox') as HTMLInputElement;
  const proceedBtn = document.getElementById('terms-proceed-btn') as HTMLButtonElement;
  checkbox.checked = false;
  proceedBtn.disabled = true;
  modal.classList.remove('hidden');
}

function hideTermsModal(): void {
  document.getElementById('terms-modal')!.classList.add('hidden');
}

// ── Exit (Withdraw) UI State ──────────────────────────────────

type Tab = 'testnet-deposit' | 'mainnet-deposit' | 'mainnet-exit';

let currentTab: Tab = 'mainnet-deposit';

let evmWallet: ConnectedEvmWallet | null = null;
let evmWalletDetachListeners: (() => void) | null = null;

let exitPublicClient: PublicClient | null = null;
let exitConfig: ExitContractConfig | null = null;
let exitBlockTimeSeconds = 1;
let exitPreflight: PreflightResult | null = null;
let exitInFlight = false;
let exitMountToken = 0;

// Debounce + token-cancellation for preflight on user input.
let exitPreflightDebounce: ReturnType<typeof setTimeout> | null = null;
let exitPreflightToken = 0;
const EXIT_PREFLIGHT_DEBOUNCE_MS = 300;

// ── DOM Elements ──────────────────────────────────────────────

const elements = {
  // Deposit
  walletSection: () => document.getElementById('wallet-section')!,
  bridgeSection: () => document.getElementById('bridge-section')!,
  resultSection: () => document.getElementById('result-section')!,

  connectBtn: () => document.getElementById('connect-btn') as HTMLButtonElement,
  walletStatus: () => document.getElementById('wallet-status')!,
  walletAddress: () => document.getElementById('wallet-address')!,
  networkStatus: () => document.getElementById('network-status')!,

  amountInput: () => document.getElementById('amount-input') as HTMLInputElement,
  l2AddressInput: () => document.getElementById('l2-address-input') as HTMLInputElement,
  bridgeBtn: () => document.getElementById('bridge-btn') as HTMLButtonElement,

  logOutput: () => document.getElementById('log-output')!,
  resultTxId: () => document.getElementById('result-txid')!,
  resultAmount: () => document.getElementById('result-amount')!,
  resultL2Address: () => document.getElementById('result-l2-address')!,
  explorerLink: () => document.getElementById('explorer-link') as HTMLAnchorElement,
  l2ExplorerLink: () => document.getElementById('l2-explorer-link') as HTMLAnchorElement,

  errorMessage: () => document.getElementById('error-message')!,

  infoBanner: () => document.getElementById('info-banner')!,
  pageSubtitle: () => document.getElementById('page-subtitle')!,

  walletKastleBtn: () => document.getElementById('wallet-kastle-btn') as HTMLButtonElement,
  walletKaswareBtn: () => document.getElementById('wallet-kasware-btn') as HTMLButtonElement,

  // Tabs
  tabTestnetDeposit: () => document.getElementById('tab-testnet-deposit') as HTMLButtonElement,
  tabMainnetDeposit: () => document.getElementById('tab-mainnet-deposit') as HTMLButtonElement,
  tabMainnetExit: () => document.getElementById('tab-mainnet-exit') as HTMLButtonElement,

  // Exit
  exitSection: () => document.getElementById('exit-section')!,
  exitResultSection: () => document.getElementById('exit-result-section')!,
  exitNotice: () => document.getElementById('exit-notice')!,
  exitWasmGate: () => document.getElementById('exit-wasm-gate')!,
  exitWasmGateText: () => document.getElementById('exit-wasm-gate-text')!,
  exitPausedBanner: () => document.getElementById('exit-paused-banner')!,
  exitFormFields: () => document.getElementById('exit-form-fields')!,
  exitAmountInput: () => document.getElementById('exit-amount-input') as HTMLInputElement,
  exitAmountHint: () => document.getElementById('exit-amount-hint')!,
  exitKaspaInput: () => document.getElementById('exit-kaspa-input') as HTMLInputElement,
  exitUseMyKaspa: () => document.getElementById('exit-use-my-kaspa') as HTMLButtonElement,
  exitPreview: () => document.getElementById('exit-preview')!,
  exitPreviewBurn: () => document.getElementById('exit-preview-burn')!,
  exitPreviewFee: () => document.getElementById('exit-preview-fee')!,
  exitPreviewTotal: () => document.getElementById('exit-preview-total')!,
  exitPreviewReceive: () => document.getElementById('exit-preview-receive')!,
  exitFormError: () => document.getElementById('exit-form-error')!,
  exitSubmitBtn: () => document.getElementById('exit-submit-btn') as HTMLButtonElement,
  exitWalletRow: () => document.getElementById('exit-wallet-row')!,
  exitWalletAddress: () => document.getElementById('exit-wallet-address')!,
  exitWalletDisconnect: () => document.getElementById('exit-wallet-disconnect') as HTMLButtonElement,
  exitWalletConnectWrap: () => document.getElementById('exit-wallet-connect-wrap')!,
  exitWalletConnect: () => document.getElementById('exit-wallet-connect') as HTMLButtonElement,
  exitWalletPicker: () => document.getElementById('exit-wallet-picker')!,

  // Exit result
  exitResultTxHash: () => document.getElementById('exit-result-txhash')!,
  exitResultRequestId: () => document.getElementById('exit-result-request-id')!,
  exitResultBurn: () => document.getElementById('exit-result-burn')!,
  exitResultPayout: () => document.getElementById('exit-result-payout')!,
  exitResultTxLink: () => document.getElementById('exit-result-tx-link') as HTMLAnchorElement,
  exitResultKaspaLink: () => document.getElementById('exit-result-kaspa-link') as HTMLAnchorElement,

  // Confirm modal
  exitConfirmModal: () => document.getElementById('exit-confirm-modal')!,
  exitConfirmBurn: () => document.getElementById('exit-confirm-burn')!,
  exitConfirmFee: () => document.getElementById('exit-confirm-fee')!,
  exitConfirmTotal: () => document.getElementById('exit-confirm-total')!,
  exitConfirmReceive: () => document.getElementById('exit-confirm-receive')!,
  exitConfirmPayout: () => document.getElementById('exit-confirm-payout')!,
  exitConfirmAck: () => document.getElementById('exit-confirm-ack') as HTMLInputElement,
  exitConfirmCancel: () => document.getElementById('exit-confirm-cancel') as HTMLButtonElement,
  exitConfirmProceed: () => document.getElementById('exit-confirm-proceed') as HTMLButtonElement,
};

// ── Logging + error helpers (deposit) ────────────────────────

function log(message: string): void {
  const logOutput = elements.logOutput();
  const timestamp = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.textContent = `[${timestamp}] ${message}`;
  logOutput.appendChild(entry);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function showError(message: string): void {
  const errorEl = elements.errorMessage();
  errorEl.textContent = message;
  errorEl.style.display = 'block';
  setTimeout(() => {
    errorEl.style.display = 'none';
  }, 10000);
}

function clearError(): void {
  elements.errorMessage().style.display = 'none';
}

// ── Labels based on current tab ──────────────────────────────

function getLabels() {
  if (currentTab === 'mainnet-exit') {
    return {
      subtitle: 'Burn iKAS on Igra · receive KAS on Kaspa via manual multi-sig',
      bannerHtml:
        `<strong>Withdrawals are processed manually.</strong> Your iKAS burn is instant on Igra, but the KAS payout on Kaspa is released by a multi-signature committee in a separate step. Timing varies.`,
    };
  }
  const mode = getNetworkMode();
  if (mode === 'mainnet') {
    const fee = getMainnetFee();
    const feeNote = fee ? ` Bridge fee: ${sompiToKas(fee.amountSompi)} KAS per transaction.` : '';
    return {
      kasSymbol: 'KAS',
      bridgeAction: 'Bridge KAS → iKAS',
      subtitle: 'Kaspa Mainnet → Igra Mainnet',
      bannerHtml: `<strong>Igra Mainnet</strong> — Wraps KAS into iKAS on Igra Mainnet. Min: ${CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS} KAS.${CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS !== null ? ` Max: ${CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS.toLocaleString()} KAS.` : ''}${feeNote}`,
    };
  }
  if (mode === 'test-mainnet') {
    return {
      kasSymbol: 'KAS',
      bridgeAction: 'Bridge KAS → iKAS',
      subtitle: 'Kaspa Mainnet → Igra Galleon Test Mainnet',
      bannerHtml: `<strong>Test Mainnet</strong> — Wraps KAS into iKAS on Galleon Test Mainnet via self-send. Min: ${CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS} KAS.`,
    };
  }
  return {
    kasSymbol: 'TKAS',
    bridgeAction: 'Bridge TKAS → iKAS',
    subtitle: 'Kaspa Testnet-10 → Igra Galleon Testnet',
    bannerHtml: `<strong>Galleon Testnet</strong> — Bridges tKAS into iKAS on Igra Galleon. Min: ${CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS} tKAS. Get tKAS from the <a href="https://faucet-tn10.kaspanet.io/" target="_blank" style="color:var(--accent-secondary)">Testnet-10 Faucet</a>.`,
  };
}

// ── Tab state renderer ───────────────────────────────────────

function updateTabsUI(): void {
  const labels = getLabels();

  elements.tabTestnetDeposit().setAttribute('aria-selected', String(currentTab === 'testnet-deposit'));
  elements.tabMainnetDeposit().setAttribute('aria-selected', String(currentTab === 'mainnet-deposit'));
  elements.tabMainnetExit().setAttribute('aria-selected', String(currentTab === 'mainnet-exit'));

  // Withdraw tab disabled when contract address env var isn't set.
  const exitAddress = getExitContractAddress();
  const exitTab = elements.tabMainnetExit();
  if (!exitAddress) {
    exitTab.disabled = true;
    exitTab.setAttribute('title', 'Coming soon — exit contract address not configured');
  } else {
    exitTab.disabled = false;
    exitTab.removeAttribute('title');
  }

  elements.pageSubtitle().textContent = labels.subtitle;
  elements.infoBanner().innerHTML = labels.bannerHtml;

  // Section visibility
  const showBridge = currentTab !== 'mainnet-exit';
  const showExit = currentTab === 'mainnet-exit';

  elements.walletSection().style.display = showBridge ? 'block' : 'none';
  elements.exitSection().style.display = showExit ? 'block' : 'none';

  // Hide deposit result when on exit tab; and vice-versa.
  if (showExit) {
    elements.resultSection().style.display = 'none';
  } else {
    elements.exitResultSection().style.display = 'none';
  }

  // Bridge section visibility is already controlled by updateUI(); just
  // ensure it's hidden when on exit tab regardless of wallet state.
  if (showExit) {
    elements.bridgeSection().style.display = 'none';
  }

  if (showBridge) {
    const labelsForDeposit = getLabels();
    if (labelsForDeposit.bridgeAction) {
      elements.bridgeBtn().textContent = labelsForDeposit.bridgeAction;
    }
  }
}

// ── Tab switching ────────────────────────────────────────────

function tabToNetwork(tab: Tab): NetworkMode {
  switch (tab) {
    case 'testnet-deposit':
      return 'testnet';
    case 'mainnet-deposit':
    case 'mainnet-exit':
      return 'mainnet';
  }
}

async function handleTabSwitch(nextTab: Tab): Promise<void> {
  if (nextTab === currentTab) return;

  const prevTab = currentTab;
  const prevNetwork = getNetworkMode();
  const nextNetwork = tabToNetwork(nextTab);
  const l1NetworkChanged = prevNetwork !== nextNetwork;

  // Disconnect Kaspa wallet ONLY when the L1 network changes.
  // Switching Mainnet-Deposit <-> Mainnet-Withdraw preserves both wallets.
  if (l1NetworkChanged && connectedWallet) {
    if (connectedWallet.type === 'kastle') await kastleDisconnect();
    else await kaswareDisconnect();
    connectedWallet = null;
    await disconnectRpc();

    const ns = elements.networkStatus();
    ns.textContent = '-';
    ns.className = 'status-value';
  }

  if (l1NetworkChanged) {
    setNetworkMode(nextNetwork);
  }

  setBridgeMode(nextTab === 'mainnet-exit' ? 'exit' : 'deposit');
  currentTab = nextTab;

  updateTabsUI();

  if (prevTab !== 'mainnet-exit' && nextTab !== 'mainnet-exit') {
    // Reset the deposit log & result exactly like the old handler did.
    elements.logOutput().innerHTML = '';
    elements.resultSection().style.display = 'none';
    clearError();

    log(`Switched to ${CONFIG.L2.NETWORK_NAME}`);
    log(`L1: Kaspa ${CONFIG.L1.NETWORK_ID}`);
    log(`L2: ${CONFIG.L2.NETWORK_NAME} (Chain ID: ${CONFIG.L2.CHAIN_ID})`);
    if (CONFIG.L1.ENTRY_ADDRESS) {
      log(`Entry Address: ${CONFIG.L1.ENTRY_ADDRESS.slice(0, 30)}...`);
    } else {
      log(`Entry mode: self-send (KAS sent to your own address)`);
    }
    log(`Required TX Prefix: ${CONFIG.L1.TX_ID_PREFIX}`);

    updateAmountConstraints();
    logWalletDetection();
    updateUI();
  } else if (nextTab === 'mainnet-exit') {
    await mountExitTab();
  } else {
    // Returning from exit to deposit — re-render deposit UI state.
    updateAmountConstraints();
    updateUI();
  }
}

// ── Deposit flow (unchanged logic) ───────────────────────────

function updateAmountConstraints(): void {
  const input = elements.amountInput();
  const min = CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS;
  const max = CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS;
  const hint = input.nextElementSibling as HTMLElement | null;

  input.min = min.toString();

  if (max !== null) {
    input.max = max.toString();
    const maxDisplay = max.toLocaleString();
    input.placeholder = `${min} – ${maxDisplay} KAS`;
    if (hint) hint.textContent = `Amount of KAS to bridge to Igra (${min} – ${maxDisplay} KAS)`;
  } else {
    input.removeAttribute('max');
    input.placeholder = `Min: ${min} KAS`;
    if (hint) hint.textContent = `Amount of KAS to bridge to Igra (min ${min} KAS)`;
  }

  if (input.value !== '') {
    const val = parseFloat(input.value);
    if (!isNaN(val)) {
      if (max !== null && val > max) input.value = max.toString();
      else if (val < min) input.value = min.toString();
    }
  }
}

function logWalletDetection(): void {
  const kastleOk = isKastleInstalled();
  const kaswareOk = isKaswareInstalled();

  if (kastleOk && kaswareOk) {
    log('Kastle and Kasware wallets detected. Select a wallet and click "Connect".');
  } else if (kastleOk) {
    log('Kastle wallet detected. Kasware not found.');
  } else if (kaswareOk) {
    log('Kasware wallet detected. Kastle not found.');
  } else {
    log('No Kaspa wallet detected. Please install Kastle or Kasware.');
  }
}

function selectWallet(type: WalletType): void {
  selectedWalletType = type;

  const kastleBtn = elements.walletKastleBtn();
  const kaswareBtn = elements.walletKaswareBtn();
  kastleBtn.classList.toggle('active', type === 'kastle');
  kaswareBtn.classList.toggle('active', type === 'kasware');

  updateUI();
}

function updateUI(): void {
  const walletStatus = elements.walletStatus();
  const walletAddress = elements.walletAddress();
  const connectBtn = elements.connectBtn();
  const bridgeSection = elements.bridgeSection();
  const kastleBtn = elements.walletKastleBtn();
  const kaswareBtn = elements.walletKaswareBtn();
  const walletSelector = kastleBtn.parentElement!;

  // On exit tab, deposit UI is hidden; nothing to do.
  if (currentTab === 'mainnet-exit') {
    bridgeSection.style.display = 'none';
    return;
  }

  if (connectedWallet) {
    const walletName = connectedWallet.type === 'kastle' ? 'Kastle' : 'Kasware';
    walletStatus.textContent = `Connected (${walletName})`;
    walletStatus.className = 'status-value connected';
    walletAddress.textContent = connectedWallet.address;
    connectBtn.textContent = 'Disconnect';
    connectBtn.disabled = false;
    bridgeSection.style.display = 'block';
    elements.bridgeBtn().disabled = !isMiningAvailable();

    kastleBtn.disabled = true;
    kaswareBtn.disabled = true;
    kastleBtn.removeAttribute('data-tooltip');
    kaswareBtn.removeAttribute('data-tooltip');
    walletSelector.setAttribute('data-tooltip', 'Disconnect your wallet before switching');

    // Enable autofill on the exit form if we later switch tabs.
    refreshExitAutofillButton();
  } else {
    walletStatus.textContent = 'Not connected';
    walletStatus.className = 'status-value';
    walletAddress.textContent = '-';
    walletSelector.removeAttribute('data-tooltip');

    const kastleInstalled = isKastleInstalled();
    const kaswareInstalled = isKaswareInstalled();
    kastleBtn.disabled = !kastleInstalled;
    kaswareBtn.disabled = !kaswareInstalled;

    if (!kastleInstalled) kastleBtn.setAttribute('data-tooltip', 'Kastle not detected — install from Chrome Web Store');
    else kastleBtn.removeAttribute('data-tooltip');
    if (!kaswareInstalled) kaswareBtn.setAttribute('data-tooltip', 'Kasware not detected — install from Chrome Web Store');
    else kaswareBtn.removeAttribute('data-tooltip');

    if (selectedWalletType) {
      const walletName = selectedWalletType === 'kastle' ? 'Kastle' : 'Kasware';
      connectBtn.textContent = `Connect ${walletName}`;
      connectBtn.disabled = false;
    } else {
      connectBtn.textContent = 'Select a Wallet';
      connectBtn.disabled = true;
    }

    bridgeSection.style.display = 'none';

    refreshExitAutofillButton();
  }
}

async function handleConnect(): Promise<void> {
  clearError();

  if (!selectedWalletType) {
    showError('Please select a wallet first.');
    return;
  }

  const walletName = selectedWalletType === 'kastle' ? 'Kastle' : 'Kasware';

  const isInstalled = selectedWalletType === 'kastle' ? isKastleInstalled() : isKaswareInstalled();
  if (!isInstalled) {
    const installUrl = selectedWalletType === 'kastle'
      ? 'https://chromewebstore.google.com/detail/kastle/oambclflhjfppdmkghokjmpppmaebego'
      : 'https://chromewebstore.google.com/detail/kasware-wallet/hklhheigdglejcbllnodkdemomannpcg';
    showError(`${walletName} wallet not detected. Please install the extension.`);
    window.open(installUrl, '_blank');
    return;
  }

  try {
    elements.connectBtn().disabled = true;
    elements.connectBtn().textContent = 'Connecting...';

    if (selectedWalletType === 'kastle') {
      await kastleEnsureNetwork();
    } else {
      await kaswareEnsureNetwork();
    }

    let address: string;
    if (selectedWalletType === 'kastle') {
      const account = await kastleConnect();
      address = account.address;
    } else {
      address = await kaswareConnect();
    }

    const correctNetwork = verifyNetworkByAddress(address);
    const networkStatus = elements.networkStatus();

    if (correctNetwork) {
      connectedWallet = { address, type: selectedWalletType };
      log(`${walletName} wallet connected: ${address}`);
      networkStatus.textContent = `${CONFIG.L1.NETWORK_ID}`;
      networkStatus.className = 'status-value connected';
      log(`Network verified: ${CONFIG.L1.NETWORK_ID}`);
    } else {
      if (selectedWalletType === 'kastle') await kastleDisconnect();
      else await kaswareDisconnect();

      networkStatus.textContent = `Wrong network!`;
      networkStatus.className = 'status-value error';
      const got = address.startsWith('kaspatest:') ? 'testnet' : 'mainnet';
      showError(`${walletName} is on ${got}. Please switch to ${CONFIG.L1.NETWORK_ID} and reconnect.`);
      log(`WARNING: ${walletName} address is ${got}, expected ${CONFIG.L1.NETWORK_ID}`);
    }

    updateUI();
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to connect wallet';
    showError(msg);
    log(`Connection error: ${msg}`);
    updateUI();
  }
}

async function handleDisconnect(): Promise<void> {
  if (!connectedWallet) return;

  const walletName = connectedWallet.type === 'kastle' ? 'Kastle' : 'Kasware';

  if (connectedWallet.type === 'kastle') await kastleDisconnect();
  else await kaswareDisconnect();

  connectedWallet = null;

  const networkStatus = elements.networkStatus();
  networkStatus.textContent = '-';
  networkStatus.className = 'status-value';

  log(`${walletName} wallet disconnected`);
  updateUI();
}

async function handleBridge(): Promise<void> {
  clearError();

  if (!connectedWallet) {
    showError('Please connect your wallet first');
    return;
  }

  if (!isMiningAvailable()) {
    showError('Bridge unavailable — Kaspa WASM failed to initialize. Please reload the page.');
    return;
  }

  const amountStr = elements.amountInput().value;
  const l2Address = elements.l2AddressInput().value.trim();

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount < CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS) {
    showError(`Minimum amount is ${CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS} KAS`);
    return;
  }

  if (CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS !== null && amount > CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS) {
    showError(`Maximum amount is ${CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS} KAS per transaction`);
    return;
  }

  if (!isValidL2Address(l2Address)) {
    showError('Invalid L2 address. Must be a valid Ethereum address (0x...)');
    return;
  }

  if (!hasAcceptedTerms()) {
    showTermsModal();
    return;
  }

  const labels = getLabels();

  try {
    elements.bridgeBtn().disabled = true;
    elements.logOutput().innerHTML = '';
    elements.resultSection().style.display = 'none';

    elements.bridgeBtn().textContent = 'Mining TX ID...';
    log('Starting bridge with TX ID mining...');
    log('This ensures the transaction will be recognized by Igra.');

    const result = await executeBridgeWithMining(
      { amountKas: amount, l2Address },
      connectedWallet!.address,
      connectedWallet!.type,
      (msg) => log(msg)
    );

    showResult(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Bridge transaction failed';
    showError(msg);
    log(`ERROR: ${msg}`);
  } finally {
    termsAcceptedForTx = false;
    elements.bridgeBtn().disabled = false;
    if (labels.bridgeAction) elements.bridgeBtn().textContent = labels.bridgeAction;
  }
}

function showResult(result: BridgeResult): void {
  elements.resultSection().style.display = 'block';
  elements.resultTxId().textContent = result.txId;
  elements.resultAmount().textContent = `${sompiToKas(result.amountSompi)} KAS`;
  elements.resultL2Address().textContent = result.l2Address;

  const explorerLink = elements.explorerLink();
  explorerLink.href = getExplorerUrl(result.txId);

  const l2ExplorerLink = elements.l2ExplorerLink();
  l2ExplorerLink.href = getL2ExplorerUrl(result.l2Address);

  const expectedPrefix = CONFIG.L1.TX_ID_PREFIX.toLowerCase();
  const actualPrefix = result.txId.slice(0, expectedPrefix.length).toLowerCase();
  const prefixMatches = actualPrefix === expectedPrefix;

  if (prefixMatches) {
    log('Bridge transaction submitted successfully!');
    log(`TX ID prefix matches (${expectedPrefix}) - Igra will process this transaction.`);
  } else {
    log('Transaction submitted but TX ID prefix does not match.');
    log(`   Expected: ${expectedPrefix}, Got: ${actualPrefix}`);
    log('This transaction will NOT be recognized by Igra.');
    log('   Your KAS was sent but iKAS will not be minted.');
    log('   You may need to contact Igra support for recovery.');
  }

  log(`View on Kaspa Explorer: ${getExplorerUrl(result.txId)}`);
}

// ── Exit (Withdraw) flow ─────────────────────────────────────

function setExitFormError(message: string | null): void {
  const el = elements.exitFormError();
  if (!message) {
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  el.textContent = message;
  el.style.display = 'block';
}

function shortAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function refreshExitAutofillButton(): void {
  const btn = elements.exitUseMyKaspa();
  const canAutofill =
    !!connectedWallet && connectedWallet.address.startsWith('kaspa:');
  btn.disabled = !canAutofill;
  btn.title = canAutofill
    ? `Prefill ${shortAddress(connectedWallet!.address)}`
    : 'Connect your Kaspa wallet on the Deposit tab to enable this';
}

function renderExitPolicyHint(): void {
  if (!exitConfig) {
    elements.exitAmountHint().textContent = 'Loading live policy…';
    return;
  }

  const minIKas = formatSompiAsIKas(exitConfig.minExitSompi);
  const maxIKas = formatSompiAsIKas(exitConfig.maxExitSompi);
  const perWindow = formatSompiAsIKas(exitConfig.throttleMaxUnlockAmountPerWindowSompi);
  const windowHours = (exitConfig.throttleWindowBlocks * exitBlockTimeSeconds) / 3600;
  const windowLabel = windowHours >= 1
    ? `~${windowHours.toFixed(windowHours < 2 ? 1 : 0)}h`
    : `~${Math.round(windowHours * 60)}m`;

  elements.exitAmountHint().innerHTML =
    `Between <strong>${minIKas}</strong> and <strong>${maxIKas}</strong> iKAS per withdrawal. ` +
    `Up to <strong>${exitConfig.throttleMaxExitsPerWindow}</strong> withdrawals or ` +
    `<strong>${perWindow}</strong> iKAS every ${windowLabel}.`;
}

function hideExitPreview(): void {
  exitPreflight = null;
  elements.exitPreview().style.display = 'none';
  elements.exitSubmitBtn().disabled = true;
}

function renderExitPreview(unlockSompi: bigint, pre: PreflightResult): void {
  const totalIKas = (unlockSompi + pre.feeSompi);
  elements.exitPreviewBurn().textContent = `${formatSompiAsIKas(unlockSompi)} iKAS`;
  elements.exitPreviewFee().textContent = `${formatSompiAsIKas(pre.feeSompi)} iKAS`;
  elements.exitPreviewTotal().textContent = `${formatSompiAsIKas(totalIKas)} iKAS`;
  elements.exitPreviewReceive().textContent = `${formatSompiAsIKas(unlockSompi)} KAS`;
  elements.exitPreview().style.display = 'grid';
}

async function mountExitTab(): Promise<void> {
  const token = ++exitMountToken;

  setExitFormError(null);
  hideExitPreview();
  renderExitPolicyHint();

  // WASM gate — the address validator depends on it.
  if (!isWasmInitialized()) {
    elements.exitWasmGate().style.display = 'flex';
    elements.exitFormFields().style.display = 'none';
    elements.exitWalletConnectWrap().style.display = 'none';
    elements.exitWalletRow().style.display = 'none';
    elements.exitWasmGateText().textContent = 'Securing address validation…';
    try {
      await initKaspaWasm();
      if (token !== exitMountToken) return;
    } catch {
      if (token !== exitMountToken) return;
      elements.exitWasmGateText().textContent =
        'Secure address validation failed to initialise. Reload the page to retry.';
      return;
    }
  }
  elements.exitWasmGate().style.display = 'none';

  const contractAddress = getExitContractAddress();
  if (!contractAddress) {
    setExitFormError('The withdrawal contract address is not configured.');
    elements.exitFormFields().style.display = 'none';
    elements.exitWalletConnectWrap().style.display = 'none';
    return;
  }

  if (!exitPublicClient) {
    exitPublicClient = createIgraPublicClient();
  }

  // Always refresh policy + block time from chain on mount. The admin
  // can change throttle/min/max at any time, so we never cache these
  // across tab mounts — two cheap read RPC calls.
  try {
    const [cfg, blockTime] = await Promise.all([
      loadExitContractConfig(exitPublicClient),
      estimateIgraBlockTimeSeconds(exitPublicClient),
    ]);
    if (token !== exitMountToken) return;
    exitConfig = cfg;
    exitBlockTimeSeconds = blockTime;
  } catch (err) {
    if (token !== exitMountToken) return;
    console.error('Failed to load exit bridge config', err);
    setExitFormError('Could not reach the Igra RPC to load withdrawal policy. Please try again in a moment.');
    return;
  }
  renderExitPolicyHint();

  // Paused state — render read-only banner and hide form.
  if (exitConfig!.paused) {
    elements.exitPausedBanner().style.display = 'block';
    elements.exitFormFields().style.display = 'none';
    elements.exitWalletConnectWrap().style.display = 'none';
    elements.exitWalletRow().style.display = 'none';
    return;
  }
  elements.exitPausedBanner().style.display = 'none';

  // Wallet row state
  if (evmWallet) {
    renderEvmWalletConnected();
  } else {
    elements.exitWalletRow().style.display = 'none';
    elements.exitWalletConnectWrap().style.display = 'block';
    elements.exitFormFields().style.display = 'none';
    elements.exitWalletPicker().style.display = 'none';
  }

  refreshExitAutofillButton();
}

function renderEvmWalletConnected(): void {
  if (!evmWallet) return;
  elements.exitWalletRow().style.display = 'flex';
  elements.exitWalletConnectWrap().style.display = 'none';
  elements.exitWalletPicker().style.display = 'none';
  elements.exitWalletAddress().textContent = shortAddress(evmWallet.address);
  elements.exitFormFields().style.display = 'block';
}

function renderWalletPicker(options: WalletOption[]): void {
  const picker = elements.exitWalletPicker();
  picker.innerHTML = '';

  if (options.length === 0) {
    const empty = document.createElement('div');
    empty.style.color = 'var(--text-secondary)';
    empty.style.fontSize = '0.8rem';
    empty.style.padding = '0.5rem';
    empty.textContent = 'No EVM wallets detected. Install Kasware, Kastle EVM, or MetaMask.';
    picker.appendChild(empty);
    picker.style.display = 'block';
    return;
  }

  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    if (opt.icon) {
      const img = document.createElement('img');
      img.src = opt.icon;
      img.alt = '';
      btn.appendChild(img);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'wallet-placeholder';
      placeholder.textContent = opt.name.charAt(0).toUpperCase();
      btn.appendChild(placeholder);
    }
    const label = document.createElement('span');
    label.textContent = opt.name;
    btn.appendChild(label);
    btn.addEventListener('click', () => { void handleExitWalletSelection(opt); });
    picker.appendChild(btn);
  }
  picker.style.display = 'grid';
}

function openExitWalletPicker(): void {
  const options = listWalletOptions();
  renderWalletPicker(options);
}

async function handleExitWalletSelection(option: WalletOption): Promise<void> {
  setExitFormError(null);
  try {
    const wallet = await connectEvmWallet(option);
    attachWalletListeners(wallet);
    evmWallet = wallet;
    renderEvmWalletConnected();
    schedulePreviewRefresh();
  } catch (err) {
    setExitFormError(mapExitError(err).message);
  }
}

function attachWalletListeners(wallet: ConnectedEvmWallet): void {
  if (evmWalletDetachListeners) {
    evmWalletDetachListeners();
    evmWalletDetachListeners = null;
  }
  evmWalletDetachListeners = attachEvmWalletListeners(wallet.provider, (ev) => {
    if (ev.type === 'accountsChanged') {
      if (!ev.address) {
        void handleExitWalletDisconnect(true);
      } else if (evmWallet) {
        evmWallet = { ...evmWallet, address: ev.address };
        renderEvmWalletConnected();
        schedulePreviewRefresh();
      }
    } else if (ev.type === 'chainChanged') {
      if (ev.chainIdHex.toLowerCase() !== IGRA_MAINNET_CHAIN_ID_HEX) {
        setExitFormError('Your wallet left Igra Mainnet. Switch back to continue.');
        hideExitPreview();
      } else {
        setExitFormError(null);
        schedulePreviewRefresh();
      }
      if (evmWallet) evmWallet = { ...evmWallet, chainIdHex: ev.chainIdHex };
    } else if (ev.type === 'disconnected') {
      void handleExitWalletDisconnect(true);
    }
  });
}

async function handleExitWalletDisconnect(silent = false): Promise<void> {
  if (!evmWallet) return;
  try {
    await disconnectEvmWallet(evmWallet);
  } catch {
    // Ignore.
  }
  if (evmWalletDetachListeners) {
    evmWalletDetachListeners();
    evmWalletDetachListeners = null;
  }
  evmWallet = null;
  hideExitPreview();
  elements.exitFormFields().style.display = 'none';
  elements.exitWalletRow().style.display = 'none';
  elements.exitWalletConnectWrap().style.display = 'block';
  if (!silent) setExitFormError(null);
}

// ── Amount / address validation + preview ────────────────────

/**
 * Public entry point for input events. Debounces so fast typing coalesces
 * into a single RPC round-trip 300ms after the user stops, and uses a
 * monotonic token so only the latest request's result is applied.
 */
function schedulePreviewRefresh(): void {
  if (exitPreflightDebounce !== null) clearTimeout(exitPreflightDebounce);
  exitPreflightDebounce = setTimeout(() => {
    exitPreflightDebounce = null;
    void runPreviewRefresh();
  }, EXIT_PREFLIGHT_DEBOUNCE_MS);
}

async function runPreviewRefresh(): Promise<void> {
  const token = ++exitPreflightToken;
  setExitFormError(null);

  if (!evmWallet || !exitConfig || !exitPublicClient) {
    hideExitPreview();
    return;
  }

  const amountStr = elements.exitAmountInput().value;
  const kaspaStr = elements.exitKaspaInput().value.trim();

  if (amountStr.trim() === '' && kaspaStr === '') {
    hideExitPreview();
    return;
  }

  let unlockSompi: bigint;
  try {
    unlockSompi = parseIKasToSompi(amountStr);
  } catch (err) {
    hideExitPreview();
    if (amountStr.trim() !== '') {
      setExitFormError((err as Error).message);
    }
    return;
  }

  if (kaspaStr !== '') {
    try {
      validateKasPayoutAddress(kaspaStr);
    } catch (err) {
      hideExitPreview();
      setExitFormError((err as Error).message);
      return;
    }
  } else {
    hideExitPreview();
    return;
  }

  try {
    const pre = await preflightExit({
      publicClient: exitPublicClient,
      account: evmWallet.address,
      unlockSompi,
      config: exitConfig,
    });
    // Drop stale responses — only the latest user input wins.
    if (token !== exitPreflightToken) return;

    exitPreflight = pre;
    renderExitPreview(unlockSompi, pre);

    if (pre.balanceWei < pre.totalValueWei) {
      setExitFormError(
        `Your wallet only has ${formatSompiAsIKas(pre.balanceWei / SOMPI_SCALE_WEI)} iKAS. Total required: ${formatSompiAsIKas(pre.totalValueWei / SOMPI_SCALE_WEI)} iKAS.`
      );
      elements.exitSubmitBtn().disabled = true;
      return;
    }
    elements.exitSubmitBtn().disabled = exitInFlight;
  } catch (err) {
    if (token !== exitPreflightToken) return;
    hideExitPreview();
    setExitFormError(mapExitError(err).message);
  }
}

// ── Confirmation + submit ────────────────────────────────────

function openExitConfirmModal(unlockSompi: bigint, pre: PreflightResult, payout: string): void {
  elements.exitConfirmBurn().textContent = `${formatSompiAsIKas(unlockSompi)} iKAS`;
  elements.exitConfirmFee().textContent = `${formatSompiAsIKas(pre.feeSompi)} iKAS`;
  elements.exitConfirmTotal().textContent = `${formatSompiAsIKas(unlockSompi + pre.feeSompi)} iKAS`;
  elements.exitConfirmReceive().textContent = `${formatSompiAsIKas(unlockSompi)} KAS`;
  elements.exitConfirmPayout().textContent = payout;
  elements.exitConfirmAck().checked = false;
  elements.exitConfirmProceed().disabled = true;
  elements.exitConfirmModal().classList.remove('hidden');

  setTimeout(() => elements.exitConfirmAck().focus(), 0);
}

function closeExitConfirmModal(): void {
  elements.exitConfirmModal().classList.add('hidden');
}

async function handleExitSubmit(): Promise<void> {
  setExitFormError(null);

  if (!evmWallet || !exitConfig || !exitPublicClient || !exitPreflight) {
    setExitFormError('Please enter an amount and a valid Kaspa address first.');
    return;
  }

  let unlockSompi: bigint;
  try {
    unlockSompi = parseIKasToSompi(elements.exitAmountInput().value);
  } catch (err) {
    setExitFormError((err as Error).message);
    return;
  }

  const payout = elements.exitKaspaInput().value.trim();
  try {
    validateKasPayoutAddress(payout);
  } catch (err) {
    setExitFormError((err as Error).message);
    return;
  }

  openExitConfirmModal(unlockSompi, exitPreflight, payout);
}

async function handleExitConfirm(): Promise<void> {
  if (exitInFlight) return;

  if (!evmWallet || !exitConfig || !exitPublicClient) {
    setExitFormError('Session expired. Please reconnect your wallet and try again.');
    closeExitConfirmModal();
    return;
  }

  let unlockSompi: bigint;
  try {
    unlockSompi = parseIKasToSompi(elements.exitAmountInput().value);
  } catch (err) {
    setExitFormError((err as Error).message);
    closeExitConfirmModal();
    return;
  }

  const payout = elements.exitKaspaInput().value.trim();

  exitInFlight = true;
  const submitBtn = elements.exitSubmitBtn();
  const submitOriginalText = submitBtn.textContent ?? 'Withdraw iKAS → KAS';
  submitBtn.disabled = true;
  elements.exitConfirmProceed().disabled = true;
  elements.exitConfirmCancel().disabled = true;

  // Clear the previous success panel so the UI is never showing two
  // withdrawals at once.
  elements.exitResultSection().style.display = 'none';

  try {
    const walletClient = createIgraWalletClient(evmWallet.provider, evmWallet.address as Address);

    submitBtn.textContent = 'Waiting for signature…';
    const txHash = await simulateAndRequestExit({
      publicClient: exitPublicClient,
      walletClient,
      account: evmWallet.address as Address,
      kasPayoutAddress: payout,
      unlockSompi,
      feePolicyIsZero: exitConfig.feeIsZero,
    });

    closeExitConfirmModal();
    submitBtn.textContent = 'Confirming on chain…';

    const receipt = await awaitExitReceipt(exitPublicClient, txHash);
    showExitResult(receipt, payout);

    // Reset amount for next submission; keep payout address since the
    // same user often sends repeatedly to the same Kaspa wallet.
    elements.exitAmountInput().value = '';
    hideExitPreview();
  } catch (err) {
    closeExitConfirmModal();
    setExitFormError(mapExitError(err).message);
  } finally {
    exitInFlight = false;
    submitBtn.textContent = submitOriginalText;
    submitBtn.disabled = !exitPreflight;
    elements.exitConfirmCancel().disabled = false;
  }
}

function showExitResult(receipt: ExitReceipt, payout: string): void {
  elements.exitResultTxHash().textContent = receipt.txHash;
  elements.exitResultRequestId().textContent = `#${receipt.requestId}`;
  elements.exitResultBurn().textContent = `${formatSompiAsIKas(receipt.burnedSompi)} iKAS`;
  elements.exitResultPayout().textContent = payout;
  elements.exitResultTxLink().href = igraTxUrl(receipt.txHash);
  elements.exitResultKaspaLink().href = kaspaAddressUrl(payout);
  elements.exitResultSection().style.display = 'block';
  elements.exitResultSection().scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Init ─────────────────────────────────────────────────────

async function initWasm(): Promise<boolean> {
  try {
    log('Initializing Kaspa WASM...');
    await initKaspaWasm();
    log('Kaspa WASM initialized - TX ID mining enabled');
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log(`WASM init failed: ${msg}`);
    log('Bridge disabled — WASM is required for safe TX ID mining. Reload the page to retry.');
    return false;
  }
}

async function init(): Promise<void> {
  // EIP-6963 wallet discovery starts immediately so providers have time
  // to announce themselves before the user clicks Connect.
  startWalletDiscovery();

  // Initial tab = Mainnet Deposit (matches historical default).
  currentTab = 'mainnet-deposit';
  setNetworkMode('mainnet');
  setBridgeMode('deposit');

  log(`Igra Bridge v1.2`);
  log(`─────────────────────────────`);
  log(`L1: Kaspa ${CONFIG.L1.NETWORK_ID}`);
  log(`L2: ${CONFIG.L2.NETWORK_NAME} (Chain ID: ${CONFIG.L2.CHAIN_ID})`);
  if (CONFIG.L1.ENTRY_ADDRESS) {
    log(`Entry Address: ${CONFIG.L1.ENTRY_ADDRESS.slice(0, 30)}...`);
  } else {
    log(`Entry mode: self-send (KAS sent to your own address)`);
  }
  log(`Required TX Prefix: ${CONFIG.L1.TX_ID_PREFIX}`);
  log(`─────────────────────────────`);

  await initWasm();
  logWalletDetection();

  elements.connectBtn().addEventListener('click', () => {
    if (connectedWallet) handleDisconnect();
    else handleConnect();
  });
  elements.bridgeBtn().addEventListener('click', handleBridge);

  const amountEl = elements.amountInput();
  amountEl.addEventListener('input', () => {
    if (amountEl.value === '') return;
    const val = parseFloat(amountEl.value);
    if (isNaN(val)) return;
    const max = CONFIG.L1.MAX_BRIDGE_AMOUNT_KAS;
    if (max !== null && val > max) amountEl.value = max.toString();
  });
  amountEl.addEventListener('blur', () => {
    if (amountEl.value === '') return;
    const val = parseFloat(amountEl.value);
    if (isNaN(val)) return;
    const min = CONFIG.L1.MIN_BRIDGE_AMOUNT_KAS;
    if (val < min) amountEl.value = min.toString();
  });

  elements.walletKastleBtn().addEventListener('click', () => selectWallet('kastle'));
  elements.walletKaswareBtn().addEventListener('click', () => selectWallet('kasware'));

  const termsCheckbox = document.getElementById('terms-checkbox') as HTMLInputElement;
  const termsProceedBtn = document.getElementById('terms-proceed-btn') as HTMLButtonElement;
  const termsCancelBtn = document.getElementById('terms-cancel-btn') as HTMLButtonElement;

  termsCheckbox.addEventListener('change', () => {
    termsProceedBtn.disabled = !termsCheckbox.checked;
  });
  termsProceedBtn.addEventListener('click', () => {
    setTermsAccepted();
    hideTermsModal();
    handleBridge();
  });
  termsCancelBtn.addEventListener('click', hideTermsModal);

  // Tabs
  elements.tabTestnetDeposit().addEventListener('click', () => { void handleTabSwitch('testnet-deposit'); });
  elements.tabMainnetDeposit().addEventListener('click', () => { void handleTabSwitch('mainnet-deposit'); });
  elements.tabMainnetExit().addEventListener('click', () => { void handleTabSwitch('mainnet-exit'); });

  // Exit flow listeners
  elements.exitWalletConnect().addEventListener('click', openExitWalletPicker);
  elements.exitWalletDisconnect().addEventListener('click', () => { void handleExitWalletDisconnect(); });
  elements.exitAmountInput().addEventListener('input', schedulePreviewRefresh);
  elements.exitAmountInput().addEventListener('blur', schedulePreviewRefresh);
  elements.exitKaspaInput().addEventListener('input', schedulePreviewRefresh);
  elements.exitKaspaInput().addEventListener('blur', schedulePreviewRefresh);
  elements.exitUseMyKaspa().addEventListener('click', () => {
    if (!connectedWallet || !connectedWallet.address.startsWith('kaspa:')) return;
    elements.exitKaspaInput().value = connectedWallet.address;
    schedulePreviewRefresh();
  });
  elements.exitSubmitBtn().addEventListener('click', () => { void handleExitSubmit(); });
  elements.exitConfirmCancel().addEventListener('click', closeExitConfirmModal);
  elements.exitConfirmAck().addEventListener('change', () => {
    elements.exitConfirmProceed().disabled = !elements.exitConfirmAck().checked;
  });
  elements.exitConfirmProceed().addEventListener('click', () => { void handleExitConfirm(); });

  // Keyboard: Esc closes open modals (except while a tx is in flight).
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!elements.exitConfirmModal().classList.contains('hidden') && !exitInFlight) {
      closeExitConfirmModal();
    }
    if (!document.getElementById('terms-modal')!.classList.contains('hidden')) hideTermsModal();
  });

  updateAmountConstraints();
  updateTabsUI();
  updateUI();
}

document.addEventListener('DOMContentLoaded', init);
