import { route } from "../lib/http.js";
import { climateGet } from "../lib/device.js";

const handleGET = route(climateGet);
export const GET = (request) => handleGET(request);
