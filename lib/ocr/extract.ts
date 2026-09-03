import "server-only";

import { parseInvoiceJson, parseInvoiceText } from "@/lib/ocr/parse";
import type { ImageMediaType, OcrInvoice } from "@/types";

const VISION_PROMPT = `Tu lis un bon de livraison ou une facture fournisseur suisse (CHF).
Extrais uniquement ce qui est écrit. N'invente aucun prix, quantité ou produit.
Réponds en JSON strict :
{
  "supplierName": string|null,
  "invoiceDate": "YYYY-MM-DD"|null,
  "invoiceRef": string|null,
  "currency": "CHF"|"EUR",
  "lines": [{ "label": string, "quantity": number, "unit": string|null, "unitPrice": number|null, "lineTotal": number|null }]
}
Ignore totaux TVA, escompte, et lignes de frais sans article. Quantités et prix en nombres (point décimal).`;

export function ocrConfigured(): boolean {
  return Boolean(process.env.OCR_API_KEY || process.env.OPENAI_API_KEY);
}

export async function extractInvoice(input: {
  mediaType: ImageMediaType | "application/json" | "text/plain";
  bytes: Buffer;
}): Promise<{ invoice: OcrInvoice; raw: Record<string, unknown>; error: string | null }> {
  if (input.mediaType === "application/json" || input.mediaType === "text/plain") {
    const invoice = parseInvoiceText(input.bytes.toString("utf8"));
    return { invoice, raw: invoice as unknown as Record<string, unknown>, error: invoice.lines.length ? null : "Aucune ligne lisible dans le fichier." };
  }

  if (!ocrConfigured()) {
    return {
      invoice: { supplierName: null, invoiceDate: null, invoiceRef: null, currency: "CHF", lines: [] },
      raw: {},
      error: "Lecture photo non configurée — ajoutez les lignes à la main, ou un fichier JSON.",
    };
  }

  const url = process.env.OCR_API_URL || "https://api.openai.com/v1/chat/completions";
  const key = process.env.OCR_API_KEY || process.env.OPENAI_API_KEY || "";
  const model = process.env.OCR_MODEL || "gpt-4o-mini";
  const dataUrl = `data:${input.mediaType};base64,${input.bytes.toString("base64")}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: VISION_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        invoice: { supplierName: null, invoiceDate: null, invoiceRef: null, currency: "CHF", lines: [] },
        raw: { status: response.status, detail: detail.slice(0, 500) },
        error: "La lecture de la photo a échoué. Ajoutez les lignes à la main.",
      };
    }
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content ?? "{}";
    const invoice = parseInvoiceJson(JSON.parse(stripFences(content)));
    return {
      invoice,
      raw: invoice as unknown as Record<string, unknown>,
      error: invoice.lines.length ? null : "Aucune ligne reconnue sur la photo. Ajoutez-les à la main.",
    };
  } catch (error) {
    return {
      invoice: { supplierName: null, invoiceDate: null, invoiceRef: null, currency: "CHF", lines: [] },
      raw: { error: error instanceof Error ? error.message : "ocr failed" },
      error: "La lecture de la photo a échoué. Ajoutez les lignes à la main.",
    };
  }
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}
