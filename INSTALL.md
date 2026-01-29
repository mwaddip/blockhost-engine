# Blockhost Monitor Installation Guide

This guide covers installing the Blockhost event monitor on a Debian/Ubuntu server.

## Prerequisites

- Debian 12+ or Ubuntu 22.04+
- Root access
- Network connectivity to Sepolia RPC endpoint

## Installation Steps

### 1. Install Node.js 20

```bash
# Install required packages
apt-get update
apt-get install -y ca-certificates curl gnupg

# Add NodeSource repository
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main' > /etc/apt/sources.list.d/nodesource.list

# Install Node.js
apt-get update
apt-get install -y nodejs

# Verify installation
node --version  # Should show v20.x.x
```

### 2. Create Directory Structure

```bash
mkdir -p /opt/blockhost/src/monitor /opt/blockhost/src/handlers
```

### 3. Copy Application Files

Copy the following files from the repository:

```
/opt/blockhost/
├── package.json
├── .env
├── start.sh
└── src/
    ├── monitor/
    │   └── index.ts
    └── handlers/
        └── index.ts
```

**package.json:**
```json
{
  "name": "blockhost-monitor",
  "version": "0.1.0",
  "description": "BlockhostSubscriptions event monitor",
  "type": "module",
  "scripts": {
    "monitor": "npx tsx src/monitor/index.ts"
  },
  "dependencies": {
    "ethers": "^6.9.0",
    "tsx": "^4.21.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### 4. Configure Environment

Create `/opt/blockhost/.env`:

```bash
SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com
BLOCKHOST_CONTRACT=0xYourContractAddressHere
```

### 5. Create Startup Script

Create `/opt/blockhost/start.sh`:

```bash
#!/bin/bash
cd /opt/blockhost
set -a
source .env
set +a
exec npx tsx src/monitor/index.ts
```

Make it executable:
```bash
chmod +x /opt/blockhost/start.sh
```

### 6. Install Dependencies

```bash
cd /opt/blockhost
npm install
```

### 7. Test Manual Startup

```bash
/opt/blockhost/start.sh
```

You should see:
```
==============================================
  BlockhostSubscriptions Event Monitor
==============================================
Contract: 0x...
RPC: https://ethereum-sepolia-rpc.publicnode.com
Poll Interval: 5000ms
----------------------------------------------

Connected to network: sepolia (chainId: 11155111)
Starting from block: XXXXXX

Polling for events...

Monitor is running. Press Ctrl+C to stop.
```

Press Ctrl+C to stop.

### 8. Configure Systemd Service

Create `/etc/systemd/system/blockhost-monitor.service`:

```ini
[Unit]
Description=Blockhost Subscriptions Event Monitor
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/blockhost
ExecStart=/opt/blockhost/start.sh
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### 9. Enable and Start Service

```bash
systemctl daemon-reload
systemctl enable blockhost-monitor
systemctl start blockhost-monitor
```

### 10. Verify Service Status

```bash
systemctl status blockhost-monitor
```

## Management Commands

```bash
# Check status
systemctl status blockhost-monitor

# View logs
journalctl -u blockhost-monitor -f

# Restart service
systemctl restart blockhost-monitor

# Stop service
systemctl stop blockhost-monitor

# Disable auto-start
systemctl disable blockhost-monitor
```

## Troubleshooting

### Service fails to start

1. Check logs: `journalctl -u blockhost-monitor -n 50`
2. Verify environment file exists: `cat /opt/blockhost/.env`
3. Test manual startup: `/opt/blockhost/start.sh`

### RPC connection errors

1. Verify network connectivity: `curl -I https://ethereum-sepolia-rpc.publicnode.com`
2. Try an alternative RPC endpoint in `.env`

### Missing dependencies

```bash
cd /opt/blockhost
npm install
```

## File Locations Summary

| File | Purpose |
|------|---------|
| `/opt/blockhost/.env` | Environment configuration |
| `/opt/blockhost/start.sh` | Startup script |
| `/opt/blockhost/src/monitor/index.ts` | Event monitor |
| `/opt/blockhost/src/handlers/index.ts` | Event handlers |
| `/etc/systemd/system/blockhost-monitor.service` | Systemd service |
