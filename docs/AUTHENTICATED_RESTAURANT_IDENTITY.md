# Authenticated restaurant identity (P0)

GET /api/v1/auth/restaurant-identity, Authorization: Bearer access token.

Owner and employee only; restaurant ID is derived from the verified principal. No input ID or public-domain readiness requirement. Browser-origin tenant enforcement still applies to owner dashboard sessions. Identity reads do not grant operational subscription entitlements. Platform admin receives 403. Missing/invalid sessions receive 401. Active restaurant required. Initial-password flow may read branding but grants no operational privileges.

Response: { data: { id, name, subdomain: string | null, branding: { logoUrl, primaryColor, secondaryColor, fontFamily } } }. All branding fields nullable. Public menu keeps existing subdomain/QR contract. No migration or reseed needed. Consumers should key cached identity by authenticated restaurant ID, reject mismatched IDs and clear on logout. See mocks/contracts/restaurant-identity-v1.json.
