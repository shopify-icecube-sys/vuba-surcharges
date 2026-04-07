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
    // 1. Fetch current fee product and target product details
    const setupCheckResponse = await admin.graphql(
      `#graphql
      query getSetupInfo {
        feeProduct: products(first: 1, query: "handle:aggregate-surcharge OR handle:aggregate-fee") {
          nodes {
            id
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
            variants(first: 1) {
              nodes {
                id
              }
            }
          }
        }
      }`
    );
    const setupData = (await setupCheckResponse.json()).data;
    let variantId = setupData.feeProduct?.nodes[0]?.variants?.nodes[0]?.id;
    let productId = setupData.feeProduct?.nodes[0]?.id;
    const targetProductId = setupData.targetProduct?.nodes[0]?.id;
    const targetVariantId = setupData.targetProduct?.nodes[0]?.variants?.nodes[0]?.id;

    if (!productId) {
      // Create fee product if missing
      const createResponse = await admin.graphql(
        `#graphql
        mutation createFeeProduct($input: ProductCreateInput!) {
          productCreate(product: $input) {
            product {
              id
              variants(first: 1) {
                nodes {
                  id
                  inventoryItem {
                    id
                  }
                }
              }
            }
          }
        }`,
        {
          variables: {
            input: {
              title: "Aggregate Surcharge 5.2%",
              handle: "aggregate-surcharge",
              vendor: "Vuba",
              productType: "Surcharge",
              status: "ACTIVE",
              variants: [
                {
                  price: "0.00",
                }
              ]
            },
          },
        }
      );
      const createData = (await createResponse.json()).data;
      productId = createData.productCreate?.product?.id;
      const variantNode = createData.productCreate?.product?.variants?.nodes[0];
      variantId = variantNode?.id;
    }

    if (productId && variantId) {
      // 1. Update Title and Handle
      await admin.graphql(
        `#graphql
        mutation updateFeeProduct($input: ProductInput!) {
          productUpdate(input: $input) {
            product { id }
          }
        }`,
        {
          variables: {
            input: {
              id: productId,
              title: "Aggregate Surcharge 5.2%",
              handle: "aggregate-surcharge",
            },
          },
        }
      );
      
      // 2. Fetch inventoryItemId to disable tracking
      const variantResponse = await admin.graphql(
        `#graphql
        query getVariantId($id: ID!) {
          productVariant(id: $id) {
            inventoryItem {
              id
            }
          }
        }`,
        { variables: { id: variantId } }
      );
      const inventoryItemId = (await variantResponse.json()).data?.productVariant?.inventoryItem?.id;

      if (inventoryItemId) {
        await admin.graphql(
          `#graphql
          mutation updateTracked($id: ID!, $input: InventoryItemInput!) {
            inventoryItemUpdate(id: $id, input: $input) {
              inventoryItem { id }
            }
          }`,
          {
            variables: {
              id: inventoryItemId,
              input: { tracked: false },
            },
          }
        );
      }

      // 3. Update Price to 0.00
      await admin.graphql(
        `#graphql
        mutation bulkUpdateFeePrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants { id }
          }
        }`,
        {
          variables: {
            productId: productId,
            variants: [{ id: variantId, price: "0.00" }],
          },
        }
      );
    }

    // 3. Fix "Sold Out" status for the TARGET product (Apollo Grey)
    if (targetProductId && targetVariantId) {
      await admin.graphql(
        `#graphql
        mutation bulkUpdateTarget($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants {
              id
            }
          }
        }`,
        {
          variables: {
            productId: targetProductId,
            variants: [
              {
                id: targetVariantId,
                inventoryPolicy: "CONTINUE",
              },
            ],
          },
        }
      );
    }

    if (variantId) {
      // 3. Set the shop metafield
      const shopResponse = await admin.graphql(`{ shop { id } }`);
      const shopData = (await shopResponse.json()).data;
      const shopId = shopData.shop.id;

      await admin.graphql(
        `#graphql
        mutation setFeeMetafield($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              value
            }
          }
        }`,
        {
          variables: {
            metafields: [
              {
                namespace: "vuba_surcharges",
                key: "fee_variant_id",
                type: "variant_reference",
                ownerId: shopId,
                value: variantId,
              },
            ],
          },
        }
      );

      // 4. Create the cart transform
      const functionsResponse = await admin.graphql(
        `#graphql
        query getFunctions {
          shopifyFunctions(first: 20) {
            nodes {
              id
              title
              apiType
            }
          }
        }`
      );
      const functionsData = (await functionsResponse.json()).data;
      const functionNode = functionsData?.shopifyFunctions?.nodes?.find(
        (f: any) => f.title === "aggregate-fee" || f.apiType === "cart_transform"
      );

      if (functionNode) {
        await admin.graphql(
          `#graphql
          mutation createCartTransform($functionId: String!) {
            cartTransformCreate(functionId: $functionId) {
              cartTransform {
                id
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              functionId: functionNode.id,
            },
          }
        );
      }
    }
    return { success: true };
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
