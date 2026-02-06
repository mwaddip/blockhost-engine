/**
 * Knock command handler - opens firewall ports temporarily
 *
 * Opens specified ports via iptables, sets a timeout to close them,
 * and optionally monitors auth.log for successful SSH login.
 */

import { execSync, spawn } from "child_process";
import * as fs from "fs";
import type { CommandResult, KnockParams, KnockActionConfig, ActiveKnock } from "../types";

// Track active knocks in memory
const activeKnocks: Map<string, ActiveKnock> = new Map();

// Comment used to identify our iptables rules
const IPTABLES_COMMENT = "blockhost-knock";

/**
 * Execute the knock command
 */
export async function executeKnock(
  params: KnockParams,
  config: KnockActionConfig,
  txHash: string
): Promise<CommandResult> {
  // Merge params with defaults from config
  const allowedPorts = config.allowed_ports || [22];
  const maxDuration = config.max_duration || 600;
  const defaultDuration = config.default_duration || 300;

  // Validate and sanitize ports
  const requestedPorts = params.ports || allowedPorts;
  const ports = requestedPorts.filter(port => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.warn(`[KNOCK] Invalid port number: ${port}`);
      return false;
    }
    if (!allowedPorts.includes(port)) {
      console.warn(`[KNOCK] Port not allowed: ${port}`);
      return false;
    }
    return true;
  });

  if (ports.length === 0) {
    return {
      success: false,
      message: "No valid ports to open",
    };
  }

  // Validate duration
  let duration = params.duration || defaultDuration;
  if (duration > maxDuration) {
    console.warn(`[KNOCK] Duration ${duration}s exceeds max ${maxDuration}s, capping`);
    duration = maxDuration;
  }
  if (duration < 1) {
    duration = 1;
  }

  console.log(`[KNOCK] Opening ports ${ports.join(', ')} for ${duration}s (tx: ${txHash})`);

  try {
    // Open ports via iptables
    for (const port of ports) {
      openPort(port);
    }

    // Set timeout to close ports
    const timeoutId = setTimeout(() => {
      closeKnock(txHash, "timeout");
    }, duration * 1000);

    // Track this knock
    activeKnocks.set(txHash, {
      txHash,
      ports,
      startTime: Date.now(),
      duration,
      timeoutId,
    });

    // Start monitoring auth.log for SSH login (optional enhancement)
    startAuthLogMonitor(txHash, ports);

    return {
      success: true,
      message: `Opened ports ${ports.join(', ')} for ${duration} seconds`,
      data: { ports, duration, txHash },
    };

  } catch (err) {
    console.error(`[KNOCK] Error opening ports: ${err}`);
    // Clean up any partially opened ports
    for (const port of ports) {
      try {
        closePort(port);
      } catch {
        // Ignore cleanup errors
      }
    }
    return {
      success: false,
      message: `Failed to open ports: ${err}`,
    };
  }
}

/**
 * Open a single port via iptables
 */
function openPort(port: number): void {
  // Insert rule at position 1 (top of INPUT chain)
  // Uses comment module to identify our rules for cleanup
  const cmd = `iptables -I INPUT 1 -p tcp --dport ${port} -j ACCEPT -m comment --comment "${IPTABLES_COMMENT}"`;

  console.log(`[KNOCK] Running: ${cmd}`);
  execSync(cmd, { timeout: 5000 });
}

/**
 * Close a single port (remove our iptables rule)
 */
function closePort(port: number): void {
  // Delete the rule we added
  const cmd = `iptables -D INPUT -p tcp --dport ${port} -j ACCEPT -m comment --comment "${IPTABLES_COMMENT}"`;

  console.log(`[KNOCK] Running: ${cmd}`);
  try {
    execSync(cmd, { timeout: 5000 });
  } catch (err) {
    // Rule might not exist, that's OK
    console.warn(`[KNOCK] Could not remove rule for port ${port}: ${err}`);
  }
}

/**
 * Close a knock session (called on timeout or successful login)
 */
function closeKnock(txHash: string, reason: string): void {
  const knock = activeKnocks.get(txHash);
  if (!knock) {
    return;
  }

  console.log(`[KNOCK] Closing knock session (reason: ${reason}, tx: ${txHash})`);

  // Clear timeout if still pending
  clearTimeout(knock.timeoutId);

  // Close all ports
  for (const port of knock.ports) {
    closePort(port);
  }

  // Remove from active knocks
  activeKnocks.delete(txHash);

  console.log(`[KNOCK] Knock session closed: ${knock.ports.join(', ')}`);
}

/**
 * Monitor auth.log for successful SSH login (optional enhancement)
 *
 * When a successful login is detected:
 * 1. Close the open ports immediately
 * 2. Optionally, could lock to source IP (future enhancement)
 */
function startAuthLogMonitor(txHash: string, ports: number[]): void {
  const knock = activeKnocks.get(txHash);
  if (!knock) return;

  // Only monitor if port 22 is in the list
  if (!ports.includes(22)) {
    return;
  }

  const authLogPath = "/var/log/auth.log";
  if (!fs.existsSync(authLogPath)) {
    console.log(`[KNOCK] Auth log not found, skipping login monitoring`);
    return;
  }

  console.log(`[KNOCK] Monitoring ${authLogPath} for SSH login...`);

  // Use tail -f to watch for new entries
  const tail = spawn("tail", ["-F", "-n", "0", authLogPath]);

  let buffer = "";

  tail.stdout.on("data", (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line

    for (const line of lines) {
      // Look for successful SSH login
      // Format: "Accepted publickey for user from IP port PORT ssh2"
      // or: "Accepted password for user from IP port PORT ssh2"
      if (line.includes("Accepted") && line.includes("ssh2")) {
        console.log(`[KNOCK] Detected SSH login: ${line}`);

        // Extract source IP
        const match = line.match(/from\s+(\d+\.\d+\.\d+\.\d+)/);
        if (match) {
          knock.sourceIp = match[1];
          console.log(`[KNOCK] Login from IP: ${knock.sourceIp}`);
        }

        // Close knock session after successful login
        tail.kill();
        closeKnock(txHash, "ssh-login");
        return;
      }
    }
  });

  tail.on("error", (err) => {
    console.warn(`[KNOCK] Auth log monitor error: ${err}`);
  });

  // Stop monitoring when knock expires
  const originalTimeout = knock.timeoutId;
  const wrappedTimeout = setTimeout(() => {
    tail.kill();
    // The original timeout callback will handle closing
  }, knock.duration * 1000);

  // Replace with wrapped timeout
  clearTimeout(originalTimeout);
  knock.timeoutId = wrappedTimeout;
}

/**
 * Get active knocks (for diagnostics)
 */
export function getActiveKnocks(): ActiveKnock[] {
  return Array.from(activeKnocks.values());
}

/**
 * Close all active knocks (for shutdown)
 */
export function closeAllKnocks(): void {
  console.log(`[KNOCK] Closing ${activeKnocks.size} active knock sessions`);
  for (const txHash of activeKnocks.keys()) {
    closeKnock(txHash, "shutdown");
  }
}
