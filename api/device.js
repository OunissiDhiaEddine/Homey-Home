import { route } from "../lib/http.js";
import { devicePost } from "../lib/device.js";

const handlePOST = route(devicePost);
export const POST = (request) => handlePOST(request);
