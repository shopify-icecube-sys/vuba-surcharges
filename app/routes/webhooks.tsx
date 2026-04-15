import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { topic, admin, payload } = await authenticate.webhook(request);

    if (!admin) {
        return new Response();
    }

    // Sirf draft order create aur update ke time process run hoga
    if (topic === "draft_orders/create" || topic === "draft_orders/update") {
        try {
            const draftOrder = payload;

            // 1. Draft Order ke saare products ki ek Unique gids list banana
            const productIds = draftOrder.line_items
                .filter((item: any) => item.product_id)
                .map((item: any) => `gid://shopify/Product/${item.product_id}`);

            // Agar sirf manual items hain aur koi product nahi hai to process rok denge
            if (productIds.length === 0) return new Response("OK", { status: 200 });

            // 2. GraphQL ke zariye eksath unsab products ke Surcharge Metafield nikalna
            const getMetafieldsQuery = `#graphql
        query getMetafields($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              surchargeVariant: metafield(namespace: "custom", key: "surcharge_variant") {
                value
              }
            }
          }
        }
      `;

            const metafieldsResponse = await admin.graphql(getMetafieldsQuery, {
                variables: { ids: [...new Set(productIds)] }
            });

            const metafieldsData = await metafieldsResponse.json();

            // Ek mapping banayenge: Main Product ID -> Surcharge Variant ID (Metafield ki value)
            const productSurchargeMap: Record<string, string> = {};

            // Draft me pichle existing variants check karna taaki bar-bar add ya double entry na ho
            const existingVariantIds = new Set<string>();
            draftOrder.line_items.forEach((item: any) => {
                if (item.variant_id) {
                    existingVariantIds.add(item.variant_id.toString());
                }
            });

            if (metafieldsData.data?.nodes) {
                metafieldsData.data.nodes.forEach((node: any) => {
                    // Agar product milta hai aur usme surcharge variant metafield bhi hai
                    if (node && node.surchargeVariant?.value) {
                        const rawId = node.id.split("/").pop();
                        productSurchargeMap[rawId] = node.surchargeVariant.value;
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

                // (B) - Ab check karenge ki kya is product (e.g. Purple Rain) pe Metafield true tha?
                if (item.product_id && productSurchargeMap[item.product_id.toString()]) {
                    const surchargeVariantValue = productSurchargeMap[item.product_id.toString()];
                    const numericSurchargeId = surchargeVariantValue.replace("gid://shopify/ProductVariant/", "");

                    // Agar Missing hai (yani Cart me surcharge us product ka already nahi hai)
                    if (!existingVariantIds.has(numericSurchargeId)) {
                        needsUpdate = true; // Order ab backend me rewrite hoga
                        newLineItems.push({
                            variantId: surchargeVariantValue.includes("gid://")
                                ? surchargeVariantValue
                                : `gid://shopify/ProductVariant/${surchargeVariantValue}`,
                            quantity: item.quantity, // Bundle ka jo size hai utni hi surcharge quantity banegi
                            customAttributes: [
                                { key: "_surcharge_id", value: surchargeVariantValue },
                                { key: "_added_by_vuba_webhook", value: "true" }
                            ]
                        });

                        // Dobara verify mark tak infinite addition se bachein
                        existingVariantIds.add(numericSurchargeId);
                    }
                }
            });

            // 4. Agar naya surcharge map hua hai, to ab GraphQL Mutation run kar k draft update karein
            if (needsUpdate) {
                const updateQuery = `#graphql
           mutation draftOrderUpdate($id: ID!, $input: DraftOrderInput!) {
             draftOrderUpdate(id: $id, input: $input) {
               draftOrder { id }
               userErrors { field message }
             }
           }
         `;

                await admin.graphql(updateQuery, {
                    variables: {
                        id: draftOrder.admin_graphql_api_id,
                        input: { lineItems: newLineItems }
                    }
                });
            }

        } catch (err) {
            console.error("Draft Order Surcharge Webhook Error:", err);
        }
    }

    return new Response("OK", { status: 200 }); // Har haal me success 200 return
};
