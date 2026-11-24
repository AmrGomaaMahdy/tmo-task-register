/**
 * The "Under development" mark shown beside the page titles. Build with VITE_APP_STAGE empty (or "off")
 * to remove it once the application is in production, or with another text, for example "Pilot".
 */
const raw = import.meta.env.VITE_APP_STAGE as string | undefined;
const stage = raw === undefined ? 'Under development' : raw.trim();
export const APP_STAGE = /^(off|none|false|hide)$/i.test(stage) ? '' : stage;
export const STAGE_TIP = 'This application is still under development: features may change, and the data shown may be sample data.';
