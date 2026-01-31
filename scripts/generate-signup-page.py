#!/usr/bin/env python3
"""
Generate a static, self-contained signup page for Blockhost.

This script creates a standalone HTML file that:
- Connects to user's wallet (MetaMask, etc.)
- Prompts user to sign the decrypt message
- Encrypts the signature with the server's public key
- Submits the buySubscription transaction

Usage:
    python3 generate-signup-page.py [--output signup.html]
    python3 generate-signup-page.py --config /etc/blockhost/blockhost.yaml --output /var/www/signup.html
"""

import argparse
import os
import sys
import urllib.request
import yaml
from pathlib import Path

# Default paths
DEFAULT_CONFIG = "/etc/blockhost/blockhost.yaml"
DEFAULT_WEB3_CONFIG = "/etc/blockhost/web3-defaults.yaml"
DEFAULT_OUTPUT = "signup.html"

# Template location (relative to this script)
SCRIPT_DIR = Path(__file__).parent
TEMPLATE_FILE = SCRIPT_DIR / "signup-template.html"


def load_config(config_path: str, web3_config_path: str) -> dict:
    """Load configuration from YAML files."""
    config = {}

    # Load main blockhost config
    if os.path.exists(config_path):
        with open(config_path) as f:
            config.update(yaml.safe_load(f) or {})
    else:
        print(f"Warning: Config file not found: {config_path}")

    # Load web3 config
    if os.path.exists(web3_config_path):
        with open(web3_config_path) as f:
            web3_config = yaml.safe_load(f) or {}
            config.update(web3_config)
    else:
        print(f"Warning: Web3 config file not found: {web3_config_path}")

    return config


def fetch_library(url: str, name: str) -> str:
    """Fetch a JavaScript library from URL."""
    print(f"Fetching {name}...")
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            return response.read().decode('utf-8')
    except Exception as e:
        print(f"Error fetching {name}: {e}")
        sys.exit(1)


def generate_page(config: dict, template: str) -> str:
    """Generate the signup page by replacing placeholders."""

    # Required config values
    server_public_key = config.get('server_public_key', '')
    decrypt_message = config.get('decrypt_message', 'blockhost-access')

    # Web3 config (may be nested under 'blockchain')
    blockchain = config.get('blockchain', {})
    chain_id = blockchain.get('chain_id', config.get('chain_id', 11155111))
    rpc_url = blockchain.get('rpc_url', config.get('rpc_url', 'https://ethereum-sepolia-rpc.publicnode.com'))
    nft_contract = blockchain.get('nft_contract', config.get('nft_contract', ''))
    subscription_contract = blockchain.get('subscription_contract', config.get('subscription_contract', ''))
    usdc_address = blockchain.get('usdc_address', config.get('usdc_address', ''))

    # Theming (future expansion)
    page_title = config.get('page_title', 'Blockhost - Get Your Server')
    primary_color = config.get('primary_color', '#6366f1')

    if not server_public_key:
        print("Error: server_public_key not found in config. Run init-server.sh first.")
        sys.exit(1)

    # Replace placeholders
    replacements = {
        '{{SERVER_PUBLIC_KEY}}': server_public_key,
        '{{DECRYPT_MESSAGE}}': decrypt_message,
        '{{CHAIN_ID}}': str(chain_id),
        '{{RPC_URL}}': rpc_url,
        '{{NFT_CONTRACT}}': nft_contract,
        '{{SUBSCRIPTION_CONTRACT}}': subscription_contract,
        '{{USDC_ADDRESS}}': usdc_address,
        '{{PAGE_TITLE}}': page_title,
        '{{PRIMARY_COLOR}}': primary_color,
    }

    result = template
    for placeholder, value in replacements.items():
        result = result.replace(placeholder, value)

    return result


def main():
    parser = argparse.ArgumentParser(description='Generate Blockhost signup page')
    parser.add_argument('--config', default=DEFAULT_CONFIG,
                        help=f'Path to blockhost.yaml (default: {DEFAULT_CONFIG})')
    parser.add_argument('--web3-config', default=DEFAULT_WEB3_CONFIG,
                        help=f'Path to web3-defaults.yaml (default: {DEFAULT_WEB3_CONFIG})')
    parser.add_argument('--output', '-o', default=DEFAULT_OUTPUT,
                        help=f'Output HTML file (default: {DEFAULT_OUTPUT})')
    parser.add_argument('--template', default=str(TEMPLATE_FILE),
                        help=f'Template HTML file (default: {TEMPLATE_FILE})')
    args = parser.parse_args()

    # Load template
    template_path = Path(args.template)
    if not template_path.exists():
        print(f"Error: Template file not found: {template_path}")
        sys.exit(1)

    with open(template_path) as f:
        template = f.read()

    # Load config
    config = load_config(args.config, args.web3_config)

    # Generate page
    html = generate_page(config, template)

    # Write output
    output_path = Path(args.output)
    with open(output_path, 'w') as f:
        f.write(html)

    blockchain = config.get('blockchain', {})
    print(f"Generated: {output_path}")
    print(f"  Server public key: {config.get('server_public_key', 'NOT SET')[:20]}...")
    print(f"  Decrypt message: {config.get('decrypt_message', 'NOT SET')}")
    print(f"  Chain ID: {blockchain.get('chain_id', config.get('chain_id', 'NOT SET'))}")
    print(f"  Subscription contract: {blockchain.get('subscription_contract', 'NOT SET')}")


if __name__ == '__main__':
    main()
