import '@shopify/ui-extensions/checkout';

export default async () => {
  let isSyncing = false;

  shopify.lines.subscribe(async (lines) => {
    if (isSyncing || !lines) return;

    // Filter main items (has _kit_id but no _surcharge)
    const mainItems = lines.filter((line) => {
      const kitId = line.attributes?.find(attr => attr.key === '_kit_id')?.value;
      const isSurcharge = line.attributes?.find(attr => attr.key === '_surcharge')?.value;
      return kitId && !isSurcharge;
    });

    // Filter surcharge items (has _surcharge = "true")
    const surchargeItems = lines.filter((line) => {
      const isSurcharge = line.attributes?.find(attr => attr.key === '_surcharge')?.value;
      return isSurcharge === "true";
    });

    let operations = [];

    for (const surcharge of surchargeItems) {
      const surchargeKitId = surcharge.attributes?.find(attr => attr.key === '_kit_id')?.value;
      
      const matchingMain = mainItems.find(main => {
        const mainKitId = main.attributes?.find(attr => attr.key === '_kit_id')?.value;
        return mainKitId === surchargeKitId;
      });

      if (!matchingMain) {
        // Main item was removed -> remove surcharge
        operations.push(
          shopify.applyCartLinesChange({
            type: 'removeCartLine',
            id: surcharge.id,
            quantity: surcharge.quantity
          })
        );
      } else if (matchingMain.quantity !== surcharge.quantity) {
        // Main item quantity changed -> update surcharge
        operations.push(
          shopify.applyCartLinesChange({
            type: 'updateCartLine',
            id: surcharge.id,
            quantity: matchingMain.quantity
          })
        );
      }
    }

    if (operations.length > 0) {
      isSyncing = true;
      try {
        await Promise.all(operations);
      } catch (e) {
        console.error("Failed to sync surcharge:", e);
      }
      setTimeout(() => { isSyncing = false; }, 500);
    }
  });
};