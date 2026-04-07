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

    const targetCollectionIds = [
      "gid://shopify/Collection/446838440227",
      "gid://shopify/Collection/701490528643",
    ];

    // ✅ New Check: Loop through all product collections (Direct)
    const isDirectlyTargeted = (merchandise.product as any).collections.nodes.some((c: any) =>
      targetCollectionIds.includes(c.id)
    );

    // ✅ New Check: Loop through all parent bundle collections (Indirect)
    const isBundleComponent = (line as any).parentRelationship?.parent?.merchandise?.__typename === "ProductVariant" &&
      ((line as any).parentRelationship.parent.merchandise.product.collections as any).nodes.some((c: any) =>
        targetCollectionIds.includes(c.id)
      );

    if (isDirectlyTargeted || isBundleComponent) {
      const unitPrice = parseFloat(line.cost.amountPerQuantity.amount);
      const feeAmount = (unitPrice * FEE_PERCENTAGE).toFixed(2);

      operations.push({
        lineExpand: {
          cartLineId: line.id,
          expandedCartItems: [
            {
              merchandiseId: merchandise.id,
              quantity: 1, // Must be original quantity
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
              quantity: 1, // Must be same quantity to match subtotal
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

  return {
    operations,
  };
}