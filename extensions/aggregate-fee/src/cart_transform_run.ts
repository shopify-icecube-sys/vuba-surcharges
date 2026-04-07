import {
  CartTransformRunInput,
  CartTransformRunResult,
} from "../generated/api";

const FEE_PERCENTAGE = 0.052;

export const run = (input: CartTransformRunInput): CartTransformRunResult => {
  const operations: any[] = [];

  for (const line of input.cart.lines) {
    const merchandise = line.merchandise;
    if (merchandise.__typename !== "ProductVariant") continue;

    // Direct Collection check
    const isDirectlyTargeted = merchandise.product.inAnyCollection;

    // Sefton Park Variant ID check
    const isSeftonPark = merchandise.id === "gid://shopify/ProductVariant/57554789990787";

    // Bundle Parent check (Checks if parent is in collection or is Sefton Park)
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
    operations: operations,
  };
};