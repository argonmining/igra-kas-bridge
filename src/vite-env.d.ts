/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAINNET_MIN_KAS: string;
  readonly VITE_MAINNET_MAX_KAS: string;
  readonly VITE_MAINNET_FEE_KAS: string;
  readonly VITE_MAINNET_FEE_ADDRESS: string;
  readonly VITE_TESTNET_NODE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
