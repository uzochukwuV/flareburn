# Wallet Connection Guide: XRP & Flare Integration for Portfolio.html

## 📱 Overview

This guide explains how to add wallet connection functionality to `portfolio.html` to enable users to connect both:
- **XRP Wallets** (Xaman, Ledger, Ripple Keypairs) via XRPL
- **Flare Wallets** (MetaMask, Ledger, etc.) via EVM

The dashboard will display the connected wallet addresses and auto-load portfolio data for the connected accounts.

---

## 🔌 Architecture: Dual-Wallet System

```
┌─────────────────────────────────────────────────────────┐
│                  Portfolio.html Dashboard               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Header: [Connect XRP Wallet] [Connect Flare Wallet]   │
│          XRP: rG1QQv2...  |  Flare: 0x1234...          │
│                                                         │
│  Content:                                               │
│  - If BOTH connected: Show omnichain portfolio          │
│  - If only XRP: Show XRPL data only                     │
│  - If only Flare: Show Flare data only                  │
│  - If neither: Show demo data + "Connect to start"      │
│                                                         │
└─────────────────────────────────────────────────────────┘

        ↓                           ↓
    
   XRPL                         EVM (Flare)
   ├─ Xaman                     ├─ MetaMask
   ├─ Ledger                    ├─ Ledger Live
   ├─ Trust Wallet              ├─ Brave Wallet
   └─ xrpl.js keypair           └─ WalletConnect
```

---

## 📋 Part 1: XRP Wallet Connection

### 1.1 Libraries Required

```bash
npm install xrpl@2.4.0 xaman@0.5.0
```

**Library Overview:**
- `xrpl.js` — Low-level XRPL interaction (address validation, keypairs, ledger queries)
- `xaman` — Xaman (formerly Xumm) SDK for mobile/browser wallet integration

### 1.2 XRP Wallet Connection Flow

```
User clicks "Connect XRP Wallet"
    ↓
Show wallet provider modal (Xaman / Ledger / Keypair)
    ↓
[Xaman Path]:
  - Open Xaman login URL
  - User scans QR / clicks link
  - Xaman app returns auth token + address
  
[Ledger Path]:
  - Request Ledger transport
  - Prompt user: approve on device
  - Return address + signing capability
  
[Keypair Path]:
  - User pastes private key (dev-only!)
  - Validate key format
  - Derive public address
    ↓
Store: { walletType, xrplAddress, signerObject }
    ↓
Fetch: GET /portfolio?xrplAddress={address}
    ↓
Display: XRP balances, prepare minting
```

### 1.3 XRP Wallet Connection Code

```javascript
// wallet-xrp.js

import { Client, Wallet } from 'xrpl';
import { XamanPlatform } from 'xaman';

const XRPL_NETWORK = 'testnet'; // or 'mainnet'
const XRPL_ENDPOINT = 'wss://testnet.xrpl-labs.com';

let xrplClient = null;
let xrplWallet = null;
let xrplAddress = null;

// ============ Connection Management ============

export async function initializeXrplClient() {
  if (!xrplClient) {
    xrplClient = new Client(XRPL_ENDPOINT);
    await xrplClient.connect();
  }
  return xrplClient;
}

export async function disconnectXrpl() {
  if (xrplClient) {
    await xrplClient.disconnect();
    xrplClient = null;
  }
  xrplWallet = null;
  xrplAddress = null;
}

// ============ Xaman Connection (Recommended for Users) ============

export async function connectXamanWallet() {
  try {
    const xaman = new XamanPlatform({
      apiKey: process.env.VITE_XAMAN_API_KEY,
      apiSecret: process.env.VITE_XAMAN_API_SECRET
    });

    // 1. Initiate Xaman login
    const loginRequest = await xaman.authorize();
    
    // 2. Generate login URL & QR code
    const loginUrl = loginRequest.url;
    const qrCode = loginRequest.qrcode;

    // 3. Show modal with QR + link
    showXamanModal({
      qrCode,
      loginUrl,
      onTimeout: () => handleXamanTimeout()
    });

    // 4. Poll for authorization
    const authorized = await loginRequest.resolved;
    
    if (!authorized) {
      throw new Error('Xaman authorization failed');
    }

    // 5. Get authorized account info
    const accountInfo = await xaman.getAccountInfo();
    xrplAddress = accountInfo.address;

    // 6. Store wallet info (for later signing)
    xrplWallet = {
      type: 'xaman',
      address: xrplAddress,
      xaman: xaman,
      token: authorized.token
    };

    return { success: true, address: xrplAddress };
  } catch (error) {
    console.error('Xaman connection failed:', error);
    return { success: false, error: error.message };
  }
}

// ============ Ledger Connection (For Hardware Wallets) ============

export async function connectLedgerWallet() {
  try {
    // 1. Import Ledger transport (browser-specific)
    const TransportWebUSB = (
      await import('@ledgerhq/hw-transport-webusb')
    ).default;

    const transport = await TransportWebUSB.create();
    const RippleApp = (await import('@zondax/ledger-ripple')).default;
    const app = new RippleApp(transport);

    // 2. Get version (verify Ledger connection)
    const version = await app.getVersion();
    console.log('Ledger RippleApp version:', version);

    // 3. Derive public key from Ledger
    // BIP44 path: m/44'/144'/0'/0'/0' (XRP standard)
    const derivationPath = [44, 144, 0, 0, 0];
    const response = await app.getPublicKey(derivationPath);

    // 4. Convert Ledger public key to XRPL address
    const xrplPublicKey = response.publicKey.toString('hex').toUpperCase();
    xrplAddress = deriveXrplAddressFromPublicKey(xrplPublicKey);

    // 5. Store wallet info
    xrplWallet = {
      type: 'ledger',
      address: xrplAddress,
      publicKey: xrplPublicKey,
      derivationPath,
      app,
      transport,
      signTransaction: async (txBlob) => {
        // Sign on Ledger device
        const signResponse = await app.sign(
          derivationPath,
          Buffer.from(txBlob, 'hex')
        );
        return signResponse.signature.toString('hex').toUpperCase();
      }
    };

    return { success: true, address: xrplAddress };
  } catch (error) {
    console.error('Ledger connection failed:', error);
    return { success: false, error: error.message };
  }
}

// ============ Keypair Connection (Dev/Testing Only) ============

export async function connectKeypairWallet(seed) {
  try {
    // WARNING: Only for development/testing!
    // NEVER use with real funds
    
    if (!seed.startsWith('sEd')) {
      throw new Error('Invalid XRP seed format (must start with sEd or sEd)');
    }

    // Derive keypair & address from seed
    const wallet = Wallet.fromSeed(seed);
    xrplAddress = wallet.address;

    xrplWallet = {
      type: 'keypair',
      address: xrplAddress,
      privateKey: wallet.privateKey,
      publicKey: wallet.publicKey,
      wallet: wallet,
      signTransaction: async (txJson) => {
        // Sign locally (dangerous!)
        const signedTx = wallet.sign(txJson);
        return signedTx.tx_blob;
      }
    };

    return { success: true, address: xrplAddress };
  } catch (error) {
    console.error('Keypair connection failed:', error);
    return { success: false, error: error.message };
  }
}

// ============ Helper Functions ============

export function getXrplAddress() {
  return xrplAddress;
}

export function isXrplConnected() {
  return xrplAddress !== null;
}

export function getXrplWalletType() {
  return xrplWallet?.type || null;
}

function deriveXrplAddressFromPublicKey(publicKeyHex) {
  // Helper: convert Ledger public key → XRPL address
  const { Wallet } = require('xrpl');
  return Wallet.fromPublicKey(publicKeyHex).address;
}

// ============ Signing Functions ============

export async function signXrplTransaction(txJson) {
  if (!xrplWallet) {
    throw new Error('No XRPL wallet connected');
  }

  try {
    if (xrplWallet.type === 'xaman') {
      // Sign with Xaman
      const signRequest = await xrplWallet.xaman.signPayloadRequest({
        payload: txJson
      });
      return signRequest.resolved;
    } else if (xrplWallet.type === 'ledger') {
      // Sign with Ledger
      return await xrplWallet.signTransaction(txJson);
    } else if (xrplWallet.type === 'keypair') {
      // Sign with local keypair
      return await xrplWallet.signTransaction(txJson);
    }
  } catch (error) {
    console.error('Transaction signing failed:', error);
    throw error;
  }
}

// ============ Portfolio Fetch ============

export async function fetchXrpPortfolioData() {
  if (!isXrplConnected()) {
    throw new Error('XRP wallet not connected');
  }

  try {
    const response = await fetch(
      `/personal-account?xrplAddress=${encodeURIComponent(xrplAddress)}`
    );
    const data = await response.json();

    return {
      xrplAddress,
      personalAccount: data.personalAccount,
      nonce: data.nonce,
      fxrpBalance: data.fxrpBalance,
      executor: data.executor
    };
  } catch (error) {
    console.error('Failed to fetch XRP portfolio:', error);
    throw error;
  }
}
```

---

## 🌐 Part 2: Flare Wallet Connection

### 2.1 Libraries Required

```bash
npm install ethers@6.0.0 wagmi@2.0.0 @wagmi/core@2.0.0
```

**Library Overview:**
- `ethers.js` v6 — EVM interaction (contract calls, signing)
- `wagmi` — React hooks for wallet connection (optional, for React apps)
- For vanilla JS: use `ethers.js` directly + browser provider detection

### 2.2 Flare Wallet Connection Flow

```
User clicks "Connect Flare Wallet"
    ↓
Show wallet provider modal (MetaMask / Ledger / WalletConnect)
    ↓
[MetaMask Path]:
  - Call window.ethereum.request({ method: 'eth_requestAccounts' })
  - User confirms in MetaMask popup
  - Return Flare address (0x...)
  - Auto-switch to Flare network (chainId: 14)
  
[Ledger Path]:
  - Request Ledger transport
  - Derive EVM addresses (BIP44: m/44'/60'/0'/0/0)
  - Return address + signing capability
  
[WalletConnect Path]:
  - Show QR code
  - Scan with mobile wallet
  - Return address + WalletConnect session
    ↓
Store: { walletType, flareAddress, provider, signer }
    ↓
Fetch: GET /portfolio?flareAddress={address}
    ↓
Display: Flare balances, cross-chain positions
```

### 2.3 Flare Wallet Connection Code

```javascript
// wallet-flare.js

import { ethers } from 'ethers';

const FLARE_CHAIN_ID = 14;
const FLARE_RPC = 'https://flare-api.flare.network/ext/C/rpc';
const FLARE_NETWORK = {
  chainId: FLARE_CHAIN_ID,
  chainName: 'Flare Mainnet',
  rpcUrls: [FLARE_RPC],
  blockExplorerUrls: ['https://flare-explorer.flare.network'],
  nativeCurrency: { name: 'Flare', symbol: 'FLR', decimals: 18 }
};

// Coston2 testnet
const COSTON2_CHAIN_ID = 114;
const COSTON2_RPC = 'https://ctn2-api.flare.network/ext/C/rpc';
const COSTON2_NETWORK = {
  chainId: COSTON2_CHAIN_ID,
  chainName: 'Coston2 Testnet',
  rpcUrls: [COSTON2_RPC],
  blockExplorerUrls: ['https://ctn2-explorer.flare.network'],
  nativeCurrency: { name: 'Flare', symbol: 'FLR', decimals: 18 }
};

let flareProvider = null;
let flareSigner = null;
let flareAddress = null;
let flareChainId = null;

// Determine which network to use
const TARGET_NETWORK = process.env.VITE_FLARE_NETWORK === 'mainnet' 
  ? FLARE_NETWORK 
  : COSTON2_NETWORK;

// ============ Connection Management ============

export async function connectMetaMaskWallet() {
  try {
    // 1. Check if MetaMask is installed
    if (!window.ethereum) {
      throw new Error('MetaMask not installed. Download it at https://metamask.io');
    }

    // 2. Request account access
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts'
    });

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts found');
    }

    flareAddress = accounts[0];

    // 3. Create ethers provider from MetaMask
    flareProvider = new ethers.BrowserProvider(window.ethereum);
    flareSigner = await flareProvider.getSigner();

    // 4. Get current chain ID
    const network = await flareProvider.getNetwork();
    flareChainId = network.chainId;

    // 5. Check if connected to correct network
    if (flareChainId !== TARGET_NETWORK.chainId) {
      // Prompt user to switch network
      await switchFlareNetwork(TARGET_NETWORK.chainId);
    }

    // 6. Listen for account/chain changes
    setupMetaMaskListeners();

    return {
      success: true,
      address: flareAddress,
      chainId: flareChainId
    };
  } catch (error) {
    console.error('MetaMask connection failed:', error);
    return { success: false, error: error.message };
  }
}

export async function connectLedgerWalletFlare() {
  try {
    // For Ledger EVM (Flare is EVM-compatible)
    // This requires @ledgerhq/hw-transport-webusb
    
    const TransportWebUSB = (
      await import('@ledgerhq/hw-transport-webusb')
    ).default;

    const EthereumApp = (
      await import('@ledgerhq/hw-app-eth')
    ).default;

    const transport = await TransportWebUSB.create();
    const eth = new EthereumApp(transport);

    // Derive address from BIP44 path: m/44'/60'/0'/0/0 (Ethereum standard)
    const derivationPath = "m/44'/60'/0'/0/0";
    const { publicKey, chainCode } = await eth.getAddress(derivationPath, false);

    // Derive address from public key
    const address = deriveAddressFromPublicKey(publicKey);
    flareAddress = address;

    // Create provider for Ledger
    flareProvider = new ethers.JsonRpcProvider(TARGET_NETWORK.rpcUrls[0]);

    // Store Ledger signing capability
    flareSigner = {
      _signTransaction: async (tx) => {
        const signedTx = await eth.signTransaction(derivationPath, tx);
        return signedTx;
      },
      getAddress: async () => address,
      signMessage: async (message) => {
        return await eth.signMessage(derivationPath, message);
      }
    };

    return {
      success: true,
      address: flareAddress,
      chainId: TARGET_NETWORK.chainId
    };
  } catch (error) {
    console.error('Ledger Flare connection failed:', error);
    return { success: false, error: error.message };
  }
}

export async function connectWalletConnectWallet() {
  try {
    // For WalletConnect, use @walletconnect/web3modal
    // This example shows basic pattern
    
    const Web3Modal = (
      await import('@web3modal/ethers')
    ).Web3Modal;

    const web3modal = new Web3Modal({
      projectId: process.env.VITE_WALLETCONNECT_PROJECT_ID,
      chains: [TARGET_NETWORK],
      explorerRecommendedWalletIds: [
        'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
        '1ae92b26df02f0736f9f3c6dc6696f39c6cb41b825060dc5ac44b9b995926d63'  // Ledger Live
      ]
    });

    const connection = await web3modal.connect();
    const web3Provider = new ethers.BrowserProvider(connection);
    
    const signer = await web3Provider.getSigner();
    flareAddress = await signer.getAddress();
    flareProvider = web3Provider;
    flareSigner = signer;

    return {
      success: true,
      address: flareAddress,
      chainId: TARGET_NETWORK.chainId
    };
  } catch (error) {
    console.error('WalletConnect connection failed:', error);
    return { success: false, error: error.message };
  }
}

export async function disconnectFlare() {
  flareProvider = null;
  flareSigner = null;
  flareAddress = null;
  flareChainId = null;
}

// ============ Network Switching ============

export async function switchFlareNetwork(chainId) {
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${chainId.toString(16)}` }]
    });
  } catch (error) {
    if (error.code === 4902) {
      // Network not added, add it
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: `0x${TARGET_NETWORK.chainId.toString(16)}`,
            chainName: TARGET_NETWORK.chainName,
            rpcUrls: TARGET_NETWORK.rpcUrls,
            blockExplorerUrls: TARGET_NETWORK.blockExplorerUrls,
            nativeCurrency: TARGET_NETWORK.nativeCurrency
          }
        ]
      });
    } else {
      throw error;
    }
  }
}

// ============ Event Listeners ============

export function setupMetaMaskListeners() {
  if (!window.ethereum) return;

  // Listen for account changes
  window.ethereum.on('accountsChanged', (accounts) => {
    if (accounts.length === 0) {
      // User disconnected
      disconnectFlare();
      window.dispatchEvent(new CustomEvent('flareWalletDisconnected'));
    } else {
      flareAddress = accounts[0];
      window.dispatchEvent(new CustomEvent('flareAccountChanged', {
        detail: { address: flareAddress }
      }));
    }
  });

  // Listen for network changes
  window.ethereum.on('chainChanged', (chainId) => {
    flareChainId = parseInt(chainId, 16);
    if (flareChainId !== TARGET_NETWORK.chainId) {
      window.dispatchEvent(new CustomEvent('flareNetworkChanged', {
        detail: { chainId: flareChainId }
      }));
    }
  });
}

// ============ Helper Functions ============

export function getFlareAddress() {
  return flareAddress;
}

export function isFlareConnected() {
  return flareAddress !== null;
}

export function getFlareChainId() {
  return flareChainId;
}

function deriveAddressFromPublicKey(publicKeyHex) {
  const publicKeyBuffer = Buffer.from(publicKeyHex, 'hex');
  const keccak256 = ethers.keccak256(publicKeyBuffer);
  const address = '0x' + keccak256.slice(-40);
  return ethers.getAddress(address); // Checksum
}

// ============ Signing Functions ============

export async function signFlareTransaction(txData) {
  if (!flareSigner) {
    throw new Error('No Flare wallet connected');
  }

  try {
    const tx = await flareSigner.sendTransaction(txData);
    return tx.hash;
  } catch (error) {
    console.error('Transaction signing failed:', error);
    throw error;
  }
}

export async function signFlareMessage(message) {
  if (!flareSigner) {
    throw new Error('No Flare wallet connected');
  }

  try {
    const signature = await flareSigner.signMessage(message);
    return signature;
  } catch (error) {
    console.error('Message signing failed:', error);
    throw error;
  }
}

// ============ Portfolio Fetch ============

export async function fetchFlarePortfolioData() {
  if (!isFlareConnected()) {
    throw new Error('Flare wallet not connected');
  }

  try {
    const response = await fetch(
      `/portfolio?flareAddress=${encodeURIComponent(flareAddress)}`
    );
    const data = await response.json();

    return {
      flareAddress,
      ...data
    };
  } catch (error) {
    console.error('Failed to fetch Flare portfolio:', error);
    throw error;
  }
}

export async function fetchFxrpBalance() {
  if (!isFlareConnected()) {
    throw new Error('Flare wallet not connected');
  }

  try {
    const fxrpTokenAddress = '0x0b6A3645c240605887a5532109323A3E12273dc7'; // Coston2
    const fxrpAbi = [
      'function balanceOf(address owner) view returns (uint256)',
      'function decimals() view returns (uint8)'
    ];

    const contract = new ethers.Contract(
      fxrpTokenAddress,
      fxrpAbi,
      flareProvider
    );

    const balance = await contract.balanceOf(flareAddress);
    const decimals = await contract.decimals();

    return ethers.formatUnits(balance, decimals);
  } catch (error) {
    console.error('Failed to fetch FXRP balance:', error);
    throw error;
  }
}
```

---

## 🎨 Part 3: Portfolio.html Integration

### 3.1 HTML Structure Updates

Add to the header section of `portfolio.html`:

```html
<!-- Wallet Connection Section (Top Header) -->
<div class="flex items-center gap-2 absolute top-6 right-6">
  <!-- XRP Wallet Button -->
  <button id="connectXrpBtn" class="flex items-center gap-2 px-4 py-2 rounded-lg 
           bg-secondary-container/10 hover:bg-secondary-container/20 
           border border-secondary-container/50 transition-all">
    <span class="material-symbols-outlined text-base">account_balance_wallet</span>
    <span id="xrpStatus">Connect XRP</span>
  </button>

  <!-- Flare Wallet Button -->
  <button id="connectFlareBtn" class="flex items-center gap-2 px-4 py-2 rounded-lg 
           bg-primary-container/10 hover:bg-primary-container/20 
           border border-primary-container/50 transition-all">
    <span class="material-symbols-outlined text-base">account_balance_wallet</span>
    <span id="flareStatus">Connect Flare</span>
  </button>

  <!-- Disconnect Menu (appears when connected) -->
  <div id="walletMenu" class="relative hidden">
    <button id="walletMenuToggle" class="flex items-center gap-2 px-4 py-2 rounded-lg 
             bg-surface-container hover:bg-surface-container-high border border-outline-variant">
      <span id="connectedAddress" class="text-sm font-mono">0x...</span>
      <span class="material-symbols-outlined text-base">expand_more</span>
    </button>
    
    <!-- Dropdown Menu -->
    <div id="walletDropdown" class="absolute right-0 mt-2 w-48 rounded-lg 
         bg-surface-container border border-outline-variant hidden z-50">
      <button id="viewDetailsBtn" class="w-full px-4 py-2 text-left hover:bg-surface-container-high">
        View Wallet
      </button>
      <button id="switchWalletBtn" class="w-full px-4 py-2 text-left hover:bg-surface-container-high">
        Switch Wallet
      </button>
      <button id="disconnectBtn" class="w-full px-4 py-2 text-left hover:bg-surface-container-high text-error">
        Disconnect
      </button>
    </div>
  </div>
</div>

<!-- Wallet Selection Modal -->
<div id="walletModal" class="fixed inset-0 bg-black/50 hidden flex items-center justify-center z-50">
  <div class="bg-surface-container rounded-xl border border-outline-variant p-6 max-w-sm w-full mx-4">
    <h2 class="text-xl font-bold mb-4">Select Wallet</h2>
    
    <!-- XRP Wallets -->
    <div class="mb-6">
      <h3 class="text-sm font-semibold text-on-surface-variant mb-2">XRP Wallets</h3>
      <button class="w-full px-4 py-3 rounded-lg bg-surface-container-low hover:bg-surface-container-high 
               border border-outline-variant/50 text-left mb-2" data-wallet="xaman">
        <div class="font-semibold">Xaman</div>
        <div class="text-xs text-on-surface-variant">Mobile & browser</div>
      </button>
      <button class="w-full px-4 py-3 rounded-lg bg-surface-container-low hover:bg-surface-container-high 
               border border-outline-variant/50 text-left mb-2" data-wallet="ledger-xrp">
        <div class="font-semibold">Ledger</div>
        <div class="text-xs text-on-surface-variant">Hardware wallet</div>
      </button>
      <button class="w-full px-4 py-3 rounded-lg bg-surface-container-low hover:bg-surface-container-high 
               border border-outline-variant/50 text-left" data-wallet="keypair-xrp">
        <div class="font-semibold">Keypair (Dev Only)</div>
        <div class="text-xs text-on-surface-variant">Private key import</div>
      </button>
    </div>

    <!-- Flare Wallets -->
    <div>
      <h3 class="text-sm font-semibold text-on-surface-variant mb-2">Flare Wallets</h3>
      <button class="w-full px-4 py-3 rounded-lg bg-surface-container-low hover:bg-surface-container-high 
               border border-outline-variant/50 text-left mb-2" data-wallet="metamask">
        <div class="font-semibold">MetaMask</div>
        <div class="text-xs text-on-surface-variant">Browser extension</div>
      </button>
      <button class="w-full px-4 py-3 rounded-lg bg-surface-container-low hover:bg-surface-container-high 
               border border-outline-variant/50 text-left mb-2" data-wallet="ledger-evm">
        <div class="font-semibold">Ledger (EVM)</div>
        <div class="text-xs text-on-surface-variant">Hardware wallet</div>
      </button>
      <button class="w-full px-4 py-3 rounded-lg bg-surface-container-low hover:bg-surface-container-high 
               border border-outline-variant/50 text-left" data-wallet="walletconnect">
        <div class="font-semibold">WalletConnect</div>
        <div class="text-xs text-on-surface-variant">QR scan mobile</div>
      </button>
    </div>

    <button id="closeModalBtn" class="w-full mt-6 px-4 py-2 rounded-lg bg-surface-container-high text-on-surface">
      Cancel
    </button>
  </div>
</div>

<!-- Xaman QR Modal -->
<div id="xamanModal" class="fixed inset-0 bg-black/50 hidden flex items-center justify-center z-50">
  <div class="bg-surface-container rounded-xl border border-outline-variant p-6 max-w-sm w-full mx-4">
    <h2 class="text-xl font-bold mb-4">Scan with Xaman</h2>
    <div id="xamanQr" class="bg-surface-container-low p-4 rounded-lg mb-4"></div>
    <p class="text-sm text-on-surface-variant mb-4">
      Or <a id="xamanLink" href="#" target="_blank" class="text-primary hover:underline">open in Xaman</a>
    </p>
    <div class="text-center text-xs text-on-surface-variant">
      <span id="xamanTimeout">Waiting for authorization...</span>
    </div>
    <button id="closeXamanBtn" class="w-full mt-6 px-4 py-2 rounded-lg bg-surface-container-high text-on-surface">
      Cancel
    </button>
  </div>
</div>
```

### 3.2 JavaScript Event Handlers

Add to `portfolio.js`:

```javascript
// ============ Wallet Initialization ============

import {
  connectXamanWallet,
  connectLedgerWallet,
  connectKeypairWallet,
  disconnectXrpl,
  isXrplConnected,
  getXrplAddress,
  fetchXrpPortfolioData
} from './wallet-xrp.js';

import {
  connectMetaMaskWallet,
  connectLedgerWalletFlare,
  connectWalletConnectWallet,
  disconnectFlare,
  isFlareConnected,
  getFlareAddress,
  fetchFlarePortfolioData,
  fetchFxrpBalance
} from './wallet-flare.js';

// Wallet state
let connectedWallets = {
  xrp: null,
  flare: null
};

// ============ UI Updates ============

function updateWalletUI() {
  const xrpAddr = getXrplAddress();
  const flareAddr = getFlareAddress();

  // Update button text
  if (xrpAddr) {
    document.getElementById('xrpStatus').textContent = 
      `XRP: ${xrpAddr.substring(0, 6)}...${xrpAddr.substring(-4)}`;
    document.getElementById('connectXrpBtn').classList.add('bg-green-500/10', 'border-green-500/50');
  }

  if (flareAddr) {
    document.getElementById('flareStatus').textContent = 
      `Flare: ${flareAddr.substring(0, 6)}...${flareAddr.substring(-4)}`;
    document.getElementById('connectFlareBtn').classList.add('bg-blue-500/10', 'border-blue-500/50');
  }

  // Show/hide wallet menu
  if (xrpAddr || flareAddr) {
    document.getElementById('walletMenu').classList.remove('hidden');
    document.getElementById('connectedAddress').textContent = 
      xrpAddr || flareAddr;
  }
}

function updatePortfolioAfterConnection() {
  // Load portfolio data for connected wallets
  if (isXrplConnected()) {
    loadXrpPortfolio();
  }

  if (isFlareConnected()) {
    loadFlarePortfolio();
  }
}

// ============ Event Handlers ============

document.getElementById('connectXrpBtn').addEventListener('click', () => {
  showWalletModal('xrp');
});

document.getElementById('connectFlareBtn').addEventListener('click', () => {
  showWalletModal('flare');
});

// Wallet selection modal
document.querySelectorAll('[data-wallet]').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    const walletType = e.currentTarget.dataset.wallet;
    await handleWalletSelection(walletType);
  });
});

document.getElementById('closeModalBtn').addEventListener('click', () => {
  document.getElementById('walletModal').classList.add('hidden');
});

document.getElementById('closeXamanBtn').addEventListener('click', () => {
  document.getElementById('xamanModal').classList.add('hidden');
});

// Wallet menu
document.getElementById('walletMenuToggle').addEventListener('click', () => {
  const dropdown = document.getElementById('walletDropdown');
  dropdown.classList.toggle('hidden');
});

document.getElementById('disconnectBtn').addEventListener('click', async () => {
  if (isXrplConnected()) {
    await disconnectXrpl();
    document.getElementById('xrpStatus').textContent = 'Connect XRP';
  }
  if (isFlareConnected()) {
    await disconnectFlare();
    document.getElementById('flareStatus').textContent = 'Connect Flare';
  }
  updateWalletUI();
  document.getElementById('walletMenu').classList.add('hidden');
});

// ============ Connection Logic ============

function showWalletModal(type) {
  document.getElementById('walletModal').classList.remove('hidden');
  
  // Filter buttons by type
  document.querySelectorAll('[data-wallet]').forEach(btn => {
    const walletType = btn.dataset.wallet;
    const isXrp = walletType.includes('xrp') || ['xaman', 'ledger-xrp', 'keypair-xrp'].includes(walletType);
    const isFlare = walletType.includes('evm') || ['metamask', 'ledger-evm', 'walletconnect'].includes(walletType);
    
    if ((type === 'xrp' && isXrp) || (type === 'flare' && isFlare)) {
      btn.style.display = 'block';
    } else {
      btn.style.display = 'none';
    }
  });
}

async function handleWalletSelection(walletType) {
  try {
    showLoading('Connecting wallet...');
    
    let result;
    
    switch (walletType) {
      case 'xaman':
        result = await connectXamanWallet();
        if (result.success) {
          showXamanQrModal(result);
        }
        break;
      
      case 'ledger-xrp':
        result = await connectLedgerWallet();
        break;
      
      case 'keypair-xrp':
        const seed = prompt('Enter your XRP seed (dev only):');
        if (seed) {
          result = await connectKeypairWallet(seed);
        }
        break;
      
      case 'metamask':
        result = await connectMetaMaskWallet();
        break;
      
      case 'ledger-evm':
        result = await connectLedgerWalletFlare();
        break;
      
      case 'walletconnect':
        result = await connectWalletConnectWallet();
        break;
      
      default:
        throw new Error('Unknown wallet type');
    }

    if (result.success) {
      hideLoading();
      document.getElementById('walletModal').classList.add('hidden');
      updateWalletUI();
      updatePortfolioAfterConnection();
      showToast(`✓ Connected: ${result.address}`);
    } else {
      throw result.error;
    }
  } catch (error) {
    hideLoading();
    showError(`Connection failed: ${error.message}`);
  }
}

function showXamanQrModal(result) {
  // This would show QR code and wait for user to scan
  // Using a library like qrcode.js for rendering
  const xamanModal = document.getElementById('xamanModal');
  xamanModal.classList.remove('hidden');
  
  // Generate QR from result.qrUrl
  // displayQrCode(result.qrUrl);
}

// ============ Portfolio Loading ============

async function loadXrpPortfolio() {
  try {
    const portfolio = await fetchXrpPortfolioData();
    console.log('XRP Portfolio:', portfolio);
    // Update portfolio cards/tables with XRP data
  } catch (error) {
    showError(`Failed to load XRP portfolio: ${error.message}`);
  }
}

async function loadFlarePortfolio() {
  try {
    const portfolio = await fetchFlarePortfolioData();
    const fxrpBalance = await fetchFxrpBalance();
    
    console.log('Flare Portfolio:', { ...portfolio, fxrpBalance });
    // Update portfolio cards/tables with Flare data
  } catch (error) {
    showError(`Failed to load Flare portfolio: ${error.message}`);
  }
}

// ============ Startup ============

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize wallet listeners
  setupMetaMaskListeners();
  
  // Check if wallets were previously connected (from localStorage)
  const previousXrp = localStorage.getItem('connectedXrpWallet');
  const previousFlare = localStorage.getItem('connectedFlareWallet');
  
  // Optionally auto-reconnect
  // if (previousXrp) {
  //   await connectXamanWallet();
  // }
  // if (previousFlare) {
  //   await connectMetaMaskWallet();
  // }
});
```

---

## 🚀 Part 4: Implementation Steps

### Step 1: Install Dependencies
```bash
cd /workspaces/flareburn
npm install xrpl@2.4.0 xaman@0.5.0 ethers@6.0.0 qrcode@1.5.0
```

### Step 2: Create Wallet Modules
- Create `/public/wallet-xrp.js` (use code from Part 1)
- Create `/public/wallet-flare.js` (use code from Part 2)

### Step 3: Update portfolio.html
- Add wallet buttons to header (see Part 3.1)
- Add wallet modals

### Step 4: Update portfolio.js
- Import wallet modules (see Part 3.2)
- Add event handlers
- Add portfolio loading functions

### Step 5: Set Environment Variables
```bash
# .env.local
VITE_XAMAN_API_KEY=your_key
VITE_XAMAN_API_SECRET=your_secret
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
VITE_FLARE_NETWORK=testnet  # or mainnet
```

### Step 6: Test
```bash
npm run dev
# Navigate to portfolio.html
# Click "Connect XRP" or "Connect Flare"
# Verify wallet connection and data loading
```

---

## 🔐 Security Best Practices

### ✅ DO:
- **Use secure RPC endpoints** — Use official Flare RPC, not third-party
- **Validate addresses** — Check format before API calls
- **Use environment variables** — Never hardcode API keys
- **Sign with hardware wallets** — Ledger/Xaman for high-value txs
- **Cache carefully** — Don't cache private keys or seed phrases
- **Validate responses** — Verify API responses before displaying

### ❌ DON'T:
- **Store private keys** — Never in localStorage or cookies
- **Hardcode RPC URLs** — Use environment variables
- **Skip address validation** — Always validate XRPL/EVM addresses
- **Use keypair in production** — Only for testing/development
- **Display sensitive data** — Never log private keys/seeds

---

## 📋 Checklist

- [ ] Dependencies installed
- [ ] wallet-xrp.js created
- [ ] wallet-flare.js created
- [ ] portfolio.html updated with wallet buttons
- [ ] portfolio.js updated with event handlers
- [ ] Environment variables configured
- [ ] Tested XRP wallet connection
- [ ] Tested Flare wallet connection
- [ ] Portfolio data loads after connection
- [ ] Disconnect functionality works
- [ ] Error handling tested

---

## 🔗 Reference Links

- **XRPL.js**: https://js.xrpl.org/
- **Xaman SDK**: https://github.com/XRPL-Labs/XamanPkce
- **Ethers.js**: https://docs.ethers.org/v6/
- **Ledger Web USB**: https://github.com/LedgerHQ/ledger-web3-snap
- **MetaMask**: https://docs.metamask.io/
- **WalletConnect**: https://docs.walletconnect.com/

---

**Status**: 🚀 Ready for implementation!
