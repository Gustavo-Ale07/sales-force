/**
 * GENERATED FILE - do not edit. Source: packages/contracts/openapi/openapi.json
 * (built from the Zod contracts). Regenerate with: pnpm --filter @salesforce/contracts run openapi
 */

export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Liveness
         * @description The process is up. Does not check the database or the integration.
         */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Readiness
         * @description Database, migration level and integration summary. A degraded integration does not make the API not ready.
         */
        get: operations["getReady"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sign in
         * @description Sets the HttpOnly session cookie. The response body carries no token.
         */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sign out */
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Current session
         * @description Always 200: `authenticated` tells whether a valid session exists.
         */
        get: operations["getSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/configuration": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Installation configuration summary and integration state
         * @description Client-safe snapshot summary, sync states, gateway mode. Never contains secrets.
         */
        get: operations["getConfiguration"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Dashboard KPIs within the actor scope */
        get: operations["getDashboard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sellers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List sellers visible to the actor */
        get: operations["listSellers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/customers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Customer portfolio (scoped) */
        get: operations["listCustomers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/customers/{code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Customer detail (scoped)
         * @description A customer outside the actor scope is reported as 404.
         */
        get: operations["getCustomer"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/product-groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Product groups */
        get: operations["listProductGroups"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Product catalog with list price context
         * @description With `customerCode` prices are resolved against that customer table (within scope); otherwise against the catalog reference table.
         */
        get: operations["listProducts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/products/{code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Product detail with list price context */
        get: operations["getProduct"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Orders and drafts (scoped) */
        get: operations["listOrders"];
        put?: never;
        /**
         * Create a draft order
         * @description Idempotent on `clientRequestId`: 201 when created, 200 with the original order on a replay of the same payload, 409 idempotency_conflict when the id was used with a different payload. Prices are always computed server-side.
         */
        post: operations["createOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Order detail (scoped) */
        get: operations["getOrder"];
        /**
         * Replace a draft (optimistic concurrency)
         * @description Full replace. 409 version_conflict when `expectedVersion` is stale; 409 order_not_editable when the order is not a draft. The server recomputes prices and totals.
         */
        put: operations["replaceOrder"];
        post?: never;
        /** Discard a draft (status becomes cancelled) */
        delete: operations["discardOrder"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit an order to the ERP (disabled)
         * @description Always 409 erp_submission_disabled until the ERP write-safety gates close (SNK-4/SNK-5).
         */
        post: operations["submitOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Account: {
            /** Format: uuid */
            id: string;
            /** Format: email */
            email: string;
            displayName: string;
            role: components["schemas"]["AccountRole"];
            sellerCodes: number[];
        };
        /** @enum {string} */
        AccountRole: "admin" | "manager" | "seller";
        AnonymousSession: {
            /** @constant */
            authenticated: false;
            authMode: components["schemas"]["AuthMode"];
        };
        ApiError: {
            code: components["schemas"]["ErrorCode"];
            message: string;
            details?: components["schemas"]["ErrorDetails"];
        };
        /** @enum {string} */
        AuthMode: "dev";
        AuthenticatedSession: {
            /** @constant */
            authenticated: true;
            authMode: components["schemas"]["AuthMode"];
            account: components["schemas"]["Account"];
            expiresAt: components["schemas"]["IsoTimestamp"];
        };
        ConfigurationResponse: {
            contentHash: string | null;
            configuration: components["schemas"]["ConfigurationSummary"];
            syncStates: components["schemas"]["SyncState"][];
            gateway: {
                mode: components["schemas"]["GatewayMode"];
            };
            integration: components["schemas"]["IntegrationSummary"];
        };
        /** @enum {string} */
        ConfigurationSourceKind: "sankhya" | "bootstrap-file" | "demo";
        ConfigurationSummary: {
            /** @constant */
            schemaVersion: 1;
            source: {
                kind: components["schemas"]["ConfigurationSourceKind"];
                version: string;
                syncedAt: components["schemas"]["IsoTimestamp"];
            };
            general: {
                enabled: boolean;
                enabledCompanyCodes: number[];
            };
            sales: {
                orderTopCode: number | null;
                quotationTopCode: number | null;
                defaultNegotiationTypeCode: number | null;
                negotiationTypes: components["schemas"]["NegotiationType"][];
                orderBehavior: {
                    allowDraftWithoutPrice: boolean;
                };
                confirmationBehavior: components["schemas"]["ConfirmationBehavior"];
            };
            customers: {
                portfolioOwnership: {
                    strategy: components["schemas"]["PortfolioOwnershipStrategy"];
                };
                customerWithoutPriceTable: components["schemas"]["CustomerWithoutPriceTablePolicy"];
                creditFeatures: {
                    showCreditLimit: boolean;
                };
                accountSellerLinkCount: number;
            };
            products: {
                sellableUsageValues: string[];
                showInactive: boolean;
                productWithoutPrice: {
                    visible: boolean;
                    orderable: boolean;
                };
            };
            pricing: {
                /** @constant */
                customerTableStrategy: "customer_table";
                fallbackStrategy: components["schemas"]["FallbackStrategy"];
                fallbackTableCode: number | null;
                catalogReferenceTableCode: number | null;
                /** @constant */
                missingPrice: "no_price_state";
            };
            financial: {
                showFinancialArea: boolean;
                overdueTitles: boolean;
                creditChecks: boolean;
            };
            features: components["schemas"]["FeatureFlags"];
        };
        /** @enum {string} */
        ConfirmationBehavior: "manual" | "automatic" | "disabled";
        CreateOrderRequest: {
            /** Format: uuid */
            clientRequestId: string;
            customerCode: number;
            negotiationTypeCode: number | null;
            notes: string | null;
            items: components["schemas"]["OrderItemInput"][];
        };
        CustomerDetail: {
            code: number;
            name: string;
            tradeName: string | null;
            document: string | null;
            active: boolean;
            blocked: boolean;
            sellerCode: number | null;
            sellerName: string | null;
            priceTableCode: number | null;
            priceTableName: string | null;
            resolvedPriceTable: {
                code: number;
                /** @enum {string} */
                source: "customer" | "fallback";
            } | null;
            creditLimit: components["schemas"]["DecimalString"] | null;
            syncedAt: components["schemas"]["IsoTimestamp"];
        };
        CustomerListItem: {
            code: number;
            name: string;
            tradeName: string | null;
            document: string | null;
            active: boolean;
            blocked: boolean;
            sellerCode: number | null;
            sellerName: string | null;
            priceTableCode: number | null;
        };
        /** @enum {string} */
        CustomerSort: "name" | "-name" | "code" | "-code";
        /** @enum {string} */
        CustomerStatusFilter: "active" | "inactive" | "blocked";
        /** @enum {string} */
        CustomerWithoutPriceTablePolicy: "no_resolved_table" | "use_fallback_table";
        CustomersResponse: {
            items: components["schemas"]["CustomerListItem"][];
            page: number;
            pageSize: number;
            total: number;
        };
        DashboardResponse: {
            generatedAt: components["schemas"]["IsoTimestamp"];
            scope: components["schemas"]["DashboardScope"];
            groups: components["schemas"]["MetricGroup"][];
            recentOrders: components["schemas"]["OrderListItem"][];
        };
        DashboardScope: {
            /** @enum {string} */
            kind: "all" | "sellers";
            sellerCodes: number[];
        };
        DecimalString: string;
        ErpSubmissionDisabledError: {
            /** @constant */
            code: "erp_submission_disabled";
            message: string;
            details?: components["schemas"]["ErrorDetails"];
        };
        /** @enum {string} */
        ErrorCode: "validation_failed" | "unauthenticated" | "invalid_credentials" | "forbidden" | "not_found" | "conflict" | "version_conflict" | "idempotency_conflict" | "order_not_editable" | "installation_not_enabled" | "erp_submission_disabled" | "rate_limited" | "service_unavailable" | "internal_error";
        ErrorDetails: {
            issues?: components["schemas"]["ErrorIssue"][];
        } & {
            [key: string]: unknown;
        };
        ErrorIssue: {
            path: string;
            code: string;
            message?: string;
        };
        /** @enum {string} */
        FallbackStrategy: "none" | "fixed_table";
        FeatureFlags: {
            [key: string]: boolean;
        };
        /** @enum {string} */
        GatewayMode: "fake" | "live";
        HealthResponse: {
            /** @constant */
            status: "ok";
        };
        IntegrationSummary: {
            /** @enum {string} */
            state: "ok" | "degraded" | "not_configured";
            gatewayMode: components["schemas"]["GatewayMode"];
            lastSuccessAt: components["schemas"]["IsoTimestamp"] | null;
            failingEntities: string[];
            message: string | null;
        };
        /** Format: date-time */
        IsoTimestamp: string;
        ListPriceContext: {
            /** @constant */
            state: "priced";
            unitPrice: components["schemas"]["DecimalString"];
            tableCode: number;
            versionId: number;
            noPriceReason: null;
        } | {
            /** @constant */
            state: "zero";
            unitPrice: components["schemas"]["DecimalString"];
            tableCode: number;
            versionId: number;
            noPriceReason: null;
        } | {
            /** @constant */
            state: "none";
            unitPrice: null;
            tableCode: number | null;
            versionId: number | null;
            noPriceReason: components["schemas"]["NoPriceReason"];
        };
        /** @enum {string} */
        ListPriceState: "priced" | "zero" | "none";
        LoginRequest: {
            /** Format: email */
            email: string;
            password: string;
        };
        Metric: {
            key: string;
            label: string;
            value: components["schemas"]["MetricValue"] | null;
            description: string | null;
        };
        MetricGroup: {
            key: components["schemas"]["MetricGroupKey"];
            label: string;
            demo: boolean;
            metrics: components["schemas"]["Metric"][];
        };
        /** @enum {string} */
        MetricGroupKey: "portfolio" | "catalog" | "orders" | "credit" | "positivation";
        MetricValue: {
            /** @constant */
            kind: "count";
            value: number;
        } | {
            /** @constant */
            kind: "money";
            value: components["schemas"]["DecimalString"];
        } | {
            /** @constant */
            kind: "percent";
            value: components["schemas"]["DecimalString"];
        };
        NegotiationType: {
            code: number;
            label: string;
        };
        /** @enum {string} */
        NoPriceReason: "no_resolved_table" | "no_effective_version" | "no_price_row";
        OrderDetail: {
            /** Format: uuid */
            id: string;
            draftNumber: number;
            customerCode: number;
            customerName: string;
            sellerCode: number | null;
            status: components["schemas"]["OrderStatus"];
            estimatedTotal: components["schemas"]["DecimalString"];
            itemCount: number;
            isPartial: boolean;
            erpNumber: number | null;
            version: number;
            createdAt: components["schemas"]["IsoTimestamp"];
            updatedAt: components["schemas"]["IsoTimestamp"];
            negotiationTypeCode: number | null;
            notes: string | null;
            items: components["schemas"]["OrderItem"][];
            totals: components["schemas"]["OrderTotals"];
        };
        OrderItem: {
            lineNo: number;
            productCode: number;
            productDescription: string;
            unit: string;
            quantity: components["schemas"]["DecimalString"];
            unitListPrice: components["schemas"]["DecimalString"] | null;
            priceState: components["schemas"]["ListPriceState"];
            priceTableCode: number | null;
            priceVersionId: number | null;
            estimatedLineTotal: components["schemas"]["DecimalString"] | null;
        };
        OrderItemInput: {
            productCode: number;
            quantity: components["schemas"]["DecimalString"];
        };
        OrderListItem: {
            /** Format: uuid */
            id: string;
            draftNumber: number;
            customerCode: number;
            customerName: string;
            sellerCode: number | null;
            status: components["schemas"]["OrderStatus"];
            estimatedTotal: components["schemas"]["DecimalString"];
            itemCount: number;
            isPartial: boolean;
            erpNumber: number | null;
            version: number;
            createdAt: components["schemas"]["IsoTimestamp"];
            updatedAt: components["schemas"]["IsoTimestamp"];
        };
        /** @enum {string} */
        OrderSort: "updatedAt" | "-updatedAt" | "draftNumber" | "-draftNumber";
        /** @enum {string} */
        OrderStatus: "draft" | "cancelled" | "queued" | "sent" | "rejected" | "unknown";
        OrderTotals: {
            estimatedTotal: components["schemas"]["DecimalString"];
            lineCount: number;
            unpricedLineCount: number;
            isPartial: boolean;
        };
        OrdersResponse: {
            items: components["schemas"]["OrderListItem"][];
            page: number;
            pageSize: number;
            total: number;
        };
        /** @enum {string} */
        PortfolioOwnershipStrategy: "customer_seller_field" | "explicit_account_links" | "all_visible";
        PriceContext: {
            customerCode: number | null;
            tableCode: number | null;
            tableName: string | null;
            /** @enum {string} */
            source: "customer" | "fallback" | "catalog_reference" | "none";
        };
        ProductDetail: {
            code: number;
            description: string;
            active: boolean;
            sellable: boolean;
            unit: string;
            brand: string | null;
            reference: string | null;
            groupCode: number | null;
            groupName: string | null;
            listPrice: components["schemas"]["ListPriceContext"];
            usageCode: string | null;
            priceContext: components["schemas"]["PriceContext"];
        };
        ProductGroup: {
            code: number;
            name: string;
        };
        ProductGroupsResponse: {
            items: components["schemas"]["ProductGroup"][];
        };
        ProductListItem: {
            code: number;
            description: string;
            active: boolean;
            sellable: boolean;
            unit: string;
            brand: string | null;
            reference: string | null;
            groupCode: number | null;
            groupName: string | null;
            listPrice: components["schemas"]["ListPriceContext"];
        };
        /** @enum {string} */
        ProductSort: "description" | "-description" | "code" | "-code";
        ProductsResponse: {
            items: components["schemas"]["ProductListItem"][];
            page: number;
            pageSize: number;
            total: number;
            priceContext: components["schemas"]["PriceContext"];
        };
        ReadyResponse: {
            /** @enum {string} */
            status: "ready" | "degraded" | "not_ready";
            checks: {
                /** @enum {string} */
                database: "ok" | "fail";
                migrations: {
                    /** @enum {string} */
                    status: "ok" | "behind" | "ahead" | "unknown";
                    applied: string | null;
                    expected: string | null;
                };
            };
            integration: components["schemas"]["IntegrationSummary"];
        };
        ReplaceOrderRequest: {
            expectedVersion: number;
            customerCode: number;
            negotiationTypeCode: number | null;
            notes: string | null;
            items: components["schemas"]["OrderItemInput"][];
        };
        Seller: {
            code: number;
            name: string;
            active: boolean;
        };
        SellersResponse: {
            items: components["schemas"]["Seller"][];
        };
        SessionResponse: components["schemas"]["AuthenticatedSession"] | components["schemas"]["AnonymousSession"];
        SyncState: {
            entity: string;
            status: components["schemas"]["SyncStatus"];
            lastSuccessAt: components["schemas"]["IsoTimestamp"] | null;
            lastAttemptAt: components["schemas"]["IsoTimestamp"] | null;
            lastFullReconcileAt: components["schemas"]["IsoTimestamp"] | null;
            rowCount: number | null;
            lastErrorClass: string | null;
            lastErrorMessage: string | null;
        };
        /** @enum {string} */
        SyncStatus: "idle" | "running" | "succeeded" | "failed";
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description API no ar */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
        };
    };
    getReady: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Pronta (ready) ou degradada (degraded) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReadyResponse"];
                };
            };
            /** @description Não pronta (not_ready) */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReadyResponse"];
                };
            };
        };
    };
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Sessão criada */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthenticatedSession"];
                };
            };
            /** @description Requisição inválida (validation_failed) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Não autenticado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Muitas tentativas */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Serviço indisponível */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sessão encerrada */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Não autenticado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Estado da sessão */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionResponse"];
                };
            };
        };
    };
    getConfiguration: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Configuração vigente */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConfigurationResponse"];
                };
            };
            /** @description Não autenticado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Sem permissão para este recurso */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Serviço indisponível */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getDashboard: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Indicadores */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DashboardResponse"];
                };
            };
            /** @description Não autenticado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Sem permissão para este recurso */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listSellers: {
        parameters: {
            query?: {
                search?: string;
                active?: "true" | "false";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Vendedores */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SellersResponse"];
                };
            };
            /** @description Requisição inválida (validation_failed) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Não autenticado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Sem permissão para este recurso */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listCustomers: {
        parameters: {
            query?: {
                search?: string;
                status?: components["schemas"]["CustomerStatusFilter"];
                sellerCode?: number;
                hasPriceTable?: "true" | "false";
                sort?: components["schemas"]["CustomerSort"];
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Carteira de clientes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomersResponse"];
                };
            };
            /** @description Requisição inválida (validation_failed) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Não autenticado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Sem permissão para este recurso */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getCustomer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Cliente */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerDetail"];
                };
            };
            /** @description Requisição inválida (validation_failed) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Não autenticado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Sem permissão para este recurso */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Recurso não encontrado (ou fora do escopo do usuário) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listProductGroups: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Grupos de produto */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductGroupsResponse"];
                };
            };
            /** @description Não autenticado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Sem permissão para este recurso */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listProducts: {
        parameters: {
            query?: {
                search?: string;
                group?: number;
                sellable?: "true" | "false";
                priceState?: components["schemas"]["ListPriceState"];
                customerCode?: number;
                sort?: components["schemas"]["ProductSort"];
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Produtos */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductsResponse"];
                };
            };
            /** @description Requisição inválida (validation_failed) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Não autenticado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Sem permissão para este recurso */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Recurso não encontrado (ou fora do escopo do usuário) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getProduct: {
        parameters: {
            query?: {
                customerCode?: number;
            };
            header?: never;
            path: {
                code: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Produto */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductDetail"];
                };
            };
            /** @description Requisição inválida (validation_failed) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Não autenticado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Sem permissão para este recurso */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Recurso não encontrado (ou fora do escopo do usuário) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listOrders: {
        parameters: {
            query?: {
                search?: string;
                status?: components["schemas"]["OrderStatus"];
                customerCode?: number;
                sort?: components["schemas"]["OrderSort"];
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Pedidos */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrdersResponse"];
                };
            };
            /** @description Requisição inválida (validation_failed) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Não autenticado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Sem permissão para este recurso */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createOrder: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateOrderRequest"];
            };
        };
        responses: {
            /** @description Reenvio idempotente: pedido original */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            /** @description Rascunho criado */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            /** @description Requisição inválida (validation_failed) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Não autenticado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Sem permissão para este recurso */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Recurso não encontrado (ou fora do escopo do usuário) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Conflito de estado */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Pedido */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            /** @description Requisição inválida (validation_failed) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Não autenticado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Sem permissão para este recurso */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Recurso não encontrado (ou fora do escopo do usuário) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    replaceOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReplaceOrderRequest"];
            };
        };
        responses: {
            /** @description Rascunho atualizado */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            /** @description Requisição inválida (validation_failed) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Não autenticado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Sem permissão para este recurso */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Recurso não encontrado (ou fora do escopo do usuário) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Conflito de estado */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    discardOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Rascunho descartado */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            /** @description Requisição inválida (validation_failed) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Não autenticado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Sem permissão para este recurso */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Recurso não encontrado (ou fora do escopo do usuário) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Conflito de estado */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    submitOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Requisição inválida (validation_failed) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Não autenticado */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Sem permissão para este recurso */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Recurso não encontrado (ou fora do escopo do usuário) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Envio ao ERP aguardando conclusão da integração segura */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErpSubmissionDisabledError"];
                };
            };
        };
    };
}
