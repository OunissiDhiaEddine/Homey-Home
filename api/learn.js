import { route } from "../lib/http.js";
import { learnPost } from "../lib/device.js";

const handlePOST = route(learnPost);
export const POST = (request) => handlePOST(request);
