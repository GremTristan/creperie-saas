import type { CaptureEventType } from "@/types";

export function captureKey(
  tenantId: string,
  type: CaptureEventType,
  entityId: string,
  discriminator: string
): string {
  return `${tenantId}:${type}:${entityId}:${discriminator}`;
}
