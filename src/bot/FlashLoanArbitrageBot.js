const { Web3 } = require('web3');
const { ethers } = require('ethers');
const protocolink = require('@protocolink/api');
const config = require('../config/config');
const uniswapV2Abi = require('../abis/uniswapV2.json');
const aaveV3Abi = require('../abis/aaveV3.json');
const balancerV2Abi = require('../abis/balancerV2.json');

class FlashLoanArbitrageBot {
    constructor() {
        this.web3 = new Web3(config.rpcUrl);
        this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
        this.wallet = new ethers.Wallet(config.privateKey, this.provider);
        this.running = false;
        this.lastTrade = 0;
    }

    async initialize() {
        await protocolink.init({
            chainId: config.chainId,
            account: this.wallet.address
        });
        console.log('Bot initialized for address:', this.wallet.address);
    }

    async checkArbitrageOpportunity(tokenIn, tokenOut, amount) {
        try {
            console.log('Fetching quotes for', tokenIn, 'to', tokenOut);
            const uniswapQuote = await this.getUniswapQuote(tokenIn, tokenOut, amount);
            console.log('Uniswap quote:', ethers.utils.formatUnits(uniswapQuote, 6)); // USDC has 6 decimals
            const balancerQuote = await this.getBalancerQuote(tokenIn, tokenOut, amount);
            console.log('Balancer quote:', ethers.utils.formatUnits(balancerQuote, 6));

            const profit = balancerQuote.sub(uniswapQuote);
            return {
                profitable: profit.gt(config.minProfitThreshold),
                profit: profit,
                buyFrom: 'uniswap',
                sellTo: 'balancer'
            };
        } catch (error) {
            console.error('Arbitrage check failed:', error);
            return { profitable: false };
        }
    }

    async getLendingRates(token) {
        const aaveContract = new ethers.Contract(
            config.addresses.aaveV3Pool,
            aaveV3Abi,
            this.provider
        );
        
        console.log('Fetching lending rates for token:', token);
        const data = await aaveContract.getReserveData(token);
        console.log('Lending rates:', {
            supplyRate: data.currentLiquidityRate.toString(),
            borrowRate: data.currentVariableBorrowRate.toString()
        });
        return {
            supplyRate: data.currentLiquidityRate,
            borrowRate: data.currentVariableBorrowRate
        };
    }

    async buildFlashLoanTransaction(amount, tokenIn, tokenOut, arbData) {
        const flashLoanParams = {
            protocolId: 'aave-v3',
            loans: [{
                token: tokenIn,
                amount: amount.toString()
            }]
        };

        const logics = [];

        console.log('Building flash loan logic...');
        const flashLoanLogic = await protocolink.protocols.aavev3.newFlashLoanLogic(flashLoanParams);
        logics.push(flashLoanLogic);

        if (arbData.buyFrom === 'uniswap') {
            console.log('Building Uniswap swap logic...');
            const swapLogic = await protocolink.protocols.uniswapv2.newSwapLogic({
                input: { token: tokenIn, amount: amount.toString() },
                output: { token: tokenOut },
                router: config.addresses.uniswapV2Router
            });
            logics.push(swapLogic);

            console.log('Building Balancer swap logic...');
            const balancerSwapLogic = await protocolink.protocols.balancerv2.newSwapLogic({
                poolId: config.balancerPoolId,
                input: { token: tokenOut, amount: arbData.profit.toString() },
                output: { token: tokenIn },
                vault: config.addresses.balancerV2Vault
            });
            logics.push(balancerSwapLogic);
        }

        const rates = await this.getLendingRates(tokenOut);
        if (this.isLeverageProfitable(rates)) {
            console.log('Building leverage logic...');
            const supplyLogic = await protocolink.protocols.aavev3.newSupplyLogic({
                token: tokenOut,
                amount: amount.div(2).toString()
            });
            const borrowLogic = await protocolink.protocols.aavev3.newBorrowLogic({
                token: tokenIn,
                amount: amount.div(4).toString()
            });
            logics.push(supplyLogic, borrowLogic);
        }

        const repayAmount = amount.mul(10009).div(10000); // Aave V3 fee: 0.09%
        console.log('Building repay logic with amount:', ethers.utils.formatEther(repayAmount));
        const repayLogic = await protocolink.protocols.aavev3.newFlashLoanRepayLogic({
            token: tokenIn,
            amount: repayAmount.toString()
        });
        logics.push(repayLogic);

        return logics;
    }

    async start() {
        this.running = true;
        console.log('Starting arbitrage bot...');

        while (this.running) {
            try {
                console.log('Starting new arbitrage check...');
                const amount = ethers.utils.parseEther('0.1'); // 0.1 ETH for mainnet
                console.log('Checking arbitrage opportunity with amount:', ethers.utils.formatEther(amount), 'ETH');
                const arbData = await this.checkArbitrageOpportunity(
                    config.tokens.WETH,
                    config.tokens.USDC,
                    amount
                );

                console.log('Arbitrage data:', arbData);
                if (arbData.profitable) {
                    console.log(`Found opportunity! Profit: ${ethers.utils.formatEther(arbData.profit)} ETH`);
                    
                    const logics = await this.buildFlashLoanTransaction(
                        amount,
                        config.tokens.WETH,
                        config.tokens.USDC,
                        arbData
                    );

                    console.log('Building transaction request...');
                    const txRequest = await protocolink.buildTransactionRequest({
                        chainId: config.chainId,
                        account: this.wallet.address,
                        logics: logics
                    });

                    console.log('Signing transaction...');
                    const signedTx = await this.wallet.signTransaction(txRequest);
                    console.log('Sending transaction...');
                    const tx = await this.provider.sendTransaction(signedTx);
                    console.log(`Transaction executed: ${tx.hash}`);
                    
                    await tx.wait();
                    this.lastTrade = Date.now();
                    await this.wait(60000);
                } else {
                    console.log('No profitable opportunity found.');
                }

                console.log('Waiting 10 seconds before next check...');
                await this.wait(10000);
            } catch (error) {
                console.error('Trading loop error:', error);
                await this.wait(30000);
            }
        }
    }

    async getUniswapQuote(tokenIn, tokenOut, amount) {
        const contract = new ethers.Contract(
            config.addresses.uniswapV2Router,
            uniswapV2Abi,
            this.provider
        );
        console.log('Calling getAmountsOut on Uniswap router...');
        const amounts = await contract.getAmountsOut(amount, [tokenIn, tokenOut]);
        return amounts[1];
    }

    async getBalancerQuote(tokenIn, tokenOut, amount) {
        const vaultContract = new ethers.Contract(
            config.addresses.balancerV2Vault,
            balancerV2Abi,
            this.provider
        );
        console.log('Calling queryBatchSwap on Balancer Vault...');
        const swap = [{
            poolId: config.balancerPoolId,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: amount.toString(),
            userData: '0x'
        }];
        const funds = {
            sender: this.wallet.address,
            fromInternalBalance: false,
            recipient: this.wallet.address,
            toInternalBalance: false
        };
        const assets = [tokenIn, tokenOut];
        const amounts = await vaultContract.queryBatchSwap(0, swap, assets, funds);
        return amounts[1].mul(-1); // Convert negative delta to positive output
    }

    isLeverageProfitable(rates) {
        return rates.supplyRate.gt(rates.borrowRate);
    }

    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    stop() {
        this.running = false;
    }
}

module.exports = FlashLoanArbitrageBot;