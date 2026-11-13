/** UI-only derivation. Never changes fixtures or invents timestamps for existing counts. */
import type { NetworkDemoEvent } from '@/services/NetworkPrototypeDemo';

export type NetworkDemoActivity = Readonly<{
  id: string;
  eventPublicId: string;
  kind: 'PUBLISHED' | 'AUTHOR_UPDATE' | 'RESOLVED' | 'LOCAL_CONFIRMATION';
  occurredAt: string;
  label: string;
  body: string;
  local: boolean;
}>;

export function buildNetworkPrototypeActivity(
  entries: readonly NetworkDemoEvent[], confirmations: ReadonlyMap<string, string> = new Map(),
): readonly NetworkDemoActivity[] {
  const rows: NetworkDemoActivity[] = [];
  for (const entry of entries) {
    if (!entry.demo || !('authorNickname' in entry.detail)) continue;
    const detail = entry.detail, marker = detail.marker;
    rows.push({ id: `${marker.publicId}:published`, eventPublicId: marker.publicId, kind: 'PUBLISHED',
      occurredAt: marker.createdAt, label: 'Nuova segnalazione', body: entry.title, local: false });
    for (const update of detail.updates) rows.push({ id: `${marker.publicId}:${update.publicId}`, eventPublicId: marker.publicId,
      kind: 'AUTHOR_UPDATE', occurredAt: update.createdAt, label: 'Aggiornamento dell’autore', body: update.body, local: false });
    if (marker.status === 'RESOLVED') rows.push({ id: `${marker.publicId}:resolved`, eventPublicId: marker.publicId,
      kind: 'RESOLVED', occurredAt: marker.resolvedAt, label: 'Segnalazione conclusa', body: entry.title, local: false });
    const confirmedAt = confirmations.get(marker.publicId);
    if (confirmedAt) rows.push({ id: `${marker.publicId}:local-confirmation`, eventPublicId: marker.publicId,
      kind: 'LOCAL_CONFIRMATION', occurredAt: confirmedAt, label: 'Confermata da te · demo', body: entry.title, local: true });
  }
  return rows.filter(row => Number.isFinite(Date.parse(row.occurredAt)))
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.id.localeCompare(b.id));
}
