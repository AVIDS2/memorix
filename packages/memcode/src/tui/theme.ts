/**
 * Memcode TUI theme token system.
 *
 * All color tokens used across the TUI are defined here for consistency.
 * Import `theme` and use the tokens directly in component props.
 */

export const theme = {
	// Brand
	brand: "#4A9EFF",
	brandDim: "#1e3a5f",

	// Semantic
	success: "#22C55E",
	warning: "#F97316",
	error: "#EF4444",
	info: "#818CF8",

	// Text
	textPrimary: "#F1F5F9",
	textSecondary: "#94A3B8",
	textMuted: "#475569",

	// Background
	bgBase: "#0D1117",
	bgElevated: "#161B22",
	bgBorder: "#30363D",

	// Git status
	gitAdded: "#22C55E",
	gitModified: "#F97316",
	gitDeleted: "#EF4444",
	gitBranch: "#818CF8",

	// Memory
	memHit: "#4A9EFF",
	memPromoted: "#22C55E",
	memExpired: "#475569",
} as const;

export type Theme = typeof theme;
