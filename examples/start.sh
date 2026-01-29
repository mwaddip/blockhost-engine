#!/bin/bash
cd /opt/blockhost
set -a
source .env
set +a
exec npx tsx src/monitor/index.ts
