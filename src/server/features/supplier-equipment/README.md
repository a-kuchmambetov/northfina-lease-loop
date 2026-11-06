# supplier-equipment: the supplier's Catalog ("Your equipment")

The table from Figma's "Suppliers / My equipment". It is what a supplier sees as the Catalog
(`/[locale]`, in place of the customers' catalogue): every item of one supplier, what state it is in, and what is waiting
for them. Read-only. `get-supplier-equipment.ts` reads the database and
`src/domain/supplier-equipment.ts` decides the state of each item.

## Which items are a supplier's

The data pack has no owner for an item, so a supplier is the **brand**: an account named
"Pohja Compute" has the Pohja Compute items (`suppliesAsset` in `src/domain/catalogue.ts`,
the same rule that filters the catalogue). Capitals and extra spaces don't matter.

## One state per item

| State             | When                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| `leased`          | Its latest contract is running and the term isn't over                             |
| `contract_ended`  | The running contract is past its term and hasn't been bought, returned or extended |
| `returned`        | It was given back and is waiting to be refurbished                                 |
| `manual_approval` | An application for it is waiting for a person (`manual_review`)                    |
| `sold`            | The renter bought it                                                               |
| `reserved`        | Marked reserved with no contract behind it                                         |
| `available`       | None of the above                                                                  |

A running contract decides first. `contract_ended`, `returned` and `manual_approval` are the ones
that "need action". The page's counts, quick filters (All, Needs action, Active leases), search
(name, serial number, contract code, renter) and status filter are all
`src/domain/supplier-equipment.ts`.

## What the page does not do

Figma's table also has transfers, renter approvals and inspection results. Those flows don't
exist in the app, so the page shows no actions for them: **View contract** opens the contract's
terms in a dialog, and **Open request** (for a returned item) goes to the Requests page.
