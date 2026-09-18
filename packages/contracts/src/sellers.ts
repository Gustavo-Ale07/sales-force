import { z } from 'zod';
import { codeInt, named, queryBoolean, querySearch } from './primitives.js';

export const SellerSchema = named(
  'Seller',
  z.object({ code: codeInt(), name: z.string(), active: z.boolean() }),
);
export type Seller = z.infer<typeof SellerSchema>;

export const SellersQuerySchema = z.object({
  search: querySearch().optional(),
  active: queryBoolean().optional(),
});
export type SellersQuery = z.infer<typeof SellersQuerySchema>;

/** Sellers visible to the actor (scoped server-side, P-21). Small list: not paginated. */
export const SellersResponseSchema = named(
  'SellersResponse',
  z.object({ items: z.array(SellerSchema) }),
);
export type SellersResponse = z.infer<typeof SellersResponseSchema>;
