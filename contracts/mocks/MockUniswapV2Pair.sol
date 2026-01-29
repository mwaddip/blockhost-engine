// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockUniswapV2Pair {
    address public token0;
    address public token1;
    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;

    constructor(
        address _token0,
        address _token1,
        uint112 _reserve0,
        uint112 _reserve1
    ) {
        // Ensure token0 < token1 (Uniswap V2 convention)
        if (_token0 < _token1) {
            token0 = _token0;
            token1 = _token1;
            reserve0 = _reserve0;
            reserve1 = _reserve1;
        } else {
            token0 = _token1;
            token1 = _token0;
            reserve0 = _reserve1;
            reserve1 = _reserve0;
        }
        blockTimestampLast = uint32(block.timestamp);
    }

    function getReserves() external view returns (
        uint112 _reserve0,
        uint112 _reserve1,
        uint32 _blockTimestampLast
    ) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    // Test helpers
    function setReserves(uint112 _reserve0, uint112 _reserve1) external {
        reserve0 = _reserve0;
        reserve1 = _reserve1;
        blockTimestampLast = uint32(block.timestamp);
    }
}
