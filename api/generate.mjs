import { handler as netlifyHandler } from "../netlify/functions/generate.mjs";

export default async function handler(request, response) {
  const body = typeof request.body === "string"
    ? request.body
    : JSON.stringify(request.body || {});

  const result = await netlifyHandler({
    httpMethod: request.method,
    body
  });

  for (const [name, value] of Object.entries(result.headers || {})) {
    response.setHeader(name, value);
  }
  response.status(result.statusCode || 200).send(result.body || "");
}
