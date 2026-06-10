/**
 * Kaspa WASM SDK Integration
 * 
 * Loads and initializes the Kaspa WASM module for transaction construction
 * and TX ID mining.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Version of the vendored Kaspa WASM SDK under `public/kaspa`. Used as a
 * cache-busting token on both asset URLs so the glue (`kaspa.js`) and the
 * binary (`kaspa_bg.wasm`) — which are served from stable, non-hashed URLs —
 * can never be paired across versions by a browser/CDN cache (which would
 * cause a WASM `LinkError`). Bump this whenever the SDK is revendored.
 */
const KASPA_SDK_VERSION = '2.0.0';

let wasmInitialized = false;
let wasmModule: any = null;

/**
 * Initialize the Kaspa WASM module
 */
export async function initKaspaWasm(): Promise<any> {
  if (wasmInitialized && wasmModule) {
    return wasmModule;
  }
  
  try {
    // Dynamic import from public folder - served as static files.
    // Using Function constructor to bypass TypeScript module resolution.
    // Both URLs carry the same version token so the glue and binary are always
    // fetched as a matched pair (see KASPA_SDK_VERSION).
    const dynamicImport = new Function('path', 'return import(path)');
    const kaspa = await dynamicImport(`/kaspa/kaspa.js?v=${KASPA_SDK_VERSION}`);
    
    // Initialize the WASM binary. Pass the single-object form (wasm-bindgen's
    // current API) to avoid the deprecated positional-argument warning.
    await kaspa.default({ module_or_path: `/kaspa/kaspa_bg.wasm?v=${KASPA_SDK_VERSION}` });
    
    // Enable console panic hooks for debugging
    if (typeof kaspa.initConsolePanicHook === 'function') {
      kaspa.initConsolePanicHook();
    }
    
    wasmInitialized = true;
    wasmModule = kaspa;
    
    console.log('Kaspa WASM initialized successfully');
    return kaspa;
  } catch (error) {
    console.error('Failed to initialize Kaspa WASM:', error);
    throw new Error(`Failed to initialize Kaspa WASM: ${error}`);
  }
}

/**
 * Check if WASM is initialized
 */
export function isWasmInitialized(): boolean {
  return wasmInitialized;
}

/**
 * Get the initialized WASM module
 */
export function getKaspaWasm(): any {
  if (!wasmModule) {
    throw new Error('Kaspa WASM not initialized. Call initKaspaWasm() first.');
  }
  return wasmModule;
}
