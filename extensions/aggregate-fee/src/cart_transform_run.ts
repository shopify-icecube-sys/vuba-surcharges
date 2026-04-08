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
  const operations: Operation[] = [];

  console.log("===== CART DEBUG START =====");

  for (const line of input.cart.lines) {
    const merchandise = line.merchandise;

    if (merchandise.__typename !== "ProductVariant") continue;

    console.log("---- LINE ----");
    console.log("Line ID:", line.id);
    console.log("Quantity:", line.quantity);
    console.log("Variant ID:", merchandise.id);
    console.log("Product Handle:", merchandise.product.handle);
    console.log("In Collection:", merchandise.product.inAnyCollection);
    console.log("Price:", line.cost.amountPerQuantity.amount);
  }

  console.log("===== CART DEBUG END =====");

  return { operations };
}