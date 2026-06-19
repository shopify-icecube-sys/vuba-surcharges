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


    if (topic === "DRAFT_ORDERS_CREATE" || topic === "DRAFT_ORDERS_UPDATE") {
        try {
            const draftOrder = payload;


            const productIds = draftOrder.line_items
                .filter((item: any) => item.product_id)
                .map((item: any) => `gid://shopify/Product/${item.product_id}`);

            const variantIds = draftOrder.line_items
                .filter((item: any) => item.variant_id)
                .map((item: any) => `gid://shopify/ProductVariant/${item.variant_id}`);


            console.log("Product IDs found:", productIds);
            console.log("Variant IDs found:", variantIds);
            if (productIds.length === 0 && variantIds.length === 0) {
                console.log("No product or variant IDs found — skipping.");
                return new Response("OK", { status: 200 });
            }


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


            const productSurchargeMap: Record<string, string> = {};
            const variantSurchargeMap: Record<string, string> = {};


            const existingVariantIds = new Set<string>();
            draftOrder.line_items.forEach((item: any) => {
                if (item.variant_id) {
                    existingVariantIds.add(item.variant_id.toString());
                }
            });

            if (metafieldsData.data?.products) {
                metafieldsData.data.products.forEach((node: any) => {

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


            let needsUpdate = false;
            const newLineItems: any[] = [];

            draftOrder.line_items.forEach((item: any) => {


                const lineItemInput: any = {
                    quantity: item.quantity,
                };

                if (item.variant_id) {
                    lineItemInput.variantId = `gid://shopify/ProductVariant/${item.variant_id}`;
                } else {
                    lineItemInput.title = item.title;
                    lineItemInput.originalUnitPrice = item.price;
                }


                if (item.properties && item.properties.length > 0) {
                    lineItemInput.customAttributes = item.properties.map((p: any) => ({
                        key: p.name,
                        value: String(p.value)
                    }));
                }

                newLineItems.push(lineItemInput);


                let combinedSurchargeIds = new Set<string>();


                if (item.product_id && productSurchargeMap[item.product_id.toString()]) {
                    productSurchargeMap[item.product_id.toString()]
                        .split(',')
                        .forEach((id: string) => combinedSurchargeIds.add(id.trim()));
                }


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

    return new Response("OK", { status: 200 });
};
