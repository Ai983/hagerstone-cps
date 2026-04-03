export const isPOLegacy = (po: any) => po.source === "legacy";
export const isQuoteLegacy = (quote: any) => quote.is_legacy === true || quote.channel === "legacy";
export const isVendorNew = (supplier: any) => supplier.profile_complete === false;
export const isManualRFQEntry = (rfqSupplier: any) => rfqSupplier.added_manually === true;
