# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

blockhost-engine is the core component of a hosting subscription management system. It consists of:

1. **EVM Smart Contract** (Solidity) - Handles subscription purchases and extensions on-chain
2. **Monitor Server** (TypeScript) - Watches the smart contract for events and triggers actions
3. **Maintenance Scheduler** - Manages subscription lifecycle (suspend/destroy expired subscriptions)

Maintenance scripts will be provided by a submodule (not yet integrated).

## Build Commands

```bash
npm install              # Install dependencies
npm run compile          # Compile Solidity contracts
npm test                 # Run tests
npm run test:coverage    # Run tests with coverage
npm run node             # Start local Hardhat node
npm run deploy:local     # Deploy to local node
npm run clean            # Clean build artifacts
```

## Architecture

```
blockhost-engine/
├── contracts/           # Solidity smart contracts
│   ├── BlockhostSubscriptions.sol  # Main subscription contract
│   └── mocks/           # Mock contracts for testing
├── scripts/             # Deployment scripts
├── test/                # Contract tests
└── src/                 # TypeScript server source (planned)
    ├── monitor/         # Contract event monitoring
    ├── scheduler/       # Maintenance job scheduling
    └── actions/         # Actions triggered by events
```

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
