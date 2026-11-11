/**
 * Toast notification system.
 *
 * Provides useToast() hook for spawning ephemeral notifications,
 * and ToastContainer to render them in a top-right vertical stack.
 *
 * Auto-dismisses after 2500ms. Supports info, success, error types.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { theme } from "../theme.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastType = "info" | "success" | "error";

interface Toast {
	id: number;
	msg: string;
	type: ToastType;
}

interface ToastContainerProps {
	toasts: Toast[];
}

// ---------------------------------------------------------------------------
// Color map
// ---------------------------------------------------------------------------

const TOAST_COLORS: Record<ToastType, string> = {
	info: theme.brand,
	success: theme.success,
	error: theme.error,
};

const TOAST_ICONS: Record<ToastType, string> = {
	info: "i",
	success: "✓", // checkmark
	error: "✗",   // cross
};

// ---------------------------------------------------------------------------
// ToastContainer
// ---------------------------------------------------------------------------

function ToastContainer({ toasts }: ToastContainerProps) {
	if (toasts.length === 0) return null;

	return (
		<box flexDirection="column" paddingLeft={1} paddingRight={1}>
			{toasts.map((t) => {
				const color = TOAST_COLORS[t.type];
				const icon = TOAST_ICONS[t.type];
				return (
					<box key={t.id} marginBottom={0}>
						<text>
							<span fg={color}>[{icon}] </span>
							<span fg={theme.textPrimary}>{t.msg}</span>
						</text>
					</box>
				);
			})}
		</box>
	);
}

// ---------------------------------------------------------------------------
// useToast hook
// ---------------------------------------------------------------------------

const DISMISS_MS = 2500;

function useToast() {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const nextId = useRef(0);

	const show = useCallback((msg: string, type: ToastType = "info") => {
		const id = nextId.current++;
		setToasts((prev) => [...prev, { id, msg, type }]);

		setTimeout(() => {
			setToasts((prev) => prev.filter((t) => t.id !== id));
		}, DISMISS_MS);
	}, []);

	return { toasts, show };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { ToastContainer, useToast };
export type { Toast, ToastContainerProps, ToastType };
