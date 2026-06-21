/**
 * Memcode TUI theme token system.
 *
 * Muted, sophisticated palette for a modern developer tool aesthetic.
 * All color tokens used across the TUI are defined here for consistency.
 * Import `theme` and use the tokens directly in component props.
 *
 * Design principles:
 * - Muted monochromatic colors (slate gray, dark charcoal, dim white)
 * - Non-essential text has low contrast (dimmed)
 * - Red reserved for fatal errors only
 * - Subtle pastel accents for interactive elements
 */

export const theme = {
	// Brand — subtle, not screaming
	brand: "#7C8AFF", // soft indigo
	brandDim: "#3D4273", // dark muted indigo

	// Semantic — muted, not neon
	success: "#6BCB77", // soft green
	warning: "#E8A838", // warm amber
	error: "#E85D5D", // muted red — fatal only
	info: "#9BA4B5", // cool gray-blue

	// Text — sophisticated hierarchy
	textPrimary: "#E2E8F0", // soft white, not pure white
	textSecondary: "#8B95A5", // medium gray
	textMuted: "#4A5568", // dim gray for metadata

	// Background — deep, not black
	bgBase: "#0F1117", // deep dark blue-black
	bgElevated: "#1A1D27", // slightly lighter for header/footer
	bgBorder: "#2D3148", // subtle border

	// Surface colors for cards/panels
	bgSurface: "#151821", // card background
	bgSurfaceHover: "#1E2233", // hover state
	borderSubtle: "#252940", // very subtle borders

	// Git — muted
	gitAdded: "#6BCB77",
	gitModified: "#E8A838",
	gitDeleted: "#E85D5D",
	gitBranch: "#9BA4B5",

	// Memory — subtle
	memHit: "#7C8AFF",
	memPromoted: "#6BCB77",
	memExpired: "#4A5568",
} as const;

export type Theme = typeof theme;
