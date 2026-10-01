import type { Market, Quote, TradeSide } from '../data/types';

/**
 * Constant-product AMM math (x · y = k) with the fee taken on the input side.
 * The same functions are used for quoting in the UI and for executing trades in
 * the simulation, so the "estimated" numbers a user sees are produced by the
 * exact code path that settles the trade.
 */
export function spotPrice(m: Pick<Market, 'reserveQuote' | 'reserveToken'>) {
  return m.reserveQuote / m.reserveToken;
}

export function quote(m: Market, side: TradeSide, inputAmount: number, slippage: number): Quote {
  const spot = spotPrice(m);
  if (inputAmount <= 0 || !Number.isFinite(inputAmount)) {
    return { side, tokenId: m.tokenId, inputAmount: 0, outputAmount: 0, avgPrice: spot, priceImpact: 0, fee: 0, minReceived: 0 };
  }
  if (side === 'buy') {
    const fee = inputAmount * m.feeRate;
    const dx = inputAmount - fee;
    const out = (m.reserveToken * dx) / (m.reserveQuote + dx);
    const avgPrice = inputAmount / out;
    return {
      side, tokenId: m.tokenId, inputAmount, outputAmount: out, avgPrice,
      priceImpact: avgPrice / spot - 1, fee, minReceived: out * (1 - slippage),
    };
  }
  const gross = (m.reserveQuote * inputAmount) / (m.reserveToken + inputAmount);
  const fee = gross * m.feeRate;
  const out = gross - fee;
  const avgPrice = out / inputAmount;
  return {
    side, tokenId: m.tokenId, inputAmount, outputAmount: out, avgPrice,
    priceImpact: 1 - avgPrice / spot, fee, minReceived: out * (1 - slippage),
  };
}

/** Apply a swap to the reserves. Returns output amount. Fees stay in the pool. */
export function applySwap(m: Market, side: TradeSide, inputAmount: number) {
  if (side === 'buy') {
    const dx = inputAmount * (1 - m.feeRate);
    const out = (m.reserveToken * dx) / (m.reserveQuote + dx);
    m.reserveQuote += inputAmount;
    m.reserveToken -= out;
    m.price = spotPrice(m);
    m.volumeQuote += inputAmount;
    return out;
  }
  const gross = (m.reserveQuote * inputAmount) / (m.reserveToken + inputAmount);
  const out = gross * (1 - m.feeRate);
  m.reserveQuote -= out;
  m.reserveToken += inputAmount;
  m.price = spotPrice(m);
  m.volumeQuote += out;
  return out;
}

export const marketCapQuote = (m: Market, totalSupply: number) => m.price * totalSupply;
export const liquidityQuote = (m: Market) => m.reserveQuote * 2;
