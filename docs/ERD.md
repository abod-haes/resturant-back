# ERD — logical draft
```mermaid
erDiagram
  ADMIN_USER ||--o{ AUDIT_LOG : writes
  RESTAURANT ||--|| OWNER : has
  RESTAURANT ||--o{ BRANCH : contains
  RESTAURANT ||--o{ SUBSCRIPTION : subscribes
  PLAN ||--o{ SUBSCRIPTION : defines
  BRANCH ||--o{ FLOOR : has
  FLOOR ||--o{ AREA : has
  BRANCH ||--o{ AREA : contains
  AREA ||--o{ RESTAURANT_TABLE : contains
  RESTAURANT_TABLE ||--o{ QR_CREDENTIAL : rotates
  BRANCH ||--o{ CATEGORY : has
  CATEGORY ||--o{ PRODUCT : contains
  PRODUCT ||--o{ PRODUCT_IMAGE : has
  BRANCH ||--o{ EMPLOYEE : employs
  EMPLOYEE ||--o{ SHIFT : works
  EMPLOYEE ||--o{ EMPLOYEE_DEVICE : registers
  RESTAURANT_TABLE ||--o{ CUSTOMER_SESSION : starts
  CUSTOMER_SESSION ||--o{ SERVICE_CALL : requests
  RESTAURANT_TABLE ||--o{ SERVICE_CALL : receives
  SERVICE_CALL ||--o{ NOTIFICATION_DELIVERY : fans_out
  BRANCH ||--o{ OWNER_ALERT : raises
  BRANCH ||--|| BRANCH_CALL_SETTINGS : configures
```
## Data integrity rules
- UUID PKs; tenant_id/restaurant_id scope on branch-owned tables, indexed foreign keys.
- Restaurant owner unique per restaurant; employee belongs to exactly one branch and department.
- QR credential opaque random token hash, only one active token per table, rotation revokes prior sessions.
- Product price integer minor units; currency explicit. No sensitive passwords in fixture or audit.
- Soft delete/archival for product, table, employee; historical calls preserved.
- Unique idempotency key per call scope; atomic cooldown enforced with transaction/lock or Redis atomic script.
- Shift auto-end configurable, active shift uniqueness per employee.
- Outbox entries written in same DB transaction as accepted service call.
- Tenant scope and subscription validation on every protected operation.
