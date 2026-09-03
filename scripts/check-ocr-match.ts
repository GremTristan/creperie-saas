import { bestMatch, scoreLabels } from "@/lib/ocr/match";
import { parseInvoiceJson } from "@/lib/ocr/parse";
import { parseAmount } from "@/lib/ocr/normalize";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(scoreLabels("Farine sarrasin 25kg", "Sac de Farine  Sarrasin") >= 0.5, "sarrasin flour matches");
assert(scoreLabels("Poulet hallal", "Poulet Hallal") >= 0.9, "poulet exactish");
assert(scoreLabels("Cidre inconnu magique", "Nutella pot de 750g") < 0.5, "unrelated stays unmatched");

const hit = bestMatch(
  "Jambon cuit Puccini 6kg",
  [
    { id: "1", name: "Jambon cuit Puccini", supplierId: "s1" },
    { id: "2", name: "Jambon Prestige", supplierId: "s2" },
  ],
  "s1"
);
assert(hit?.id === "1", "prefers matching supplier when close");

const invoice = parseInvoiceJson({
  supplierName: "Binggeli",
  invoiceDate: "03.09.2026",
  currency: "CHF",
  lines: [
    { label: "Confiture de Myrtilles", quantity: "2", unit: "pot", unitPrice: "5,90" },
    { name: "Sans quantité", qty: 0 },
  ],
});
assert(invoice.invoiceDate === "2026-09-03", "FR date normalized");
assert(invoice.lines.length === 1, "zero qty line dropped");
assert(invoice.lines[0].unitPrice === 5.9, "swiss comma price");
assert(invoice.lines[0].lineTotal === 11.8, "line total derived");
assert(parseAmount("1'234.50") === 1234.5, "apostrophe thousands");

console.log("ocr match harness OK");
