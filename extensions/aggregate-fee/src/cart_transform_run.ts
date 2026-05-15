import type {
  CartTransformRunInput,
  CartTransformRunResult,
  Operation,
} from "../generated/api";

const NO_CHANGES: CartTransformRunResult = {
  operations: [],
};

export function cartTransformRun(input: CartTransformRunInput): CartTransformRunResult {
  const FEE_PERCENTAGE = 0.052; // 5.2%
  const feeVariantId = input.shop?.metafield?.value;
  if (!feeVariantId) {
    return NO_CHANGES;
  }
  const operations: Operation[] = [];
  const isSurchargeAlreadyPresent = input.cart.lines.some(line => {
    if (line.merchandise.__typename !== "ProductVariant") return false;
    return line.merchandise.id === feeVariantId || line.attribute?.value === "true";
  });
  if (isSurchargeAlreadyPresent) {
    return NO_CHANGES;
  }
  for (const line of input.cart.lines) {
    const merchandise = line.merchandise;
    if (merchandise.__typename !== "ProductVariant") continue;
    if (merchandise.product.inAnyCollection) {
      const unitPrice = parseFloat(line.cost.amountPerQuantity.amount);
      const feeAmount = (unitPrice * FEE_PERCENTAGE).toFixed(2);
      operations.push({
        lineExpand: {
          cartLineId: line.id,
          expandedCartItems: [
            {
              merchandiseId: merchandise.id,
              quantity: 1,
              price: {
                adjustment: {
                  fixedPricePerUnit: {
                    amount: unitPrice.toFixed(2),
                  },
                },
              },
            },
            {
              merchandiseId: feeVariantId,
              quantity: 1,
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