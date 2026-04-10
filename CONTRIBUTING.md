# Contributing to Igra KAS Bridge

Thank you for your interest in contributing. This guide covers the process for submitting changes.

## Getting Started

1. Fork the repository
2. Clone your fork and install dependencies:
   ```bash
   git clone https://github.com/<your-username>/igra-kas-bridge.git
   cd igra-kas-bridge
   npm install
   cp .env.example .env
   ```
3. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
4. Start the dev server:
   ```bash
   npm run dev
   ```

## Making Changes

- Keep changes focused — one concern per PR.
- Follow the existing code style (TypeScript strict mode, no unused locals).
- Run `npm run build` before submitting to ensure the project compiles cleanly.
- Test in the browser with both Galleon Testnet and Igra Mainnet modes.

## Commit Messages

Use clear, descriptive commit messages:

```
feat: add support for KasWare wallet
fix: correct UTXO selection when inputs exceed 10
docs: update testnet node setup instructions
```

## Pull Requests

1. Push your branch to your fork.
2. Open a PR against `main` on the upstream repository.
3. Describe **what** changed and **why**.
4. Link any related issues.

For significant changes (new features, architectural shifts), please open an issue first to discuss the approach.

## Reporting Bugs

Open a [GitHub issue](https://github.com/argonmining/igra-kas-bridge/issues) with:

- Browser and wallet extension version
- Network mode (testnet / mainnet)
- Steps to reproduce
- Console errors (if any)

## Security

If you find a security vulnerability, **do not open a public issue**. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.
