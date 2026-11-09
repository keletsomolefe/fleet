# Deferred transport features

Customers, saved locations, products, customer-product links, transport rates, dispatch, activity logging and truck earnings are removed from the current application. They remain future features; the earlier implementation and design records are available in Git history and `design/`.

The web transport pages and browser/native transport APIs are no longer registered. The native Jobs & activity screen, activity recording contexts and upload queue integration are removed. On upgraded installations, the former activity upload background task is unregistered without uploading or deleting its local queue. Existing PostgreSQL transport records and device data are retained, but are not read or changed by the current application.

Permissions for these features are excluded from session access and the role catalogue, even when old database grants remain. Core account, driver, vehicle, schedule, issue-review and location-logging permissions still apply.

## Current workflow

Drivers sign in, confirm their vehicle and report issues. Administrators manage drivers, vehicles and schedules, and review reports in **Exceptions**. Issue reports do not depend on a customer, dispatch or activity record.

The next planned step is to send an issue to a WhatsApp group and allow a third-party mechanic to mark it resolved. The Truck mechanic role already supports reviewing and resolving reports in the app. WhatsApp group delivery and completion-link details are awaiting the user's breakdown. Administrator resolution also remains available.

## Database setup

All application migrations and reset commands are removed for now. Use the existing initialized `app` schema; fresh database setup is deferred. TypeORM synchronization remains disabled. Existing application data, Kratos identities and credentials, and database role/schema isolation are preserved.
