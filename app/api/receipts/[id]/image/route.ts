import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { getReceiptImage } from "@/lib/receipt-store";
import { requireDirector } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { tenant } = await requireDirector();
    const { id } = await params;
    const image = await getReceiptImage(tenant.id, id);
    if (!image) return NextResponse.json({ error: "Photo introuvable" }, { status: 404 });
    return new NextResponse(new Uint8Array(image.bytes), {
      headers: {
        "content-type": image.mediaType,
        "cache-control": "private, max-age=3600",
      },
    });
  });
}
