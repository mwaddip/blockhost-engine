#!/bin/bash
# Build blockhost-engine .deb package
set -e

VERSION="0.1.0"
PKG_NAME="blockhost-engine_${VERSION}_all"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PKG_DIR="$SCRIPT_DIR/$PKG_NAME"

echo "Building blockhost-engine v${VERSION}..."

# Clean and recreate package directory
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR"/{DEBIAN,usr/bin,usr/share/blockhost/contracts,opt/blockhost/src/monitor,opt/blockhost/src/handlers,opt/blockhost/contracts/mocks,opt/blockhost/scripts,lib/systemd/system}

# ============================================
# Compile Solidity contracts with Foundry
# ============================================
echo "Compiling Solidity contracts..."

FORGE_BUILD_DIR="$SCRIPT_DIR/.forge-build"
COMPILED_ARTIFACT=""

if command -v forge &> /dev/null; then
    echo "Found forge: $(forge --version | head -1)"

    # Create temporary forge project
    rm -rf "$FORGE_BUILD_DIR"
    mkdir -p "$FORGE_BUILD_DIR/src"

    # Copy contract source
    cp "$PROJECT_DIR/contracts/BlockhostSubscriptions.sol" "$FORGE_BUILD_DIR/src/"

    # Create foundry.toml
    cat > "$FORGE_BUILD_DIR/foundry.toml" << 'TOML'
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.20"
optimizer = true
optimizer_runs = 200
TOML

    # Install OpenZeppelin contracts dependency
    echo "Installing OpenZeppelin contracts..."
    (cd "$FORGE_BUILD_DIR" && forge install OpenZeppelin/openzeppelin-contracts --no-commit 2>/dev/null) || {
        echo "Warning: Could not install OpenZeppelin via forge, trying alternative..."
        mkdir -p "$FORGE_BUILD_DIR/lib"
        git clone --depth 1 https://github.com/OpenZeppelin/openzeppelin-contracts "$FORGE_BUILD_DIR/lib/openzeppelin-contracts" 2>/dev/null || {
            echo "Error: Could not install OpenZeppelin contracts"
            exit 1
        }
    }

    # Create remappings
    echo "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/" > "$FORGE_BUILD_DIR/remappings.txt"

    # Compile
    echo "Running forge build..."
    (cd "$FORGE_BUILD_DIR" && forge build) || {
        echo "Error: forge build failed"
        exit 1
    }

    # Check for compiled artifact
    COMPILED_ARTIFACT="$FORGE_BUILD_DIR/out/BlockhostSubscriptions.sol/BlockhostSubscriptions.json"
    if [ -f "$COMPILED_ARTIFACT" ]; then
        echo "Contract compiled successfully: $COMPILED_ARTIFACT"
        cp "$COMPILED_ARTIFACT" "$PKG_DIR/usr/share/blockhost/contracts/"
        echo "Copied compiled artifact to package"
    else
        echo "Warning: Compiled artifact not found at expected path"
        ls -la "$FORGE_BUILD_DIR/out/" 2>/dev/null || true
    fi

    # Cleanup forge build directory
    rm -rf "$FORGE_BUILD_DIR"
else
    echo "WARNING: forge not found. Contract will not be pre-compiled."
    echo "         Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"
    echo "         The contract source will still be included for manual compilation."
fi

# ============================================
# Create DEBIAN control files
# ============================================

# Create DEBIAN/control
cat > "$PKG_DIR/DEBIAN/control" << EOF
Package: blockhost-engine
Version: ${VERSION}
Section: admin
Priority: optional
Architecture: all
Depends: blockhost-common (>= 0.1.0), libpam-web3-tools (>= 0.5.0), nodejs (>= 18), python3 (>= 3.10)
Recommends: blockhost-provisioner (>= 0.1.0)
Maintainer: Blockhost <admin@blockhost.io>
Description: Blockchain-based VM hosting subscription engine
 Blockhost Engine provides the core subscription management system:
 - Smart contract deployment (BlockhostSubscriptions + AccessCredentialNFT)
 - Blockchain event monitor service
 - Event handlers for VM provisioning
 - Server initialization and signup page generation
 .
 This package monitors blockchain events and triggers VM provisioning
 via the blockhost-provisioner package.
EOF

# Create DEBIAN/postinst
cat > "$PKG_DIR/DEBIAN/postinst" << 'EOF'
#!/bin/bash
set -e

case "$1" in
    configure)
        echo "Installing Node.js dependencies..."
        cd /opt/blockhost
        npm install --production 2>/dev/null || npm install 2>/dev/null || {
            echo "Warning: npm install failed. Run manually: cd /opt/blockhost && npm install"
        }

        if [ -d /run/systemd/system ]; then
            systemctl daemon-reload || true
        fi

        echo ""
        echo "=========================================="
        echo "  blockhost-engine installed successfully"
        echo "=========================================="
        echo ""
        echo "Next steps:"
        echo "1. Run: sudo blockhost-init"
        echo "2. Fund the deployer wallet with ETH"
        echo "3. Deploy contracts from /opt/blockhost"
        echo "4. Run: sudo systemctl enable --now blockhost-monitor"
        echo ""
        ;;
esac
exit 0
EOF

# Create DEBIAN/prerm
cat > "$PKG_DIR/DEBIAN/prerm" << 'EOF'
#!/bin/bash
set -e
case "$1" in
    remove|upgrade|deconfigure)
        if [ -d /run/systemd/system ]; then
            systemctl stop blockhost-monitor 2>/dev/null || true
            systemctl disable blockhost-monitor 2>/dev/null || true
        fi
        ;;
esac
exit 0
EOF

# Create DEBIAN/postrm
cat > "$PKG_DIR/DEBIAN/postrm" << 'EOF'
#!/bin/bash
set -e
case "$1" in
    purge)
        rm -rf /opt/blockhost/node_modules 2>/dev/null || true
        rm -f /opt/blockhost/.env 2>/dev/null || true
        ;;
esac
if [ -d /run/systemd/system ]; then
    systemctl daemon-reload || true
fi
exit 0
EOF

chmod 755 "$PKG_DIR/DEBIAN/postinst" "$PKG_DIR/DEBIAN/prerm" "$PKG_DIR/DEBIAN/postrm"

# ============================================
# Copy application files
# ============================================
echo "Copying files..."

# Bin scripts
cp "$PROJECT_DIR/scripts/init-server.sh" "$PKG_DIR/usr/bin/blockhost-init"
cp "$PROJECT_DIR/scripts/generate-signup-page.py" "$PKG_DIR/usr/bin/blockhost-generate-signup"
chmod 755 "$PKG_DIR/usr/bin/"*

# Application files
cp "$PROJECT_DIR/package.json" "$PROJECT_DIR/package-lock.json" "$PKG_DIR/opt/blockhost/"
cp "$PROJECT_DIR/tsconfig.json" "$PROJECT_DIR/hardhat.config.ts" "$PKG_DIR/opt/blockhost/"
cp "$PROJECT_DIR/src/monitor/index.ts" "$PKG_DIR/opt/blockhost/src/monitor/"
cp "$PROJECT_DIR/src/handlers/index.ts" "$PKG_DIR/opt/blockhost/src/handlers/"
cp "$PROJECT_DIR/scripts/deploy.ts" "$PROJECT_DIR/scripts/create-plan.ts" "$PKG_DIR/opt/blockhost/scripts/"
cp "$PROJECT_DIR/examples/start.sh" "$PKG_DIR/opt/blockhost/"
chmod 755 "$PKG_DIR/opt/blockhost/start.sh"

# Contract sources (for reference/recompilation)
cp "$PROJECT_DIR/contracts/BlockhostSubscriptions.sol" "$PKG_DIR/opt/blockhost/contracts/"
cp "$PROJECT_DIR/contracts/mocks/"*.sol "$PKG_DIR/opt/blockhost/contracts/mocks/"

# Static resources
cp "$PROJECT_DIR/scripts/signup-template.html" "$PKG_DIR/usr/share/blockhost/"

# Systemd service
cp "$PROJECT_DIR/examples/blockhost-monitor.service" "$PKG_DIR/lib/systemd/system/"

# Example env
cat > "$PKG_DIR/opt/blockhost/.env.example" << 'ENVEOF'
# Blockhost Monitor Configuration
SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com
BLOCKHOST_CONTRACT=0xYourContractAddressHere
ENVEOF

# ============================================
# Build package
# ============================================
echo "Building package..."
dpkg-deb --build "$PKG_DIR"

echo ""
echo "=========================================="
echo "Package built: $SCRIPT_DIR/${PKG_NAME}.deb"
echo "=========================================="
dpkg-deb --info "$SCRIPT_DIR/${PKG_NAME}.deb"

# Show contract compilation status
if [ -f "$PKG_DIR/usr/share/blockhost/contracts/BlockhostSubscriptions.json" ]; then
    echo ""
    echo "Compiled contract included:"
    echo "  /usr/share/blockhost/contracts/BlockhostSubscriptions.json"
else
    echo ""
    echo "WARNING: Compiled contract NOT included (forge not available)"
fi
