require('dotenv').config();
const { ethers } = require('ethers');

module.exports = {
    rpcUrl: `https://mainnet.infura.io/v3/${process.env.INFURA_KEY}`,
    privateKey: process.env.PRIVATE_KEY,
    chainId: 1, // Mainnet
    minProfitThreshold: '100000000000000000', // 0.1 ETH
    protocolinkApi: 'https://api.protocolink.com',
    addresses: {
        uniswapV2Router: ethers.utils.getAddress('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'),
        aaveV3Pool: ethers.utils.getAddress('0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2'),
        balancerV2Vault: ethers.utils.getAddress('0xBA12222222228d8Ba445958a75a0704d566BF2C8')
    },
    tokens: {
        WETH: ethers.utils.getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
        USDC: ethers.utils.getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
        DAI: ethers.utils.getAddress('0x6B175474E89094C44Da98b954EedeAC495271d0F')
    },
    balancerPoolId: '0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019' // WETH-USDC 50/50
};