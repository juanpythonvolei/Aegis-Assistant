import { WifiOff } from 'lucide-react';
import React, { useEffect, useState } from 'react';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 flex items-center gap-2 rounded-xl border border-amber-500/50 bg-[#1A1308]/95 px-4 py-2 text-xs font-medium text-amber-200 shadow-2xl"
    >
      <WifiOff className="h-3.5 w-3.5 text-amber-400 shrink-0" />
      <span>Modo Offline — Interface em cache; reconecte para sincronizar nuvem e dispositivos.</span>
    </div>
  );
};
