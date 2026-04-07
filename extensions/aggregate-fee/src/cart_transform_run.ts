import {
  CartTransformRunInput,
  CartTransformRunResult,
} from "../generated/api";

const FEE_PERCENTAGE = 0.052;

export function cartTransformRun(input: CartTransformRunInput): CartTransformRunResult {
  const operations: any[] = [];

  for (const line of input.cart.lines) {
    const merchandise = line.merchandise;
    if (merchandise.__typename !== "ProductVariant") continue;

    // Checks
    const isDirectlyTargeted = merchandise.product.inAnyCollection;
    const isSeftonPark = merchandise.id === "gid://shopify/ProductVariant/57554789990787";
    const parent = (line as any).parentRelationship?.parent?.merchandise;
    const isBundleComponent = 
      parent?.product?.inAnyCollection ||
      parent?.id === "gid://shopify/ProductVariant/57554789990787";

    if (isDirectlyTargeted || isSeftonPark || isBundleComponent) {
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