// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IUniswapV2Pair {
    function getReserves() external view returns (
        uint112 reserve0,
        uint112 reserve1,
        uint32 blockTimestampLast
    );
    function token0() external view returns (address);
    function token1() external view returns (address);
}

contract BlockhostSubscriptions is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    // Payment method ID 1 is reserved for direct stablecoin payments
    uint256 public constant STABLECOIN_PAYMENT_ID = 1;

    // ============ Structs ============

    struct Plan {
        string name;
        uint256 pricePerDayUsdCents; // Price in USD cents (e.g., 100 = $1.00)
        bool active;
    }

    struct Subscription {
        uint256 planId;
        address subscriber;
        uint256 expiresAt; // Unix timestamp
        bool cancelled; // Explicit cancel flag to distinguish from natural expiry
    }

    struct PaymentMethod {
        address tokenAddress;       // The ERC20 token to accept for payment
        address pairAddress;        // Uniswap V2 pair (address(0) for direct stablecoin)
        address stablecoinAddress;  // The USD stablecoin in the pair (same as tokenAddress for direct)
        uint8 tokenDecimals;
        uint8 stablecoinDecimals;
        bool active;
    }

    // ============ State Variables ============

    uint256 public nextPlanId = 1;
    uint256 public nextSubscriptionId = 1;
    uint256 public nextPaymentMethodId = 2; // Start at 2, ID 1 reserved for stablecoin

    // Slippage tolerance in basis points (100 = 1%) - only applies to non-stablecoin payments
    uint256 public slippageBps = 100;

    // Minimum liquidity required in pair to accept payment (prevents manipulation on low-liquidity pairs)
    uint256 public minLiquidityUsd = 10000 * 1e6; // $10,000 in stablecoin units (assuming 6 decimals)

    mapping(uint256 => Plan) private _plans;
    mapping(uint256 => Subscription) private _subscriptions;
    mapping(uint256 => PaymentMethod) private _paymentMethods;

    // Track non-stablecoin payment method IDs for enumeration
    uint256[] private _paymentMethodIds;

    // ============ Events ============

    event PlanCreated(
        uint256 indexed planId,
        string name,
        uint256 pricePerDayUsdCents
    );

    event PlanUpdated(
        uint256 indexed planId,
        string name,
        uint256 pricePerDayUsdCents,
        bool active
    );

    event SubscriptionCreated(
        uint256 indexed subscriptionId,
        uint256 indexed planId,
        address indexed subscriber,
        uint256 expiresAt,
        uint256 paidAmount,
        address paymentToken,
        bytes userEncrypted
    );

    event SubscriptionExtended(
        uint256 indexed subscriptionId,
        uint256 indexed planId,
        address indexed extendedBy,
        uint256 newExpiresAt,
        uint256 paidAmount,
        address paymentToken
    );

    event SubscriptionCancelled(
        uint256 indexed subscriptionId,
        uint256 indexed planId,
        address indexed subscriber
    );

    event PrimaryStablecoinSet(
        address indexed stablecoinAddress,
        uint8 decimals
    );

    event PaymentMethodAdded(
        uint256 indexed paymentMethodId,
        address tokenAddress,
        address pairAddress,
        address stablecoinAddress
    );

    event PaymentMethodUpdated(
        uint256 indexed paymentMethodId,
        bool active
    );

    event FundsWithdrawn(
        address indexed token,
        address indexed to,
        uint256 amount
    );

    event SlippageUpdated(uint256 oldSlippageBps, uint256 newSlippageBps);
    event MinLiquidityUpdated(uint256 oldMinLiquidity, uint256 newMinLiquidity);

    // ============ Errors ============

    error PlanNotFound(uint256 planId);
    error PlanNotActive(uint256 planId);
    error PlanPriceMustBePositive();
    error SubscriptionNotFound(uint256 subscriptionId);
    error SubscriptionAlreadyCancelled(uint256 subscriptionId);
    error PaymentMethodNotFound(uint256 paymentMethodId);
    error PaymentMethodNotActive(uint256 paymentMethodId);
    error PrimaryStablecoinNotSet();
    error InvalidAddress();
    error DaysMustBePositive();
    error SlippageTooHigh();
    error NoBalanceToWithdraw();
    error TokenNotInPair();
    error InsufficientLiquidity();

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Owner Functions ============

    /**
     * @notice Set the primary stablecoin for direct USD payments (payment method ID 1)
     * @dev This is the simplest payment method - no price conversion or slippage needed
     * @param stablecoinAddress The USD stablecoin contract address (e.g., USDC, USDT, DAI)
     */
    function setPrimaryStablecoin(address stablecoinAddress) external onlyOwner {
        if (stablecoinAddress == address(0)) revert InvalidAddress();

        uint8 decimals = IERC20Metadata(stablecoinAddress).decimals();

        _paymentMethods[STABLECOIN_PAYMENT_ID] = PaymentMethod({
            tokenAddress: stablecoinAddress,
            pairAddress: address(0), // No pair needed - direct stablecoin payment
            stablecoinAddress: stablecoinAddress,
            tokenDecimals: decimals,
            stablecoinDecimals: decimals,
            active: true
        });

        emit PrimaryStablecoinSet(stablecoinAddress, decimals);
    }

    /**
     * @notice Create a new subscription plan
     * @param name Human-readable name for the plan
     * @param pricePerDayUsdCents Price in USD cents per 24 hours
     * @return planId The ID of the newly created plan
     */
    function createPlan(
        string calldata name,
        uint256 pricePerDayUsdCents
    ) external onlyOwner returns (uint256 planId) {
        if (pricePerDayUsdCents == 0) revert PlanPriceMustBePositive();

        planId = nextPlanId++;
        _plans[planId] = Plan({
            name: name,
            pricePerDayUsdCents: pricePerDayUsdCents,
            active: true
        });

        emit PlanCreated(planId, name, pricePerDayUsdCents);
    }

    /**
     * @notice Update an existing subscription plan
     * @param planId The plan to update
     * @param name New name for the plan
     * @param pricePerDayUsdCents New price in USD cents per 24 hours
     * @param active Whether the plan accepts new subscriptions
     */
    function updatePlan(
        uint256 planId,
        string calldata name,
        uint256 pricePerDayUsdCents,
        bool active
    ) external onlyOwner {
        if (planId == 0 || planId >= nextPlanId) revert PlanNotFound(planId);
        if (pricePerDayUsdCents == 0) revert PlanPriceMustBePositive();

        _plans[planId] = Plan({
            name: name,
            pricePerDayUsdCents: pricePerDayUsdCents,
            active: active
        });

        emit PlanUpdated(planId, name, pricePerDayUsdCents, active);
    }

    /**
     * @notice Cancel a subscription immediately
     * @param subscriptionId The subscription to cancel
     */
    function cancelSubscription(uint256 subscriptionId) external onlyOwner {
        if (subscriptionId == 0 || subscriptionId >= nextSubscriptionId) {
            revert SubscriptionNotFound(subscriptionId);
        }

        Subscription storage sub = _subscriptions[subscriptionId];
        if (sub.cancelled) revert SubscriptionAlreadyCancelled(subscriptionId);

        sub.cancelled = true;
        sub.expiresAt = block.timestamp;

        emit SubscriptionCancelled(subscriptionId, sub.planId, sub.subscriber);
    }

    /**
     * @notice Add a new payment method using a Uniswap V2 pair for price discovery
     * @param tokenAddress The ERC20 token to accept for payment
     * @param pairAddress The Uniswap V2 pair address (token/stablecoin)
     * @param stablecoinAddress The USD stablecoin address in the pair
     * @return paymentMethodId The ID of the newly created payment method
     */
    function addPaymentMethod(
        address tokenAddress,
        address pairAddress,
        address stablecoinAddress
    ) external onlyOwner returns (uint256 paymentMethodId) {
        if (tokenAddress == address(0) || pairAddress == address(0) || stablecoinAddress == address(0)) {
            revert InvalidAddress();
        }

        // Validate pair contains both tokens
        IUniswapV2Pair pair = IUniswapV2Pair(pairAddress);
        address token0 = pair.token0();
        address token1 = pair.token1();

        bool hasToken = (token0 == tokenAddress || token1 == tokenAddress);
        bool hasStablecoin = (token0 == stablecoinAddress || token1 == stablecoinAddress);

        if (!hasToken || !hasStablecoin) revert TokenNotInPair();

        // Get decimals
        uint8 tokenDecimals = IERC20Metadata(tokenAddress).decimals();
        uint8 stablecoinDecimals = IERC20Metadata(stablecoinAddress).decimals();

        paymentMethodId = nextPaymentMethodId++;
        _paymentMethods[paymentMethodId] = PaymentMethod({
            tokenAddress: tokenAddress,
            pairAddress: pairAddress,
            stablecoinAddress: stablecoinAddress,
            tokenDecimals: tokenDecimals,
            stablecoinDecimals: stablecoinDecimals,
            active: true
        });

        _paymentMethodIds.push(paymentMethodId);

        emit PaymentMethodAdded(paymentMethodId, tokenAddress, pairAddress, stablecoinAddress);
    }

    /**
     * @notice Enable or disable a payment method
     * @param paymentMethodId The payment method to update
     * @param active Whether the payment method should be active
     */
    function updatePaymentMethod(
        uint256 paymentMethodId,
        bool active
    ) external onlyOwner {
        if (!_isValidPaymentMethod(paymentMethodId)) {
            revert PaymentMethodNotFound(paymentMethodId);
        }

        _paymentMethods[paymentMethodId].active = active;

        emit PaymentMethodUpdated(paymentMethodId, active);
    }

    /**
     * @notice Withdraw accumulated tokens from the contract
     * @param tokenAddress The token to withdraw
     * @param to Recipient address
     */
    function withdrawFunds(address tokenAddress, address to) external onlyOwner {
        if (to == address(0)) revert InvalidAddress();

        uint256 balance = IERC20(tokenAddress).balanceOf(address(this));
        if (balance == 0) revert NoBalanceToWithdraw();

        IERC20(tokenAddress).safeTransfer(to, balance);

        emit FundsWithdrawn(tokenAddress, to, balance);
    }

    /**
     * @notice Update slippage tolerance (only applies to non-stablecoin payments)
     * @param newSlippageBps New slippage in basis points (max 1000 = 10%)
     */
    function setSlippageBps(uint256 newSlippageBps) external onlyOwner {
        if (newSlippageBps > 1000) revert SlippageTooHigh();

        uint256 oldSlippageBps = slippageBps;
        slippageBps = newSlippageBps;

        emit SlippageUpdated(oldSlippageBps, newSlippageBps);
    }

    /**
     * @notice Update minimum liquidity requirement
     * @param newMinLiquidity New minimum liquidity in stablecoin base units
     */
    function setMinLiquidity(uint256 newMinLiquidity) external onlyOwner {
        uint256 oldMinLiquidity = minLiquidityUsd;
        minLiquidityUsd = newMinLiquidity;

        emit MinLiquidityUpdated(oldMinLiquidity, newMinLiquidity);
    }

    // ============ Public Functions ============

    /**
     * @notice Purchase a new subscription
     * @param planId The plan to subscribe to
     * @param days_ Number of days to subscribe for
     * @param paymentMethodId The payment method to use (1 for stablecoin, 2+ for other tokens)
     * @param userEncrypted Encrypted connection details (AES-256-GCM encrypted JSON with hostname/port/username)
     * @return subscriptionId The ID of the new subscription
     */
    function buySubscription(
        uint256 planId,
        uint256 days_,
        uint256 paymentMethodId,
        bytes calldata userEncrypted
    ) external nonReentrant returns (uint256 subscriptionId) {
        // Validate inputs
        if (planId == 0 || planId >= nextPlanId) revert PlanNotFound(planId);
        if (!_plans[planId].active) revert PlanNotActive(planId);
        if (days_ == 0) revert DaysMustBePositive();
        if (!_isValidPaymentMethod(paymentMethodId)) {
            revert PaymentMethodNotFound(paymentMethodId);
        }
        if (!_paymentMethods[paymentMethodId].active) {
            revert PaymentMethodNotActive(paymentMethodId);
        }

        // Calculate and collect payment
        uint256 tokenAmount = _calculatePayment(planId, days_, paymentMethodId);
        PaymentMethod memory pm = _paymentMethods[paymentMethodId];

        // Transfer tokens from user to contract
        // SafeERC20 handles non-standard tokens and reverts on failure
        IERC20(pm.tokenAddress).safeTransferFrom(msg.sender, address(this), tokenAmount);

        // Create subscription
        subscriptionId = nextSubscriptionId++;
        uint256 expiresAt = block.timestamp + (days_ * 1 days);

        _subscriptions[subscriptionId] = Subscription({
            planId: planId,
            subscriber: msg.sender,
            expiresAt: expiresAt,
            cancelled: false
        });

        emit SubscriptionCreated(
            subscriptionId,
            planId,
            msg.sender,
            expiresAt,
            tokenAmount,
            pm.tokenAddress,
            userEncrypted
        );
    }

    /**
     * @notice Extend an existing subscription
     * @dev Anyone can extend any subscription (allows gifting)
     * @param subscriptionId The subscription to extend
     * @param days_ Number of days to add
     * @param paymentMethodId The payment method to use (1 for stablecoin, 2+ for other tokens)
     */
    function extendSubscription(
        uint256 subscriptionId,
        uint256 days_,
        uint256 paymentMethodId
    ) external nonReentrant {
        // Validate subscription
        if (subscriptionId == 0 || subscriptionId >= nextSubscriptionId) {
            revert SubscriptionNotFound(subscriptionId);
        }

        Subscription storage sub = _subscriptions[subscriptionId];
        if (sub.cancelled) revert SubscriptionAlreadyCancelled(subscriptionId);

        // Validate plan is still active for extensions
        if (!_plans[sub.planId].active) revert PlanNotActive(sub.planId);

        // Validate inputs
        if (days_ == 0) revert DaysMustBePositive();
        if (!_isValidPaymentMethod(paymentMethodId)) {
            revert PaymentMethodNotFound(paymentMethodId);
        }
        if (!_paymentMethods[paymentMethodId].active) {
            revert PaymentMethodNotActive(paymentMethodId);
        }

        // Calculate and collect payment
        uint256 tokenAmount = _calculatePayment(sub.planId, days_, paymentMethodId);
        PaymentMethod memory pm = _paymentMethods[paymentMethodId];

        IERC20(pm.tokenAddress).safeTransferFrom(msg.sender, address(this), tokenAmount);

        // Extend from current expiry if active, or from now if expired
        uint256 baseTime = sub.expiresAt > block.timestamp ? sub.expiresAt : block.timestamp;
        sub.expiresAt = baseTime + (days_ * 1 days);

        emit SubscriptionExtended(
            subscriptionId,
            sub.planId,
            msg.sender,
            sub.expiresAt,
            tokenAmount,
            pm.tokenAddress
        );
    }

    // ============ View Functions ============

    /**
     * @notice Get days remaining on a subscription
     * @param subscriptionId The subscription to check
     * @return Number of full days remaining (0 if expired or cancelled)
     */
    function daysRemaining(uint256 subscriptionId) external view returns (uint256) {
        if (subscriptionId == 0 || subscriptionId >= nextSubscriptionId) {
            revert SubscriptionNotFound(subscriptionId);
        }

        Subscription memory sub = _subscriptions[subscriptionId];

        if (sub.cancelled || sub.expiresAt <= block.timestamp) {
            return 0;
        }

        return (sub.expiresAt - block.timestamp) / 1 days;
    }

    /**
     * @notice Get subscription details
     * @param subscriptionId The subscription to query
     */
    function getSubscription(uint256 subscriptionId) external view returns (
        uint256 planId,
        address subscriber,
        uint256 expiresAt,
        bool isActive,
        bool cancelled
    ) {
        if (subscriptionId == 0 || subscriptionId >= nextSubscriptionId) {
            revert SubscriptionNotFound(subscriptionId);
        }

        Subscription memory sub = _subscriptions[subscriptionId];
        return (
            sub.planId,
            sub.subscriber,
            sub.expiresAt,
            !sub.cancelled && sub.expiresAt > block.timestamp,
            sub.cancelled
        );
    }

    /**
     * @notice Get plan details
     * @param planId The plan to query
     */
    function getPlan(uint256 planId) external view returns (
        string memory name,
        uint256 pricePerDayUsdCents,
        bool active
    ) {
        if (planId == 0 || planId >= nextPlanId) revert PlanNotFound(planId);

        Plan memory plan = _plans[planId];
        return (plan.name, plan.pricePerDayUsdCents, plan.active);
    }

    /**
     * @notice Get the primary stablecoin address
     * @return The stablecoin token address, or address(0) if not set
     */
    function getPrimaryStablecoin() external view returns (address) {
        return _paymentMethods[STABLECOIN_PAYMENT_ID].tokenAddress;
    }

    /**
     * @notice Get all payment method IDs (including stablecoin if configured)
     * @return Array of payment method IDs
     */
    function getPaymentMethodIds() external view returns (uint256[] memory) {
        bool hasStablecoin = _paymentMethods[STABLECOIN_PAYMENT_ID].tokenAddress != address(0);

        if (!hasStablecoin) {
            return _paymentMethodIds;
        }

        // Include stablecoin (ID 1) at the beginning
        uint256[] memory allIds = new uint256[](_paymentMethodIds.length + 1);
        allIds[0] = STABLECOIN_PAYMENT_ID;
        for (uint256 i = 0; i < _paymentMethodIds.length; i++) {
            allIds[i + 1] = _paymentMethodIds[i];
        }
        return allIds;
    }

    /**
     * @notice Get payment method details
     * @param paymentMethodId The payment method to query
     */
    function getPaymentMethod(uint256 paymentMethodId) external view returns (
        address tokenAddress,
        address pairAddress,
        address stablecoinAddress,
        uint8 tokenDecimals,
        uint8 stablecoinDecimals,
        bool active
    ) {
        if (!_isValidPaymentMethod(paymentMethodId)) {
            revert PaymentMethodNotFound(paymentMethodId);
        }

        PaymentMethod memory pm = _paymentMethods[paymentMethodId];
        return (
            pm.tokenAddress,
            pm.pairAddress,
            pm.stablecoinAddress,
            pm.tokenDecimals,
            pm.stablecoinDecimals,
            pm.active
        );
    }

    /**
     * @notice Calculate token amount required for a subscription
     * @param planId The plan to calculate for
     * @param days_ Number of days
     * @param paymentMethodId The payment method to use
     * @return tokenAmount The amount of tokens required
     */
    function calculatePayment(
        uint256 planId,
        uint256 days_,
        uint256 paymentMethodId
    ) external view returns (uint256) {
        if (planId == 0 || planId >= nextPlanId) revert PlanNotFound(planId);
        if (!_isValidPaymentMethod(paymentMethodId)) {
            revert PaymentMethodNotFound(paymentMethodId);
        }

        return _calculatePayment(planId, days_, paymentMethodId);
    }

    /**
     * @notice Get current price of a token in USD cents from the Uniswap pair
     * @dev Returns 100 (=$1.00) for the primary stablecoin
     * @param paymentMethodId The payment method to query
     * @return priceUsdCents Price of 1 token in USD cents (e.g., 200000 = $2000.00)
     */
    function getTokenPriceUsdCents(uint256 paymentMethodId) external view returns (uint256 priceUsdCents) {
        if (!_isValidPaymentMethod(paymentMethodId)) {
            revert PaymentMethodNotFound(paymentMethodId);
        }

        PaymentMethod memory pm = _paymentMethods[paymentMethodId];

        // Direct stablecoin = $1.00 = 100 cents
        if (pm.pairAddress == address(0)) {
            return 100;
        }

        (uint256 tokenReserve, uint256 stablecoinReserve) = _getReserves(pm);

        // Price = stablecoinReserve / tokenReserve, normalized to cents
        // priceUsdCents = (stablecoinReserve * 100 * 10^tokenDecimals) / (tokenReserve * 10^stablecoinDecimals)
        priceUsdCents = (stablecoinReserve * 100 * (10 ** pm.tokenDecimals))
                        / (tokenReserve * (10 ** pm.stablecoinDecimals));
    }

    // ============ Server Helper Functions ============

    /**
     * @notice Get count of total subscriptions created
     * @return Total number of subscriptions (including expired/cancelled)
     */
    function getTotalSubscriptionCount() external view returns (uint256) {
        return nextSubscriptionId - 1;
    }

    /**
     * @notice Get count of total plans created
     * @return Total number of plans
     */
    function getTotalPlanCount() external view returns (uint256) {
        return nextPlanId - 1;
    }

    /**
     /**
     * @notice Get all subscriptions for a specific subscriber
     * @param subscriber The address to query
     * @return subscriptionIds Array of subscription IDs owned by the subscriber
     */
    function getSubscriptionsBySubscriber(
        address subscriber
    ) external view returns (uint256[] memory subscriptionIds) {
        // Count first
        uint256 count = 0;
        for (uint256 i = 1; i < nextSubscriptionId; i++) {
            if (_subscriptions[i].subscriber == subscriber) {
                count++;
            }
        }

        subscriptionIds = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 1; i < nextSubscriptionId; i++) {
            if (_subscriptions[i].subscriber == subscriber) {
                subscriptionIds[index] = i;
                index++;
            }
        }
    }

    /**
     * @notice Check if a subscription is currently active
     * @param subscriptionId The subscription to check
     * @return True if active (not cancelled and not expired)
     */
    function isSubscriptionActive(uint256 subscriptionId) external view returns (bool) {
        if (subscriptionId == 0 || subscriptionId >= nextSubscriptionId) {
            return false;
        }

        Subscription memory sub = _subscriptions[subscriptionId];
        return !sub.cancelled && sub.expiresAt > block.timestamp;
    }

    // ============ Internal Functions ============

    /**
     * @dev Check if a payment method ID is valid
     * @param paymentMethodId The ID to check
     * @return True if the payment method exists
     */
    function _isValidPaymentMethod(uint256 paymentMethodId) internal view returns (bool) {
        if (paymentMethodId == 0) return false;

        // Check stablecoin (ID 1)
        if (paymentMethodId == STABLECOIN_PAYMENT_ID) {
            return _paymentMethods[STABLECOIN_PAYMENT_ID].tokenAddress != address(0);
        }

        // Check other payment methods (ID 2+)
        return paymentMethodId < nextPaymentMethodId;
    }

    /**
     * @dev Get reserves from Uniswap V2 pair, ordered as (tokenReserve, stablecoinReserve)
     * @param pm The payment method containing pair info
     * @return tokenReserve Reserve of the payment token
     * @return stablecoinReserve Reserve of the stablecoin
     */
    function _getReserves(PaymentMethod memory pm) internal view returns (
        uint256 tokenReserve,
        uint256 stablecoinReserve
    ) {
        IUniswapV2Pair pair = IUniswapV2Pair(pm.pairAddress);
        (uint112 reserve0, uint112 reserve1,) = pair.getReserves();

        address token0 = pair.token0();

        if (token0 == pm.tokenAddress) {
            tokenReserve = uint256(reserve0);
            stablecoinReserve = uint256(reserve1);
        } else {
            tokenReserve = uint256(reserve1);
            stablecoinReserve = uint256(reserve0);
        }
    }

    /**
     * @dev Calculate token amount for payment
     * @param planId The plan ID
     * @param days_ Number of days
     * @param paymentMethodId The payment method ID
     * @return tokenAmount Amount of tokens required
     *
     * For stablecoin (ID 1): Direct conversion from USD cents to token units
     * For other tokens: Uses Uniswap V2 pair reserves with slippage buffer
     */
    function _calculatePayment(
        uint256 planId,
        uint256 days_,
        uint256 paymentMethodId
    ) internal view returns (uint256 tokenAmount) {
        Plan memory plan = _plans[planId];
        PaymentMethod memory pm = _paymentMethods[paymentMethodId];

        uint256 totalUsdCents = plan.pricePerDayUsdCents * days_;

        // Direct stablecoin payment - simple conversion, no slippage
        if (pm.pairAddress == address(0)) {
            // Convert cents to token units: totalUsdCents * 10^decimals / 100
            return (totalUsdCents * (10 ** pm.tokenDecimals)) / 100;
        }

        // Non-stablecoin payment - use Uniswap V2 pair for price discovery
        (uint256 tokenReserve, uint256 stablecoinReserve) = _getReserves(pm);

        // Check minimum liquidity to prevent manipulation on thin pairs
        // Normalize stablecoin reserve to 6 decimals for comparison
        uint256 normalizedStablecoinReserve = stablecoinReserve;
        if (pm.stablecoinDecimals > 6) {
            normalizedStablecoinReserve = stablecoinReserve / (10 ** (pm.stablecoinDecimals - 6));
        } else if (pm.stablecoinDecimals < 6) {
            normalizedStablecoinReserve = stablecoinReserve * (10 ** (6 - pm.stablecoinDecimals));
        }

        if (normalizedStablecoinReserve < minLiquidityUsd) revert InsufficientLiquidity();

        // Calculate total USD cost in stablecoin base units
        uint256 totalStablecoinUnits = (totalUsdCents * (10 ** pm.stablecoinDecimals)) / 100;

        // Calculate token amount using constant product formula
        // tokenAmount = totalStablecoinUnits * tokenReserve / stablecoinReserve
        tokenAmount = (totalStablecoinUnits * tokenReserve) / stablecoinReserve;

        // Add slippage buffer to protect against price movements
        tokenAmount = tokenAmount + (tokenAmount * slippageBps / 10000);
    }
}
