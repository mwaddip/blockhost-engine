import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { BlockhostSubscriptions } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("BlockhostSubscriptions", function () {
  let contract: BlockhostSubscriptions;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let paymentToken: any;
  let stablecoin: any;
  let mockPair: any;

  const PLAN_PRICE_CENTS = 1000n; // $10/day
  const ONE_DAY = 86400;
  const STABLECOIN_PAYMENT_ID = 1n;

  // Mock pair reserves: 100k tokens paired with 100k USDC = $1 per token
  const TOKEN_RESERVE = ethers.parseUnits("100000", 18);
  const STABLECOIN_RESERVE = ethers.parseUnits("100000", 6);

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock ERC20 tokens
    const MockToken = await ethers.getContractFactory("MockERC20");
    paymentToken = await MockToken.deploy("Mock Token", "MTK", 18);
    stablecoin = await MockToken.deploy("Mock USDC", "MUSDC", 6);

    // Deploy mock Uniswap V2 pair
    const MockPair = await ethers.getContractFactory("MockUniswapV2Pair");
    mockPair = await MockPair.deploy(
      await paymentToken.getAddress(),
      await stablecoin.getAddress(),
      TOKEN_RESERVE,
      STABLECOIN_RESERVE
    );

    // Deploy main contract
    const BlockhostSubscriptions = await ethers.getContractFactory("BlockhostSubscriptions");
    contract = await BlockhostSubscriptions.deploy();

    // Mint tokens to users
    await paymentToken.mint(user1.address, ethers.parseUnits("10000", 18));
    await paymentToken.mint(user2.address, ethers.parseUnits("10000", 18));
    await stablecoin.mint(user1.address, ethers.parseUnits("10000", 6));
    await stablecoin.mint(user2.address, ethers.parseUnits("10000", 6));

    // Approve contract to spend tokens
    await paymentToken.connect(user1).approve(await contract.getAddress(), ethers.MaxUint256);
    await paymentToken.connect(user2).approve(await contract.getAddress(), ethers.MaxUint256);
    await stablecoin.connect(user1).approve(await contract.getAddress(), ethers.MaxUint256);
    await stablecoin.connect(user2).approve(await contract.getAddress(), ethers.MaxUint256);
  });

  describe("Primary Stablecoin", function () {
    it("should set primary stablecoin", async function () {
      const stablecoinAddr = await stablecoin.getAddress();

      await expect(contract.setPrimaryStablecoin(stablecoinAddr))
        .to.emit(contract, "PrimaryStablecoinSet")
        .withArgs(stablecoinAddr, 6);

      expect(await contract.getPrimaryStablecoin()).to.equal(stablecoinAddr);
    });

    it("should include stablecoin in payment method IDs", async function () {
      // Before setting stablecoin
      let ids = await contract.getPaymentMethodIds();
      expect(ids.length).to.equal(0);

      // Set stablecoin
      await contract.setPrimaryStablecoin(await stablecoin.getAddress());

      ids = await contract.getPaymentMethodIds();
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(STABLECOIN_PAYMENT_ID);
    });

    it("should reject zero address for stablecoin", async function () {
      await expect(contract.setPrimaryStablecoin(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(contract, "InvalidAddress");
    });

    it("should allow updating stablecoin address", async function () {
      await contract.setPrimaryStablecoin(await stablecoin.getAddress());

      // Deploy another stablecoin
      const MockToken = await ethers.getContractFactory("MockERC20");
      const newStablecoin = await MockToken.deploy("USDT", "USDT", 6);

      await contract.setPrimaryStablecoin(await newStablecoin.getAddress());
      expect(await contract.getPrimaryStablecoin()).to.equal(await newStablecoin.getAddress());
    });
  });

  describe("Stablecoin Payments", function () {
    beforeEach(async function () {
      await contract.setPrimaryStablecoin(await stablecoin.getAddress());
      await contract.createPlan("Basic Plan", PLAN_PRICE_CENTS);
    });

    it("should buy subscription with stablecoin (no slippage)", async function () {
      // $10/day * 30 days = $300 = 300 USDC (6 decimals) = 300000000
      const expectedCost = ethers.parseUnits("300", 6);

      const initialBalance = await stablecoin.balanceOf(user1.address);

      await expect(contract.connect(user1).buySubscription(1, 30, STABLECOIN_PAYMENT_ID, "0x"))
        .to.emit(contract, "SubscriptionCreated");

      const finalBalance = await stablecoin.balanceOf(user1.address);
      expect(initialBalance - finalBalance).to.equal(expectedCost);
    });

    it("should emit userEncrypted in SubscriptionCreated event", async function () {
      const encryptedData = "0xdeadbeef1234567890";

      const tx = await contract.connect(user1).buySubscription(1, 30, STABLECOIN_PAYMENT_ID, encryptedData);
      const receipt = await tx.wait();

      const event = receipt?.logs.find(
        (log) => contract.interface.parseLog(log as any)?.name === "SubscriptionCreated"
      );

      const parsed = contract.interface.parseLog(event as any);
      expect(parsed?.args.userEncrypted).to.equal(encryptedData);
    });

    it("should calculate exact stablecoin amount without slippage", async function () {
      // $10/day * 30 days = $300 = 300000000 (6 decimals)
      const payment = await contract.calculatePayment(1, 30, STABLECOIN_PAYMENT_ID);
      expect(payment).to.equal(ethers.parseUnits("300", 6));
    });

    it("should return $1.00 price for stablecoin", async function () {
      const price = await contract.getTokenPriceUsdCents(STABLECOIN_PAYMENT_ID);
      expect(price).to.equal(100n); // $1.00 = 100 cents
    });

    it("should extend subscription with stablecoin", async function () {
      await contract.connect(user1).buySubscription(1, 30, STABLECOIN_PAYMENT_ID, "0x");

      const subBefore = await contract.getSubscription(1);

      await contract.connect(user1).extendSubscription(1, 15, STABLECOIN_PAYMENT_ID);

      const subAfter = await contract.getSubscription(1);
      expect(subAfter.expiresAt - subBefore.expiresAt).to.equal(BigInt(15 * ONE_DAY));
    });

    it("should reject stablecoin payment if not configured", async function () {
      // Deploy fresh contract without stablecoin set
      const BlockhostSubscriptions = await ethers.getContractFactory("BlockhostSubscriptions");
      const freshContract = await BlockhostSubscriptions.deploy();
      await freshContract.createPlan("Test", 100);

      await expect(freshContract.connect(user1).buySubscription(1, 30, STABLECOIN_PAYMENT_ID, "0x"))
        .to.be.revertedWithCustomError(freshContract, "PaymentMethodNotFound");
    });
  });

  describe("Mixed Payment Methods", function () {
    beforeEach(async function () {
      await contract.setPrimaryStablecoin(await stablecoin.getAddress());
      await contract.createPlan("Basic Plan", PLAN_PRICE_CENTS);
      await contract.addPaymentMethod(
        await paymentToken.getAddress(),
        await mockPair.getAddress(),
        await stablecoin.getAddress()
      );
    });

    it("should list both stablecoin and token payment methods", async function () {
      const ids = await contract.getPaymentMethodIds();
      expect(ids.length).to.equal(2);
      expect(ids[0]).to.equal(1n); // Stablecoin
      expect(ids[1]).to.equal(2n); // Token via pair
    });

    it("should calculate different amounts for stablecoin vs token", async function () {
      // Stablecoin: exact amount, no slippage
      const stablecoinPayment = await contract.calculatePayment(1, 30, 1);
      expect(stablecoinPayment).to.equal(ethers.parseUnits("300", 6));

      // Token: $1 per token with 1% slippage = 303 tokens
      const tokenPayment = await contract.calculatePayment(1, 30, 2);
      expect(tokenPayment).to.equal(ethers.parseUnits("303", 18));
    });

    it("should allow user to choose payment method", async function () {
      // Buy with stablecoin
      await contract.connect(user1).buySubscription(1, 30, 1, "0x");

      // Extend with token
      await contract.connect(user1).extendSubscription(1, 30, 2);

      const sub = await contract.getSubscription(1);
      expect(sub.isActive).to.be.true;
    });
  });

  describe("Plan Management", function () {
    it("should create a plan", async function () {
      await expect(contract.createPlan("Basic Plan", PLAN_PRICE_CENTS))
        .to.emit(contract, "PlanCreated")
        .withArgs(1n, "Basic Plan", PLAN_PRICE_CENTS);

      const plan = await contract.getPlan(1);
      expect(plan.name).to.equal("Basic Plan");
      expect(plan.pricePerDayUsdCents).to.equal(PLAN_PRICE_CENTS);
      expect(plan.active).to.be.true;
    });

    it("should reject zero price plan", async function () {
      await expect(contract.createPlan("Free Plan", 0))
        .to.be.revertedWithCustomError(contract, "PlanPriceMustBePositive");
    });

    it("should update a plan", async function () {
      await contract.createPlan("Basic Plan", PLAN_PRICE_CENTS);

      await expect(contract.updatePlan(1, "Premium Plan", 2000n, false))
        .to.emit(contract, "PlanUpdated")
        .withArgs(1n, "Premium Plan", 2000n, false);

      const plan = await contract.getPlan(1);
      expect(plan.name).to.equal("Premium Plan");
      expect(plan.pricePerDayUsdCents).to.equal(2000n);
      expect(plan.active).to.be.false;
    });

    it("should reject non-owner plan creation", async function () {
      await expect(contract.connect(user1).createPlan("Hacker Plan", 100))
        .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  describe("Payment Methods (Token via Pair)", function () {
    it("should add a payment method", async function () {
      const tokenAddr = await paymentToken.getAddress();
      const pairAddr = await mockPair.getAddress();
      const stablecoinAddr = await stablecoin.getAddress();

      await expect(contract.addPaymentMethod(tokenAddr, pairAddr, stablecoinAddr))
        .to.emit(contract, "PaymentMethodAdded")
        .withArgs(2n, tokenAddr, pairAddr, stablecoinAddr); // ID 2 (1 is reserved)

      const pm = await contract.getPaymentMethod(2);
      expect(pm.tokenAddress).to.equal(tokenAddr);
      expect(pm.pairAddress).to.equal(pairAddr);
      expect(pm.stablecoinAddress).to.equal(stablecoinAddr);
      expect(pm.tokenDecimals).to.equal(18);
      expect(pm.stablecoinDecimals).to.equal(6);
      expect(pm.active).to.be.true;
    });

    it("should reject if token not in pair", async function () {
      const MockToken = await ethers.getContractFactory("MockERC20");
      const randomToken = await MockToken.deploy("Random", "RND", 18);

      await expect(contract.addPaymentMethod(
        await randomToken.getAddress(),
        await mockPair.getAddress(),
        await stablecoin.getAddress()
      )).to.be.revertedWithCustomError(contract, "TokenNotInPair");
    });
  });

  describe("Subscription Purchase (Token)", function () {
    beforeEach(async function () {
      await contract.createPlan("Basic Plan", PLAN_PRICE_CENTS);
      await contract.addPaymentMethod(
        await paymentToken.getAddress(),
        await mockPair.getAddress(),
        await stablecoin.getAddress()
      );
    });

    it("should buy a subscription with token", async function () {
      const days = 30n;
      const expectedCost = await contract.calculatePayment(1, days, 2);

      const initialBalance = await paymentToken.balanceOf(user1.address);

      await expect(contract.connect(user1).buySubscription(1, days, 2, "0x"))
        .to.emit(contract, "SubscriptionCreated");

      const finalBalance = await paymentToken.balanceOf(user1.address);
      expect(initialBalance - finalBalance).to.equal(expectedCost);

      const sub = await contract.getSubscription(1);
      expect(sub.subscriber).to.equal(user1.address);
      expect(sub.planId).to.equal(1n);
      expect(sub.isActive).to.be.true;
    });

    it("should calculate correct payment with slippage", async function () {
      // $10/day * 30 days = $300
      // Token price is $1, so 300 tokens + 1% slippage = 303 tokens
      const payment = await contract.calculatePayment(1, 30, 2);
      expect(payment).to.equal(ethers.parseUnits("303", 18));
    });
  });

  describe("Subscription Extension", function () {
    beforeEach(async function () {
      await contract.setPrimaryStablecoin(await stablecoin.getAddress());
      await contract.createPlan("Basic Plan", PLAN_PRICE_CENTS);
      await contract.connect(user1).buySubscription(1, 30, STABLECOIN_PAYMENT_ID, "0x");
    });

    it("should extend an active subscription", async function () {
      const subBefore = await contract.getSubscription(1);

      await expect(contract.connect(user1).extendSubscription(1, 30, STABLECOIN_PAYMENT_ID))
        .to.emit(contract, "SubscriptionExtended");

      const subAfter = await contract.getSubscription(1);
      expect(subAfter.expiresAt - subBefore.expiresAt).to.equal(BigInt(30 * ONE_DAY));
    });

    it("should allow anyone to extend (gifting)", async function () {
      await expect(contract.connect(user2).extendSubscription(1, 15, STABLECOIN_PAYMENT_ID))
        .to.emit(contract, "SubscriptionExtended");
    });

    it("should extend expired subscription from now", async function () {
      await time.increase(31 * ONE_DAY);

      const now = BigInt(await time.latest());

      await contract.connect(user1).extendSubscription(1, 30, STABLECOIN_PAYMENT_ID);

      const sub = await contract.getSubscription(1);
      expect(sub.expiresAt).to.be.closeTo(now + BigInt(30 * ONE_DAY), 10n);
    });

    it("should reject extension of cancelled subscription", async function () {
      await contract.cancelSubscription(1);

      await expect(contract.connect(user1).extendSubscription(1, 30, STABLECOIN_PAYMENT_ID))
        .to.be.revertedWithCustomError(contract, "SubscriptionAlreadyCancelled");
    });
  });

  describe("Subscription Cancellation", function () {
    beforeEach(async function () {
      await contract.setPrimaryStablecoin(await stablecoin.getAddress());
      await contract.createPlan("Basic Plan", PLAN_PRICE_CENTS);
      await contract.connect(user1).buySubscription(1, 30, STABLECOIN_PAYMENT_ID, "0x");
    });

    it("should cancel a subscription", async function () {
      await expect(contract.cancelSubscription(1))
        .to.emit(contract, "SubscriptionCancelled")
        .withArgs(1n, 1n, user1.address);

      const sub = await contract.getSubscription(1);
      expect(sub.isActive).to.be.false;
      expect(sub.cancelled).to.be.true;
    });

    it("should reject double cancellation", async function () {
      await contract.cancelSubscription(1);

      await expect(contract.cancelSubscription(1))
        .to.be.revertedWithCustomError(contract, "SubscriptionAlreadyCancelled");
    });

    it("should reject non-owner cancellation", async function () {
      await expect(contract.connect(user1).cancelSubscription(1))
        .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  describe("Fund Withdrawal", function () {
    beforeEach(async function () {
      await contract.setPrimaryStablecoin(await stablecoin.getAddress());
      await contract.createPlan("Basic Plan", PLAN_PRICE_CENTS);
      await contract.connect(user1).buySubscription(1, 30, STABLECOIN_PAYMENT_ID, "0x");
    });

    it("should withdraw stablecoin funds", async function () {
      const contractBalance = await stablecoin.balanceOf(await contract.getAddress());
      const ownerBalanceBefore = await stablecoin.balanceOf(owner.address);

      await expect(contract.withdrawFunds(await stablecoin.getAddress(), owner.address))
        .to.emit(contract, "FundsWithdrawn");

      const ownerBalanceAfter = await stablecoin.balanceOf(owner.address);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(contractBalance);
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await contract.setPrimaryStablecoin(await stablecoin.getAddress());
      await contract.createPlan("Basic Plan", PLAN_PRICE_CENTS);
    });

    it("should return correct days remaining", async function () {
      await contract.connect(user1).buySubscription(1, 30, STABLECOIN_PAYMENT_ID, "0x");

      const days = await contract.daysRemaining(1);
      expect(days).to.be.gte(29n);
      expect(days).to.be.lte(30n);

      await time.increase(10 * ONE_DAY);

      const daysAfter = await contract.daysRemaining(1);
      expect(daysAfter).to.be.gte(19n);
      expect(daysAfter).to.be.lte(20n);
    });

    it("should return 0 days for expired subscription", async function () {
      await contract.connect(user1).buySubscription(1, 5, STABLECOIN_PAYMENT_ID, "0x");

      await time.increase(6 * ONE_DAY);

      const days = await contract.daysRemaining(1);
      expect(days).to.equal(0n);
    });

    it("should get subscriptions by subscriber", async function () {
      await contract.connect(user1).buySubscription(1, 30, STABLECOIN_PAYMENT_ID, "0x");
      await contract.connect(user1).buySubscription(1, 15, STABLECOIN_PAYMENT_ID, "0x");
      await contract.connect(user2).buySubscription(1, 30, STABLECOIN_PAYMENT_ID, "0x");

      const user1Subs = await contract.getSubscriptionsBySubscriber(user1.address);
      expect(user1Subs.length).to.equal(2);
      expect(user1Subs[0]).to.equal(1n);
      expect(user1Subs[1]).to.equal(2n);
    });
  });

  describe("Security", function () {
    beforeEach(async function () {
      await contract.createPlan("Basic Plan", PLAN_PRICE_CENTS);
    });

    it("should reject low liquidity pairs", async function () {
      const MockPair = await ethers.getContractFactory("MockUniswapV2Pair");
      const lowLiquidityPair = await MockPair.deploy(
        await paymentToken.getAddress(),
        await stablecoin.getAddress(),
        ethers.parseUnits("1000", 18),
        ethers.parseUnits("1000", 6)
      );

      await contract.addPaymentMethod(
        await paymentToken.getAddress(),
        await lowLiquidityPair.getAddress(),
        await stablecoin.getAddress()
      );

      await expect(contract.connect(user1).buySubscription(1, 30, 2, "0x"))
        .to.be.revertedWithCustomError(contract, "InsufficientLiquidity");
    });

    it("should not apply liquidity check to stablecoin payments", async function () {
      await contract.setPrimaryStablecoin(await stablecoin.getAddress());

      // Stablecoin payments don't need liquidity check
      await expect(contract.connect(user1).buySubscription(1, 30, STABLECOIN_PAYMENT_ID, "0x"))
        .to.emit(contract, "SubscriptionCreated");
    });

    it("should calculate correct price with expensive tokens", async function () {
      // Create a pair where 1 token = $2000
      const MockPair = await ethers.getContractFactory("MockUniswapV2Pair");
      const expensivePair = await MockPair.deploy(
        await paymentToken.getAddress(),
        await stablecoin.getAddress(),
        ethers.parseUnits("50", 18),
        ethers.parseUnits("100000", 6)
      );

      await contract.addPaymentMethod(
        await paymentToken.getAddress(),
        await expensivePair.getAddress(),
        await stablecoin.getAddress()
      );

      const price = await contract.getTokenPriceUsdCents(2);
      expect(price).to.equal(200000n); // $2000

      // $300 / $2000 = 0.15 tokens + 1% slippage = 0.1515
      const payment = await contract.calculatePayment(1, 30, 2);
      expect(payment).to.equal(ethers.parseUnits("0.1515", 18));
    });
  });
});
