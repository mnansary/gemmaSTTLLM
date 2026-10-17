import { useEffect, useRef } from 'react';

interface WaveformVisualizerProps {
  active: boolean;
}

export function WaveformVisualizer({ active }: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const dataRef = useRef<number[]>(new Array(300).fill(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const centerY = height / 2;

    const animate = () => {
      dataRef.current.shift();
      const noise = active
        ? (Math.random() - 0.5) * 2 * (0.4 + Math.random() * 0.6)
        : (Math.random() - 0.5) * 2 * 0.03;
      dataRef.current.push(noise);

      ctx.clearRect(0, 0, width, height);

      // Draw baseline
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw waveform
      ctx.beginPath();
      const step = width / (dataRef.current.length - 1);
      for (let i = 0; i < dataRef.current.length; i++) {
        const x = i * step;
        const y = centerY + dataRef.current[i]! * (height * 0.38);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      if (active) {
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, '#3b82f6');
        gradient.addColorStop(0.5, '#60a5fa');
        gradient.addColorStop(1, '#3b82f6');
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(59, 130, 246, 0.4)';
        ctx.shadowBlur = 8;
      } else {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 0;
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Fill area under curve when active
      if (active) {
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        for (let i = 0; i < dataRef.current.length; i++) {
          const x = i * step;
          const y = centerY + dataRef.current[i]! * (height * 0.38);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, centerY);
        ctx.closePath();
        const fillGrad = ctx.createLinearGradient(0, 0, 0, height);
        fillGrad.addColorStop(0, 'rgba(59, 130, 246, 0.08)');
        fillGrad.addColorStop(0.5, 'rgba(59, 130, 246, 0.02)');
        fillGrad.addColorStop(1, 'rgba(59, 130, 246, 0.08)');
        ctx.fillStyle = fillGrad;
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animate();
    return () => cancelAnimationFrame(animRef.current);
  }, [active]);

  return (
    <div className="relative w-full h-28 rounded-xl overflow-hidden bg-gradient-to-b from-slate-800/50 to-slate-900/50 border border-slate-700/40">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ width: '100%', height: '100%' }}
      />
      {!active && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-slate-500 font-medium tracking-wide uppercase">
            Waiting for speech…
          </span>
        </div>
      )}
    </div>
  );
}
