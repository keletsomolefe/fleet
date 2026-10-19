.DEFAULT_GOAL := help

.PHONY: help setup install dev build start typecheck test test-e2e up down restart status logs migrate infra-test db-shell db-migrate seed-admin admin-test

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

setup: install ## Install dependencies and generate local development secrets
	pnpm dev:setup

install: ## Install the monorepo dependencies
	pnpm install --frozen-lockfile

dev: ## Start API, web and gateway with Watt
	pnpm dev

build: ## Build all applications
	pnpm build

start: ## Start the production build
	pnpm start

typecheck: ## Check API and web TypeScript
	pnpm typecheck

test: ## Run API and web unit tests
	pnpm test

test-e2e: ## Run API end-to-end tests
	pnpm test:e2e

up: ## Start infrastructure, apply app migrations and bootstrap the development admin
	pnpm infra:up

down: ## Stop development services and retain database data
	pnpm infra:down

restart: down ## Recreate services in dependency order and retain database data
	$(MAKE) up

status: ## Show development services and migration status
	pnpm infra:status

logs: ## Follow development service logs (SERVICE=kratos for one service)
	docker compose logs -f $(SERVICE)

migrate: ## Apply pending Kratos database migrations
	pnpm infra:migrate

infra-test: ## Verify schema isolation and authentication flows
	pnpm infra:test

db-migrate: ## Apply pending application migrations
	pnpm db:migrate

seed-admin: ## Bootstrap the default development administrator
	pnpm db:seed

admin-test: ## Verify admin sessions, creation, hooks and access against the local stack
	pnpm test:admin

db-shell: ## Open an administrator psql session in the development database
	docker compose exec postgres sh -c 'exec psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'
