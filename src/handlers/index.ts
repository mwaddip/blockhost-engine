/**
 * Event handlers for BlockhostSubscriptions contract events
 * Calls blockhost-provisioner scripts to provision/manage VMs
 */

import { ethers } from "ethers";
import { spawn, execSync } from "child_process";
import * as fs from "fs";
import * as yaml from "js-yaml";

// Paths on the server
const WORKING_DIR = "/var/lib/blockhost";
const SERVER_PRIVATE_KEY_FILE = "/etc/blockhost/server.key";
const BLOCKHOST_CONFIG_FILE = "/etc/blockhost/blockhost.yaml";

// Load static publicSecret from config (same for all users)
function getPublicSecret(): string {
  try {
    const config = yaml.load(fs.readFileSync(BLOCKHOST_CONFIG_FILE, "utf8")) as Record<string, unknown>;
    return (config.public_secret as string) || "blockhost-access";
  } catch (err) {
    console.warn(`[WARN] Could not load config, using default public_secret`);
    return "blockhost-access";
  }
}

export interface SubscriptionCreatedEvent {
  subscriptionId: bigint;
  planId: bigint;
  subscriber: string;
  expiresAt: bigint;
  paidAmount: bigint;
  paymentToken: string;
  userEncrypted: string; // Hex-encoded encrypted connection details
}

export interface SubscriptionExtendedEvent {
  subscriptionId: bigint;
  planId: bigint;
  extendedBy: string;
  newExpiresAt: bigint;
  paidAmount: bigint;
  paymentToken: string;
}

export interface SubscriptionCancelledEvent {
  subscriptionId: bigint;
  planId: bigint;
  subscriber: string;
}

export interface PlanCreatedEvent {
  planId: bigint;
  name: string;
  pricePerDayUsdCents: bigint;
}

export interface PlanUpdatedEvent {
  planId: bigint;
  name: string;
  pricePerDayUsdCents: bigint;
  active: boolean;
}

/**
 * Format subscription ID as VM name: blockhost-001, blockhost-042, etc.
 */
function formatVmName(subscriptionId: bigint): string {
  return `blockhost-${subscriptionId.toString().padStart(3, "0")}`;
}

/**
 * Calculate days from now until expiry timestamp
 */
function calculateExpiryDays(expiresAt: bigint): number {
  const expiryMs = Number(expiresAt) * 1000;
  const nowMs = Date.now();
  const daysRemaining = Math.ceil((expiryMs - nowMs) / (1000 * 60 * 60 * 24));
  return Math.max(1, daysRemaining); // At least 1 day
}

/**
 * Decrypt userEncrypted data using the server's private key
 * Returns the decrypted user signature, or null if decryption fails
 *
 * For testing: if the data looks like a raw signature (0x + 130 hex chars), use it directly
 */
function decryptUserSignature(userEncrypted: string): string | null {
  // Check if it's a raw signature (65 bytes = 130 hex chars + 0x prefix)
  // Ethereum signatures are 65 bytes: r (32) + s (32) + v (1)
  if (userEncrypted.startsWith("0x") && userEncrypted.length === 132) {
    console.log("[INFO] Using raw signature (no decryption needed)");
    return userEncrypted;
  }

  // Otherwise, try to decrypt with server's private key
  try {
    const result = execSync(
      `pam_web3_tool decrypt --private-key-file ${SERVER_PRIVATE_KEY_FILE} --ciphertext ${userEncrypted}`,
      { encoding: "utf8", timeout: 10000 }
    );
    // Strip "Decrypted: " prefix if present
    return result.trim().replace(/^Decrypted:\s*/, '');
  } catch (err) {
    console.error(`[ERROR] Failed to decrypt user signature: ${err}`);
    return null;
  }
}

/**
 * Run a command and return a promise
 */
function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: WORKING_DIR,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

export async function handleSubscriptionCreated(event: SubscriptionCreatedEvent, txHash: string): Promise<void> {
  const vmName = formatVmName(event.subscriptionId);
  const expiryDays = calculateExpiryDays(event.expiresAt);

  console.log("\n========== SUBSCRIPTION CREATED ==========");
  console.log(`Transaction: ${txHash}`);
  console.log(`Subscription ID: ${event.subscriptionId}`);
  console.log(`Plan ID: ${event.planId}`);
  console.log(`Subscriber: ${event.subscriber}`);
  console.log(`Expires At: ${new Date(Number(event.expiresAt) * 1000).toISOString()}`);
  console.log(`Paid Amount: ${ethers.formatUnits(event.paidAmount, 6)} (assuming 6 decimals)`);
  console.log(`Payment Token: ${event.paymentToken}`);
  console.log(`User Encrypted: ${event.userEncrypted.length > 10 ? event.userEncrypted.slice(0, 10) + "..." : event.userEncrypted}`);
  console.log("------------------------------------------");
  console.log(`Provisioning VM: ${vmName}`);
  console.log(`Expiry: ${expiryDays} days`);

  // Build blockhost-vm-create arguments
  const args = [
    vmName,
    "--owner-wallet", event.subscriber,
    "--expiry-days", expiryDays.toString(),
    "--apply",
  ];

  // Decrypt user signature if provided
  if (event.userEncrypted && event.userEncrypted !== "0x") {
    console.log("Decrypting user signature...");
    const userSignature = decryptUserSignature(event.userEncrypted);
    if (userSignature) {
      console.log("User signature decrypted successfully");
      args.push("--user-signature", userSignature);
      // Use static publicSecret from config (same for all users)
      const publicSecret = getPublicSecret();
      args.push("--public-secret", publicSecret);
    } else {
      console.warn("[WARN] Could not decrypt user signature, proceeding without encrypted connection details");
    }
  }

  // Call blockhost-vm-create (provided by blockhost-provisioner package)
  const result = await runCommand("blockhost-vm-create", args);

  if (result.code === 0) {
    console.log(`[OK] VM ${vmName} provisioned successfully`);
    console.log(result.stdout);
  } else {
    console.error(`[ERROR] Failed to provision VM ${vmName}`);
    console.error(result.stderr || result.stdout);
  }

  console.log("==========================================\n");
}

export async function handleSubscriptionExtended(event: SubscriptionExtendedEvent, txHash: string): Promise<void> {
  const vmName = formatVmName(event.subscriptionId);
  const newExpiryDate = new Date(Number(event.newExpiresAt) * 1000);

  console.log("\n========== SUBSCRIPTION EXTENDED ==========");
  console.log(`Transaction: ${txHash}`);
  console.log(`Subscription ID: ${event.subscriptionId}`);
  console.log(`Plan ID: ${event.planId}`);
  console.log(`Extended By: ${event.extendedBy}`);
  console.log(`New Expires At: ${newExpiryDate.toISOString()}`);
  console.log(`Paid Amount: ${ethers.formatUnits(event.paidAmount, 6)} (assuming 6 decimals)`);
  console.log(`Payment Token: ${event.paymentToken}`);
  console.log("-------------------------------------------");
  console.log(`Updating expiry for VM: ${vmName}`);

  // Calculate additional days from current time to new expiry
  const additionalDays = calculateExpiryDays(event.newExpiresAt);

  // Use Python to update the database and check if VM needs to be resumed
  // Returns "NEEDS_RESUME" if the VM was suspended and should be started
  const script = `
from blockhost.vm_db import get_database

db = get_database()
vm = db.get_vm('${vmName}')
if vm:
    old_status = vm.get('status', 'unknown')
    db.extend_expiry('${vmName}', ${additionalDays})
    print(f"Extended {vm['vm_name']} expiry by ${additionalDays} days")
    if old_status == 'suspended':
        print("NEEDS_RESUME")
else:
    print(f"VM ${vmName} not found in database")
`;

  const proc = spawn("python3", ["-c", script], { cwd: WORKING_DIR });

  let output = "";
  proc.stdout.on("data", (data) => { output += data.toString(); });
  proc.stderr.on("data", (data) => { output += data.toString(); });

  const needsResume = await new Promise<boolean>((resolve) => {
    proc.on("close", (code) => {
      if (code === 0) {
        console.log(`[OK] ${output.trim().split('\n')[0]}`);
        resolve(output.includes("NEEDS_RESUME"));
      } else {
        console.error(`[ERROR] Failed to extend expiry: ${output}`);
        resolve(false);
      }
    });
  });

  // If VM was suspended, resume it
  if (needsResume) {
    console.log(`Resuming suspended VM: ${vmName}`);

    const resumeProc = spawn("blockhost-vm-resume", [vmName], { cwd: WORKING_DIR });

    let resumeOutput = "";
    resumeProc.stdout.on("data", (data) => { resumeOutput += data.toString(); });
    resumeProc.stderr.on("data", (data) => { resumeOutput += data.toString(); });

    await new Promise<void>((resolve) => {
      resumeProc.on("close", (code) => {
        if (code === 0) {
          console.log(`[OK] Successfully resumed VM: ${vmName}`);
          if (resumeOutput.trim()) {
            console.log(resumeOutput.trim());
          }
        } else {
          // Don't fail the handler - subscription extension succeeded on-chain
          // Operator can manually resume if needed
          console.error(`[WARN] Failed to resume VM ${vmName} (exit code ${code})`);
          console.error(`[WARN] ${resumeOutput.trim()}`);
          console.error(`[WARN] Operator may need to manually resume the VM`);
        }
        resolve();
      });
    });
  }

  console.log("===========================================\n");
}

export async function handleSubscriptionCancelled(event: SubscriptionCancelledEvent, txHash: string): Promise<void> {
  const vmName = formatVmName(event.subscriptionId);

  console.log("\n========== SUBSCRIPTION CANCELLED ==========");
  console.log(`Transaction: ${txHash}`);
  console.log(`Subscription ID: ${event.subscriptionId}`);
  console.log(`Plan ID: ${event.planId}`);
  console.log(`Subscriber: ${event.subscriber}`);
  console.log("--------------------------------------------");
  console.log(`Destroying VM: ${vmName}`);

  // Mark VM for immediate destruction using vm-gc.py with specific VM
  // For now, we'll mark it as destroyed in the database and let terraform destroy it
  const script = `
import subprocess
import os
from blockhost.vm_db import get_database
from blockhost.config import load_db_config

db = get_database()
db_config = load_db_config()
vm = db.get_vm('${vmName}')
if vm:
    # Run terraform destroy for this specific VM
    tf_dir = db_config.get('terraform_dir', '/var/lib/blockhost/terraform')
    tf_file = os.path.join(tf_dir, '${vmName}.tf.json')

    if os.path.exists(tf_file):
        # Remove the tf.json file and run terraform apply to destroy
        os.remove(tf_file)
        result = subprocess.run(
            ['terraform', 'apply', '-auto-approve'],
            cwd=tf_dir,
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            db.mark_destroyed('${vmName}')
            print(f"VM ${vmName} destroyed successfully")
        else:
            print(f"Terraform error: {result.stderr}")
    else:
        print(f"VM config ${vmName}.tf.json not found")
        db.mark_destroyed('${vmName}')
else:
    print(f"VM ${vmName} not found in database")
`;

  const proc = spawn("python3", ["-c", script], { cwd: WORKING_DIR });

  let output = "";
  proc.stdout.on("data", (data) => { output += data.toString(); });
  proc.stderr.on("data", (data) => { output += data.toString(); });

  await new Promise<void>((resolve) => {
    proc.on("close", (code) => {
      if (code === 0) {
        console.log(`[OK] ${output.trim()}`);
      } else {
        console.error(`[ERROR] Failed to destroy VM: ${output}`);
      }
      resolve();
    });
  });

  console.log("============================================\n");
}

export async function handlePlanCreated(event: PlanCreatedEvent, txHash: string): Promise<void> {
  console.log("\n========== PLAN CREATED ==========");
  console.log(`Transaction: ${txHash}`);
  console.log(`Plan ID: ${event.planId}`);
  console.log(`Name: ${event.name}`);
  console.log(`Price: $${Number(event.pricePerDayUsdCents) / 100}/day`);
  console.log("----------------------------------");
  console.log("[INFO] Plan registered on-chain");
  console.log("==================================\n");
}

export async function handlePlanUpdated(event: PlanUpdatedEvent, txHash: string): Promise<void> {
  console.log("\n========== PLAN UPDATED ==========");
  console.log(`Transaction: ${txHash}`);
  console.log(`Plan ID: ${event.planId}`);
  console.log(`Name: ${event.name}`);
  console.log(`Price: $${Number(event.pricePerDayUsdCents) / 100}/day`);
  console.log(`Active: ${event.active}`);
  console.log("----------------------------------");
  console.log("[INFO] Plan updated on-chain");
  console.log("==================================\n");
}
