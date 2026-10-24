// Test fixture: stands in for the dashboard.
import { createServer } from "node:http";
createServer((_, res) => res.end("hello dashboard pid=" + process.pid))
  .listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
