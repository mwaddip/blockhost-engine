/**
 * Type definitions for fund-manager and bw CLI
 */

export interface AddressbookEntry {
  address: string;
  keyfile?: string;
}

export type Addressbook = Record<string, AddressbookEntry>;

export interface RevenueShareRecipient {
  role: string;
  percent: number;
}

export interface RevenueShareConfig {
  enabled: boolean;
  total_percent: number;
  recipients: RevenueShareRecipient[];
}

export interface FundManagerConfig {
  fund_cycle_interval_hours: number;
  gas_check_interval_minutes: number;
  min_withdrawal_usd: number;
  gas_low_threshold_usd: number;
  gas_swap_amount_usd: number;
  server_stablecoin_buffer_usd: number;
  hot_wallet_gas_eth: number;
}

export interface ChainConfig {
  router: string;
  weth: string;
  usdc: string;
  usdc_weth_pair: string;
}

export interface FundManagerState {
  last_fund_cycle: number;
  last_gas_check: number;
  hot_wallet_generated: boolean;
}

export interface TokenBalance {
  tokenAddress: string;
  symbol: string;
  balance: bigint;
  decimals: number;
  usdValue: number;
  paymentMethodId: number;
}
