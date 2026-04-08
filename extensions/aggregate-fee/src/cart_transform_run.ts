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
  const FEE_PERCENTAGE = 0.052; // 5.2%

  const operations: Operation[] = [];

  for (const line of input.cart.lines) {
    const merchandise = line.merchandise;

    if (merchandise.__typename !== "ProductVariant") continue;

    if (
      merchandise.product.inAnyCollection ||
      merchandise.id === "gid://shopify/ProductVariant/57554789990787"
    ) {
      const unitPrice = parseFloat(
        line.cost.amountPerQuantity.amount
      );

      // ✅ Calculate increased price
      const newPrice = (unitPrice * (1 + FEE_PERCENTAGE)).toFixed(2);

      operations.push({
        lineUpdate: {
          cartLineId: line.id,
          price: {
            adjustment: {
              fixedPricePerUnit: {
                amount: newPrice,
              },
            },
          },
        },
      });
    }
  }

  return {
    operations,
  };
}