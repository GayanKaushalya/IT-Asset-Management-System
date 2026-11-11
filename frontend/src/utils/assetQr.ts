/** Build plain-text payload shown when a phone camera scans the QR. */

export type AssetQrSource = {
  asset_tag?: unknown;
  serial_number?: unknown;
  brand?: unknown;
  model?: unknown;
  category?: unknown;
  imei_number?: unknown;
  imei_number_2?: unknown;
};

function val(v: unknown): string {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
}

export function buildAssetQrText(asset: AssetQrSource): string {
  const category = val(asset.category).toLowerCase();
  const lines = [
    'Indra Group IT Asset',
    `Asset ID: ${val(asset.asset_tag) || '—'}`,
    `SN: ${val(asset.serial_number) || '—'}`,
    `Brand: ${val(asset.brand) || '—'}`,
    `Model: ${val(asset.model) || '—'}`,
  ];

  if (category === 'mobile_phone' || category === 'mobile-phones') {
    lines.push(`IMEI 1: ${val(asset.imei_number) || '—'}`);
    lines.push(`IMEI 2: ${val(asset.imei_number_2) || '—'}`);
  }

  return lines.join('\n');
}

export function assetQrFileName(asset: AssetQrSource): string {
  const tag = val(asset.asset_tag).replace(/[^\w.-]+/g, '_') || 'asset';
  return `ITAMS-QR-${tag}.png`;
}
