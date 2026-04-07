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

  for (const line of input.cart.lines) {
    const merchandise = line.merchandise;
    if (merchandise.__typename !== "ProductVariant") continue;

    const isDirectlyTargeted = merchandise.product.inAnyCollection;
    const isTargetType = (merchandise.product as any).productType === "Resin Bound Kit";
    const isBundleComponentTargeted =
      (line as any).parentRelationship?.parent?.merchandise?.__typename === "ProductVariant" &&
      (line as any).parentRelationship.parent.merchandise.product.inAnyCollection;

    const debugValue = `Handle: ${merchandise.product.handle} | InColl: ${isDirectlyTargeted} | Type: ${(merchandise.product as any).productType}`;

    if (isDirectlyTargeted || isTargetType || isBundleComponentTargeted) {
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
              attributes: [
                {
                  key: "_debug_status",
                  value: debugValue,
                },
              ],
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
              attributes: [
                {
                  key: "_debug_type",
                  value: (merchandise.product as any).productType || "Missing",
                },
              ],
            },
          ],
        },
      });
    }
  }

  return {
    operations,
  };
}