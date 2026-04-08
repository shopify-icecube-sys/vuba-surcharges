import type {
  CartTransformRunInput,
  CartTransformRunResult,
  Operation,
} from "../generated/api";

const NO_CHANGES: CartTransformRunResult = {
  operations: [],
};

export function cartTransformRun(input: CartTransformRunInput): CartTransformRunResult {
  const operations: Operation[] = [];

  for (const line of input.cart.lines) {
    const merchandise = line.merchandise;

    if (merchandise.__typename !== "ProductVariant") continue;

    // 🔥 DEBUG: product title me data show karo
    operations.push({
      lineUpdate: {
        cartLineId: line.id,
        title: `${merchandise.product.handle} | ${merchandise.id}`,
      },
    });
  }

  return { operations };
}