import handler, { config } from "./sync-scanntech-run.js";
export { config };
export default function statusHandler(req, res) {
  req.url = "/api/sync-scanntech/status";
  req.method = "GET";
  return handler(req, res);
}
