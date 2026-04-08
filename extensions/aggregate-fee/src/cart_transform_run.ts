import type {
  CartTransformRunInput,
  CartTransformRunResult,
  Operation,
} from "../generated/api";

const NO_CHANGES: CartTransformRunResult = {
  operations: [],
};

export function cartTransformRun(input: CartTransformRunInput): CartTransformRunResult {
  const operations: Operation[] = [];

  for (const line of input.cart.lines) {
    const merchandise = line.merchandise;

    if (merchandise.__typename !== "ProductVariant") continue;

    // ✅ Fee product detect
    if (merchandise.id === "gid://shopify/ProductVariant/57708706627971") {

      const feeAmountStr = (line as any).fee?.value;

      if (!feeAmountStr) continue;

      const feeAmount = parseFloat(feeAmountStr);

      operations.push({
        lineUpdate: {
          cartLineId: line.id,
          price: {
            adjustment: {
              fixedPricePerUnit: {
                amount: feeAmount.toFixed(2),
              },
            },
          },
        },
      });
    }
  }

  return { operations };
}