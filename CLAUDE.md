# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## SPECIAL.md (HIGHEST PRIORITY)

**Read and internalize `SPECIAL.md` at the start of every session.** It defines the S.P.E.C.I.A.L. analytical bias system — per-component attention weights that affect how you approach code. Apply the matching component profile based on which files you're working on:

| Path pattern | Profile | Key biases |
|---|---|---|
| `src/root-agent/` | S8 P10 E7 C4 I8 A6 L7 | Security obsessive. Mirrors the root agent daemon. |
| `src/fund-manager/` | S8 P8 E8 C5 I7 A6 L9 | Money + timing = max edge case paranoia. |
| `src/bw/` | S8 P7 E6 C7 I6 A6 L7 | User-facing wallet ops. Funds at stake. |
| `src/ab/` | S6 P6 E5 C7 I6 A5 L5 | Simple CRUD. Don't overthink it. |
| everything else | S7 P7 E8 C5 I9 A7 L8 | Architectural discipline is survival. |

These stats override your default attention distribution. High stats (8+) mean obsessive focus on that dimension. See `SPECIAL.md` for full definitions.

## Rules

- **Documentation sync**: After completing any code change, check whether `README.md` or `CLAUDE.md` need updating to reflect the change. This includes new modules, changed APIs, new CLI commands, new configuration options, changed architecture, and new dependencies. Update the relevant docs before considering the task done.

## Project Overview

blockhost-engine is the core component of a hosting subscription management system. It consists of:

1. **EVM Smart Contract** (Solidity) - Handles subscription purchases and extensions on-chain
2. **Monitor Server** (TypeScript) - Watches the smart contract for events and triggers actions
3. **Maintenance Scheduler** - Manages subscription lifecycle (suspend/destroy expired subscriptions)
4. **Fund Manager** (TypeScript) - Automated fund withdrawal, revenue sharing, and gas management
5. **bw CLI** (TypeScript) - Scriptable wallet operations (`bw send`, `bw balance`, `bw withdraw`, `bw swap`, `bw split`)
6. **ab CLI** (TypeScript) - Addressbook management (`ab add`, `ab del`, `ab up`, `ab new`, `ab list`)
7. **Root Agent Client** (TypeScript) - Privilege separation client for the root agent daemon (iptables, key writes, addressbook saves)

VM provisioning is handled by the separate `blockhost-provisioner` package.
Shared configuration is provided by `blockhost-common`.

## Build Commands

```bash
npm install              # Install dependencies
npm run compile          # Compile Solidity contracts
npm test                 # Run tests
npm run test:coverage    # Run tests with coverage
npm run node             # Start local Hardhat node
npm run deploy:local     # Deploy to local node
npm run deploy:sepolia   # Deploy to Sepolia testnet
npm run monitor          # Run event monitor
npm run clean            # Clean build artifacts
```

## Environment Setup

Source the shared environment file before running deploy or monitor:
```bash
source ~/projects/sharedenv/blockhost.env
```

## Architecture

```
blockhost-engine/
├── contracts/           # Solidity smart contracts
│   ├── BlockhostSubscriptions.sol  # Main subscription contract
│   └── mocks/           # Mock contracts for testing
├── scripts/             # Deployment and test scripts
├── test/                # Contract tests
├── src/                 # TypeScript server source
│   ├── monitor/         # Contract event polling & processing
│   ├── handlers/        # Event handlers (calls blockhost-provisioner scripts)
│   ├── admin/           # On-chain admin commands (ECIES-encrypted, anti-replay)
│   ├── reconcile/       # Periodic NFT state reconciliation
│   ├── fund-manager/    # Automated fund withdrawal, distribution & gas management
│   ├── bw/              # blockwallet CLI (send, balance, withdraw, swap, split)
│   ├── ab/              # addressbook CLI (add, del, up, new, list)
│   └── root-agent/      # Root agent client (Unix socket, privilege separation)
└── examples/            # Deployment examples (systemd, env, config)
```

### VM Naming Convention

VMs are named based on subscription ID: `blockhost-001`, `blockhost-042`, etc. (3-digit zero-padded).

## Smart Contract (BlockhostSubscriptions.sol)

### Key Concepts

- **Plans**: Subscription tiers with USD-denominated pricing (in cents per day)
- **Subscriptions**: User subscriptions with expiration timestamps
- **Payment Methods**: Accepted ERC20 tokens with Chainlink price feeds for USD conversion

### Payment Methods

**Primary Stablecoin (ID 1)**: Direct USD payment, no conversion needed
- Set via `setPrimaryStablecoin(address)`
- Simple calculation: `amount = priceUsdCents * days * 10^decimals / 100`
- No slippage, no liquidity requirements

**Other Tokens (ID 2+)**: Price derived from Uniswap V2 pairs
- Added via `addPaymentMethod(tokenAddress, pairAddress, stablecoinAddress)`
- Uses constant product formula: `tokenAmount = (totalUsdCost * tokenReserve) / stablecoinReserve`
- 1% slippage buffer (configurable)
- $10k minimum liquidity requirement (configurable)

### Events (for server monitoring)

- `PlanCreated`, `PlanUpdated` - Plan lifecycle
- `SubscriptionCreated`, `SubscriptionExtended`, `SubscriptionCancelled` - Subscription lifecycle
- `PaymentMethodAdded`, `PaymentMethodUpdated` - Payment configuration

### Server Helper Functions

- `getExpiredSubscriptions(offset, limit)` - For cleanup scripts
- `getSubscriptionsExpiringSoon(withinSeconds, offset, limit)` - For warning notifications
- `getSubscriptionsBySubscriber(address)` - User subscription lookup
- `isSubscriptionActive(subscriptionId)` - Quick status check

### Security Features

- ReentrancyGuard on payment functions
- Minimum liquidity requirement for Uniswap pairs (configurable, default $10k)
- SafeERC20 for token transfers
- Owner-only administrative functions
- Slippage buffer on payments (configurable, default 1%)

## Fund Manager

Integrated into the monitor polling loop. Runs two periodic tasks:

### Fund Cycle (every 24h, configurable)

1. **Withdraw** — For each payment method token with balance > $50, call `withdrawFunds()` to move tokens from contract to hot wallet
2. **Hot wallet gas** — Server sends ETH to hot wallet if below `hot_wallet_gas_eth` (default 0.01 ETH)
3. **Server stablecoin buffer** — Hot wallet sends stablecoin to server if below `server_stablecoin_buffer_usd` (default $50)
4. **Revenue shares** — If enabled in `revenue-share.json`, distribute configured % to dev/broker
5. **Remainder to admin** — Send all remaining hot wallet token balances to admin

### Gas Check (every 30min, configurable)

- Top up hot wallet ETH from server if below threshold
- Check server wallet ETH balance; if below `gas_low_threshold_usd` ($5), swap USDC→ETH via Uniswap V2

### Hot Wallet

Auto-generated on first fund cycle if not in addressbook. Private key saved to `/etc/blockhost/hot.key` (chmod 600). Acts as an intermediary for distribution — contract funds flow through it before going to recipients.

### Configuration

**`/etc/blockhost/blockhost.yaml`** — under `fund_manager:` key:

| Setting | Default | Description |
|---|---|---|
| `fund_cycle_interval_hours` | 24 | Hours between fund cycles |
| `gas_check_interval_minutes` | 30 | Minutes between gas checks |
| `min_withdrawal_usd` | 50 | Minimum USD value to trigger withdrawal |
| `gas_low_threshold_usd` | 5 | Server ETH balance (in USD) that triggers a swap |
| `gas_swap_amount_usd` | 20 | USDC amount to swap for ETH |
| `server_stablecoin_buffer_usd` | 50 | Target stablecoin balance for server wallet |
| `hot_wallet_gas_eth` | 0.01 | Target ETH balance for hot wallet |

**`/etc/blockhost/addressbook.json`** — role-to-wallet mapping (written by installer):

```json
{
  "admin":  { "address": "0x..." },
  "server": { "address": "0x...", "keyfile": "/etc/blockhost/deployer.key" },
  "dev":    { "address": "0x..." },
  "broker": { "address": "0x..." }
}
```

Entries with `keyfile` can sign transactions. The `hot` entry is auto-added on first launch.

**`/etc/blockhost/revenue-share.json`** — revenue sharing config:

```json
{
  "enabled": true,
  "total_percent": 1.0,
  "recipients": [
    { "role": "dev", "percent": 0.5 },
    { "role": "broker", "percent": 0.5 }
  ]
}
```

`recipients[].role` maps to addressbook keys (never contains addresses directly).

## bw (blockwallet) CLI

Standalone CLI for scriptable wallet operations. Uses the same `SEPOLIA_RPC` and `BLOCKHOST_CONTRACT` env vars as the monitor.

```bash
bw send <amount> <token> <from> <to>       # Send tokens between wallets
bw balance <role> [token]                   # Show wallet balances
bw split <amount> <token> <ratios> <from> <to1> <to2> ...  # Split tokens
bw withdraw [token] <to>                    # Withdraw from contract
bw swap <amount> <from-token> eth <wallet>  # Swap token for ETH via Uniswap V2
```

- **Token shortcuts**: `eth` (native), `stable` (contract's primary stablecoin), or `0x` address
- **Roles**: `admin`, `server`, `hot`, `dev`, `broker` (resolved from addressbook.json)
- **Signing**: Only roles with `keyfile` in addressbook can be used as `<from>`/`<wallet>`

The fund-manager module imports `executeSend()`, `executeWithdraw()`, and `executeSwap()` from the bw command modules directly — all wallet operations flow through the same code paths.

## ab (addressbook) CLI

Standalone CLI for managing wallet entries in `/etc/blockhost/addressbook.json`. No RPC or contract env vars required — purely local filesystem operations.

```bash
ab add <name> <0xaddress>    # Add new entry
ab del <name>                # Delete entry
ab up <name> <0xaddress>     # Update entry's address
ab new <name>                # Generate new wallet, save key, add to addressbook
ab list                      # Show all entries
```

- **Immutable roles**: `server`, `admin`, `hot`, `dev`, `broker` — cannot be added, deleted, updated, or generated via `ab`
- **`ab new`**: Generates a keypair, saves private key to `/etc/blockhost/<name>.key` (chmod 600), same pattern as hot wallet generation
- **`ab up`**: Only changes the address; preserves existing `keyfile` if present
- **`ab del`**: Removes the entry from JSON but does NOT delete the keyfile (if any)

## Privilege Separation (Root Agent)

The monitor and CLIs run as the unprivileged `blockhost` user. Privileged operations are delegated to a root agent daemon (from `blockhost-common`) via Unix socket at `/run/blockhost/root-agent.sock`.

### Protocol

Length-prefixed JSON: 4-byte big-endian length + JSON payload (both directions).
- Request: `{"action": "action-name", "params": {...}}`
- Response: `{"ok": true, ...}` or `{"ok": false, "error": "reason"}`

### Client (`src/root-agent/client.ts`)

- `callRootAgent(action, params, timeout)` — generic call
- `iptablesOpen(port, proto?, comment?)` / `iptablesClose(...)` — firewall rules (used by knock handler)
- `generateWallet(name)` — key generation + addressbook update (used by fund-manager hot wallet, `ab new`)
- `addressbookSave(entries)` — write addressbook.json (used by `ab add/del/up`, fund-manager)
- `qmStart(vmid)` — start a Proxmox VM

### What does NOT go through the root agent

- Reading keyfiles and addressbook.json — works via group permission (`blockhost` group, mode 0640)
- ECIES decryption (`pam_web3_tool`) — `blockhost` user can read `server.key` via group permission
- VM provisioning scripts — provisioner runs as `blockhost`
- Process checks (`pgrep`) — no privilege needed
