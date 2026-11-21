import { route } from "../lib/http.js";
import { sendPost } from "../lib/device.js";

const handlePOST = route(sendPost);
export const POST = (request) => handlePOST(request);
