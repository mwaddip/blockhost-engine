# Blockhost Engine

Blockchain-based VM hosting subscription system. Users purchase subscriptions on-chain, which triggers automatic VM provisioning with NFT-based SSH authentication.

## How It Works

1. **User visits signup page** - Connects wallet, signs message, purchases subscription
2. **Smart contract emits event** - SubscriptionCreated with encrypted user data
3. **Monitor service detects event** - Triggers VM provisioning
4. **VM is created** - With web3-only SSH authentication (no passwords, no keys)
5. **NFT is minted** - Contains embedded signing page for authentication
6. **User authenticates** - Signs with wallet on VM's signing page, gets OTP, SSHs in

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Signup Page   │────▶│  Smart Contract  │────▶│  Monitor Svc    │
│   (static HTML) │     │  (Sepolia/ETH)   │     │  (TypeScript)   │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   User's VM     │◀────│  Proxmox Host    │◀────│  vm-generator   │
│   (web3 auth)   │     │  (Terraform)     │     │  (Python)       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## Components

| Component | Language | Description |
|-----------|----------|-------------|
| `contracts/` | Solidity | Subscription smart contract with NFT minting |
| `src/monitor/` | TypeScript | Blockchain event watcher |
| `src/handlers/` | TypeScript | Event handlers calling VM provisioning |
| `scripts/` | TS/Python/Bash | Deployment, signup page generation, server init |

## Prerequisites

- Node.js 18+
- Python 3.10+
- Proxmox VE 8+ with Terraform
- [proxmox-terraform](https://github.com/mwaddip/proxmox-terraform) for VM provisioning
- [libpam-web3](https://github.com/mwaddip/libpam-web3) for VM authentication

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/mwaddip/blockhost-engine.git
cd blockhost-engine
npm install
```

### 2. Configure environment

```bash
cp examples/env.example .env
# Edit .env with your deployer private key and RPC URL
```

### 3. Deploy contract (Sepolia testnet)

```bash
source .env
npm run deploy:sepolia
```

### 4. Initialize server

```bash
sudo ./scripts/init-server.sh
```

This creates:
- `/etc/blockhost/server.key` - Server private key for ECIES encryption
- `/etc/blockhost/blockhost.yaml` - Server configuration

### 5. Generate signup page

```bash
python3 scripts/generate-signup-page.py --output /var/www/signup.html
```

### 6. Start monitor service

```bash
npm run monitor
# Or use systemd: see examples/blockhost-monitor.service
```

## Smart Contract

**BlockhostSubscriptions.sol** handles:

- **Plans** - Subscription tiers with USD pricing (cents/day)
- **Subscriptions** - User subscriptions with expiration timestamps
- **Payments** - ERC20 tokens (USDC primary, others via Uniswap pricing)
- **NFT Minting** - Each subscription gets an NFT with embedded signing page

### Key Functions

```solidity
// Admin
createPlan(name, pricePerDayUsdCents)
setPrimaryStablecoin(tokenAddress)

// Users
buySubscription(planId, days, paymentMethodId, userEncrypted)
extendSubscription(subscriptionId, days, paymentMethodId)
cancelSubscription(subscriptionId)

// Queries
getSubscription(subscriptionId)
isSubscriptionActive(subscriptionId)
getExpiredSubscriptions(offset, limit)
```

## VM Authentication Flow

VMs use NFT-based web3 authentication instead of passwords or SSH keys:

1. VM serves signing page on port 8080 (fetched from NFT metadata)
2. User connects wallet that owns the NFT
3. User signs challenge message
4. Signing page displays 6-digit OTP
5. User SSHs to VM, enters OTP when prompted
6. PAM module verifies signature against NFT ownership

## Configuration Files

| File | Location | Purpose |
|------|----------|---------|
| `blockhost.yaml` | `/etc/blockhost/` | Server keypair, decrypt message |
| `web3-defaults.yaml` | `/etc/blockhost/` | Blockchain config (chain ID, contracts, RPC) |
| `vms.json` | `/var/lib/blockhost/` | VM database (IPs, VMIDs, expiry) |

## Development

```bash
# Compile contracts
npm run compile

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Start local Hardhat node
npm run node

# Deploy to local node
npm run deploy:local
```

## Project Structure

```
blockhost-engine/
├── contracts/                 # Solidity smart contracts
│   ├── BlockhostSubscriptions.sol
│   └── mocks/                 # Test mocks
├── scripts/                   # Deployment & utility scripts
│   ├── deploy.ts              # Contract deployment
│   ├── init-server.sh         # Server initialization
│   ├── generate-signup-page.py
│   └── signup-template.html
├── src/                       # TypeScript source
│   ├── monitor/               # Blockchain event monitor
│   └── handlers/              # Event handlers
├── test/                      # Contract tests
├── examples/                  # Deployment examples
│   ├── blockhost-monitor.service
│   └── env.example
└── PROJECT.yaml               # Machine-readable spec
```

## License

MIT

## Related Projects

- [proxmox-terraform](https://github.com/mwaddip/proxmox-terraform) - VM provisioning scripts
- [libpam-web3](https://github.com/mwaddip/libpam-web3) - PAM module for web3 authentication
