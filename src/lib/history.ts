import { useEffect, useRef } from "react";
import { onPhone } from "./platform";

// The phone's back button (and the mouse back button on desktop) walks the
// webview's history, so every screen change adds an entry: going back then
// returns to the previous screen instead of closing the app.
export function useHistoryBack<T>(value: T, restore: (v: T) => void) {
  const stack = useRef<T[]>([]);
  const prev = useRef<T | null>(null);
  const popped = useRef(false);
  // The next popstate comes from our own history.back(), not the user.
  const skip = useRef(false);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  useEffect(() => {
    const last = prev.current;
    prev.current = value;
    if (popped.current) {
      popped.current = false;
      return;
    }
    if (last === null || same(last, value)) return;
    // Coming back to the screen just left (a "Volver" button) undoes that step.
    const top = stack.current[stack.current.length - 1];
    if (top !== undefined && same(top, value)) {
      stack.current.pop();
      skip.current = true;
      window.history.back();
      return;
    }
    stack.current.push(last);
    if (stack.current.length > 50) stack.current.shift();
    window.history.pushState({ eureka: stack.current.length }, "");
  }, [value]);

  useEffect(() => {
    const onPop = () => {
      if (skip.current) {
        skip.current = false;
        return;
      }
      const r = stack.current.pop();
      if (r === undefined) return;
      popped.current = true;
      restoreRef.current(r);
    };
    window.addEventListener("popstate", onPop);
    // Android hands the back button to the app: walk our history, and close
    // the app only when there is nothing left to go back to.
    let listener: Promise<{ unregister: () => Promise<void> } | null> = Promise.resolve(null);
    if (onPhone()) {
      listener = import("@tauri-apps/api/app")
        .then(({ onBackButtonPress, exit }) => onBackButtonPress(() => (stack.current.length ? window.history.back() : void exit(0))))
        .catch(() => null);
    }
    return () => {
      window.removeEventListener("popstate", onPop);
      listener.then((l) => l?.unregister());
    };
  }, []);
}

function same<T>(a: T, b: T): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
}
