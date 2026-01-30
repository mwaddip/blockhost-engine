# Blockhost Installation Guide

This guide covers installing the Blockhost system on a Debian/Ubuntu server (tested on Proxmox VE host).

## Prerequisites

- Debian 12+ or Ubuntu 22.04+
- Root access
- Network connectivity to Sepolia RPC endpoint
- Proxmox VE (for VM provisioning)

## Installation Steps

### 1. Install Node.js 20 and Terraform

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

**Terraform:**
```bash
# Add HashiCorp repository
curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo 'deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com bookworm main' > /etc/apt/sources.list.d/hashicorp.list

# Install Terraform
apt-get update
apt-get install -y terraform

# Verify installation
terraform --version
```

**Foundry (for NFT minting):**
```bash
# Install foundryup
curl -L https://foundry.paradigm.xyz | bash

# Source the updated PATH (or start new shell)
source /root/.bashrc

# Install foundry tools
foundryup

# Verify installation
/root/.foundry/bin/cast --version
```

**libpam-web3 (for NFT ECIES encryption):**
```bash
# Install the libpam-web3 package (provides pam_web3_tool)
dpkg -i /path/to/libpam-web3_*.deb

# Generate server keypair for ECIES encryption
mkdir -p /etc/pam_web3
pam_web3_tool generate-keypair --output /etc/pam_web3/server.key

# Note the public key printed - add it to /etc/blockhost/web3.yaml:
#   server:
#     public_key: "04..."
```

### 2. Create Directory Structure

```bash
mkdir -p /opt/blockhost/src/monitor /opt/blockhost/src/handlers
mkdir -p /opt/blockhost/terraform
mkdir -p /opt/blockhost/proxmox-terraform
mkdir -p /etc/blockhost
mkdir -p /var/lib/blockhost
```

### 3. Copy Application Files

Copy the following files from the repository:

```
/opt/blockhost/
├── package.json              # Monitor dependencies
├── .env                      # Monitor environment (RPC, contract)
├── start.sh                  # Monitor startup script
├── src/
│   ├── monitor/
│   │   └── index.ts          # Event polling monitor
│   └── handlers/
│       └── index.ts          # Event handlers
├── terraform/                # Terraform working directory
│   ├── provider.tf.json      # Proxmox provider config
│   └── *.tf.json             # Generated VM configs
└── proxmox-terraform/        # VM provisioning scripts (from submodule)
    ├── scripts/
    │   ├── vm-generator.py   # VM creation
    │   ├── vm-gc.py          # Garbage collection
    │   ├── vm_db.py          # Database abstraction
    │   └── mint_nft.py       # NFT minting
    ├── config/
    │   ├── db.yaml           # Database/terraform config
    │   └── web3-defaults.yaml # Blockchain/NFT config
    ├── cloud-init/           # Cloud-init templates
    └── accounting/           # Mock database for testing

/etc/blockhost/               # Symlinks to configs
├── db.yaml -> /opt/blockhost/proxmox-terraform/config/db.yaml
├── web3.yaml -> /opt/blockhost/proxmox-terraform/config/web3-defaults.yaml
├── monitor.env -> /opt/blockhost/.env
└── deployer.key              # Deployer private key (chmod 600)

/var/lib/blockhost/
└── vms.json                  # VM database (created automatically)
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
| `/opt/blockhost/.env` | Monitor environment (RPC, contract address) |
| `/opt/blockhost/start.sh` | Monitor startup script |
| `/opt/blockhost/src/monitor/index.ts` | Event polling monitor |
| `/opt/blockhost/src/handlers/index.ts` | Event handlers |
| `/opt/blockhost/terraform/` | Terraform working directory |
| `/opt/blockhost/proxmox-terraform/scripts/` | VM provisioning scripts |
| `/etc/blockhost/db.yaml` | Database/terraform configuration |
| `/etc/blockhost/web3.yaml` | Blockchain/NFT configuration |
| `/etc/blockhost/deployer.key` | Deployer private key |
| `/var/lib/blockhost/vms.json` | VM database |
| `/etc/systemd/system/blockhost-monitor.service` | Systemd service |

## VM Provisioning

### Initialize Terraform

```bash
cd /opt/blockhost/terraform
terraform init
```

### Test VM Generator (mock mode)

```bash
cd /opt/blockhost/proxmox-terraform
python3 scripts/vm-generator.py test-vm --owner-wallet 0x... --mock --skip-mint
```

### Create a Real VM

```bash
cd /opt/blockhost/proxmox-terraform
python3 scripts/vm-generator.py myvm --owner-wallet 0x... --apply
```

### Garbage Collect Expired VMs

```bash
cd /opt/blockhost/proxmox-terraform
python3 scripts/vm-gc.py --execute --grace-days 3
```
