#!/bin/bash
cd /opt/blockhost
set -a
source .env
set +a
# Add foundry to PATH for NFT minting
export PATH="/root/.foundry/bin:$PATH"
exec npx tsx src/monitor/index.ts
