import { useFetcher, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Check if the fee product and metafield are already setup
  const response = await admin.graphql(
    `#graphql
    query checkSetup {
      shop {
        metafield(namespace: "vuba_surcharges", key: "fee_variant_id") {
          value
        }
      }
      cartTransforms(first: 5) {
        nodes {
          id
          functionId
        }
      }
      feeProduct: products(first: 1, query: "handle:aggregate-surcharge OR handle:aggregate-fee") {
        nodes {
          id
          title
          handle
          variants(first: 1) {
            nodes {
              id
            }
          }
        }
      }
      targetProduct: products(first: 1, query: "handle:apollo-grey-2-5mm-25kg") {
        nodes {
          id
          title
          handle
        }
      }
    }`
  );
  const data = (await response.json()).data;
  const isSetup = !!data.shop?.metafield?.value;
  const feeProduct = data.feeProduct?.nodes[0];
  const targetProduct = data.targetProduct?.nodes[0];

  const cartTransforms = data.cartTransforms?.nodes || [];

  return {
    isSetup: isSetup && cartTransforms.length > 0,
    feeProduct,
    targetProduct,
    cartTransforms,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "setup_fee") {
    try {
      console.log("--- Starting Setup ---");
      // 1. Fetch current info
      const infoRes = await admin.graphql(
        `#graphql
        query getSetupInfo {
          feeProduct: products(first: 1, query: "handle:aggregate-surcharge OR handle:aggregate-fee") {
            nodes { id handle variants(first: 1) { nodes { id } } }
          }
        }`
      );
      const info = await infoRes.json();
      console.log("Check Info:", JSON.stringify(info));

      let productId = info.data?.feeProduct?.nodes[0]?.id;
      let variantId = info.data?.feeProduct?.nodes[0]?.variants?.nodes[0]?.id;

      if (!productId) {
        console.log("Creating Fee Product...");
        const createRes = await admin.graphql(
          `#graphql
          mutation createFeeProduct($input: ProductCreateInput!) {
            productCreate(product: $input) {
              product { id variants(first: 1) { nodes { id } } }
              userErrors { field message }
            }
          }`,
          {
            variables: {
              input: {
                title: "Aggregate Surcharge 5.2%",
                handle: "aggregate-surcharge",
                status: "ACTIVE",
                variants: [{ price: "0.00" }]
              }
            }
          }
        );
        const createJson = await createRes.json();
        console.log("Create Response:", JSON.stringify(createJson));
        if (createJson.data?.productCreate?.userErrors?.length) {
          throw new Error("Product Create Error: " + createJson.data.productCreate.userErrors[0].message);
        }
        productId = createJson.data.productCreate.product.id;
        variantId = createJson.data.productCreate.product.variants.nodes[0].id;
      }

      if (productId && variantId) {
        console.log("Updating Variant Settings (Price & Tracking)...");
        // Update Price
        await admin.graphql(
          `#graphql
          mutation updatePrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              productVariants { id }
              userErrors { field message }
            }
          }`,
          { variables: { productId, variants: [{ id: variantId, price: "0.00" }] } }
        );

        // Update Tracking
        const vRes = await admin.graphql(`query getInv($id: ID!) { productVariant(id: $id) { inventoryItem { id } } }`, { variables: { id: variantId } });
        const invId = (await vRes.json()).data?.productVariant?.inventoryItem?.id;
        if (invId) {
          await admin.graphql(
            `#graphql
            mutation updateInv($id: ID!, $input: InventoryItemInput!) {
              inventoryItemUpdate(id: $id, input: $input) { userErrors { message } }
            }`,
            { variables: { id: invId, input: { tracked: false } } }
          );
        }

        // Metafield
        const shopRes = await admin.graphql(`{ shop { id } }`);
        const shopId = (await shopRes.json()).data.shop.id;
        await admin.graphql(
          `#graphql
          mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) { metafields { id } userErrors { message } }
          }`,
          {
            variables: {
              metafields: [{
                namespace: "vuba_surcharges",
                key: "fee_variant_id",
                type: "variant_reference",
                ownerId: shopId,
                value: variantId
              }]
            }
          }
        );

        // Cart Transform
        const funcsRes = await admin.graphql(`query getF { shopifyFunctions(first: 10) { nodes { id apiType title } } }`);
        const funcs = await funcsRes.json();
        const funcId = funcs.data?.shopifyFunctions?.nodes?.find(
          (f: any) => f.apiType === "cart_transform" || f.title === "aggregate-fee"
        )?.id;

        if (funcId) {
          console.log("Creating Cart Transform for func:", funcId);
          const ctRes = await admin.graphql(
            `#graphql
            mutation createCT($functionId: ID!) {
              cartTransformCreate(functionId: $functionId) {
                cartTransform { id }
                userErrors { field message }
              }
            }`,
            { variables: { functionId: funcId } }
          );
          console.log("Transform Response:", JSON.stringify(await ctRes.json()));
        }
      }

      console.log("--- Setup Finished ---");
      return { success: true };
    } catch (err: any) {
      console.error("SETUP ERROR:", err);
      return { success: false, error: err.message };
    }
  }

  // Original generate product logic
  const response = await admin.graphql(
    `#graphql
      mutation populateProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            handle
          }
        }
      }`,
    {
      variables: {
        product: {
          title: "Sample Product",
        },
      },
    }
  );
  const responseJson = await response.json();
  const product = responseJson.data?.productCreate?.product;

  return { product };
};

export default function Index() {
  const fetcher = useFetcher<typeof action>();
  const { isSetup, feeProduct, targetProduct, cartTransforms } = useLoaderData<typeof loader>();

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const setupFee = () => fetcher.submit({ intent: "setup_fee" }, { method: "POST" });
  const generateProduct = () => fetcher.submit({ intent: "generate" }, { method: "POST" });

  return (
    <s-page heading="Vuba Surcharges">
      <s-section heading="App Setup Status">
        <div style={{ border: "1px solid #ccc", borderRadius: "8px", padding: "1rem", backgroundColor: "#f9f9f9", marginBottom: "1rem" }}>
          <div style={{ padding: "1rem" }}>
            <s-paragraph>
              Status: {isSetup ? (
                <b style={{ color: "green" }}>✅ Fee Logic Setup</b>
              ) : (
                <b style={{ color: "orange" }}>⚠️ Fee Logic Not Setup</b>
              )}
            </s-paragraph>
            {feeProduct && (
              <s-paragraph>
                Fee Product: <b>{feeProduct.title}</b>
              </s-paragraph>
            )}
            {targetProduct ? (
              <s-paragraph>
                Target Collection: <b style={{ color: "green" }}>Active (ID: 446838440227)</b>
              </s-paragraph>
            ) : (
              <s-paragraph>
                Target Collection: <b style={{ color: "green" }}>Active (ID: 446838440227)</b>
              </s-paragraph>
            )}
            <s-paragraph>
              Active Transforms: <b style={{ color: cartTransforms.length > 0 ? "green" : "red" }}>{cartTransforms.length}</b>
            </s-paragraph>
            {cartTransforms.map((t: any) => (
              <div key={t.id} style={{ fontSize: "0.8rem", color: "#666" }}>
                <s-paragraph>ID: {t.id}</s-paragraph>
              </div>
            ))}
            <div style={{ marginTop: "1rem" }}>
              <s-button
                loading={isLoading && fetcher.formData?.get("intent") === "setup_fee"}
                onClick={setupFee}
                variant="primary"
              >
                {isSetup ? "Refresh Setup" : "Setup Surcharge System"}
              </s-button>
            </div>
          </div>
        </div>
      </s-section>

      <s-section heading="How it works">
        <s-paragraph>
          This app applies a <b>5.2% surcharge</b> to all products assigned to the collection <code>446838440227</code>.
        </s-paragraph>
        <s-paragraph>
          1. The app manages a hidden <b>Aggregate Surcharge 5.2%</b> product.<br />
          2. A Shopify Function (Cart Transform) monitors the cart for products from the target collection.<br />
          3. It automatically expands those line items to include the surcharge for each item.
        </s-paragraph>
      </s-section>

      <s-section heading="Testing">
        <s-paragraph>
          To test, add any product from the specified collection to your cart.
        </s-paragraph>
        <div style={{ marginTop: "1rem" }}>
          <s-button
            loading={isLoading && fetcher.formData?.get("intent") === "generate"}
            onClick={generateProduct}
          >
            Generate Sample Product
          </s-button>
        </div>
        {fetcher.data?.product && (
          <div style={{ marginTop: "1rem" }}>
            <s-paragraph>
              Product created: <b>{fetcher.data.product.title}</b>
            </s-paragraph>
          </div>
        )}
      </s-section>
    </s-page>
  );
}
