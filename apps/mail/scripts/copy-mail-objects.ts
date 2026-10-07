// Copies every object of one R2 bucket into another through the Cloudflare
// API, for the one-time move of Mail's stored mail from the app Worker's
// bucket to the bucket of the inbox Worker. Objects that the target already
// has are skipped, so a second run copies only what is missing. It prints
// counts only.
//
//   node apps/mail/scripts/copy-mail-objects.ts <source bucket> <target bucket>
//
// It reads CLOUDFLARE_API_TOKEN (with Workers R2 Storage edit) and
// CLOUDFLARE_ACCOUNT_ID from the environment. The body and the content type
// of each object are copied; R2 custom metadata is not, and nothing reads it.
import process from "node:process";
import * as Schema from "effect/Schema";

const [source, target] = process.argv.slice(2);
const token = process.env["CLOUDFLARE_API_TOKEN"];
const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
if (!source || !target || !token || !accountId) {
  throw new Error(
    "Usage: node apps/mail/scripts/copy-mail-objects.ts <source bucket> <target bucket>, with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID set.",
  );
}

const bucketsUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`;
const authorization = `Bearer ${token}`;

const ListPage = Schema.Struct({
  result: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      httpMetadata: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({ contentType: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
        ),
      ),
    }),
  ),
  result_info: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        cursor: Schema.optionalKey(Schema.NullOr(Schema.String)),
        is_truncated: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
      }),
    ),
  ),
});

async function* objects(bucket: string) {
  let cursor: string | undefined;
  while (true) {
    const url = new URL(`${bucketsUrl}/${bucket}/objects`);
    url.searchParams.set("per_page", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, { headers: { authorization } });
    if (!response.ok) throw new Error(`Listing ${bucket} failed with HTTP ${response.status}.`);
    const page = Schema.decodeUnknownSync(ListPage)(await response.json());
    yield* page.result;
    const info = page.result_info;
    if (!info?.cursor || info.is_truncated === false || page.result.length === 0) return;
    cursor = info.cursor;
  }
}

// Slashes in a key stay literal; every other reserved character is encoded.
const objectUrl = (bucket: string, key: string) =>
  `${bucketsUrl}/${bucket}/objects/${key.split("/").map(encodeURIComponent).join("/")}`;

const existing = new Set<string>();
for await (const object of objects(target)) existing.add(object.key);

let copied = 0;
let skipped = 0;
for await (const object of objects(source)) {
  if (existing.has(object.key)) {
    skipped += 1;
    continue;
  }
  const read = await fetch(objectUrl(source, object.key), { headers: { authorization } });
  if (!read.ok) throw new Error(`Reading an object failed with HTTP ${read.status}.`);
  const contentType =
    object.httpMetadata?.contentType ??
    read.headers.get("content-type") ??
    "application/octet-stream";
  const write = await fetch(objectUrl(target, object.key), {
    method: "PUT",
    headers: { authorization, "content-type": contentType },
    body: await read.arrayBuffer(),
  });
  if (!write.ok) throw new Error(`Writing an object failed with HTTP ${write.status}.`);
  copied += 1;
}
console.log(`Copied ${copied} objects, skipped ${skipped} that ${target} already had.`);
