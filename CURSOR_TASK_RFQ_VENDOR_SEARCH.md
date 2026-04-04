# CURSOR TASK: RFQ Review Dialog — Add Vendor Search Box

## Fix 1 (already done in DB) — sent_at column
The error "Could not find the 'sent_at' column" is fixed — column now exists.
Make sure the send handler sets it:
```typescript
await supabase
  .from('cps_rfqs')
  .update({ 
    status: 'sent',
    sent_at: new Date().toISOString(),  // ← now valid
    updated_at: new Date().toISOString()
  })
  .eq('id', rfq.id);
```

---

## Fix 2 — Add Vendor Search in the Select Suppliers section

Currently users can only see the auto-suggested list. Add a search box so procurement can find any existing vendor by name.

### Where to add it
In the Review & Send dialog, above the supplier list, add:

```
Select Suppliers
0 of 7 selected · Painting · 2 will receive WhatsApp

[🔍 Search existing vendors by name...        ]   ← ADD THIS

[ ] ADINATH PLY AND DECOR   Incomplete Profile  ★0  🗑
...
```

### Implementation

```typescript
const [vendorSearch, setVendorSearch] = useState('');
const [searchResults, setSearchResults] = useState<Supplier[]>([]);
const [isSearching, setIsSearching] = useState(false);

// Search handler — debounced
const handleVendorSearch = useDebouncedCallback(async (query: string) => {
  if (!query.trim() || query.length < 2) {
    setSearchResults([]);
    return;
  }
  setIsSearching(true);
  const { data } = await supabase
    .from('cps_suppliers')
    .select('id, name, phone, whatsapp, categories, performance_score, profile_complete')
    .eq('status', 'active')
    .ilike('name', `%${query}%`)
    .limit(8);
  
  // Filter out already shown suppliers to avoid duplicates
  const alreadyShownIds = suggestedSuppliers.map((s: any) => s.id);
  setSearchResults((data || []).filter(s => !alreadyShownIds.includes(s.id)));
  setIsSearching(false);
}, 300);

useEffect(() => {
  handleVendorSearch(vendorSearch);
}, [vendorSearch]);
```

### Search UI component

```tsx
{/* Search box */}
<div className="relative mb-3">
  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
  <Input
    placeholder="Search existing vendors by name..."
    value={vendorSearch}
    onChange={e => setVendorSearch(e.target.value)}
    className="pl-9"
  />
  {isSearching && (
    <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
  )}
</div>

{/* Search results — shown as addable rows */}
{searchResults.length > 0 && (
  <div className="mb-3 border rounded-lg overflow-hidden">
    <p className="text-xs text-muted-foreground px-3 py-1.5 bg-muted">
      Search results — click to add to selection
    </p>
    {searchResults.map(s => (
      <div
        key={s.id}
        className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent cursor-pointer border-t"
        onClick={() => {
          // Add to suggested list and select
          setSuggestedSuppliers((prev: any) => [...prev, s]);
          setSelectedIds((prev: string[]) => [...prev, s.id]);
          setVendorSearch(''); // clear search
          setSearchResults([]);
          toast.success(`${s.name} added to selection`);
        }}
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{s.name}</span>
            {!s.profile_complete && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                Incomplete Profile
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {s.whatsapp || s.phone || 'No phone'} · {(s.categories || []).join(', ')}
          </p>
        </div>
        <span className="text-xs text-primary font-medium">+ Add</span>
      </div>
    ))}
  </div>
)}
```

### Notes
- `useDebouncedCallback` — if not available, use `useCallback` with a `setTimeout` debounce of 300ms
- Search results appear below the search box, above the suggested list
- Clicking a result adds it to `suggestedSuppliers` + auto-checks it in `selectedIds`
- Search clears after selection
- Only shows vendors NOT already in the suggested list (no duplicates)

---

## FILES TO MODIFY
- RFQ Review & Send dialog component — add search box + results list
