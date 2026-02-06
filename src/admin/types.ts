/**
 * Admin command types for on-chain command processing
 */

export type DestinationMode = 'any' | 'self' | 'server' | 'null';

/**
 * Admin command payload structure (encrypted in tx.data)
 */
export interface AdminCommand {
  command: string;           // Secret command name (maps to action in database)
  params: Record<string, unknown>;
  nonce: string;             // REQUIRED for anti-replay (UUID)
  timestamp: number;         // Unix timestamp
}

/**
 * Parameters for knock command action
 */
export interface KnockParams {
  ports?: number[];          // Ports to open (validated against allowed_ports)
  duration?: number;         // How long to keep ports open (seconds)
}

/**
 * Admin configuration from blockhost.yaml
 */
export interface AdminConfig {
  wallet_address: string;           // Admin wallet address (required)
  max_command_age?: number;         // Reject commands older than N seconds (default: 300)
  destination_mode?: DestinationMode;  // How to filter tx.to (default: 'any')
  destination_address?: string;     // Custom address for 'null' mode
}

/**
 * Command definition in admin-commands.json
 */
export interface CommandDefinition {
  action: string;                   // Action type: 'knock', etc.
  description?: string;             // Admin reference only
  params: Record<string, unknown>;  // Action-specific configuration
}

/**
 * Command database structure (admin-commands.json)
 */
export interface CommandDatabase {
  commands: Record<string, CommandDefinition>;
}

/**
 * Knock action configuration (from command definition params)
 */
export interface KnockActionConfig {
  allowed_ports?: number[];         // Ports that can be opened (default: [22])
  max_duration?: number;            // Maximum duration in seconds (default: 600)
  default_duration?: number;        // Default duration if not specified (default: 300)
}

/**
 * Result of command execution
 */
export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * Active knock state (tracked in memory)
 */
export interface ActiveKnock {
  txHash: string;
  ports: number[];
  startTime: number;
  duration: number;
  timeoutId: NodeJS.Timeout;
  sourceIp?: string;            // Set when SSH login detected
}
