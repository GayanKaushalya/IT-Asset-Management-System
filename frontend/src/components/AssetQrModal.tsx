import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Modal } from './ui/Modal';
import { assetQrFileName, buildAssetQrText, type AssetQrSource } from '../utils/assetQr';

type Props = {
  open: boolean;
  asset: AssetQrSource | null;
  onClose: () => void;
};

function dash(v: unknown): string {
  if (v == null || String(v).trim() === '') return '—';
  return String(v);
}

/** Build printable PNG: QR + asset fields (no helper captions). */
async function buildLabelPng(qrDataUrl: string, asset: AssetQrSource, isPhone: boolean): Promise<string> {
  const qrImg = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load QR image'));
    img.src = qrDataUrl;
  });

  const rows: [string, string][] = [
    ['Asset ID', dash(asset.asset_tag)],
    ['SN', dash(asset.serial_number)],
    ['Brand', dash(asset.brand)],
    ['Model', dash(asset.model)],
  ];
  if (isPhone) {
    rows.push(['IMEI 1', dash(asset.imei_number)]);
    rows.push(['IMEI 2', dash(asset.imei_number_2)]);
  }

  const pad = 28;
  const qrSize = 280;
  const gap = 28;
  const labelColW = 90;
  const valueColW = 320;
  const lineH = 34;
  const titleH = 36;
  const detailsW = labelColW + valueColW;
  const detailsBlockH = titleH + rows.length * lineH;
  const contentH = Math.max(qrSize, detailsBlockH);

  const width = pad + qrSize + gap + detailsW + pad;
  const height = pad + contentH + pad;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');

  // White card background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Light border
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  // QR
  ctx.drawImage(qrImg, pad, pad + (contentH - qrSize) / 2, qrSize, qrSize);

  // Title
  const textX = pad + qrSize + gap;
  let y = pad + 8;
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 20px Segoe UI, Arial, sans-serif';
  ctx.fillText('Indra Group IT Asset', textX, y + 18);
  y += titleH + 8;

  // Detail rows
  for (const [label, value] of rows) {
    ctx.font = '600 15px Segoe UI, Arial, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText(label, textX, y + 18);

    ctx.font = '600 15px Segoe UI, Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    const valueX = textX + labelColW;
    // Wrap long model lines if needed
    const maxValueW = valueColW;
    const words = value.split(' ');
    let line = '';
    let lineY = y + 18;
    let linesUsed = 0;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxValueW && line) {
        ctx.fillText(line, valueX, lineY);
        line = word;
        lineY += 20;
        linesUsed += 1;
      } else {
        line = test;
      }
    }
    ctx.fillText(line, valueX, lineY);
    y += lineH + (linesUsed > 0 ? linesUsed * 20 : 0);
  }

  return canvas.toDataURL('image/png');
}

export default function AssetQrModal({ open, asset, onClose }: Props) {
  const [dataUrl, setDataUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const text = asset ? buildAssetQrText(asset) : '';
  const fileName = asset ? assetQrFileName(asset) : 'ITAMS-QR.png';
  const isPhone = String(asset?.category ?? '').toLowerCase().includes('mobile');

  useEffect(() => {
    if (!open || !asset) {
      setDataUrl('');
      setError('');
      return;
    }

    let cancelled = false;
    setBusy(true);
    setError('');
    void QRCode.toDataURL(text, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 360,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not generate QR');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, asset, text]);

  async function download() {
    if (!dataUrl || !asset) return;
    setDownloading(true);
    setError('');
    try {
      const labelUrl = await buildLabelPng(dataUrl, asset, isPhone);
      const a = document.createElement('a');
      a.href = labelUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Modal
      open={open && !!asset}
      title="Asset QR code"
      eyebrow={String(asset?.asset_tag ?? 'Asset')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-soft" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dataUrl || busy || downloading}
            onClick={() => void download()}
          >
            {downloading ? 'Preparing…' : 'Download QR'}
          </button>
        </>
      }
    >
      <div className="asset-qr-modal">
        <div className="asset-qr-preview">
          {busy ? <p className="asset-qr-muted">Generating…</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
          {dataUrl ? (
            <img src={dataUrl} alt={`QR for ${String(asset?.asset_tag ?? 'asset')}`} width={220} height={220} />
          ) : null}
        </div>
        <div className="asset-qr-details">
          <p className="asset-qr-muted">When scanned, the phone shows:</p>
          <dl>
            <div>
              <dt>Asset ID</dt>
              <dd>{dash(asset?.asset_tag)}</dd>
            </div>
            <div>
              <dt>SN</dt>
              <dd>{dash(asset?.serial_number)}</dd>
            </div>
            <div>
              <dt>Brand</dt>
              <dd>{dash(asset?.brand)}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{dash(asset?.model)}</dd>
            </div>
            {isPhone ? (
              <>
                <div>
                  <dt>IMEI 1</dt>
                  <dd>{dash(asset?.imei_number)}</dd>
                </div>
                <div>
                  <dt>IMEI 2</dt>
                  <dd>{dash(asset?.imei_number_2)}</dd>
                </div>
              </>
            ) : null}
          </dl>
          <p className="asset-qr-hint">Print or stick this QR on the device. Download saves a PNG to your PC.</p>
        </div>
      </div>
      <style>{`
        .asset-qr-modal {
          display: grid;
          grid-template-columns: minmax(200px, 240px) 1fr;
          gap: 1.1rem;
          align-items: start;
        }
        @media (max-width: 640px) {
          .asset-qr-modal { grid-template-columns: 1fr; }
        }
        .asset-qr-preview {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 220px;
          padding: 0.75rem;
          border: 1px solid var(--border);
          border-radius: 12px;
          background: #fff;
        }
        .asset-qr-preview img {
          display: block;
          width: 220px;
          height: 220px;
        }
        .asset-qr-details dl {
          margin: 0;
          display: grid;
          gap: 0.45rem;
        }
        .asset-qr-details dl > div {
          display: grid;
          grid-template-columns: 5.5rem 1fr;
          gap: 0.4rem;
          font-size: 0.9rem;
        }
        .asset-qr-details dt {
          margin: 0;
          color: var(--muted);
          font-weight: 600;
        }
        .asset-qr-details dd {
          margin: 0;
          word-break: break-word;
        }
        .asset-qr-muted {
          margin: 0 0 0.65rem;
          color: var(--muted);
          font-size: 0.88rem;
        }
        .asset-qr-hint {
          margin: 0.85rem 0 0;
          color: var(--muted);
          font-size: 0.82rem;
        }
      `}</style>
    </Modal>
  );
}
