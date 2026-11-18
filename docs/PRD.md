# Restaurant Menu & Staff Call Platform — PRD v1
**Status:** approved business scope; implementation details in contract are draft. **Date:** 2026-11-18.

## Actors
Primary Super Admin (creates platform admins), platform admin, one owner per restaurant, employee (one branch/department), anonymous customer.

## Platform
Admins create restaurants and owners, plans with branch/table/employee/feature limits, manual monthly/yearly subscriptions and grace period. Renewal is ONLY by contacting configurable admin channels. On expiry+grace, operational public and admin functions stop; owner can sign in to view renewal contacts. Audit all admin operations.

## Branches & menus
Each branch independently owns menu, categories, products, floors, areas, tables, employees and call routing. One-branch owner UI hides branch selectors while retaining branch-add capability. Owner can copy menu/template between branches, then edit independently. Menu Arabic RTL, searchable, product details and multiple optimized images; product has one price, optional old price, tags, sold-out or hidden. No checkout, order, size/extras or promotional campaign in V1.

## QR & customer
Unique stable QR per table; changing table label/location does not rotate token. Owner/admin can bulk create, print PDFs, revoke/rotate, disable QR or table calls. General menu link has no call buttons. Table QR shows welcome, logo, table number, menu and waiter/hookah call buttons; hookah optional. Buttons remain available while browsing. First call in browser visit needs confirmation; later calls direct. Visit idle expiration 4h. Server-enforced cooldown 10s per table/type. No GPS or physical presence proof: static QR can be shared.

## Employees/calls
Two fixed departments: waiter and hookah. Owner creates username/password employee account; starts/ends shift via Expo app, owner may force-end, configurable auto-end. Routing defaults restaurant-wide with branch override: all on-shift employees in branch OR on-shift employees of requested department. Foreground realtime, background push, distinct sounds where OS supports, call history. Call is a notification-only event; no accept/complete. If no eligible staff, record event and alert owner in dashboard and external channel when available; customer success message must not imply delivery to employee.

## Technical
Admin and owner dashboards share one React+Vite repository with independent deployment targets; customer React+Vite in its own repository; employee Expo RN Android/iOS; NestJS PostgreSQL; object storage; VPS Docker Dokploy. Secure persistent login, backups, monitoring and alerts. Backend first, pilot one restaurant. ESP32 deferred entirely to separate phase.

## Acceptance
Tenant isolation; independent branch menus; QR revoke; first-call confirmation; atomic cooldown/idempotency; branch routing; shift lifecycle; no-staff fallback; manual renewal only; archived historical records; mock/live contract equivalence.
