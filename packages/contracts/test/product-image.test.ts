import { describe, expect, it } from 'vitest';
import {
  ProductDetailSchema,
  ProductImageQuerySchema,
  ProductListItemSchema,
  buildOpenApiDocument,
  routes,
} from '../src/index.js';

const listItem = {
  code: 7,
  description: 'Produto',
  active: true,
  sellable: true,
  unit: 'UN',
  brand: null,
  reference: null,
  groupCode: null,
  groupName: null,
  listPrice: { state: 'none', unitPrice: null, tableCode: null, versionId: null, noPriceReason: 'no_resolved_table' },
};

describe('product image contract', () => {
  it('keeps the image optional so existing consumers still parse', () => {
    expect(ProductListItemSchema.safeParse(listItem).success).toBe(true);
    expect(ProductListItemSchema.safeParse({ ...listItem, image: null }).success).toBe(true);
  });

  it('accepts metadata made of an opaque version and relative paths', () => {
    const image = { version: 'abc123', thumbnailUrl: '/api/v1/products/7/image?variant=thumb', url: '/api/v1/products/7/image?variant=full' };
    const parsed = ProductListItemSchema.parse({ ...listItem, image });
    expect(parsed.image).toEqual(image);
    expect(ProductDetailSchema.shape).toHaveProperty('image');
  });

  it('drops unknown image keys and rejects an empty or oversized version', () => {
    const image = { version: 'v', thumbnailUrl: '/a', url: '/b', bytes: 'AAAA' };
    expect(ProductListItemSchema.parse({ ...listItem, image }).image).not.toHaveProperty('bytes');
    expect(ProductListItemSchema.safeParse({ ...listItem, image: { ...image, version: '' } }).success).toBe(false);
    expect(ProductListItemSchema.safeParse({ ...listItem, image: { ...image, version: 'x'.repeat(129) } }).success).toBe(false);
  });

  it('validates the variant, defaulting to thumb', () => {
    expect(ProductImageQuerySchema.parse({}).variant).toBe('thumb');
    expect(ProductImageQuerySchema.safeParse({ variant: 'huge' }).success).toBe(false);
  });

  it('documents the image route as binary with 304 and no JSON body', () => {
    const doc = buildOpenApiDocument() as { paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, unknown> }> }>> };
    const responses = doc.paths['/products/{code}/image']?.['get']?.responses;
    expect(Object.keys(responses ?? {})).toEqual(expect.arrayContaining(['200', '304', '404', '503']));
    expect(Object.keys(responses?.['200']?.content ?? {}).sort()).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(responses?.['304']?.content).toBeUndefined();
    expect(routes.getProductImage.auth).toBe('session');
  });
});
