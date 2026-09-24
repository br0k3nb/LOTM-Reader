import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals }) => {
  return json(
    { user: locals.user },
    { headers: { "cache-control": "no-store" } },
  );
};
