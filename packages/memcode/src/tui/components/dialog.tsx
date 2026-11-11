/**
 * Dialog — modal overlay for confirmations and selections.
 *
 * Usage:
 *   const { dialog, confirm, select } = useDialog();
 *
 *   // Simple confirmation
 *   const ok = await confirm("Delete all memories?");
 *
 *   // Selection list
 *   const picked = await select("Choose model", [
 *     { label: "claude-sonnet-4-20250514", value: "sonnet" },
 *     { label: "claude-opus-4-20250514", value: "opus" },
 *   ]);
 */

import { useState, useCallback, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { createTextAttributes } from "@opentui/core";
import { theme } from "../theme.ts";

const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });

// ─── Types ───────────────────────────────────────────────────────────

interface SelectItem {
	label: string;
	value: string;
}

interface DialogState {
	visible: boolean;
	title: string;
	message: string;
	/** null = confirm mode, array = select mode */
	items: SelectItem[] | null;
	selectedIdx: number;
	/** Resolve callback for the active promise */
	resolveRef: React.MutableRefObject<((value: any) => void) | null>;
	/** Reject callback if dialog is cancelled */
	rejectRef: React.MutableRefObject<((reason?: any) => void) | null>;
}

interface DialogAPI {
	dialog: DialogState;
	confirm: (message: string, title?: string) => Promise<boolean>;
	select: (title: string, items: SelectItem[]) => Promise<string | null>;
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useDialog(): DialogAPI {
	const resolveRef = useRef<((value: any) => void) | null>(null);
	const rejectRef = useRef<((reason?: any) => void) | null>(null);

	const [state, setState] = useState<DialogState>({
		visible: false,
		title: "",
		message: "",
		items: null,
		selectedIdx: 0,
		resolveRef,
		rejectRef,
	});

	const close = useCallback(() => {
		setState((s) => ({ ...s, visible: false }));
	}, []);

	const confirm = useCallback(
		(message: string, title = "Confirm"): Promise<boolean> => {
			return new Promise<boolean>((resolve) => {
				resolveRef.current = resolve;
				rejectRef.current = null;
				setState({
					visible: true,
					title,
					message,
					items: null,
					selectedIdx: 0,
					resolveRef,
					rejectRef,
				});
			});
		},
		[]
	);

	const select = useCallback(
		(title: string, items: SelectItem[]): Promise<string | null> => {
			return new Promise<string | null>((resolve) => {
				resolveRef.current = resolve;
				rejectRef.current = null;
				setState({
					visible: true,
					title,
					message: "",
					items,
					selectedIdx: 0,
					resolveRef,
					rejectRef,
				});
			});
		},
		[]
	);

	return { dialog: state, confirm, select };
}

// ─── Keyboard handler (consumed inside Dialog render) ────────────────

function useDialogKeys(
	state: DialogState,
	setState: React.Dispatch<React.SetStateAction<DialogState>>,
	close: () => void
) {
	useKeyboard((e) => {
		if (!state.visible) return;

		// Confirm mode shortcuts
		if (!state.items) {
			if (e.name === "y" || e.name === "return") {
				e.preventDefault();
				close();
				state.resolveRef.current?.(true);
				return;
			}
			if (e.name === "n" || e.name === "escape") {
				e.preventDefault();
				close();
				state.resolveRef.current?.(false);
				return;
			}
			return;
		}

		// Select mode shortcuts
		if (e.name === "escape") {
			e.preventDefault();
			close();
			state.resolveRef.current?.(null);
			return;
		}
		if (e.name === "up" || e.name === "k") {
			e.preventDefault();
			setState((s) => ({
				...s,
				selectedIdx: s.selectedIdx > 0 ? s.selectedIdx - 1 : (s.items?.length ?? 1) - 1,
			}));
			return;
		}
		if (e.name === "down" || e.name === "j") {
			e.preventDefault();
			setState((s) => ({
				...s,
				selectedIdx:
					s.items && s.selectedIdx < s.items.length - 1
						? s.selectedIdx + 1
						: 0,
			}));
			return;
		}
		if (e.name === "return") {
			e.preventDefault();
			const picked = state.items?.[state.selectedIdx];
			close();
			state.resolveRef.current?.(picked?.value ?? null);
			return;
		}
	});
}

// ─── Dialog component ────────────────────────────────────────────────

interface DialogComponentProps {
	state: DialogState;
	setState: React.Dispatch<React.SetStateAction<DialogState>>;
	close: () => void;
}

export function Dialog({ state, setState, close }: DialogComponentProps) {
	useDialogKeys(state, setState, close);

	if (!state.visible) return null;

	const isSelect = state.items !== null;
	const dialogWidth = 40;

	return (
		<box
			position="absolute"
			top={0}
			left={0}
			width="100%"
			height="100%"
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			zIndex={100}
		>
			{/* Backdrop dim — full-screen darkened overlay */}
			<box
				position="absolute"
				top={0}
				left={0}
				width="100%"
				height="100%"
				backgroundColor={theme.bgBase}
				opacity={0.6}
			/>

			{/* Dialog box — centered */}
			<box
				width={dialogWidth}
				flexDirection="column"
				border
				borderColor={theme.brand}
				backgroundColor={theme.bgElevated}
				paddingLeft={1}
				paddingRight={1}
				paddingTop={0}
				paddingBottom={0}
			>
				{/* Title */}
				<box width="100%" height={1} paddingLeft={0} paddingRight={0}>
					<text fg={theme.brand} attributes={BOLD}>
						{state.title}
					</text>
				</box>

				{/* Message or items */}
				{isSelect ? (
					<box width="100%" flexDirection="column">
						{state.items!.map((item, i) => (
							<box
								key={item.value}
								width="100%"
								height={1}
								paddingLeft={0}
								paddingRight={0}
								backgroundColor={
									i === state.selectedIdx
										? theme.brandDim
										: undefined
								}
							>
								<text
									fg={
										i === state.selectedIdx
											? theme.brand
											: theme.textPrimary
									}
									attributes={
										i === state.selectedIdx ? BOLD : undefined
									}
								>
									{i === state.selectedIdx ? "▸ " : "  "}
									{item.label}
								</text>
							</box>
						))}
					</box>
				) : (
					<box width="100%" height={1} paddingLeft={0} paddingRight={0}>
						<text fg={theme.textPrimary}>{state.message}</text>
					</box>
				)}

				{/* Separator */}
				<box
					width="100%"
					height={1}
					flexDirection="row"
					paddingLeft={0}
					paddingRight={0}
				>
					<text fg={theme.bgBorder}>
						{"─".repeat(dialogWidth - 2)}
					</text>
				</box>

				{/* Footer: key hints */}
				<box
					width="100%"
					height={1}
					flexDirection="row"
					paddingLeft={0}
					paddingRight={0}
					gap={2}
				>
					{isSelect ? (
						<>
							<text>
								<span fg={theme.brand} attributes={BOLD}>
									[enter]
								</span>
								<span fg={theme.textSecondary}> confirm</span>
							</text>
							<text>
								<span fg={theme.textMuted} attributes={DIM}>
									[j/k]
								</span>
								<span fg={theme.textSecondary}> navigate</span>
							</text>
							<text>
								<span fg={theme.error} attributes={DIM}>
									[esc]
								</span>
								<span fg={theme.textSecondary}> cancel</span>
							</text>
						</>
					) : (
						<>
							<text>
								<span fg={theme.success} attributes={BOLD}>
									[y]
								</span>
								<span fg={theme.textSecondary}> confirm</span>
							</text>
							<text>
								<span fg={theme.error} attributes={BOLD}>
									[n/esc]
								</span>
								<span fg={theme.textSecondary}> cancel</span>
							</text>
						</>
					)}
				</box>
			</box>
		</box>
	);
}

export type { SelectItem, DialogState };
