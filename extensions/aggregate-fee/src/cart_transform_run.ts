import type {
  CartTransformRunInput,
  CartTransformRunResult,
  Operation,
} from "../generated/api";

const NO_CHANGES: CartTransformRunResult = {
  operations: [],
};

export function cartTransformRun(input: CartTransformRunInput): CartTransformRunResult {
  const FEE_PERCENTAGE = 0.052;

  const feeVariantId = input.shop?.metafield?.value;

  if (!feeVariantId) {
    return { operations: [] };
  }

  const operations: Operation[] = [];

  for (const line of input.cart.lines) {
    const merchandise = line.merchandise;
    if (merchandise.__typename !== "ProductVariant") continue;

    const product = merchandise.product;

    const isCollectionProduct = product.inAnyCollection;
    const bundleSurchargeId = (merchandise as any).metafield?.value;

    // 🟢 EXISTING COLLECTION LOGIC (unchanged)
    if (isCollectionProduct) {
      const unitPrice = parseFloat(line.cost.amountPerQuantity.amount);
      const feeAmount = (unitPrice * FEE_PERCENTAGE).toFixed(2);

      operations.push({
        lineExpand: {
          cartLineId: line.id,
          expandedCartItems: [
            {
              merchandiseId: merchandise.id,
              quantity: 1,
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

      continue; // ❗ very important
    }

    // 🔥 NEW BUNDLE LOGIC
    if (bundleSurchargeId) {
      operations.push({
        lineExpand: {
          cartLineId: line.id,
          expandedCartItems: [
            {
              merchandiseId: merchandise.id,
              quantity: 1,
            },
            {
              merchandiseId: bundleSurchargeId,
              quantity: 1,
            },
          ],
        },
      });
    }
  }

  return { operations };
}