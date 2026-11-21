import { route } from "../lib/http.js";
import { tokensPost } from "../lib/shortcuts.js";

const handlePOST = route(tokensPost);
export const POST = (request) => handlePOST(request);
