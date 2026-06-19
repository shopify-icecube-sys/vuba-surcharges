import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { topic, admin, payload } = await authenticate.webhook(request);

    console.log("=== WEBHOOK RECEIVED ===");
    console.log("Topic:", topic);
    console.log("Admin available:", !!admin);

    if (!admin) {
        console.log("No admin API client — skipping.");
        return new Response();
    }

    // Sirf draft order create aur update ke time process run hoga
    if (topic === "DRAFT_ORDERS_CREATE" || topic === "DRAFT_ORDERS_UPDATE") {
        try {
            const draftOrder = payload;

            // 1. Draft Order ke saare products aur variants ki ek Unique gids list banana
            const productIds = draftOrder.line_items
                .filter((item: any) => item.product_id)
                .map((item: any) => `gid://shopify/Product/${item.product_id}`);

            const variantIds = draftOrder.line_items
                .filter((item: any) => item.variant_id)
                .map((item: any) => `gid://shopify/ProductVariant/${item.variant_id}`);

            // Agar sirf manual items hain aur koi product/variant nahi hai to process rok denge
            console.log("Product IDs found:", productIds);
            console.log("Variant IDs found:", variantIds);
            if (productIds.length === 0 && variantIds.length === 0) {
                console.log("No product or variant IDs found — skipping.");
                return new Response("OK", { status: 200 });
            }

            // 2. GraphQL ke zariye eksath unsab products aur variants ke Surcharge Metafield nikalna
            const getMetafieldsQuery = `#graphql
        query getMetafields($productIds: [ID!]!, $variantIds: [ID!]!) {
          products: nodes(ids: $productIds) {
            ... on Product {
              id
              surchargeVariant: metafield(namespace: "custom", key: "surcharge_variant") {
                value
              }
            }
          }
          variants: nodes(ids: $variantIds) {
            ... on ProductVariant {
              id
              surchargeVariant: metafield(namespace: "custom", key: "surcharge_product_variant_id") {
                value
              }
            }
          }
        }
      `;

            const metafieldsResponse = await admin.graphql(getMetafieldsQuery, {
                variables: { 
                    productIds: [...new Set(productIds)],
                    variantIds: [...new Set(variantIds)] 
                }
            });

            const metafieldsData = await metafieldsResponse.json();
            console.log("Metafields response:", JSON.stringify(metafieldsData.data, null, 2));

            // Ek mapping banayenge: Main Product/Variant ID -> Surcharge Variant ID (Metafield ki value)
            const productSurchargeMap: Record<string, string> = {};
            const variantSurchargeMap: Record<string, string> = {};

            // Draft me pichle existing variants check karna taaki bar-bar add ya double entry na ho
            const existingVariantIds = new Set<string>();
            draftOrder.line_items.forEach((item: any) => {
                if (item.variant_id) {
                    existingVariantIds.add(item.variant_id.toString());
                }
            });

            if (metafieldsData.data?.products) {
                metafieldsData.data.products.forEach((node: any) => {
                    // Agar product milta hai aur usme surcharge variant metafield bhi hai
                    if (node && node.surchargeVariant?.value) {
                        const rawId = node.id.split("/").pop();
                        productSurchargeMap[rawId] = node.surchargeVariant.value;
                    }
                });
            }

            if (metafieldsData.data?.variants) {
                metafieldsData.data.variants.forEach((node: any) => {
                    if (node && node.surchargeVariant?.value) {
                        const rawId = node.id.split("/").pop();
                        variantSurchargeMap[rawId] = node.surchargeVariant.value;
                    }
                });
            }

            // 3. Draft order ki Line items update karne ke liye ek fresh array tayar karenge
            let needsUpdate = false;
            const newLineItems: any[] = [];

            draftOrder.line_items.forEach((item: any) => {

                // (A) - Purane existing items (Bags vgehra) wapas array me append karenge
                const lineItemInput: any = {
                    quantity: item.quantity,
                };

                if (item.variant_id) {
                    lineItemInput.variantId = `gid://shopify/ProductVariant/${item.variant_id}`;
                } else {
                    lineItemInput.title = item.title;
                    lineItemInput.originalUnitPrice = item.price;
                }

                // Puraane custom attributes (agar koi message wgera likha h) restore karna
                if (item.properties && item.properties.length > 0) {
                    lineItemInput.customAttributes = item.properties.map((p: any) => ({
                        key: p.name,
                        value: String(p.value)
                    }));
                }

                newLineItems.push(lineItemInput);

                // (B) - Ab check karenge ki kya is product ya variant pe Metafield true tha?
                let combinedSurchargeIds = new Set<string>();

                // 1. Agar Product par metafield hai, to IDs Set me dalein
                if (item.product_id && productSurchargeMap[item.product_id.toString()]) {
                    productSurchargeMap[item.product_id.toString()]
                        .split(',')
                        .forEach((id: string) => combinedSurchargeIds.add(id.trim()));
                }

                // 2. Agar Variant par metafield hai, to IDs Set me dalein
                if (item.variant_id && variantSurchargeMap[item.variant_id.toString()]) {
                    variantSurchargeMap[item.variant_id.toString()]
                        .split(',')
                        .forEach((id: string) => combinedSurchargeIds.add(id.trim()));
                }

                if (combinedSurchargeIds.size > 0) {
                    combinedSurchargeIds.forEach((sId: string) => {
                        const fullVariantId = sId.includes("gid://")
                            ? sId
                            : `gid://shopify/ProductVariant/${sId}`;

                        const numericSurchargeId = sId.replace("gid://shopify/ProductVariant/", "");

                        if (!existingVariantIds.has(numericSurchargeId)) {
                            console.log(`Adding surcharge ${fullVariantId} for item ${item.title}`);
                            needsUpdate = true;

                            newLineItems.push({
                                variantId: fullVariantId,
                                quantity: item.quantity,
                                customAttributes: [
                                    { key: "_surcharge_id", value: "true" },
                                    { key: "_added_by_vuba_webhook", value: "true" }
                                ]
                            });

                            existingVariantIds.add(numericSurchargeId);
                        }
                    });
                }
            });

            // 4. Agar naya surcharge map hua hai, to ab GraphQL Mutation run kar k draft update karein
            console.log("Needs update:", needsUpdate);
            console.log("Product surcharge map:", productSurchargeMap);
            console.log("Variant surcharge map:", variantSurchargeMap);
            
            if (needsUpdate) {
                console.log("Updating draft order with", newLineItems.length, "line items");
                const updateQuery = `#graphql
           mutation draftOrderUpdate($id: ID!, $input: DraftOrderInput!) {
             draftOrderUpdate(id: $id, input: $input) {
               draftOrder { id }
               userErrors { field message }
             }
           }
         `;

                const updateResponse = await admin.graphql(updateQuery, {
                    variables: {
                        id: draftOrder.admin_graphql_api_id,
                        input: { lineItems: newLineItems }
                    }
                });
                const updateResult = await updateResponse.json();
                console.log("Update result:", JSON.stringify(updateResult, null, 2));
            } else {
                console.log("No update needed — surcharges already present or no matching products.");
            }

        } catch (err) {
            console.error("Draft Order Surcharge Webhook Error:", err);
        }
    }

    return new Response("OK", { status: 200 }); // Har haal me success 200 return
};
