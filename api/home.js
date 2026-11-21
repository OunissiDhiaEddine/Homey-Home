import { route } from "../lib/http.js";
import { homePost } from "../lib/home.js";
import { homeGet } from "../lib/device.js";

const handleGET = route(homeGet);
export const GET = (request) => handleGET(request);
const handlePOST = route(homePost);
export const POST = (request) => handlePOST(request);
