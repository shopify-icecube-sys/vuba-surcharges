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

    const productHandle = (merchandise.product as any).handle;

    // Targeting by Handle is much more reliable than GIDs
    const isSeftonPark = productHandle === "sefton-park-1";
    const isDirectlyTargeted = merchandise.product.inAnyCollection;

    if (isDirectlyTargeted || isSeftonPark) {
      const unitPrice = parseFloat(line.cost.amountPerQuantity.amount);
      const feeAmount = (unitPrice * FEE_PERCENTAGE).toFixed(2);
      const totalPrice = (unitPrice + parseFloat(feeAmount)).toFixed(2);

      operations.push({
        lineUpdate: {
          cartLineId: line.id,
          // Update title temporarily to confirm targeting is working
          title: isSeftonPark ? `Sefton Park (Surcharge Included)` : undefined,
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