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
    const isSeftonPark = merchandise.id === "gid://shopify/ProductVariant/57554789990787";
    const isBundleComponentTargeted =
      (line as any).parentRelationship?.parent?.merchandise?.__typename === "ProductVariant" &&
      (line as any).parentRelationship.parent.merchandise.product.inAnyCollection;

    const debugValue = `Handle: ${merchandise.product.handle} | InColl: ${isDirectlyTargeted} | Type: ${(merchandise.product as any).productType}`;

    if (isDirectlyTargeted || isTargetType || isSeftonPark || isBundleComponentTargeted) {
      const unitPrice = parseFloat(line.cost.amountPerQuantity.amount);
      const feeAmount = (unitPrice * FEE_PERCENTAGE).toFixed(2);
      const totalPrice = (unitPrice + parseFloat(feeAmount)).toFixed(2);

      operations.push({
        lineUpdate: {
          cartLineId: line.id,
          price: {
            adjustment: {
              fixedPricePerUnit: {
                amount: totalPrice,
              },
            },
          },
        },
      } as any);
    }
  }

  return {
    operations,
  };
}