import { route } from "../lib/http.js";
import { homePost } from "../lib/home.js";

const handlePOST = route(homePost);
export const POST = (request) => handlePOST(request);
