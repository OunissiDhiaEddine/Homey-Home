// Siri & Shortcuts: POST with "Authorization: Bearer <token>". See lib/shortcuts.js.
import { shortcutRoute, shortcutPost } from "../lib/shortcuts.js";

const handlePOST = shortcutRoute(shortcutPost);
export const POST = (request) => handlePOST(request);
