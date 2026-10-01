import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

// Read-only upstream research. No dependency installs or upstream scripts run.
const exec = promisify(execFile);
const directoryUrl = "https://www.convex.dev/components/llms.txt";
const titles = new Set([
  "Resend",
  "Loops",
  "Cloudflare Email Sending",
  "Agentmail",
  "Sweego",
  "convex-inbound",
  "Email Queue",
  "Convex Invite-links",
  "useSend",
  "Suppression List",
  "Email SDK",
  "Invite",
  "Brevo",
  "treg",
  "AWS SES",
  "AutoSend",
  "Cloudflare Email Sender",
  "Lettermint",
  "Notifications Inbox",
  "Notification",
  "Invitations",
]);

async function getText(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response.text();
}

function stringField(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null || !(key in value)) return null;
  const field: unknown = Reflect.get(value, key);
  return typeof field === "string" ? field : null;
}

function repositoryUrl(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("repository" in value)) return null;
  const repository: unknown = value.repository;
  const raw = typeof repository === "string" ? repository : stringField(repository, "url");
  if (!raw) return null;
  const match = raw.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/);
  if (!match) return null;
  return `https://github.com/${match[1]}/${match[2].replace(/\.git$/, "")}`;
}

const destination = await mkdtemp(join(tmpdir(), "convex-email-research-"));
const catalog = await getText(directoryUrl);
await writeFile(join(destination, "directory.txt"), catalog);
const entries = catalog
  .split(/^## /m)
  .slice(1)
  .flatMap((section) => {
    const title = section.split("\n")[0].trim();
    if (!titles.has(title)) return [];
    const field = (name: string) => {
      const value = section.split("\n").find((line) => line.startsWith(`- ${name}: `));
      if (!value) throw new Error(`Missing ${name} for ${title}`);
      return value.slice(name.length + 4).trim();
    };
    return [
      {
        title,
        directory: field("URL"),
        markdown: field("Markdown"),
        listedVersion: field("Version"),
        package: decodeURIComponent(field("npm").split("/package/")[1]),
      },
    ];
  });

const missing = [...titles].filter((title) => !entries.some((entry) => entry.title === title));
const snapshots = [];
for (let start = 0; start < entries.length; start += 4) {
  const batch = await Promise.all(
    entries.slice(start, start + 4).map(async (entry) => {
      const slug = entry.package.replace(/^@/, "").replaceAll("/", "--");
      try {
        const raw = await getText(
          `https://registry.npmjs.org/${encodeURIComponent(entry.package)}/latest`,
        );
        const metadata: unknown = JSON.parse(raw);
        await writeFile(join(destination, `${slug}.npm.json`), raw);
        await writeFile(join(destination, `${slug}.directory.md`), await getText(entry.markdown));
        const repository = repositoryUrl(metadata);
        const result = {
          ...entry,
          slug,
          npmVersion: stringField(metadata, "version"),
          license: stringField(metadata, "license"),
          npmGitHead: stringField(metadata, "gitHead"),
          repository,
        };
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return { status: "fetched", ...result };
      } catch (error) {
        return { status: "failed", ...entry, error: String(error) };
      }
    }),
  );
  snapshots.push(...batch);
}

const repositories = [
  ...new Set(
    snapshots.flatMap((item) => ("repository" in item && item.repository ? [item.repository] : [])),
  ),
];
const sources = [];
for (let start = 0; start < repositories.length; start += 4) {
  sources.push(
    ...(await Promise.all(
      repositories.slice(start, start + 4).map(async (repository) => {
        const slug = repository.slice("https://github.com/".length).replaceAll("/", "--");
        const path = join(destination, slug);
        try {
          await exec("git", ["clone", "--depth", "1", "--quiet", `${repository}.git`, path], {
            timeout: 90_000,
          });
          const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: path });
          const { stdout: timestamp } = await exec("git", ["show", "-s", "--format=%cI", "HEAD"], {
            cwd: path,
          });
          return {
            status: "cloned",
            repository,
            path,
            commit: stdout.trim(),
            timestamp: timestamp.trim(),
          };
        } catch (error) {
          return { status: "failed", repository, error: String(error) };
        }
      }),
    )),
  );
}

const inventory = {
  capturedAt: new Date().toISOString(),
  directoryUrl,
  missing,
  packages: snapshots,
  sources,
};
await writeFile(join(destination, "inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ destination, missing, sources }, null, 2)}\n`);
