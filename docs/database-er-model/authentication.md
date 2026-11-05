# Authentication model

These Better Auth models are implemented in the current Prisma schema.

```mermaid
erDiagram
    USER ||--o{ SESSION : has
    USER ||--o{ ACCOUNT : has

    USER {
        string id PK
        string name
        string email UK
        boolean emailVerified
        string image
        datetime createdAt
        datetime updatedAt
    }
    SESSION {
        string id PK
        datetime expiresAt
        string token UK
        datetime createdAt
        datetime updatedAt
        string ipAddress
        string userAgent
        string userId FK
    }
    ACCOUNT {
        string id PK
        string accountId
        string providerId
        string userId FK
        string accessToken
        string refreshToken
        string idToken
        datetime accessTokenExpiresAt
        datetime refreshTokenExpiresAt
        string scope
        string password
        datetime createdAt
        datetime updatedAt
    }
    VERIFICATION {
        string id PK
        string identifier
        string value
        datetime expiresAt
        datetime createdAt
        datetime updatedAt
    }
```

Better Auth sessions and accounts belong to a user and are deleted when that user is deleted. Verification records are standalone. The auth user is not currently linked to the proposed customer model.
