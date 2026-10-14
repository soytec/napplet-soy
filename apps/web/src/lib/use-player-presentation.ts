import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Fullscreen is a layer above the expanded player; neither layer moves its iframe. */
export function usePlayerPresentation(
  wrapper: RefObject<HTMLDivElement | null>,
  immersive: boolean,
  modalOpen: boolean,
  onEnter?: () => void,
  onExit?: () => void,
) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const lastNativeExit = useRef(-Infinity);
  const nativeRequest = useRef(0);
  const returnScroll = useRef<{ x: number; y: number } | null>(null);
  const expanded = immersive || localExpanded;
  const expandedNow = useRef(expanded);
  const restoreScroll = useCallback(() => {
    if (returnScroll.current)
      window.scrollTo({
        left: returnScroll.current.x,
        top: returnScroll.current.y,
        behavior: 'instant',
      });
  }, []);

  const exitNative = useCallback(() => {
    if (document.fullscreenElement === wrapper.current)
      void document.exitFullscreen().catch(() => {});
  }, [wrapper]);
  const leave = useCallback(() => {
    nativeRequest.current++;
    expandedNow.current = false;
    exitNative();
    setLocalExpanded(false);
    if (immersive) onExit?.();
  }, [exitNative, immersive, onExit]);
  const enterNative = useCallback(() => {
    if (!expanded) {
      returnScroll.current = { x: scrollX, y: scrollY };
      if (onEnter) onEnter();
      else setLocalExpanded(true);
    }
    // Keep this synchronous with the click. Verification/navigation must not consume activation.
    try {
      const request = ++nativeRequest.current;
      void wrapper.current
        ?.requestFullscreen()
        .then(() => {
          if (nativeRequest.current !== request) exitNative();
        })
        .catch(() => {});
    } catch {
      // Unsupported browsers still have the expanded player and visible exit.
    }
  }, [expanded, onEnter, wrapper, exitNative]);

  useEffect(() => {
    let wasNative = document.fullscreenElement === wrapper.current;
    const changed = () => {
      const native = document.fullscreenElement === wrapper.current;
      if (wasNative && !native) {
        // Browsers differ in the ordering of fullscreenchange and the same Escape key.
        lastNativeExit.current = performance.now();
        wrapper.current?.focus({ preventScroll: true });
        if (!expandedNow.current) {
          restoreScroll();
          returnScroll.current = null;
        }
      }
      wasNative = native;
      setFullscreen(native);
    };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, [wrapper, restoreScroll]);

  useLayoutEffect(() => {
    expandedNow.current = expanded;
    if (!expanded) {
      nativeRequest.current++;
      exitNative(); // Browser Back can change route while native fullscreen is open.
      if (!document.fullscreenElement) returnScroll.current = null;
      return;
    }
    const node = wrapper.current;
    if (!node) return;
    returnScroll.current ??= { x: scrollX, y: scrollY };
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Keep the iframe in place and make every background branch non-interactive.
    const siblings = new Map<HTMLElement, boolean>();
    for (let branch: HTMLElement = node; branch.parentElement; branch = branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          siblings.set(sibling, sibling.inert);
          sibling.inert = true;
        }
      }
      if (branch.parentElement === document.body) break;
    }
    node.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      for (const [sibling, inert] of siblings) sibling.inert = inert;
      if (
        previousFocus instanceof HTMLElement &&
        previousFocus !== document.body &&
        previousFocus.isConnected
      )
        previousFocus.focus({ preventScroll: true });
      else if (node.isConnected) node.focus({ preventScroll: true });
      restoreScroll();
    };
  }, [expanded, exitNative, wrapper, restoreScroll]);

  const escape = useCallback(() => {
    if (
      !expanded ||
      modalOpen ||
      document.fullscreenElement ||
      performance.now() - lastNativeExit.current <= 250
    )
      return false;
    leave();
    return true;
  }, [expanded, modalOpen, leave]);

  useEffect(() => {
    if (!expanded || modalOpen) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' && escape()) event.preventDefault();
      if (event.key === 'Tab') {
        const controls = [
          ...(wrapper.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], iframe',
          ) ?? []),
        ].filter((control) => !control.closest('[inert]') && control.getClientRects().length);
        const active = document.activeElement;
        if (
          (event.shiftKey && (active === controls[0] || active === wrapper.current)) ||
          (!event.shiftKey && active === controls.at(-1))
        ) {
          event.preventDefault();
          (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
        }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [expanded, escape, modalOpen, wrapper]);

  return { expanded, fullscreen, enterNative, exitNative, leave, escape };
}
