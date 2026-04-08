import type {
  CartTransformRunInput,
  CartTransformRunResult,
  Operation,
} from "../generated/api";

const NO_CHANGES: CartTransformRunResult = {
  operations: [],
};

export function cartTransformRun(
  input: CartTransformRunInput
): CartTransformRunResult {
  const FEE_PERCENTAGE = 0.052;

  // ✅ Correct Variant ID
  const feeVariantId = "gid://shopify/ProductVariant/57708706627971";

  const operations: Operation[] = [];

  for (const line of input.cart.lines) {
    const merchandise = line.merchandise;

    if (merchandise.__typename !== "ProductVariant") continue;

    // ✅ Detect Bundle Variant
    if (merchandise.id === "gid://shopify/ProductVariant/57554789990787") {
      const unitPrice = parseFloat(
        line.cost.amountPerQuantity.amount
      );

      const feeAmount = (unitPrice * FEE_PERCENTAGE).toFixed(2);

      operations.push({
        lineExpand: {
          cartLineId: line.id,
          expandedCartItems: [
            {
              // Original bundle
              merchandiseId: merchandise.id,
              quantity: line.quantity,
              price: {
                adjustment: {
                  fixedPricePerUnit: {
                    amount: unitPrice.toFixed(2),
                  },
                },
              },
            },
            {
              // 🔥 Surcharge product
              merchandiseId: feeVariantId,
              quantity: line.quantity,
              price: {
                adjustment: {
                  fixedPricePerUnit: {
                    amount: feeAmount,
                  },
                },
              },
            },
          ],
        },
      });
    }
  }

  return { operations };
}