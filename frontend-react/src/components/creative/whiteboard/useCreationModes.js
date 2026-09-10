import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client.js';

export function useCreationModes() {
  const [catalog, setCatalog] = useState({ status: 'loading', whiteboard: null, error: '' });
  const requestRef = useRef(0);
  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    setCatalog(previous => ({ ...previous, status: 'loading', error: '' }));
    try {
      const result = await api.getCreationModes();
      if (request !== requestRef.current) return;
      if (!result?.success || !result.whiteboard?.visualPresets?.length) throw new Error('服务端尚未提供白板创作模式。');
      setCatalog({ status: 'ready', ...result, error: '' });
    } catch (error) {
      if (request === requestRef.current) setCatalog({ status: 'failed', whiteboard: null, error: error?.message || '加载创作模式失败，请检查服务连接。' });
    }
  }, []);
  useEffect(() => {
    reload();
    return () => { requestRef.current += 1; };
  }, [reload]);
  return { ...catalog, reload };
}
