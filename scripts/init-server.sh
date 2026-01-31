#!/bin/bash
# Blockhost Server Initialization Script
# Generates server keypair, deployer keypair, and creates initial configuration
#
# Usage: sudo ./scripts/init-server.sh [options]

set -euo pipefail

# Configuration
CONFIG_DIR="/etc/blockhost"
DATA_DIR="/var/lib/blockhost"
TERRAFORM_DIR="/opt/blockhost/terraform"
PROXMOX_TERRAFORM_DIR="/opt/blockhost/proxmox-terraform"

SERVER_KEY_FILE="${CONFIG_DIR}/server.key"
DEPLOYER_KEY_FILE="${CONFIG_DIR}/deployer.key"
CONFIG_FILE="${CONFIG_DIR}/blockhost.yaml"
WEB3_CONFIG_FILE="${CONFIG_DIR}/web3-defaults.yaml"

# Defaults (can be overridden via arguments)
DECRYPT_MESSAGE="blockhost-access"
DEPLOYER_KEY=""
CHAIN_ID="11155111"
RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --decrypt-message)
            DECRYPT_MESSAGE="$2"
            shift 2
            ;;
        --deployer-key)
            DEPLOYER_KEY="$2"
            shift 2
            ;;
        --deployer-key-file)
            DEPLOYER_KEY=$(cat "$2")
            shift 2
            ;;
        --chain-id)
            CHAIN_ID="$2"
            shift 2
            ;;
        --rpc-url)
            RPC_URL="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --decrypt-message MSG   Static message users sign to derive encryption key"
            echo "                          Default: \"blockhost-access\""
            echo "  --deployer-key KEY      Existing deployer private key (hex, with or without 0x)"
            echo "  --deployer-key-file F   Read deployer private key from file"
            echo "  --chain-id ID           Blockchain chain ID (default: 11155111 for Sepolia)"
            echo "  --rpc-url URL           JSON-RPC endpoint URL"
            echo "                          Default: https://ethereum-sepolia-rpc.publicnode.com"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Check root
if [[ $EUID -ne 0 ]]; then
    echo "Error: This script must be run as root"
    exit 1
fi

# Check pam_web3_tool is available
if ! command -v pam_web3_tool &> /dev/null; then
    echo "Error: pam_web3_tool not found. Install libpam-web3-tools package."
    exit 1
fi

# Check cast (foundry) is available for address derivation
if ! command -v cast &> /dev/null; then
    echo "Error: cast not found. Install foundry: curl -L https://foundry.paradigm.xyz | bash"
    exit 1
fi

echo "========================================"
echo "  Blockhost Server Initialization"
echo "========================================"
echo ""

# Create directories
echo "Creating directories..."
mkdir -p "${CONFIG_DIR}"
mkdir -p "${DATA_DIR}"
mkdir -p "${TERRAFORM_DIR}"
mkdir -p "${PROXMOX_TERRAFORM_DIR}"

# Check if already initialized
if [[ -f "${SERVER_KEY_FILE}" ]]; then
    echo ""
    echo "WARNING: Server keypair already exists at ${SERVER_KEY_FILE}"
    read -p "Regenerate keypair? This will invalidate existing encrypted data. [y/N] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Keeping existing keypair."

        # Still show the public key
        SERVER_PRIVATE_KEY=$(cat "${SERVER_KEY_FILE}")
        SERVER_PUBLIC_KEY=$(pam_web3_tool derive-pubkey --private-key "${SERVER_PRIVATE_KEY}" | grep -oP '(?<=hex\): ).*')

        # Show deployer address if it exists
        if [[ -f "${DEPLOYER_KEY_FILE}" ]]; then
            DEPLOYER_PRIVATE_KEY=$(cat "${DEPLOYER_KEY_FILE}")
            DEPLOYER_ADDRESS=$(cast wallet address --private-key "0x${DEPLOYER_PRIVATE_KEY}")
        fi

        echo ""
        echo "========================================"
        echo "  Existing Configuration"
        echo "========================================"
        echo ""
        echo "Server public key:"
        echo "${SERVER_PUBLIC_KEY}"
        if [[ -n "${DEPLOYER_ADDRESS:-}" ]]; then
            echo ""
            echo "Deployer wallet address:"
            echo "${DEPLOYER_ADDRESS}"
        fi
        echo ""
        exit 0
    fi
fi

# Generate server keypair
echo "Generating server secp256k1 keypair..."
SERVER_PRIVATE_KEY=$(pam_web3_tool generate-keypair | grep -oP '(?<=hex\): ).*')

# Save server private key (restricted permissions)
echo "${SERVER_PRIVATE_KEY}" > "${SERVER_KEY_FILE}"
chmod 600 "${SERVER_KEY_FILE}"
echo "Server private key saved to: ${SERVER_KEY_FILE}"

# Derive server public key
SERVER_PUBLIC_KEY=$(pam_web3_tool derive-pubkey --private-key "${SERVER_PRIVATE_KEY}" | grep -oP '(?<=hex\): ).*')

# Generate or use provided deployer keypair
if [[ -n "${DEPLOYER_KEY}" ]]; then
    echo "Using provided deployer key..."
    # Strip 0x prefix if present
    DEPLOYER_PRIVATE_KEY="${DEPLOYER_KEY#0x}"
else
    echo "Generating deployer keypair..."
    DEPLOYER_PRIVATE_KEY=$(pam_web3_tool generate-keypair | grep -oP '(?<=hex\): ).*')
fi

# Save deployer private key (restricted permissions)
echo "${DEPLOYER_PRIVATE_KEY}" > "${DEPLOYER_KEY_FILE}"
chmod 600 "${DEPLOYER_KEY_FILE}"
echo "Deployer private key saved to: ${DEPLOYER_KEY_FILE}"

# Derive deployer address using cast
DEPLOYER_ADDRESS=$(cast wallet address --private-key "0x${DEPLOYER_PRIVATE_KEY}")

# Create/update main config file
echo "Creating configuration..."
cat > "${CONFIG_FILE}" << EOF
# Blockhost Server Configuration
# Generated by init-server.sh on $(date -Iseconds)

# Static message users sign to derive their encryption key
# This must match what the signup page displays
decrypt_message: "${DECRYPT_MESSAGE}"

# Server public key (for reference - signup page needs this)
# Private key is stored in: ${SERVER_KEY_FILE}
server_public_key: "${SERVER_PUBLIC_KEY}"

# Deployer wallet address (fund this with ETH for gas)
# Private key is stored in: ${DEPLOYER_KEY_FILE}
deployer_address: "${DEPLOYER_ADDRESS}"

# Contract address (set after deployment)
# Run: blockhost-deploy --network sepolia
# Or set manually if using existing contract
contract_address: ""
EOF

chmod 644 "${CONFIG_FILE}"
echo "Configuration saved to: ${CONFIG_FILE}"

# Create web3-defaults.yaml
echo "Creating web3 configuration..."
cat > "${WEB3_CONFIG_FILE}" << EOF
# Blockhost Web3 Configuration
# Generated by init-server.sh on $(date -Iseconds)

blockchain:
  # Ethereum chain ID (1=mainnet, 11155111=sepolia)
  chain_id: ${CHAIN_ID}

  # NFT contract address (same as subscription contract)
  # Set after deployment
  nft_contract: ""

  # JSON-RPC endpoint
  rpc_url: "${RPC_URL}"

# Contract deployer (for minting NFTs)
deployer:
  private_key_file: "${DEPLOYER_KEY_FILE}"

# OTP settings for VM authentication
auth:
  otp_length: 6
  otp_ttl_seconds: 300

# Signing page settings
signing_page:
  port: 8080
EOF

chmod 644 "${WEB3_CONFIG_FILE}"
echo "Web3 configuration saved to: ${WEB3_CONFIG_FILE}"

# Initialize empty VM database if it doesn't exist
DB_FILE="${DATA_DIR}/vms.json"
if [[ ! -f "${DB_FILE}" ]]; then
    echo "Initializing VM database..."
    cat > "${DB_FILE}" << EOF
{
  "vms": {},
  "next_vmid": 100,
  "next_nft_token_id": 0,
  "allocated_ips": []
}
EOF
    chmod 644 "${DB_FILE}"
    echo "VM database created: ${DB_FILE}"
fi

echo ""
echo "========================================"
echo "  Initialization Complete"
echo "========================================"
echo ""
echo "Server Public Key (for signup page encryption):"
echo "${SERVER_PUBLIC_KEY}"
echo ""
echo "Deployer Wallet Address:"
echo "${DEPLOYER_ADDRESS}"
echo ""
echo "Decrypt Message:"
echo "${DECRYPT_MESSAGE}"
echo ""
echo "Chain ID: ${CHAIN_ID}"
echo "RPC URL: ${RPC_URL}"
echo ""
echo "Files created:"
echo "  - ${SERVER_KEY_FILE} (chmod 600)"
echo "  - ${DEPLOYER_KEY_FILE} (chmod 600)"
echo "  - ${CONFIG_FILE}"
echo "  - ${WEB3_CONFIG_FILE}"
echo "  - ${DB_FILE}"
echo ""
echo "========================================"
echo "  Next Steps"
echo "========================================"
echo ""
echo "1. Fund the deployer wallet with ETH for gas:"
echo "   ${DEPLOYER_ADDRESS}"
echo ""
echo "2. Deploy the contract:"
echo "   blockhost-deploy --network sepolia"
echo ""
echo "3. Generate the signup page:"
echo "   blockhost-generate-signup --output /var/www/html/signup.html"
echo ""
echo "4. Start the monitor service:"
echo "   systemctl enable --now blockhost-monitor"
echo ""
