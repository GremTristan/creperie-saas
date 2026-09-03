import { captureKey } from "@/lib/capture-keys";
import type { CaptureEventType, CaptureSource } from "@/types";

export function posCaptureKey(
  tenantId: string,
  type: CaptureEventType,
  source: CaptureSource,
  externalId: string,
  discriminator: string
): string {
  return captureKey(tenantId, type, `${source}:${externalId}`, discriminator);
}
