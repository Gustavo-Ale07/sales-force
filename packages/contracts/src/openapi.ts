import { z } from 'zod';
import { ApiErrorSchema, ERROR_STATUS_DESCRIPTIONS } from './errors.js';
import { schemaRegistry } from './primitives.js';
import {
  API_BASE_PATH,
  SESSION_COOKIE_NAME,
  routeList,
  type RouteDefinition,
  type RouteResponse,
} from './routes.js';

/**
 * Pure OpenAPI 3.1 builder over the route registry. No I/O: the generation script writes the file.
 * Uses Zod's native JSON Schema conversion (draft 2020-12, the dialect of OpenAPI 3.1), so there is
 * no second schema library to keep in step with Zod (V-02).
 */

export const API_TITLE = 'Sales Force API';
export const API_VERSION = '1.0.0';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** Rewrites Zod's `$defs` references to OpenAPI component references and drops generator noise. */
function clean(node: Json): Json {
  if (Array.isArray(node)) return node.map(clean);
  if (node === null || typeof node !== 'object') return node;
  const out: JsonObject = {};
  const isDateTime = node['format'] === 'date-time';
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema' || key === '$id') continue;
    if (key === 'pattern' && isDateTime) continue; // the built-in date-time regex is huge noise
    if (key === 'maximum' && value === MAX_SAFE) continue; // implicit safe-integer bound
    if (key === 'minimum' && value === -MAX_SAFE) continue;
    if (key === '$ref' && typeof value === 'string') {
      out[key] = value.replace('#/$defs/', '#/components/schemas/');
      continue;
    }
    out[key] = clean(value as Json);
  }
  return out;
}

class ComponentCollector {
  readonly schemas = new Map<string, Json>();

  add(id: string, schema: Json): void {
    const existing = this.schemas.get(id);
    if (existing === undefined) {
      this.schemas.set(id, schema);
      return;
    }
    if (JSON.stringify(existing) !== JSON.stringify(schema)) {
      throw new Error(
        `Contract schema "${id}" has different input and output shapes; give the two shapes different ids.`,
      );
    }
  }

  toObject(): JsonObject {
    const out: JsonObject = {};
    for (const id of [...this.schemas.keys()].sort()) out[id] = this.schemas.get(id) as Json;
    return out;
  }
}

/** Converts a Zod schema to an inline JSON Schema; named sub-schemas go to `components`. */
function convert(
  schema: z.ZodType,
  io: 'input' | 'output',
  components: ComponentCollector,
): JsonObject {
  const raw = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
    unrepresentable: 'any',
    metadata: schemaRegistry,
  }) as JsonObject;
  const { $defs, ...rest } = raw;
  if ($defs !== undefined && typeof $defs === 'object' && $defs !== null && !Array.isArray($defs)) {
    for (const [id, def] of Object.entries($defs)) components.add(id, clean(def));
  }
  return clean(rest) as JsonObject;
}

function parameters(
  location: 'path' | 'query',
  schema: z.ZodObject,
  components: ComponentCollector,
): Json[] {
  const json = convert(schema, 'input', components);
  const properties = (json['properties'] ?? {}) as { [key: string]: JsonObject };
  const required = new Set((json['required'] ?? []) as string[]);
  return Object.entries(properties).map(([name, propSchema]) => {
    const { description, ...schemaOnly } = propSchema;
    const param: JsonObject = {
      name,
      in: location,
      required: location === 'path' ? true : required.has(name),
    };
    if (typeof description === 'string') param['description'] = description;
    param['schema'] = schemaOnly;
    return param;
  });
}

const JSON_CONTENT = 'application/json';

function responseObject(response: RouteResponse, components: ComponentCollector): JsonObject {
  if (!response.schema) return { description: response.description };
  return {
    description: response.description,
    content: { [JSON_CONTENT]: { schema: convert(response.schema, 'output', components) } },
  };
}

function operation(route: RouteDefinition, components: ComponentCollector): JsonObject {
  const op: JsonObject = {
    operationId: route.operationId,
    tags: [...route.tags],
    summary: route.summary,
  };
  if (route.description) op['description'] = route.description;
  if (route.auth === 'public') op['security'] = [];

  const params: Json[] = [];
  if (route.request.params) params.push(...parameters('path', route.request.params, components));
  if (route.request.query) params.push(...parameters('query', route.request.query, components));
  if (params.length > 0) op['parameters'] = params;

  if (route.request.body) {
    op['requestBody'] = {
      required: true,
      content: { [JSON_CONTENT]: { schema: convert(route.request.body, 'input', components) } },
    };
  }

  const responses: { [status: string]: JsonObject } = {};
  const errorSchema = convert(ApiErrorSchema, 'output', components);
  const statuses = new Set<number>([...Object.keys(route.responses).map(Number), ...route.errors]);
  for (const status of [...statuses].sort((a, b) => a - b)) {
    const declared = route.responses[status];
    if (declared) {
      responses[String(status)] = responseObject(declared, components);
    } else {
      const description =
        ERROR_STATUS_DESCRIPTIONS[status as keyof typeof ERROR_STATUS_DESCRIPTIONS];
      responses[String(status)] = {
        description,
        content: { [JSON_CONTENT]: { schema: errorSchema } },
      };
    }
  }
  op['responses'] = responses;
  return op;
}

/** Builds the OpenAPI 3.1 document. Deterministic: same registry, same output. */
export function buildOpenApiDocument(
  routesToDocument: readonly RouteDefinition[] = routeList,
): JsonObject {
  const components = new ComponentCollector();
  const paths: { [path: string]: JsonObject } = {};
  for (const route of routesToDocument) {
    const item = paths[route.path] ?? {};
    if (item[route.method] !== undefined) {
      throw new Error(`Duplicate route ${route.method.toUpperCase()} ${route.path}`);
    }
    item[route.method] = operation(route, components);
    paths[route.path] = item;
  }

  const tags = [...new Set(routesToDocument.flatMap((r) => r.tags))]
    .sort()
    .map((name) => ({ name }));

  return {
    openapi: '3.1.0',
    info: {
      title: API_TITLE,
      version: API_VERSION,
      description:
        'Sales Force HTTP API. Generated from the Zod contracts in @salesforce/contracts; do not edit by hand. Decimal values are strings. Errors use { code, message, details? }.',
    },
    servers: [{ url: API_BASE_PATH }],
    tags,
    security: [{ sessionCookie: [] }],
    paths,
    components: {
      schemas: components.toObject(),
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE_NAME },
      },
    },
  };
}

/** Stable serialization used for the committed file. */
export function serializeOpenApi(document: JsonObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
