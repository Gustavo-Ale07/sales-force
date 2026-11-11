import { StatusDot, titleCase } from "@salesforce/ui";
import type { ProductRow } from "../lib/price-types";
import { PriceCell } from "./price-cell";
import { ProductImage } from "./product-image";

type ProductListItem = ProductRow;

/**
 * Photo grid of the catalog: the same items and fields as the table (never cost or margin), one button per
 * product that opens the same detail panel. Without a photo the placeholder shows the initials.
 */
export function ProductGrid({ items, onOpen }: { items: readonly ProductListItem[]; onOpen: (code: number) => void }) {
  return (
    <ul aria-label="Produtos em grade" className="m-0 grid list-none grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((product) => (
        <li key={product.code} className="min-w-0">
          <button
            type="button"
            onClick={() => onOpen(product.code)}
            className="flex h-full w-full flex-col items-stretch gap-2 rounded-lg border border-line bg-surface p-3 text-left outline-none transition-[translate,box-shadow,border-color] duration-[var(--sf-dur-fast)] ease-spring hover:-translate-y-px hover:border-line-strong hover:shadow-card focus-visible:ring-2 focus-visible:ring-ring active:translate-y-0"
          >
            <ProductImage
              image={product.image}
              description={product.description}
              name={titleCase(product.description)}
              size={112}
              className="self-center"
            />
            <span className="min-w-0 text-sm font-medium leading-snug text-fg [overflow-wrap:anywhere]">{titleCase(product.description)}</span>
            <span className="text-xs text-fg-muted">
              Cód. {product.code}
              {product.reference ? ` · Ref. ${product.reference}` : ""}
            </span>
            <span className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-1">
              <StatusDot tone={product.sellable ? "success" : "neutral"} className="text-xs">
                {product.sellable ? "Vendável" : "Não vendável"}
              </StatusDot>
              <span className="text-sm font-semibold">
                <PriceCell price={product.listPrice} />
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
