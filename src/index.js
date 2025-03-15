const FlashLoanArbitrageBot = require('./bot/FlashLoanArbitrageBot');

async function main() {
    try {
        const bot = new FlashLoanArbitrageBot();
        await bot.initialize();
        await bot.start();
    } catch (error) {
        console.error('Bot failed to start:', error);
        process.exit(1);
    }
}

main();