'use client';
import { useState, useEffect, useRef } from 'react';
import { Camera, Mic, Check } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface DeviceSelectorProps {
  open:    boolean;
  onClose: () => void;
}

interface DeviceOption {
  deviceId: string;
  label:    string;
}

export function DeviceSelector({ open, onClose }: DeviceSelectorProps) {
  const [cameras,   setCameras]   = useState<DeviceOption[]>([]);
  const [mics,      setMics]      = useState<DeviceOption[]>([]);
  const [selCamera, setSelCamera] = useState('');
  const [selMic,    setSelMic]    = useState('');
  const [preview,   setPreview]   = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Enumerate devices when modal opens
  useEffect(() => {
    if (!open) return;

    (async () => {
      // Request permission first so labels are populated
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        tempStream.getTracks().forEach((t) => t.stop());
      } catch { /* user may deny — continue with available labels */ }

      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
      const mics_ = all
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Mic ${i + 1}` }));

      setCameras(cams);
      setMics(mics_);
      if (cams.length)  setSelCamera(cams[0].deviceId);
      if (mics_.length) setSelMic(mics_[0].deviceId);
    })();
  }, [open]);

  // Show camera preview when a camera is selected
  useEffect(() => {
    if (!open || !selCamera) return;
    let active = true;

    navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: selCamera } } })
      .then((stream) => {
        if (!active) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (preview) preview.getTracks().forEach((t) => t.stop());
        setPreview(stream);
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => {});

    return () => { active = false; };
  }, [selCamera, open]);

  // Stop preview on close
  useEffect(() => {
    if (!open && preview) {
      preview.getTracks().forEach((t) => t.stop());
      setPreview(null);
    }
  }, [open]);

  const handleSave = () => {
    // In a real app you would call switchCamera / switchMicrophone here
    // and persist preference to localStorage.
    if (preview) preview.getTracks().forEach((t) => t.stop());
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Audio & video settings" size="md">
      <div className="space-y-6">
        {/* Camera preview */}
        <div className="rounded-xl overflow-hidden bg-gray-950 aspect-video flex items-center justify-center">
          {selCamera ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover scale-x-[-1]"
            />
          ) : (
            <p className="text-gray-500 text-sm">No camera selected</p>
          )}
        </div>

        {/* Camera selector */}
        <DeviceGroup
          icon={<Camera size={16} />}
          label="Camera"
          devices={cameras}
          selected={selCamera}
          onSelect={setSelCamera}
        />

        {/* Microphone selector */}
        <DeviceGroup
          icon={<Mic size={16} />}
          label="Microphone"
          devices={mics}
          selected={selMic}
          onSelect={setSelMic}
        />

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} fullWidth>
            Cancel
          </Button>
          <Button onClick={handleSave} fullWidth>
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Helper sub-component ──────────────────────────────────────────────────────

function DeviceGroup({
  icon,
  label,
  devices,
  selected,
  onSelect,
}: {
  icon:      React.ReactNode;
  label:     string;
  devices:   DeviceOption[];
  selected:  string;
  onSelect:  (id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">
        {icon}
        {label}
      </div>
      {devices.length === 0 ? (
        <p className="text-gray-500 text-sm">No {label.toLowerCase()} found</p>
      ) : (
        <div className="space-y-1">
          {devices.map((d) => (
            <button
              key={d.deviceId}
              onClick={() => onSelect(d.deviceId)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors text-left"
            >
              <span className="text-white text-sm truncate">{d.label}</span>
              {selected === d.deviceId && (
                <Check size={14} className="text-indigo-400 flex-shrink-0 ml-2" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}