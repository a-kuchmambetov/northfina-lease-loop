# Leasing model

This diagram is a proposed logical model. Only `Asset` and `AuditLog` are currently implemented in Prisma.

```mermaid
erDiagram
    CUSTOMER ||--o{ APPLICATION : submits
    APPLICATION ||--o{ APPLICATION_ANSWER : contains
    APPLICATION ||--o| QUOTE : produces
    ASSET ||--o{ QUOTE : priced_for
    QUOTE ||--o| CONTRACT : accepted_as
    CUSTOMER ||--o{ CONTRACT : leases
    ASSET ||--o{ ASSET_LIFE : has
    CONTRACT ||--|| ASSET_LIFE : covers
    CONTRACT ||--o{ INVOICE : generates
    ASSET_LIFE ||--o| END_OF_TERM : closes_with
    ASSET_LIFE ||--o{ REFURBISHMENT : receives
    REFURBISHMENT ||--o{ REFURBISHMENT_ITEM : includes
    WAITING_REQUEST o|--o{ ASSET_LIFE : matched_to
    AUDIT_LOG }o..o| ASSET : references_by_type_and_id

    CUSTOMER {
        string id PK
        string type
        string name
        string email
        string country
        string city
        string profile_json
    }
    ASSET {
        string id PK
        string category
        string serial_number UK
        string condition
        string usage_unit
        int usage_value
        int previous_lives
        string status
    }
    APPLICATION {
        string id PK
        string customer_id FK
        string asset_id FK
        string status
        string decision
        string decision_reasons_json
        string question_version
        datetime created_at
    }
    APPLICATION_ANSWER {
        string application_id PK,FK
        string question_id PK
        string answer_json
    }
    QUOTE {
        string id PK
        string application_id FK
        string asset_id FK
        string quoted_on
        string price_list_version
        string coefficient_version
        int list_price_cents
        int down_payment_cents
        int financed_amount_cents
        int term_months
        string monthly_factor_decimal
        int monthly_net_rent_cents
        int buyout_cents
    }
    CONTRACT {
        string id PK
        string quote_id FK,UK
        string customer_id FK
        string signed_on
        string start_date
        int term_months
        int monthly_net_rent_cents
        int buyout_cents
        string pricing_snapshot_json
        string status
    }
    ASSET_LIFE {
        string id PK
        string asset_id FK
        string contract_id FK,UK
        string waiting_request_id FK
        int sequence_number
        string start_date
        string end_date
        string starting_condition
        int starting_usage
    }
    INVOICE {
        string id PK
        string contract_id FK
        int sequence_number
        string invoice_date
        string due_date
        int net_cents
        int vat_cents
        int total_cents
        string vat_rate_decimal
        string status
    }
    END_OF_TERM {
        string id PK
        string asset_life_id FK,UK
        string outcome
        string effective_date
        int settlement_cents
        string condition
        int usage_value
        string calculation_json
    }
    REFURBISHMENT {
        string id PK
        string asset_life_id FK
        string completed_on
        string condition_before
        string condition_after
        int usage_before
        int usage_after
    }
    REFURBISHMENT_ITEM {
        string id PK
        string refurbishment_id FK
        string operation
        int cost_cents
        boolean resets_usage
    }
    WAITING_REQUEST {
        string id PK
        string who
        string category
        int max_monthly_net_rent_cents
        string min_condition
        int preferred_term_months
        string needed_by
        datetime submitted_at
        string status
    }
    AUDIT_LOG {
        int id PK
        datetime created_at
        string actor
        string action
        string entity_type
        string entity_id
        string details_json
    }
```

`APPLICATION.asset_id` is also a foreign key to `Asset`; it is omitted from the relationship lines for readability. `AuditLog` is polymorphic: `entity_type` and `entity_id` can refer to any changed entity, so the dotted asset link is illustrative and is not a database foreign key.
