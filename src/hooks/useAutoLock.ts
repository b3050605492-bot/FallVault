import { useEffect, useRef } from 'react';

/**
 * 自动锁定 Hook：
 * - 解锁状态下，监听到用户活动则重置计时器
 * - 闲置超过 autoLockMinutes 分钟 → 触发 onAutoLock
 * - enabled=false 或分钟数<=0 时禁用
 */
export function useAutoLock(
  enabled: boolean,
  minutes: number,
  isUnlocked: boolean,
  onAutoLock: () => void,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    if (!enabled || minutes <= 0 || !isUnlocked) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const timeoutMs = minutes * 60 * 1000;

    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onAutoLock();
      }, timeoutMs);
    };

    const onActivity = () => {
      const now = Date.now();
      // 节流：500ms 内多次活动只更新一次 lastActivity
      if (now - lastActivityRef.current > 500) {
        lastActivityRef.current = now;
      }
      // 每次活动重新计时
      schedule();
    };

    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'wheel', 'touchstart', 'click'];
    events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));

    schedule();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
    };
  }, [enabled, minutes, isUnlocked, onAutoLock]);
}
