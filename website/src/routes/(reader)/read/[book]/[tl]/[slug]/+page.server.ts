import { error } from "@sveltejs/kit";
import { db } from "$lib/db";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const slug = Number(params.slug);
  if (!Number.isInteger(slug) || slug < 0) throw error(400, "Invalid chapter");

  // Direct DB query (no HTTP self-fetch: simpler + one less failure domain).
  const rows = await db()`
    SELECT book, tl, slug, title, category, section, idx, discussion, html
    FROM chapters
    WHERE book = ${params.book} AND tl = ${params.tl} AND slug = ${slug}
    LIMIT 1
  `;

  if (rows.length === 0) {
    const probe = await db()`SELECT count(*)::int AS n FROM chapters`;
    throw error(
      404,
      `Chapter not found [${params.book}/${params.tl}/${slug} rows=${probe[0]?.n ?? "?"}]`
    );
  }
  return { chapter: rows[0] };
};
