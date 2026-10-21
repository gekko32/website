// Content publish pipeline (T001490 Task 6).
//
// Admin saves for any of the 13 content domains now go through this
// module instead of the legacy `site_settings` / `service_config` /
// `leistungen_config` / `referenzen_config` / `homepage_block_*` DB
// writes. The pipeline:
//
//   1. Zod-validate the payload against the matching `ContentBundleSchema`
//      entry — fail-closed 422 if invalid (no GitHub call is made).
//   2. Read the current blob SHA for the file in main. If the editor's
//      `baseSha` does not match the live SHA → 409 with the current
//      SHA + value, so the editor can show a "stale, rebase"
//      diff and the user can re-try.
//   3. Create a branch `content/<brand>-<domain>-<Date.now()>`,
//      PUT the new file content on that branch with the
//      current blob SHA (so the write is race-free on the branch
//      level too), open a PR labelled `content` and squash-merge it
//      right away. The bot token is fine-grained and
//      scoped to `contents: write` + `pull-requests: write`.
//
// All GitHub interactions are routed through the injectable
// `GitHubClient` so unit tests can drive the 409/200/422 matrix
// without a real network round-trip. The default `realGitHubClient`
// reads `GITHUB_CONTENT_TOKEN` + `CONTENT_REPO` + `CONTENT_BRANCH_BASE`
// + `CONTENT_PATH_PREFIX` from env.
import { ContentBundleSchema, type Domain, type SchemaOf } from '../content-schema';
import { logger } from './logger';

/** Default repo for the content PR. */
const DEFAULT_REPO = process.env.CONTENT_REPO || 'gekko32/website';
const DEFAULT_BASE = process.env.CONTENT_BRANCH_BASE || 'main';
/** Bundle directory inside CONTENT_REPO. In gekko32/website the bundle lives at the
 *  repo root (`content/`), in the former monorepo under `components/website/content`. */
const CONTENT_PATH_PREFIX = (process.env.CONTENT_PATH_PREFIX || 'content').replace(/\/+$/, '');
const FILE_PATH = (brand: string, domain: Domain) => `${CONTENT_PATH_PREFIX}/${brand}/${domain}.json`;

/** Per-request result of `publishContent`. */
export type PublishResult =
  | { ok: true; sha: string; prNumber: number; prUrl: string }
  | { ok: false; status: 409; currentSha: string; currentValue: unknown }
  | { ok: false; status: 422; errors: string[] };

/** Minimal surface the pipeline needs from the GitHub API. */
export interface GitHubClient {
  getFile(opts: { repo: string; path: string; ref?: string }): Promise<{ sha: string; value: unknown }>;
  createBranch(opts: { repo: string; name: string; fromRef: string }): Promise<void>;
  putFile(opts: { repo: string; branch: string; path: string; content: string; sha: string }): Promise<{ sha: string }>;
  openPr(opts: {
    repo: string;
    branch: string;
    base: string;
    title: string;
    body: string;
    labels: string[];
    squash: boolean;
    autoMerge: boolean;
  }): Promise<{ prNumber: number; prUrl: string }>;
}

/** Branch-name format `content/<brand>-<domain>-<Date.now()>`. */
function branchNameFor(brand: string, domain: Domain, ts = Date.now()): string {
  return `content/${brand}-${domain}-${ts}`;
}

function jsonStringify(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

export interface PublishInput {
  brand: string;
  domain: Domain;
  payload: unknown;
  baseSha: string | null;
  editor: string;
  client?: GitHubClient;
}

export async function publishContent(input: PublishInput): Promise<PublishResult> {
  const { brand, domain, payload, baseSha, editor } = input;
  const client = input.client ?? realGitHubClient;
  const repo = DEFAULT_REPO;
  const base = DEFAULT_BASE;
  const filePath = FILE_PATH(brand, domain);

  // 1. Zod-validate (fail-closed 422, no GitHub call)
  const schema = ContentBundleSchema[domain];
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      status: 422,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }

  // 2. Read current blob SHA for optimistic-concurrency check
  const current = await client.getFile({ repo, path: filePath, ref: base });
  if (baseSha !== null && baseSha !== current.sha) {
    return {
      ok: false,
      status: 409,
      currentSha: current.sha,
      currentValue: current.value,
    };
  }

  // 3. Branch → PUT → PR with squash + auto-merge
  const branch = branchNameFor(brand, domain);
  await client.createBranch({ repo, name: branch, fromRef: base });
  const put = await client.putFile({
    repo,
    branch,
    path: filePath,
    content: jsonStringify(parsed.data as SchemaOf<typeof domain>),
    sha: current.sha,
  });
  const pr = await client.openPr({
    repo,
    branch,
    base,
    title: `content(${brand}/${domain}): admin save by ${editor}`,
    body: `T001490 bot-PR content publish.\n\nEditor: ${editor}\nDomain: ${brand}/${domain}\n`,
    labels: ['content'],
    squash: true,
    autoMerge: true,
  });

  return { ok: true, sha: put.sha, prNumber: pr.prNumber, prUrl: pr.prUrl };
}

/**
 * Real GitHub client (production path). Constructed lazily so the
 * bot token is only required in a running server, never at import
 * time. Throws if the env is not set.
 */
export const realGitHubClient: GitHubClient = {
  async getFile({ repo, path, ref }) {
    const token = requireToken();
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, {
      headers: ghHeaders(token),
    });
    if (!r.ok) throw new Error(`github getFile ${path} ${r.status}`);
    const body = await r.json() as { sha: string; content: string; encoding?: string };
    return { sha: body.sha, value: decodeContent(body.content, body.encoding) };
  },
  async createBranch({ repo, name, fromRef }) {
    const token = requireToken();
    const refRes = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/${encodeURIComponent(fromRef)}`, {
      headers: ghHeaders(token),
    });
    if (!refRes.ok) throw new Error(`github ref ${fromRef} ${refRes.status}`);
    const refBody = await refRes.json() as { object: { sha: string } };
    const r = await fetch(`https://api.github.com/repos/${repo}/git/refs`, {
      method: 'POST',
      headers: ghHeaders(token),
      body: JSON.stringify({ ref: `refs/heads/${name}`, sha: refBody.object.sha }),
    });
    if (!r.ok && r.status !== 422) throw new Error(`github createBranch ${name} ${r.status}`);
  },
  async putFile({ repo, branch, path, content, sha }) {
    const token = requireToken();
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: ghHeaders(token),
      body: JSON.stringify({
        message: `content(${branch}): update`,
        branch,
        sha,
        content: Buffer.from(content, 'utf8').toString('base64'),
      }),
    });
    if (!r.ok) throw new Error(`github putFile ${path} ${r.status}`);
    const body = await r.json() as { commit: { sha: string } };
    return { sha: body.commit.sha };
  },
  async openPr({ repo, branch, base, title, body, labels, squash, autoMerge }) {
    const token = requireToken();
    const r = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
      method: 'POST',
      headers: ghHeaders(token),
      body: JSON.stringify({ title, head: branch, base, body, labels }),
    });
    if (!r.ok) throw new Error(`github openPr ${r.status}`);
    const created = await r.json() as { number: number; html_url: string };
    if (squash || autoMerge) {
      // Merge directly with squash. GitHub's auto-merge needs branch protection
      // with required checks, which gekko32/website does not have, and REST has
      // no auto-merge endpoint. Failure is non-fatal: the PR stays open for a
      // manual merge.
      await mergePr(token, repo, created.number, branch, title);
    }
    return { prNumber: created.number, prUrl: created.html_url };
  },
};

/** Squash-merges the PR and deletes its branch. GitHub answers 405 while it is
 *  still computing mergeability right after the PR was opened, so retry briefly. */
async function mergePr(token: string, repo: string, prNumber: number, branch: string, title: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/merge`, {
      method: 'PUT',
      headers: ghHeaders(token),
      body: JSON.stringify({ merge_method: 'squash', commit_title: `${title} (#${prNumber})` }),
    });
    if (r.ok) {
      await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, {
        method: 'DELETE',
        headers: ghHeaders(token),
      });
      return;
    }
    if (r.status !== 405 || attempt === 4) {
      logger.warn({ status: r.status, prNumber }, '[content-publish] merge failed, PR left open');
      return;
    }
    await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
  }
}

function requireToken(): string {
  const t = process.env.GITHUB_CONTENT_TOKEN;
  if (!t) throw new Error('GITHUB_CONTENT_TOKEN is required for realGitHubClient');
  return t;
}

function ghHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  };
}

function decodeContent(b64: string, encoding?: string): unknown {
  if (encoding !== 'base64') return b64;
  const text = Buffer.from(b64.replace(/\n/g, ''), 'base64').toString('utf8');
  try { return JSON.parse(text); } catch { return text; }
}
