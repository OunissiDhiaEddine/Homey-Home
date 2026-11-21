import { route } from "../lib/http.js";
import { sessionPost } from "../lib/auth.js";
import { sessionGet } from "../lib/device.js";

const handleGET = route(sessionGet);
export const GET = (request) => handleGET(request);
const handlePOST = route(sessionPost);
export const POST = (request) => handlePOST(request);
