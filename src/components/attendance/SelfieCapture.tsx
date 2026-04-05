'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { Camera, RotateCcw, Check, X } from 'lucide-react'
import { startCamera, capturePhoto, stopCamera } from '@/lib/attendance/camera'

type Props = {
  onCapture: (dataUrl: string) => void
  onSkip?: () => void
  canSkip?: boolean
}

export default function SelfieCapture({ onCapture, onSkip, canSkip }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [captured, setCaptured] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const initCamera = useCallback(async () => {
    if (!videoRef.current) return
    const result = await startCamera(videoRef.current)
    if (result.status === 'success') {
      setCameraReady(true)
    } else {
      setError(result.error ?? 'No se pudo abrir la cámara')
    }
  }, [])

  useEffect(() => {
    initCamera()
    return () => {
      if (videoRef.current) stopCamera(videoRef.current)
    }
  }, [initCamera])

  const handleCapture = () => {
    if (!videoRef.current) return
    const photo = capturePhoto(videoRef.current)
    if (photo) {
      setCaptured(photo)
      stopCamera(videoRef.current)
    }
  }

  const handleRetry = () => {
    setCaptured(null)
    setCameraReady(false)
    initCamera()
  }

  const handleConfirm = () => {
    if (captured) onCapture(captured)
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <div className="flex size-12 items-center justify-center rounded-full bg-red-50">
          <X className="size-5 text-[#ea504c]" />
        </div>
        <p className="text-center text-sm text-[#ea504c]">{error}</p>
        {canSkip && (
          <button
            onClick={onSkip}
            className="mt-2 rounded-xl bg-[#f5f2ee] px-4 py-2 text-sm font-medium text-[#3d2c24]"
          >
            Continuar sin foto
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative overflow-hidden rounded-2xl bg-black" style={{ width: 280, height: 210 }}>
        {!captured ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />
        ) : (
          <img src={captured} alt="Selfie" className="h-full w-full object-cover" />
        )}

        {!cameraReady && !captured && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="size-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          </div>
        )}
      </div>

      {!captured ? (
        <div className="flex gap-2">
          <button
            onClick={handleCapture}
            disabled={!cameraReady}
            className="flex items-center gap-2 rounded-xl bg-[#006d5a] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform active:scale-95 disabled:opacity-40"
          >
            <Camera className="size-4" />
            Capturar
          </button>
          {canSkip && (
            <button
              onClick={onSkip}
              className="rounded-xl bg-[#f5f2ee] px-4 py-2.5 text-sm font-medium text-[#3d2c24]"
            >
              Omitir
            </button>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={handleRetry}
            className="flex items-center gap-2 rounded-xl bg-[#f5f2ee] px-4 py-2.5 text-sm font-medium text-[#3d2c24]"
          >
            <RotateCcw className="size-4" />
            Reintentar
          </button>
          <button
            onClick={handleConfirm}
            className="flex items-center gap-2 rounded-xl bg-[#006d5a] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform active:scale-95"
          >
            <Check className="size-4" />
            Usar foto
          </button>
        </div>
      )}
    </div>
  )
}
