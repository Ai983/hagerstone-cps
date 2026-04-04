# CURSOR QUICK FIX: RFQ Send — Use Upsert to Prevent Duplicate Key Error

## Problem
If the user clicks "Send to X Suppliers" twice (or if a previous partial attempt left rows), 
the plain `.insert()` fails with:
`duplicate key value violates unique constraint "cps_rfq_suppliers_rfq_id_supplier_id_key"`

## Fix — Change insert to upsert in the send handler

Find this line in the Review & Send dialog send handler:
```typescript
const { error: insertError } = await supabase
  .from('cps_rfq_suppliers')
  .insert(rfqSupplierRows);
```

Replace with:
```typescript
const { error: insertError } = await supabase
  .from('cps_rfq_suppliers')
  .upsert(rfqSupplierRows, { 
    onConflict: 'rfq_id,supplier_id',
    ignoreDuplicates: false 
  });
```

That's the only change needed. One line.
