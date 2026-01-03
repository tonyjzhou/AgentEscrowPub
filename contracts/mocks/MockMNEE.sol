// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockMNEE
 * @notice Mock MNEE token for testing
 */
contract MockMNEE is ERC20 {
    constructor() ERC20("Mock MNEE", "MNEE") {}

    /**
     * @notice Mint tokens to an address (for testing)
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
