import { health } from "../lib/device.js";
import { json } from "../lib/http.js";

export function GET() {
  return json(health(process.env));
}
