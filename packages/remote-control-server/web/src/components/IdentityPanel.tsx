import { useState, useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import QrScanner from 'qr-scanner';
import { getUuid, setUuid } from '../api/client';
import { cn } from '../lib/utils';
import { Scan } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';

interface IdentityPanelProps {
  open: boolean;
  onClose: () => void;
  onUuidImported?: (uuid: string) => void;
}

export function IdentityPanel({ open, onClose, onUuidImported }: IdentityPanelProps) {
  const [copied, setCopied] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uuid, setLocalUuid] = useState<string>(() => getUuid());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const { resolvedTheme } = useTheme();

  // Refresh displayed UUID whenever dialog opens
  useEffect(() => {
    if (open) {
      setLocalUuid(getUuid());
      setCameraError(null);
    } else {
      setScanning(false);
    }
  }, [open]);

  const qrColors =
    resolvedTheme === 'dark' ? { dark: '#ECE9E0', light: '#1C1B18' } : { dark: '#141413', light: '#FDFCF8' };

  useEffect(() => {
    if (!open || scanning) return;
    // Defer one frame so Radix Dialog Portal has finished mounting the canvas
    const rafId = requestAnimationFrame(() => {
      if (!canvasRef.current) return;
      const qrUrl = `${window.location.origin}/code?uuid=${encodeURIComponent(uuid)}`;
      QRCode.toCanvas(canvasRef.current, qrUrl, {
        width: 200,
        margin: 1,
        color: qrColors,
      }).catch((err: unknown) => {
        console.error('QR generation failed:', err);
      });
    });
    return () => cancelAnimationFrame(rafId);
  }, [open, scanning, uuid, resolvedTheme]);

  const stopCamera = () => {
    const existing = scannerRef.current;
    scannerRef.current = null;
    if (existing) {
      existing.stop();
      existing.destroy();
    }
    setScanning(false);
  };

  const applyImportedUuid = (importedUuid: string) => {
    setUuid(importedUuid);
    setLocalUuid(importedUuid);
    stopCamera();
    onClose();
    if (onUuidImported) {
      onUuidImported(importedUuid);
    } else {
      window.location.reload();
    }
  };

  const handleScannedData = (data: string) => {
    try {
      // Try ACP format: { url, token }
      const parsed = JSON.parse(data);
      if (parsed.url && parsed.token) {
        // Store ACP connection data and navigate to ACP direct connect view
        stopCamera();
        onClose();
        sessionStorage.setItem('acp_connection', JSON.stringify({ url: parsed.url, token: parsed.token }));
        window.location.href = '/code/?acp=1';
        return;
      }
    } catch {
      // Not JSON
    }

    // Try URL with uuid param
    try {
      const url = new URL(data);
      const importedUuid = url.searchParams.get('uuid');
      if (importedUuid) {
        applyImportedUuid(importedUuid);
        return;
      }
    } catch {
      // Not a URL
    }

    // Raw UUID string
    if (data.length >= 32) {
      applyImportedUuid(data);
      return;
    }
  };

  const handleScannedDataRef = useRef(handleScannedData);
  handleScannedDataRef.current = handleScannedData;

  // Initialize camera QrScanner AFTER <video ref={videoRef} /> mounts when scanning becomes true
  useEffect(() => {
    if (!open || !scanning) return;

    let cancelled = false;
    let localScanner: QrScanner | null = null;

    const rafId = requestAnimationFrame(() => {
      if (cancelled || !videoRef.current) return;
      const scanner = new QrScanner(
        videoRef.current,
        result => {
          handleScannedDataRef.current(result.data);
        },
        { returnDetailedScanResult: true },
      );
      localScanner = scanner;
      scannerRef.current = scanner;
      scanner.start().catch((e: unknown) => {
        if (cancelled) return;
        console.error('Camera error:', e);
        setCameraError(e instanceof Error ? e.message : 'Camera error');
        if (scannerRef.current === scanner) {
          scannerRef.current = null;
        }
        scanner.destroy();
        setScanning(false);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      const toDestroy = localScanner ?? scannerRef.current;
      localScanner = null;
      scannerRef.current = null;
      if (toDestroy) {
        toDestroy.stop();
        toDestroy.destroy();
      }
    };
  }, [open, scanning]);

  if (!open) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(uuid);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startCamera = () => {
    setCameraError(null);
    setScanning(true);
  };

  const handleScanUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const result = await QrScanner.scanImage(file, {
          returnDetailedScanResult: true,
        });
        handleScannedData(result.data);
      } catch {
        alert('No QR code found in image');
      }
    };
    input.click();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-sm rounded-2xl border-border bg-surface-1 p-6 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-semibold text-text-primary">Identity</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* UUID */}
          <div>
            <label className="mb-1 block text-sm text-text-secondary">Your UUID</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-text-primary">
                {uuid}
              </code>
              <button
                onClick={handleCopy}
                className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:bg-surface-2 transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* QR Code display */}
          {!scanning && (
            <div>
              <label className="mb-2 block text-sm text-text-secondary">Scan on another device</label>
              <div className="flex justify-center">
                <canvas ref={canvasRef} />
              </div>
            </div>
          )}

          {/* Camera scanner */}
          {scanning && (
            <div>
              <label className="mb-2 block text-sm text-text-secondary">Camera scanner</label>
              <div className="relative overflow-hidden rounded-lg">
                <video ref={videoRef} className="w-full" />
              </div>
              <button
                onClick={stopCamera}
                className="mt-2 w-full rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-2 transition-colors"
              >
                Stop scanning
              </button>
            </div>
          )}

          {/* Camera error */}
          {cameraError && <div className="text-xs text-status-error">{cameraError}</div>}

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={scanning ? stopCamera : startCamera}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors',
                scanning
                  ? 'border-status-error/30 text-status-error hover:bg-status-error/10'
                  : 'border-border text-text-secondary hover:bg-surface-2',
              )}
            >
              <Scan className="h-4 w-4" />
              {scanning ? 'Stop Camera' : 'Scan with Camera'}
            </button>
            <button
              onClick={handleScanUpload}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-2 transition-colors"
            >
              Upload QR Image
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
